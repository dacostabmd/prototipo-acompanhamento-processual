import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { getAdminClient, trackEvento } from '@/lib/track';
import { buscarProcessoPorNumero } from '@/lib/motorConsulta';
import { enviarAlertaMovimentacao } from '@/lib/email';
import type { Movement } from '@/lib/mockProcesses';

// Vercel Hobby: Route Handlers podem declarar maxDuration até 60s (o limite de 10s é só o default
// das antigas Serverless Functions sem declaração explícita). 60s não é suficiente para processar
// um dia inteiro de reconsultas de uma vez só — por isso o loop abaixo também para de INICIAR novos
// processos a partir de ORCAMENTO_TEMPO_MS (conservador, abaixo do teto da function), deixando o
// restante para a próxima invocação do cron (amanhã). Não há paginação entre invocações: o processo
// que não coube hoje simplesmente continua com proxima_consulta_em <= now() e é pego de novo amanhã,
// na frente da fila (ORDER BY ultima_consulta_em ASC), então nenhum processo fica permanentemente preterido.
export const maxDuration = 60;

const ORCAMENTO_TEMPO_MS = 50_000; // margem de 10s abaixo do maxDuration para fechar a resposta com folga
const TAMANHO_LOTE = 8; // processos buscados em paralelo por rodada (Promise.allSettled)
const LIMITE_SELECT = 200; // candidatos buscados do banco por invocação (bem acima do que cabe no orçamento de tempo)

/** Data de "hoje" no fuso America/Sao_Paulo, formato YYYY-MM-DD — mesmo padrão de ap_eventos.dia (schema inicial). */
function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Backoff crescente para processos que ficam reconsultas seguidas sem nenhuma mudança: menos
 * desperdício de orçamento em processos parados, sem nunca parar de monitorar de vez.
 *   0-2 tentativas sem mudança  -> reconsulta amanhã (+1 dia)
 *   3-9 tentativas sem mudança  -> a cada 3 dias
 *   10+ tentativas sem mudança  -> a cada 7 dias
 * Quando HOUVE mudança (tentativas=0 logo após zerar), cai no primeiro caso (+1 dia) também.
 */
function calcularProximaConsulta(tentativasConsecutivasSemMudanca: number): string {
  const dias = tentativasConsecutivasSemMudanca >= 10 ? 7 : tentativasConsecutivasSemMudanca >= 3 ? 3 : 1;
  const proxima = new Date();
  proxima.setUTCDate(proxima.getUTCDate() + dias);
  return proxima.toISOString();
}

/** Teto de orçamento diário (em reais) — tabela ap_configuracoes com fallback a env var, documentado no enunciado da Fase 2. */
async function lerOrcamentoDiario(db: NonNullable<ReturnType<typeof getAdminClient>>): Promise<number> {
  const { data } = await db.from('ap_configuracoes').select('valor').eq('chave', 'reconsulta_orcamento_diario_centavos').maybeSingle();
  const centavosConfig = typeof data?.valor === 'number' ? data.valor : Number(data?.valor);
  if (Number.isFinite(centavosConfig) && centavosConfig > 0) return centavosConfig / 100;

  const centavosEnv = Number(process.env.RECONSULTA_ORCAMENTO_DIARIO_CENTAVOS);
  if (Number.isFinite(centavosEnv) && centavosEnv > 0) return centavosEnv / 100;

  return 50; // fallback final: R$ 50,00/dia
}

interface ProcessoElegivel {
  id: string;
  numero_cnj: string;
  tentativas_consecutivas_sem_mudanca: number;
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const esperado = process.env.CRON_SECRET;
  const esperadoHeader = esperado ? `Bearer ${esperado}` : '';
  const autorizado =
    Boolean(esperado) &&
    auth.length === esperadoHeader.length &&
    timingSafeEqual(Buffer.from(auth), Buffer.from(esperadoHeader));
  if (!autorizado) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) {
    console.error('[cron/reconsulta] Supabase (service role) não configurado — encerrando sem processar nada.');
    return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 });
  }

  const inicio = Date.now();
  const hoje = hojeSaoPaulo();

  // 1) Teto de orçamento diário + 2) gasto já realizado hoje (ap_historico_consultas.custo_cobrado).
  // Filtra por um range UTC alargado (ontem 21h em diante cobre qualquer offset de America/Sao_Paulo,
  // hoje -03:00) e refina pelo fuso exato no JS, em vez de trazer a tabela inteira a cada execução.
  const orcamentoDiario = await lerOrcamentoDiario(db);
  const inicioRangeUtc = new Date();
  inicioRangeUtc.setUTCDate(inicioRangeUtc.getUTCDate() - 1);
  inicioRangeUtc.setUTCHours(21, 0, 0, 0);
  const { data: historicoHoje, error: erroHistorico } = await db
    .from('ap_historico_consultas')
    .select('custo_cobrado, created_at')
    .gte('created_at', inicioRangeUtc.toISOString());

  if (erroHistorico) {
    console.error('[cron/reconsulta] falha ao ler histórico de custos:', erroHistorico.message);
  }

  const gastoHoje = (historicoHoje ?? [])
    .filter(h => {
      const diaDoRegistro = new Date(h.created_at as string).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      return diaDoRegistro === hoje;
    })
    .reduce((acc, h) => acc + Number(h.custo_cobrado ?? 0), 0);

  if (gastoHoje >= orcamentoDiario) {
    console.log(`[cron/reconsulta] Teto de orçamento diário já atingido (R$ ${gastoHoje.toFixed(2)} / R$ ${orcamentoDiario.toFixed(2)}) — encerrando sem consultar.`);
    await trackEvento(request, null, {
      tipo: 'reconsulta_noturna',
      dados: { processados: 0, erros: 0, custoBatch: 0, gastoHoje, orcamentoDiario, motivoParada: 'orcamento_atingido_no_inicio' }
    });
    return NextResponse.json({ processados: 0, motivo: 'orcamento_atingido' });
  }

  // 3) Processos elegíveis, priorizando os há mais tempo sem reconsulta (nunca round-robin aleatório).
  // ap_processos é compartilhado entre usuários (numero_cnj é único globalmente); quem quer ser
  // avisado de cada processo está em ap_processos_monitorados (user_id+processo_id), não aqui.
  const { data: candidatos, error: erroSelect } = await db
    .from('ap_processos')
    .select('id, numero_cnj, tentativas_consecutivas_sem_mudanca')
    .eq('monitorar', true)
    .eq('status', 'ativo')
    .or(`proxima_consulta_em.is.null,proxima_consulta_em.lte.${new Date().toISOString()}`)
    .order('ultima_consulta_em', { ascending: true, nullsFirst: true })
    .limit(LIMITE_SELECT);

  if (erroSelect) {
    console.error('[cron/reconsulta] falha ao selecionar candidatos:', erroSelect.message);
    return NextResponse.json({ error: 'Falha ao selecionar processos.' }, { status: 500 });
  }

  const fila: ProcessoElegivel[] = (candidatos as ProcessoElegivel[] | null) ?? [];
  let gastoAcumulado = gastoHoje;
  let processados = 0;
  let erros = 0;
  let paradaPorOrcamento = false;
  let paradaPorTempo = false;

  // Processa em lotes pequenos (concorrência limitada) para não estourar o maxDuration da function
  // nem disparar TAMANHO_LOTE requisições simultâneas às fontes externas (Infosimples/DataJud).
  for (let offset = 0; offset < fila.length; offset += TAMANHO_LOTE) {
    if (Date.now() - inicio > ORCAMENTO_TEMPO_MS) {
      paradaPorTempo = true;
      break;
    }
    if (gastoAcumulado >= orcamentoDiario) {
      paradaPorOrcamento = true;
      break;
    }

    const lote = fila.slice(offset, offset + TAMANHO_LOTE);
    const resultados = await Promise.allSettled(lote.map(p => processarUmProcesso(db, p)));

    for (const r of resultados) {
      if (r.status === 'fulfilled') {
        processados++;
        gastoAcumulado += r.value.custoCobrado;
      } else {
        erros++;
        console.error('[cron/reconsulta] falha ao processar item do lote:', r.reason);
      }
    }
  }

  const custoBatch = gastoAcumulado - gastoHoje;
  const motivoParada = paradaPorOrcamento ? 'orcamento_atingido' : paradaPorTempo ? 'tempo_esgotado' : 'fila_concluida';

  console.log(
    `[cron/reconsulta] Batch concluído: ${processados} processado(s), ${erros} erro(s), custo do batch R$ ${custoBatch.toFixed(2)} (motivo de parada: ${motivoParada}).`
  );

  await trackEvento(request, null, {
    tipo: 'reconsulta_noturna',
    dados: { processados, erros, custoBatch: Number(custoBatch.toFixed(2)), gastoHoje: Number(gastoAcumulado.toFixed(2)), orcamentoDiario, motivoParada, candidatosNaFila: fila.length }
  });

  return NextResponse.json({ processados, erros, custoBatch, motivoParada });
}

/**
 * Reconsulta um processo monitorado: busca via motorConsulta, grava movimentações novas (dedupe por
 * hash), atualiza contadores/backoff de ap_processos e, se algo novo apareceu, enfileira+processa o
 * alerta de e-mail do dono (se ele tiver optado por avisar_movimentacao).
 */
async function processarUmProcesso(
  db: NonNullable<ReturnType<typeof getAdminClient>>,
  processo: ProcessoElegivel
): Promise<{ custoCobrado: number }> {
  const resultado = await buscarProcessoPorNumero(processo.numero_cnj);
  const agora = new Date().toISOString();

  if (!resultado.processo) {
    // Não encontrado/erro nesta rodada: não mexe no backoff de "sem mudança" (não é a mesma coisa que
    // "sem mudança" — pode ser instabilidade temporária da fonte), só registra o erro e a tentativa.
    await db
      .from('ap_processos')
      .update({ ultima_consulta_em: agora, erro_ultima_consulta: resultado.erro ?? 'Processo não encontrado nesta reconsulta.' })
      .eq('id', processo.id);
    return { custoCobrado: resultado.custoCobrado };
  }

  const movimentosDoProcesso = resultado.processo.movimentos ?? [];

  // Busca os hashes já conhecidos para este processo (dedupe) e insere só os novos. Nomes de coluna
  // seguem o schema REAL de ap_movimentacoes no banco (data_movimentacao/titulo/conteudo/tipo),
  // diferente do que supabase/migrations/20260929120000_ap_schema_inicial.sql descreve localmente
  // (data/descricao) — esse schema inicial nunca foi aplicado ao banco remoto; o que existe de fato
  // é mais rico (ver ap_partes/ap_chat_mensagens/ap_resumos_ia, todos do próprio Prosec).
  const movRows = movimentosDoProcesso.map((m: Movement) => ({
    processo_id: processo.id,
    data_movimentacao: m.data,
    tipo: m.tag || null,
    titulo: m.titulo,
    conteudo: m.descricao || m.titulo,
    hash: createHash('sha256').update(`${processo.id}:${m.data}:${m.descricao || m.titulo}`).digest('hex')
  }));

  let movimentosNovos: Movement[] = [];
  if (movRows.length > 0) {
    const hashesAtuais = movRows.map(m => m.hash);
    const { data: existentes } = await db.from('ap_movimentacoes').select('hash').eq('processo_id', processo.id).in('hash', hashesAtuais);
    const hashesExistentes = new Set((existentes ?? []).map(e => e.hash as string));
    const indicesNovos = movRows.map((m, i) => (hashesExistentes.has(m.hash) ? -1 : i)).filter(i => i >= 0);
    movimentosNovos = indicesNovos.map(i => movimentosDoProcesso[i]);

    const linhasNovas = indicesNovos.map(i => movRows[i]);
    if (linhasNovas.length > 0) {
      const insert = await db.from('ap_movimentacoes').upsert(linhasNovas, { onConflict: 'processo_id,hash', ignoreDuplicates: true });
      if (insert.error) console.error('[cron/reconsulta] falha ao inserir movimentações novas:', insert.error.message);
    }
  }

  const houveMudanca = movimentosNovos.length > 0;
  const tentativasAnteriores = processo.tentativas_consecutivas_sem_mudanca ?? 0;
  const novasTentativas = houveMudanca ? 0 : tentativasAnteriores + 1;
  const ultimaMovimentacaoMaisRecente = movimentosDoProcesso.reduce<string | null>((max, m) => (!max || m.data > max ? m.data : max), null);

  await db
    .from('ap_processos')
    .update({
      ultima_consulta_em: agora,
      proxima_consulta_em: calcularProximaConsulta(novasTentativas),
      tentativas_consecutivas_sem_mudanca: novasTentativas,
      erro_ultima_consulta: null,
      ...(houveMudanca && ultimaMovimentacaoMaisRecente ? { ultima_movimentacao_em: ultimaMovimentacaoMaisRecente } : {})
    })
    .eq('id', processo.id);

  if (houveMudanca) {
    await processarAlerta(db, processo, resultado.processo.tribunal, movimentosNovos);
  }

  return { custoCobrado: resultado.custoCobrado };
}

/**
 * ap_processos é compartilhado (numero_cnj único globalmente): vários usuários podem monitorar o
 * mesmo processo via ap_processos_monitorados (user_id+processo_id+notificar_email/notificar_whatsapp
 * — essa tabela já guarda a preferência de canal por usuário, não é preciso olhar
 * ap_preferencias_consulta aqui). Para cada monitoramento com algum canal ligado: grava o alerta em
 * ap_alertas_pendentes e já tenta processá-lo na mesma invocação (e-mail via Resend). WhatsApp fica só
 * registrado como pendente (fora de escopo nesta fase — depende do Baileys), nunca tentado, nunca
 * derruba o fluxo de e-mail dos demais usuários/canais.
 */
async function processarAlerta(
  db: NonNullable<ReturnType<typeof getAdminClient>>,
  processo: ProcessoElegivel,
  tribunal: string | undefined,
  movimentosNovos: Movement[]
) {
  const { data: monitoramentos } = await db
    .from('ap_processos_monitorados')
    .select('user_id, notificar_email, notificar_whatsapp')
    .eq('processo_id', processo.id);

  for (const monitoramento of monitoramentos ?? []) {
    const userId = monitoramento.user_id as string;
    const canaisAEnfileirar: Array<'email' | 'whatsapp'> = [
      ...(monitoramento.notificar_email ? (['email'] as const) : []),
      ...(monitoramento.notificar_whatsapp ? (['whatsapp'] as const) : [])
    ];
    if (canaisAEnfileirar.length === 0) continue;

    for (const canal of canaisAEnfileirar) {
      const { data: alerta, error: erroInsert } = await db
        .from('ap_alertas_pendentes')
        .insert({ processo_id: processo.id, user_id: userId, canal, status: 'pendente' })
        .select('id')
        .single();

      if (erroInsert || !alerta) {
        console.error('[cron/reconsulta] falha ao enfileirar alerta:', erroInsert?.message);
        continue;
      }

      if (canal === 'whatsapp') {
        // Fora de escopo nesta fase (depende do Baileys, fase futura separada) — fica "pendente" de
        // propósito, documentado aqui para não ser confundido com um alerta esquecido.
        continue;
      }

      // canal === 'email': processa já, nesta mesma invocação. ap_perfis.email (citext, já preenchido no
      // signup via trigger ap_handle_new_user) é a fonte primária — select direto, sem custo de chamada à
      // API de admin; só cai em auth.users via admin API se o perfil não tiver e-mail por algum motivo.
      const { data: perfil } = await db.from('ap_perfis').select('email').eq('id', userId).maybeSingle();
      let email: string | null | undefined = perfil?.email;
      if (!email) {
        const { data: userData } = await db.auth.admin.getUserById(userId);
        email = userData?.user?.email;
      }

      if (!email) {
        await db.from('ap_alertas_pendentes').update({ status: 'falhou', erro: 'Usuário sem e-mail cadastrado.', tentativas: 1 }).eq('id', alerta.id);
        continue;
      }

      const envio = await enviarAlertaMovimentacao(email, { numeroCnj: processo.numero_cnj, tribunal }, movimentosNovos);
      await db
        .from('ap_alertas_pendentes')
        .update(
          envio.enviado
            ? { status: 'enviado', enviado_em: new Date().toISOString(), tentativas: 1 }
            : { status: 'falhou', erro: envio.erro ?? 'Falha desconhecida ao enviar e-mail.', tentativas: 1 }
        )
        .eq('id', alerta.id);
    }
  }
}
