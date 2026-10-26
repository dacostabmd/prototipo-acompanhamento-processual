import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { getAdminClient, trackEvento } from '@/lib/track';
import { buscarProcessoPorNumero } from '@/lib/motorConsulta';
import { gerarResumoAndamento } from '@/lib/resumoAndamento';
import { enfileirarAlertas, processarFilaAlertas } from '@/lib/filaAlertas';
import type { Movement } from '@/lib/mockProcesses';

// Mesmo teto de app/api/processos (300s, Fluid Compute). Um dia inteiro de reconsultas pode não
// caber — por isso o loop para de INICIAR novos processos em ORCAMENTO_TEMPO_MS e o worker de alertas
// usa o tempo até PRAZO_TOTAL_MS. O que não coube hoje continua com proxima_consulta_em <= now() e é
// pego amanhã na frente da fila (ORDER BY ultima_consulta_em ASC); alerta não enviado fica na fila.
export const maxDuration = 300;

const ORCAMENTO_TEMPO_MS = 230_000; // DataJud leva 7-22s (até 60s) por consulta; o lote em andamento precisa terminar
const PRAZO_TOTAL_MS = 285_000; // worker de alertas até aqui; 15s de margem para fechar a resposta
const TAMANHO_LOTE = 8; // processos buscados em paralelo por rodada (Promise.allSettled)
const LIMITE_SELECT = 200; // candidatos buscados do banco por invocação (bem acima do que cabe no orçamento de tempo)

// Reconsulta só no DataJud (gratuito) por padrão. Com a Infosimples, cada processo custaria por noite
// a soma de todos os serviços do tribunal (TJSP tem 4). RECONSULTA_USAR_INFOSIMPLES=true religa.
const USAR_INFOSIMPLES = process.env.RECONSULTA_USAR_INFOSIMPLES === 'true';

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
 * O horário é fixado à 00:00 de Brasília (03:00 UTC) do dia alvo: com "agora + N dias" exato, o
 * processo tratado às 06:03 não estaria elegível no cron do dia seguinte (06:00) e pularia um dia.
 */
function calcularProximaConsulta(tentativasConsecutivasSemMudanca: number): string {
  const dias = tentativasConsecutivasSemMudanca >= 10 ? 7 : tentativasConsecutivasSemMudanca >= 3 ? 3 : 1;
  const proxima = new Date();
  proxima.setUTCDate(proxima.getUTCDate() + dias);
  proxima.setUTCHours(3, 0, 0, 0);
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
  tribunal: string | null;
  classe_processual: string | null;
  assunto_principal: string | null;
  tentativas_consecutivas_sem_mudanca: number;
}

// A Vercel chama o cron com GET; POST continua para disparo manual (curl com o mesmo Bearer).
export async function GET(request: Request) {
  return POST(request);
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
    // A fila de alertas não gasta orçamento de consulta: continua rodando.
    const alertas = await processarFilaAlertas(db, { ateMs: inicio + PRAZO_TOTAL_MS });
    await trackEvento(request, null, {
      tipo: 'reconsulta_noturna',
      dados: { processados: 0, erros: 0, custoBatch: 0, gastoHoje, orcamentoDiario, motivoParada: 'orcamento_atingido_no_inicio', alertas }
    });
    return NextResponse.json({ processados: 0, motivo: 'orcamento_atingido', alertas });
  }

  // 3) Processos elegíveis, priorizando os há mais tempo sem reconsulta (nunca round-robin aleatório).
  // ap_processos é compartilhado entre usuários (numero_cnj é único globalmente); quem quer ser
  // avisado de cada processo está em ap_processos_monitorados (user_id+processo_id), não aqui.
  const { data: candidatos, error: erroSelect } = await db
    .from('ap_processos')
    .select('id, numero_cnj, tribunal, classe_processual, assunto_principal, tentativas_consecutivas_sem_mudanca')
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
  let alertasEnfileirados = 0;
  let resumosGerados = 0;
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
        alertasEnfileirados += r.value.alertasEnfileirados;
        if (r.value.resumoGerado) resumosGerados++;
      } else {
        erros++;
        console.error('[cron/reconsulta] falha ao processar item do lote:', r.reason);
      }
    }
  }

  const custoBatch = gastoAcumulado - gastoHoje;
  const motivoParada = paradaPorOrcamento ? 'orcamento_atingido' : paradaPorTempo ? 'tempo_esgotado' : 'fila_concluida';

  // 4) Worker de alertas: envia o que acabou de entrar na fila e repete as falhas ainda válidas.
  const alertas = await processarFilaAlertas(db, { ateMs: inicio + PRAZO_TOTAL_MS });

  console.log(
    `[cron/reconsulta] Batch concluído: ${processados} processado(s), ${erros} erro(s), custo do batch R$ ${custoBatch.toFixed(2)} (motivo de parada: ${motivoParada}). ` +
      `Resumos IA: ${resumosGerados}. Alertas: ${alertasEnfileirados} enfileirado(s), ${alertas.enviados} enviado(s), ${alertas.falhas} falha(s), ` +
      `${alertas.aguardandoConfiguracao} aguardando configuração, ${alertas.restantes} para a próxima execução.`
  );

  await trackEvento(request, null, {
    tipo: 'reconsulta_noturna',
    dados: {
      processados,
      erros,
      custoBatch: Number(custoBatch.toFixed(2)),
      gastoHoje: Number(gastoAcumulado.toFixed(2)),
      orcamentoDiario,
      motivoParada,
      candidatosNaFila: fila.length,
      usarInfosimples: USAR_INFOSIMPLES,
      resumosGerados,
      alertasEnfileirados,
      alertas
    }
  });

  return NextResponse.json({ processados, erros, custoBatch, motivoParada, resumosGerados, alertasEnfileirados, alertas });
}

/**
 * Reconsulta um processo monitorado: busca via motorConsulta, grava movimentações novas (dedupe por
 * hash), atualiza contadores/backoff de ap_processos e, se algo novo apareceu, gera o resumo IA
 * (uma vez por processo, compartilhado entre quem monitora) e enfileira os alertas. O envio fica com
 * o worker (processarFilaAlertas), no fim da execução.
 */
async function processarUmProcesso(
  db: NonNullable<ReturnType<typeof getAdminClient>>,
  processo: ProcessoElegivel
): Promise<{ custoCobrado: number; alertasEnfileirados: number; resumoGerado: boolean }> {
  // tribunaisSelecionados: [] desliga a Infosimples; undefined consulta todos os serviços do tribunal.
  const resultado = await buscarProcessoPorNumero(processo.numero_cnj, USAR_INFOSIMPLES ? undefined : { tribunaisSelecionados: [] });
  const agora = new Date().toISOString();

  if (!resultado.processo) {
    // Não encontrado/erro nesta rodada: não mexe no backoff de "sem mudança" (não é a mesma coisa que
    // "sem mudança" — pode ser instabilidade temporária da fonte), só registra o erro e a tentativa.
    await db
      .from('ap_processos')
      .update({ ultima_consulta_em: agora, erro_ultima_consulta: resultado.erro ?? 'Processo não encontrado nesta reconsulta.' })
      .eq('id', processo.id);
    return { custoCobrado: resultado.custoCobrado, alertasEnfileirados: 0, resumoGerado: false };
  }

  const movimentosDoProcesso = resultado.processo.movimentos ?? [];

  // Busca os hashes já conhecidos para este processo (dedupe) e insere só os novos. Nomes de coluna
  // seguem o schema REAL de ap_movimentacoes no banco (data_movimentacao/titulo/conteudo/tipo),
  // diferente do que supabase/migrations/20260929120000_ap_schema_inicial.sql descreve localmente
  // (data/descricao) — esse schema inicial nunca foi aplicado ao banco remoto; o que existe de fato
  // é mais rico (ver ap_partes/ap_chat_mensagens/ap_resumos_ia, todos do próprio JusConsulta).
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

  if (!houveMudanca) return { custoCobrado: resultado.custoCobrado, alertasEnfileirados: 0, resumoGerado: false };

  const maisRecentesPrimeiro = (a: Movement, b: Movement) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0);
  const novos = [...movimentosNovos].sort(maisRecentesPrimeiro);
  const novosSet = new Set(movimentosNovos);
  const historico = movimentosDoProcesso.filter(m => !novosSet.has(m)).sort(maisRecentesPrimeiro).slice(0, 5);
  const tribunal = resultado.processo.tribunal?.split(' · ')[0] || processo.tribunal;

  const resumo = await gerarResumoAndamento(
    { numeroCnj: processo.numero_cnj, tribunal, classe: processo.classe_processual, assunto: processo.assunto_principal },
    novos,
    historico
  );

  if (resumo) {
    const ins = await db.from('ap_resumos_ia').insert({
      processo_id: processo.id,
      resumo_simplificado: resumo.resumo,
      status_atual_explicado: resumo.significado,
      proximos_passos: resumo.proximoPasso,
      pontos_atencao: resumo.urgencia === 'alta' ? 'Pode exigir ação rápida: fale com o advogado responsável.' : null,
      urgencia: resumo.urgencia,
      timeline_resumida: novos.slice(0, 10).map(m => ({ data: m.data, titulo: m.titulo })),
      modelo_ia: resumo.modelo,
      total_tokens: resumo.totalTokens ?? null,
      ultima_movimentacao_coberta: novos[0]?.data ?? null
    });
    if (ins.error) console.error('[cron/reconsulta] falha ao gravar resumo IA:', ins.error.message);
  }

  const alertasEnfileirados = await enfileirarAlertas(db, processo.id, {
    numeroCnj: processo.numero_cnj,
    tribunal,
    movimentos: novos.slice(0, 10).map(m => ({ data: m.data, titulo: m.titulo, descricao: m.descricao || m.titulo })),
    resumo: resumo ? { resumo: resumo.resumo, significado: resumo.significado, proximoPasso: resumo.proximoPasso, urgencia: resumo.urgencia } : null
  });

  return { custoCobrado: resultado.custoCobrado, alertasEnfileirados, resumoGerado: !!resumo };
}
