import { createHash, randomUUID } from 'crypto';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { NextResponse, after } from 'next/server';
import { consultarInfosimples } from '@/lib/infosimplesClient';
import { extractDdd, prioritizeByTribunalOrDdd, tribunalByDdd, tribunalByUf } from '@/lib/ddd';
import { invalidateProcessosCache } from '@/lib/redis';
import { consultarDataJud } from '@/lib/datajud';
import { aliasesDatajudPermitidos } from '@/lib/fontesDatajud';
import {
  IDS_PRINCIPAIS_INFOSIMPLES,
  fontesInfosimplesPara,
  type FonteInfosimples,
  type TipoBusca
} from '@/lib/fontesInfosimples';
import { parseCnj } from '@/lib/cnj';
import { desfechoInfosimples } from '@/lib/infosimplesResposta';
import { isValidCnpj, isValidCpf } from '@/lib/format';
import { custoTotal } from '@/lib/infosimplesPricing';
import { consultaEncerrada, criarRegistroConsulta, limparRegistroConsulta } from '@/lib/consultaAbort';
import { precoDaRespostaInfosimples, registrarHistoricoConsulta } from '@/lib/historicoConsultas';
import { buscarProcessoPorNumero, candidatosInfosimples, montarLegalProcessDaInfosimples, numeroDoRegistro } from '@/lib/motorConsulta';
import { MAX_CPFS_LEMIT_POR_BUSCA, consultarLemitPorCpf, cpfsNoObjeto, type ResultadoLemit } from '@/lib/lemit';
import { decidirPrioridade, ufDoEnderecoLemit, ufsDaRegiaoFiscal, type SinaisUf } from '@/lib/planoVarredura';
import { registrarFontesConsulta, type RegistroFonte } from '@/lib/registroFontes';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';

// Robôs da Infosimples levam até 4min por tribunal (lib/infosimplesClient.ts); a varredura precisa caber aqui.
export const maxDuration = 300;
// Prazo total das consultas da Infosimples numa varredura (todas as ondas), com folga para DataJud, Lemit e o 'done'.
const PRAZO_VARREDURA_MS = 265_000;

/** "12345678901" -> "***.456.789-**" (só para rótulos de tela e log). */
function mascararCpf(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

/**
 * Lemit automática numa busca: consulta o CPF pesquisado e cada CPF novo que aparecer nos processos (até
 * MAX_CPFS_LEMIT_POR_BUSCA descobertos), sem repetir CPF. Cada chamada vira um evento de progresso com o custo.
 */
function criarDisparadorLemit(emit: (obj: unknown) => void, habilitada: boolean, onRegistro?: (r: RegistroFonte) => void) {
  const consultados = new Set<string>();
  const pendentes: Promise<void>[] = [];
  let descobertos = 0;
  let custo = 0;

  /** Devolve a promessa do resultado (null quando a chamada não é feita: desligada, repetida ou acima do teto). */
  const consultar = (cpf: string, descoberto: boolean): Promise<ResultadoLemit> | null => {
    if (!habilitada || consultados.has(cpf)) return null;
    if (descoberto && descobertos >= MAX_CPFS_LEMIT_POR_BUSCA) return null;
    consultados.add(cpf);
    if (descoberto) descobertos++;
    const label = `Lemit · CPF ${mascararCpf(cpf)}`;
    emit({ type: 'progress', label, fonte: 'lemit', status: 'loading' });
    const inicio = Date.now();
    const promessa = consultarLemitPorCpf(cpf).then(r => {
        custo += r.custo;
        onRegistro?.({
          fonte: 'lemit',
          servico: cpf.length === 14 ? 'empresa' : 'pessoa',
          achou: r.status === 'ok',
          custo: r.custo,
          duracaoMs: Date.now() - inicio,
          ...(r.status === 'erro' || r.status === 'nao_configurada' ? { erroOrigem: 'lemit', erroCategoria: r.erro } : {})
        });
        console.log(`[api/processos] ${label}: ${r.status} (R$ ${r.custo.toFixed(2)})`);
        emit({
          type: 'progress',
          label,
          fonte: 'lemit',
          found: r.status === 'ok',
          custo: r.custo,
          descoberto,
          resumo: r.resumo,
          ...(r.status === 'erro' || r.status === 'nao_configurada' ? { erro: r.erro, pendente: r.status === 'nao_configurada' } : {})
        });
        return r;
      });
    pendentes.push(promessa.then(() => {}));
    return promessa;
  };

  return {
    consultar,
    aguardar: () => Promise.allSettled(pendentes),
    custo: () => custo
  };
}

/** Minúsculas, sem acentos e com espaços colapsados — para comparar nomes vindos de fontes diferentes. */
function normalizarNome(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * true quando o nome pesquisado (fullName) aparece contido no nome do polo ativo (autor) do processo
 * — critério do checkbox "somente autor" do Passo 1. Sem autor informado pela fonte, não há como
 * confirmar o polo: retorna true (processo permanece visível, nunca é descartado por falta de dado).
 */
function pesquisadoEhAutor(fullName: string | undefined, autor: string | undefined): boolean {
  const nomePesquisado = normalizarNome(fullName || '');
  if (!nomePesquisado || !autor) return true;
  return normalizarNome(autor).includes(nomePesquisado);
}

/** Salva as preferências do stepper (Onde procurar / Avisos). Nunca lança erro. */
async function salvarPreferencias(
  userId: string,
  tribunaisSelecionados: string[] | null | undefined,
  avisos: { avisarMovimentacao?: boolean; canalAviso?: string; resumoLinguagemSimples?: boolean } | undefined
) {
  if (!avisos && tribunaisSelecionados === undefined) return;
  try {
    const db = getAdminClient();
    if (!db) return;

    const r = await db.from('ap_preferencias_consulta').upsert(
      {
        user_id: userId,
        tribunais_selecionados: Array.isArray(tribunaisSelecionados) && tribunaisSelecionados.length > 0 ? tribunaisSelecionados : null,
        avisar_movimentacao: avisos?.avisarMovimentacao ?? false,
        canal_aviso: avisos?.canalAviso ?? 'nenhum',
        resumo_linguagem_simples: avisos?.resumoLinguagemSimples ?? false,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
    if (r.error) console.error('[api/processos] preferencias:', r.error.message);
  } catch (e) {
    console.error('[api/processos] falha ao salvar preferências', e);
  }
}

/** Salva os processos pesquisados (com hash) e completa o perfil. Nunca lança erro. */
async function salvarProcessos(userId: string, cpf: string, fullName: string | undefined, list: LegalProcess[]) {
  try {
    const db = getAdminClient();
    if (!db) return;

    // O celular do stepper é da parte pesquisada (opcional), não do usuário logado: não vai para o perfil.
    const perfil: Record<string, string> = {};
    if (cpf) perfil.cpf = cpf;
    if (fullName?.trim()) perfil.nome = fullName.trim();
    if (Object.keys(perfil).length > 0) {
      const up = await db.from('ap_perfis').update(perfil).eq('id', userId);
      if (up.error) console.error('[api/processos] perfil:', up.error.message);
    }

    const rows = list
      .map(p => {
        const [tribunal, vara] = p.tribunal.split(' · ');
        return {
          user_id: userId,
          numero_cnj: p.numero,
          hash: createHash('sha256').update(`${userId}:${p.numero}`).digest('hex'),
          tribunal,
          classe: p.tipo,
          assunto: vara ?? null,
          parte_passiva: p.parteContraria,
          ultima_movimentacao_em: p.movimentos[0]?.data ?? null,
          dados_brutos: { valorCausa: p.valorCausa, distribuicao: p.distribuicao, movimentos: p.movimentos.slice(0, 20) }
        };
      });
    if (rows.length) {
      const r = await db.from('ap_processos_pesquisados').upsert(rows, { onConflict: 'user_id,numero_cnj' });
      if (r.error) console.error('[api/processos] salvar:', r.error.message);
      else await invalidateProcessosCache(userId);
    }
  } catch (e) {
    console.error('[api/processos] falha ao salvar processos', e);
  }
}

/**
 * Upsert em ap_processos + ap_movimentacoes a partir dos processos já encontrados numa busca síncrona
 * do usuário final (Fluxo A ou B). Roda em paralelo/além de salvarProcessos (que grava em
 * ap_processos_pesquisados, tabela legada sem conceito de monitoramento) — nenhuma das duas
 * substitui a outra. É o que dá ao cron noturno (app/api/cron/reconsulta) "o que reconsultar" desde
 * a primeira busca síncrona: todo processo com número CNJ válido entra aqui com monitorar=true
 * (default da coluna), e já nasce com ultima_movimentacao_em preenchida para o backoff do cron ter
 * uma base correta. Nunca lança erro.
 */
/**
 * Schema REAL de ap_processos/ap_movimentacoes no Supabase remoto (confirmado em 2026-10-07):
 * numero_cnj é ÚNICO GLOBALMENTE (um processo é uma entidade compartilhada entre usuários, não uma
 * cópia por usuário) e não tem user_id — quem monitora cada processo vive em ap_processos_monitorados
 * (user_id+processo_id+notificar_email/notificar_whatsapp). ap_movimentacoes usa data_movimentacao/
 * titulo/conteudo, não data/descricao. Isso diverge do arquivo local
 * supabase/migrations/20260929120000_ap_schema_inicial.sql, que nunca foi aplicado ao banco remoto —
 * o schema abaixo segue o banco real, não esse arquivo.
 */
async function sincronizarMonitoramento(userId: string, list: LegalProcess[]) {
  try {
    const db = getAdminClient();
    if (!db) return;

    for (const p of list) {
      const cnjInfo = parseCnj(p.numero);
      const numeroCnjFormatado = cnjInfo?.numeroFormatado;
      // ap_processos.numero_cnj exige o formato NNNNNNN-DD.AAAA.J.TR.OOOO (check constraint) —
      // processos sem CNJ parseável (não deveria ocorrer no Fluxo A/B, mas por segurança) são ignorados.
      if (!numeroCnjFormatado) continue;

      const movimentoMaisRecente = p.movimentos.reduce<string | null>((max, m) => (!max || m.data > max ? m.data : max), null);
      const [tribunal] = p.tribunal.split(' · ');

      const upsertProcesso = await db
        .from('ap_processos')
        .upsert(
          {
            numero_cnj: numeroCnjFormatado,
            titulo: p.numero,
            tribunal: tribunal || 'Não informado',
            classe_processual: p.tipo || null,
            assunto_principal: p.assunto || null,
            valor_causa: parseValorCausa(p.valorCausa),
            status: 'ativo',
            ...(movimentoMaisRecente ? { ultima_movimentacao_em: movimentoMaisRecente } : {}),
            metadados: { distribuicao: p.distribuicao, varaForo: p.varaForo, origem: p.origem, parteAtiva: p.autor, partePassiva: p.reu || p.parteContraria }
          },
          { onConflict: 'numero_cnj' }
        )
        .select('id')
        .single();

      if (upsertProcesso.error || !upsertProcesso.data) {
        console.error('[api/processos] sincronizarMonitoramento (ap_processos):', upsertProcesso.error?.message);
        continue;
      }

      const processoId = upsertProcesso.data.id as string;

      // Vincula este usuário ao processo (ap_processos_monitorados já guarda a preferência de canal
      // por usuário+processo — notificar_email/notificar_whatsapp — consumida pelo cron de reconsulta).
      const upsertMonitoramento = await db
        .from('ap_processos_monitorados')
        .upsert({ user_id: userId, processo_id: processoId }, { onConflict: 'user_id,processo_id', ignoreDuplicates: true });
      if (upsertMonitoramento.error) {
        console.error('[api/processos] sincronizarMonitoramento (ap_processos_monitorados):', upsertMonitoramento.error.message);
      }

      if (p.movimentos.length === 0) continue;

      const movRows = p.movimentos.map(m => ({
        processo_id: processoId,
        data_movimentacao: m.data,
        tipo: m.tag || null,
        titulo: m.titulo,
        conteudo: m.descricao || m.titulo,
        hash: createHash('sha256').update(`${processoId}:${m.data}:${m.descricao || m.titulo}`).digest('hex')
      }));

      const upsertMovs = await db.from('ap_movimentacoes').upsert(movRows, { onConflict: 'processo_id,hash', ignoreDuplicates: true });
      if (upsertMovs.error) console.error('[api/processos] sincronizarMonitoramento (ap_movimentacoes):', upsertMovs.error.message);
    }
  } catch (e) {
    console.error('[api/processos] falha ao sincronizar monitoramento', e);
  }
}

/** "R$ 12.345,67" / "12345.67" → 12345.67. Sem valor numérico reconhecível, retorna null (coluna aceita null). */
function parseValorCausa(v: string | undefined): number | null {
  if (!v) return null;
  const limpo = v.replace(/[^\d,.-]/g, '');
  if (!limpo) return null;
  // Formato BR ("12.345,67"): remove separador de milhar (.) e troca a vírgula decimal por ponto.
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Alvo de uma consulta: uma fonte do catálogo (lib/fontesInfosimples.ts) já com o parâmetro e o valor
 * que serão enviados à Infosimples. `label` é o id da fonte (usado nos eventos de progresso e no DDD).
 */
interface Alvo {
  service: string;
  label: string;
  campo: string;
  valor: string;
  /** Parâmetros fixos que o serviço exige junto com o campo de busca. */
  fixos?: Record<string, string>;
}

/**
 * Fontes Infosimples a consultar para um tipo de busca. `selecionadas` vem do Passo 2 do stepper
 * (ids do catálogo); ausente (null) = as fontes principais. Só entram serviços que aceitam o tipo
 * de busca — o nome do parâmetro varia por serviço e vem do catálogo.
 */
function resolverAlvos(tipo: TipoBusca, valor: string, selecionadas: unknown): Alvo[] {
  const ids = Array.isArray(selecionadas)
    ? new Set(selecionadas.filter((s): s is string => typeof s === 'string'))
    : new Set(IDS_PRINCIPAIS_INFOSIMPLES);
  return fontesInfosimplesPara(tipo)
    .filter((f: FonteInfosimples) => ids.has(f.id))
    .map(f => ({ service: f.service, label: f.id, campo: f.params[tipo]!, valor, fixos: f.fixos?.[tipo] }));
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const {
      cpf,
      documento,
      nomeParte,
      fullName,
      phone,
      state,
      processNumber,
      tribunaisSelecionados,
      datajudSelecionados,
      somenteAutor,
      economizarPorDdd,
      usarLemit,
      avisarMovimentacao,
      canalAviso,
      resumoLinguagemSimples
    } = await request.json();
    // "documento" aceita CPF (11 dígitos) ou CNPJ (14); "cpf" é o nome legado do mesmo campo.
    const cleanDocumento = ((documento ?? cpf) || '').replace(/\D/g, '');
    const cleanProcessNumber = (processNumber || '').replace(/\D/g, '');
    const cleanNomeParte = typeof nomeParte === 'string' ? nomeParte.trim().replace(/\s+/g, ' ') : '';
    // DataJud: ausente = todos os endpoints; lista (inclusive vazia) = só os marcados no Passo 2.
    const datajudPermitidos = aliasesDatajudPermitidos(datajudSelecionados);

    const isBuscaPorNumero = cleanProcessNumber.length === 20;
    const isBuscaPorNome = !isBuscaPorNumero && cleanNomeParte.length > 0;
    const documentoValido =
      (cleanDocumento.length === 11 && isValidCpf(cleanDocumento)) ||
      (cleanDocumento.length === 14 && isValidCnpj(cleanDocumento));
    const tipoDocumento: 'cpf' | 'cnpj' | null =
      cleanDocumento.length === 11 ? 'cpf' : cleanDocumento.length === 14 ? 'cnpj' : null;
    // Só o CPF é gravado no perfil do usuário (a coluna cpf de ap_perfis).
    const cpfParaPerfil = tipoDocumento === 'cpf' && documentoValido ? cleanDocumento : '';

    if (isBuscaPorNome) {
      if (cleanNomeParte.length < 3) {
        return NextResponse.json({ error: 'Informe o nome da parte com ao menos 3 caracteres.' }, { status: 400 });
      }
      if (cleanDocumento && !documentoValido) {
        return NextResponse.json({ error: 'O CPF/CNPJ informado é inválido.' }, { status: 400 });
      }
    } else if (!isBuscaPorNumero && !documentoValido) {
      return NextResponse.json(
        {
          error:
            'Informe um CPF ou CNPJ válido, o nome da parte ou um número de processo CNJ válido (20 dígitos).'
        },
        { status: 400 }
      );
    }

    // ── FLUXO A: BUSCA DIRETA POR NÚMERO DE PROCESSO (CNJ) ──
    if (isBuscaPorNumero) {
      const cnjInfo = parseCnj(cleanProcessNumber);
      const targetLabel = cnjInfo?.tribunalLabel || 'Tribunal';
      const consultaId = randomUUID();
      // Registro de cancelamento: o botão "cancelar" de cada sub-fonte do card aborta só ela. As chaves
      // seguem o que o cliente envia: o rótulo do tribunal (Infosimples) e "DataJud · <tribunal>".
      const abortControllers = criarRegistroConsulta(consultaId);
      const encoder = new TextEncoder();

      // Checagem adiantada (antes de abrir o stream) idêntica à feita dentro de buscarProcessoPorNumero,
      // para devolver 400 em vez de abrir um stream sem nenhuma fonte habilitada.
      const aliasDoCnjCheck = cnjInfo?.datajudAlias ?? '';
      const idsSelecionadosCheck = Array.isArray(tribunaisSelecionados)
        ? new Set(tribunaisSelecionados.filter((s: unknown): s is string => typeof s === 'string'))
        : null;
      const temInfosimplesCheck = fontesInfosimplesPara('numero' as TipoBusca).some(
        f => aliasDoCnjCheck && f.datajud === aliasDoCnjCheck && (!idsSelecionadosCheck || idsSelecionadosCheck.has(f.id))
      );
      const usarDataJudCheck = !!aliasDoCnjCheck && (!datajudPermitidos || datajudPermitidos.has(aliasDoCnjCheck));

      if (!usarDataJudCheck && !temInfosimplesCheck) {
        return NextResponse.json(
          { error: `Nenhuma fonte habilitada para ${targetLabel}. Marque o DataJud ou a Infosimples em "Onde procurar".` },
          { status: 400 }
        );
      }

      let persistirDepois: (() => Promise<void>) | null = null;
      after(async () => {
        try {
          await persistirDepois?.();
        } catch (e) {
          console.error('[api/processos] falha ao gravar após a resposta (busca por número):', e);
        }
      });

      const stream = new ReadableStream({
        async start(controller) {
          const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          emit({ type: 'started', consultaId });

          const resultado = await buscarProcessoPorNumero(cleanProcessNumber, {
            fullName,
            somenteAutor,
            tribunaisSelecionados,
            datajudSelecionados,
            onProgress: evento => emit({ type: 'progress', ...evento }),
            onAbortControllerCreated: (chave, ctrl) => abortControllers.set(chave, ctrl),
            onAbortControllerSettled: chave => abortControllers.delete(chave)
          });

          if (resultado.erro && !resultado.processo) {
            // Erro de "nenhuma fonte habilitada" (já checado acima) não deveria chegar aqui; mantido
            // por segurança, tratado como "processo não encontrado" para não quebrar o contrato do stream.
            console.error('[api/processos] (busca por número)', resultado.erro);
          }

          const allProcesses: LegalProcess[] = resultado.processo ? [resultado.processo] : [];
          const descartadosPorPolo = resultado.descartadoPorPolo ? [resultado.descartadoPorPolo] : [];

          // Lemit automática: CPF informado no Passo 1 e CPFs que aparecerem no processo encontrado.
          const lemit = criarDisparadorLemit(emit, usarLemit !== false);
          if (cleanDocumento.length === 11 && isValidCpf(cleanDocumento)) lemit.consultar(cleanDocumento, false);
          for (const cpfAchado of cpfsNoObjeto(resultado.processo, isValidCpf)) lemit.consultar(cpfAchado, true);
          await lemit.aguardar();

          const { custoEstimado } = resultado;
          const custoCobrado = resultado.custoCobrado + lemit.custo();
          const formattedNumber = cnjInfo?.numeroFormatado || cleanProcessNumber;

          // Gravações (histórico, perfil, monitoramento) rodam em after(): o 'done' sai antes delas, sem esperar o banco.
          persistirDepois = async () => {
            const userId = await getUserId(request);
            await Promise.all([
              trackEvento(request, userId, {
                tipo: 'consulta',
                assunto: allProcesses[0]?.tipo,
                classe: allProcesses[0]?.tipo,
                tribunal: targetLabel,
                dados: {
                  totalProcessos: allProcesses.length,
                  modo: 'numero',
                  numeroProcesso: cleanProcessNumber,
                  fontes: resultado.fontes,
                  processos: allProcesses.map(p => ({ numero: p.numero, tipo: p.tipo, tribunal: p.tribunal }))
                }
              }),
              registrarHistoricoConsulta(userId, {
                tipoBusca: 'numero',
                termo: formattedNumber,
                nomeParte: fullName,
                tribunais: [targetLabel],
                totalProcessos: allProcesses.length,
                custoEstimado,
                custoCobrado
              }),
              (async () => {
                if (!userId || allProcesses.length === 0) return;
                await salvarProcessos(userId, cpfParaPerfil, fullName, allProcesses);
                await sincronizarMonitoramento(userId, allProcesses);
                await salvarPreferencias(userId, [targetLabel], { avisarMovimentacao, canalAviso, resumoLinguagemSimples });
              })()
            ]);
          };

          if (allProcesses.length === 0) {
            emit({
              type: 'done',
              notFound: true,
              totalProcessos: 0,
              processes: [],
              tribunaisConsultados: [targetLabel],
              custoEstimado,
              custoCobrado,
              descartadosPorPolo
            });
          } else {
            emit({
              type: 'done',
              notFound: false,
              totalProcessos: allProcesses.length,
              processes: allProcesses,
              tribunaisConsultados: [targetLabel],
              custoEstimado,
              custoCobrado,
              descartadosPorPolo
            });
          }

          limparRegistroConsulta(consultaId);
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no'
        }
      });
    }

    // ── FLUXO B: VARREDURA MULTI-TRIBUNAL POR CPF, CNPJ OU NOME DA PARTE (INFOSIMPLES) ──
    const token = process.env.INFOSIMPLES_API_TOKEN || process.env.INFOSIMPLES_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: 'Token da Infosimples não configurado no servidor (INFOSIMPLES_API_TOKEN).' },
        { status: 500 }
      );
    }

    const cleanPhone = (phone || '').replace(/\D/g, '');
    const ddd = extractDdd(cleanPhone);
    const selectedState = (state || '').toUpperCase();
    const forcedTj = selectedState && selectedState !== 'AUTO' ? tribunalByUf(selectedState) : null;

    // Tipo de busca -> valor enviado à Infosimples. Na busca por nome só o nome vai ao serviço (o
    // CPF/CNPJ, se informado, identifica o titular no perfil e no resumo, não filtra homônimos).
    const tipoBusca: TipoBusca = isBuscaPorNome ? 'nome' : (tipoDocumento as 'cpf' | 'cnpj');
    const valorBusca = isBuscaPorNome ? cleanNomeParte : cleanDocumento;

    const targets = prioritizeByTribunalOrDdd(resolverAlvos(tipoBusca, valorBusca, tribunaisSelecionados), forcedTj, ddd);

    if (targets.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma fonte habilitada aceita este tipo de busca. Revise as fontes em "Onde procurar".' },
        { status: 400 }
      );
    }

    const custoEstimado = custoTotal(targets.map(t => t.service));
    let custoCobrado = 0;

    console.log(
      `[api/processos] Consulta multi-tribunal para ${fullName || 'Cliente'} (${tipoBusca.toUpperCase()}: ${isBuscaPorNome ? cleanNomeParte : cleanDocumento}, Estado: ${state || 'Auto'}, DDD: ${ddd || 'N/I'}) nos tribunais:`,
      targets.map(t => t.label).join(', ')
    );

    const encoder = new TextEncoder();
    const allProcesses: LegalProcess[] = [];
    const seenProcessos = new Set<string>();
    const tribunaisConsultados: string[] = [];

    const consultaId = randomUUID();
    const abortControllers = criarRegistroConsulta(consultaId);

    let persistirDepois: (() => Promise<void>) | null = null;
    after(async () => {
      try {
        await persistirDepois?.();
      } catch (e) {
        console.error('[api/processos] falha ao gravar após a resposta:', e);
      }
    });

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        emit({ type: 'started', consultaId });
        // Uma linha por chamada a fonte (ap_consulta_fontes), gravada em after() junto com o histórico.
        const registros: RegistroFonte[] = [];

        // Enriquecimento DataJud de um processo: dispara assim que a Infosimples o encontra, em
        // paralelo com os demais tribunais ainda em varredura (não espera a Infosimples terminar).
        // Emite um card de progresso próprio ("DataJud · <tribunal>") para a tela acompanhar a fonte.
        const enriquecerComDataJud = async (p: LegalProcess, target: { label: string }) => {
          const dataJudLabel = `DataJud · ${target.label}`;
          emit({ type: 'progress', label: dataJudLabel, fonte: 'datajud', status: 'loading' });
          const tribunalLabel = p.tribunal.split(' · ')[0];
          const numeroDigits = p.numero.replace(/\D/g, '');
          // Chave própria no registro de cancelamento (distinta da Infosimples do mesmo tribunal),
          // para o botão "cancelar" do card poder abortar cada sub-fonte separadamente.
          const abortController = new AbortController();
          abortControllers.set(dataJudLabel, abortController);
          const inicioDataJud = Date.now();
          const enriquecido = await consultarDataJud(tribunalLabel, numeroDigits, datajudPermitidos, abortController.signal);
          const cancelado = abortController.signal.aborted;
          abortControllers.delete(dataJudLabel);
          const registrarDataJud = (achou: boolean, erroCategoria?: string) =>
            registros.push({ fonte: 'datajud', servico: tribunalLabel, tribunal: target.label, achou, custo: 0, duracaoMs: Date.now() - inicioDataJud, erroCategoria });

          if (cancelado) {
            registrarDataJud(false, 'Cancelada');
            emit({ type: 'progress', label: dataJudLabel, fonte: 'datajud', found: false, cancelado: true });
            return;
          }

          if (!enriquecido) {
            registrarDataJud(false);
            emit({ type: 'progress', label: dataJudLabel, fonte: 'datajud', found: false });
            return;
          }

          let mudou = false;

          const descricoesExistentes = new Set(p.movimentos.map((m: Movement) => m.descricao));
          const movimentosNovos = enriquecido.movimentos.filter((m: Movement) => !descricoesExistentes.has(m.descricao));
          if (movimentosNovos.length > 0) {
            p.movimentos = [...movimentosNovos, ...p.movimentos].sort((a, b) => (a.data < b.data ? 1 : -1));
            mudou = true;
          }

          if (enriquecido.assuntos.length > 0) {
            p.assuntosDataJud = enriquecido.assuntos;
            mudou = true;
          }
          if (enriquecido.orgaoJulgador) {
            p.orgaoJulgadorDataJud = enriquecido.orgaoJulgador;
            mudou = true;
          }
          if (enriquecido.grau) {
            p.grauDataJud = enriquecido.grau;
            mudou = true;
          }
          if ((!p.distribuicao || p.distribuicao === 'Não informada') && enriquecido.dataAjuizamento) {
            p.distribuicao = enriquecido.dataAjuizamento;
            mudou = true;
          }

          if (mudou) {
            p.enriquecidoDataJud = true;
            p.origem = 'ambos';
          }
          registrarDataJud(mudou);
          emit({ type: 'progress', label: dataJudLabel, fonte: 'datajud', found: mudou });
        };

        const enriquecimentoPromises: Promise<void>[] = [];

        // Lemit automática: dispara já para o CPF pesquisado (em paralelo com os tribunais) e, durante a
        // varredura, para cada CPF novo que aparecer nos processos (busca por nome/CNPJ ou outras partes).
        const lemit = criarDisparadorLemit(emit, usarLemit !== false, r => registros.push(r));
        const promessaLemitPesquisado = tipoBusca === 'cpf' ? lemit.consultar(cleanDocumento, false) : null;

        // Plano da 1ª onda (regras fixas de lib/planoVarredura.ts: manual > endereço na Lemit > DDD > região
        // fiscal do CPF). Com a economia ligada e sem estado manual, espera a Lemit do CPF pesquisado (até ~20s):
        // o endereço dela é o sinal mais forte. Sem economia, nada espera — todos os tribunais saem juntos.
        const lemitDoPesquisado = economizarPorDdd && !forcedTj && promessaLemitPesquisado ? await promessaLemitPesquisado : null;
        const sinais: SinaisUf = {
          manualUf: forcedTj ? selectedState : null,
          lemitUf: lemitDoPesquisado?.status === 'ok' ? ufDoEnderecoLemit(lemitDoPesquisado.dados) : null,
          dddTj: ddd ? tribunalByDdd(ddd) : null,
          regiaoFiscalUfs: tipoBusca === 'cpf' ? ufsDaRegiaoFiscal(cleanDocumento) : []
        };
        const doTribunal = (tj: string) => (t: (typeof targets)[number]) => t.label === tj || t.label.startsWith(`${tj} (`);
        const prioridade = decidirPrioridade(sinais, tj => targets.some(doTribunal(tj)));
        const alvosPrioritarios = targets.filter(t => prioridade.tribunais.some(tj => doTribunal(tj)(t)));
        const dividirEmOndas = !!(economizarPorDdd && alvosPrioritarios.length > 0 && alvosPrioritarios.length < targets.length);
        const targetsPrimeiraOnda = dividirEmOndas ? alvosPrioritarios : targets;
        const targetsSegundaOnda = dividirEmOndas ? targets.filter(t => !alvosPrioritarios.includes(t)) : [];
        emit({
          type: 'plano',
          primeiraOnda: targetsPrimeiraOnda.map(t => t.label),
          segundaOnda: targetsSegundaOnda.map(t => t.label),
          origem: dividirEmOndas ? prioridade.origem : null,
          motivo: economizarPorDdd ? prioridade.motivo : 'Economia por estado desligada: todos os tribunais consultados em paralelo.'
        });
        console.log(`[api/processos] Plano: ${prioridade.motivo} Sinais: ${JSON.stringify(sinais)}`);

        const inicioVarredura = Date.now();

        const consultarTarget = async (target: (typeof targets)[number], onda: 1 | 2) => {
          // "Encerrar e ver resultados": nenhuma fonte nova começa depois do pedido do usuário.
          if (consultaEncerrada(consultaId)) {
            emit({ type: 'progress', label: target.label, fonte: 'infosimples', found: false, cancelado: true, custo: 0 });
            return;
          }
          tribunaisConsultados.push(target.label);
          // Cada fonte tem todo o tempo que ainda resta do prazo da varredura (a 2ª onda herda o que sobrou da 1ª).
          const restanteSegundos = Math.floor((PRAZO_VARREDURA_MS - (Date.now() - inicioVarredura)) / 1000) - 10;
          if (restanteSegundos < 15) {
            registros.push({ fonte: 'infosimples', servico: target.service, tribunal: target.label, onda, achou: false, custo: 0, erroOrigem: 'prosec', erroCategoria: 'Prazo da varredura esgotado' });
            emit({ type: 'progress', label: target.label, fonte: 'infosimples', found: false, erro: `Prazo da varredura esgotado: a 1ª onda consumiu quase todo o limite de ${PRAZO_VARREDURA_MS / 1000}s da busca, e não sobrou tempo para esta fonte; a Infosimples não foi chamada nem cobrou.`, custo: 0 });
            return;
          }
          const abortController = new AbortController();
          abortControllers.set(target.label, abortController);
          emit({ type: 'progress', label: target.label, fonte: 'infosimples', status: 'loading' });
          const result = await consultarInfosimples(
            target.service,
            token,
            { ...target.fixos, [target.campo]: target.valor },
            abortController.signal,
            { cacheNegativo: true, timeoutSegundos: restanteSegundos }
          );
          const custoDaFonte = precoDaRespostaInfosimples(result);
          custoCobrado += custoDaFonte;
          const cancelado = abortController.signal.aborted;
          abortControllers.delete(target.label);

          if (cancelado) {
            registros.push({ fonte: 'infosimples', servico: target.service, tribunal: target.label, onda, achou: false, custo: custoDaFonte, duracaoMs: result?._duracaoMs, erroOrigem: 'prosec', erroCategoria: 'Cancelada' });
            emit({ type: 'progress', label: target.label, fonte: 'infosimples', found: false, cancelado: true, custo: custoDaFonte });
            return;
          }

          let foundInThisTribunal = false;
          let novosNesteTribunal = 0;
          const desfecho = desfechoInfosimples(result);
          console.log(
            result
              ? `[api/processos] ${target.label} (${target.campo}): code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})${desfecho.erroTecnico ? ` [ERRO] ${desfecho.erroTecnico}` : ''}`
              : `[api/processos] ${target.label} (${target.campo}): sem resposta da Infosimples [ERRO]`
          );

          if (result && result.code === 200 && result.data?.[0]) {
            const rawList = candidatosInfosimples(result.data[0]);
            if (rawList.length === 0 || !rawList.some(p => numeroDoRegistro(p))) {
              if (result.data_count > 0) {
                console.warn(`[processos] ${target.service}: resposta com dados, mas nenhum processo reconhecido. Chaves de data[0]: ${Object.keys(result.data[0]).join(', ')}`);
              }
            }

            rawList.forEach((p: any) => {
              const num = numeroDoRegistro(p);
              // dedup pelos dígitos: o mesmo processo pode vir no detalhe da raiz e na lista, formatado diferente
              const chave = num.replace(/\D/g, '');
              if (!chave || seenProcessos.has(chave)) return;
              seenProcessos.add(chave);
              foundInThisTribunal = true;
              novosNesteTribunal++;

              const processo = montarLegalProcessDaInfosimples(p, target.label, fullName);
              processo.origem = 'infosimples';
              allProcesses.push(processo);
              // Resultado parcial para a tela, já respeitando o filtro "somente autor".
              if (!somenteAutor || pesquisadoEhAutor(fullName, processo.autor)) {
                // Vai completo: se o usuário encerrar e o 'done' não chegar, a tela monta o resultado com estes.
                emit({ type: 'processo', processo });
              }
              // Dispara o DataJud já aqui, em paralelo com os outros tribunais ainda rodando.
              enriquecimentoPromises.push(enriquecerComDataJud(processo, target));
              for (const cpfAchado of cpfsNoObjeto(p, isValidCpf)) lemit.consultar(cpfAchado, true);
            });
          }

          registros.push({
            fonte: 'infosimples',
            servico: target.service,
            tribunal: target.label,
            onda,
            achou: foundInThisTribunal,
            qtdProcessos: novosNesteTribunal,
            custo: custoDaFonte,
            duracaoMs: result?._duracaoMs,
            codigo: result?.code,
            erroOrigem: desfecho.erro ? desfecho.origem : undefined,
            erroCategoria: desfecho.erro ? desfecho.categoria : undefined
          });

          // "erro" só quando a fonte falhou; fonte que respondeu "nada encontrado" segue como found:false.
          emit({
            type: 'progress',
            label: target.label,
            fonte: 'infosimples',
            found: foundInThisTribunal,
            custo: custoDaFonte,
            ...(desfecho.erro && !foundInThisTribunal ? { erro: desfecho.erro, erroTecnico: desfecho.erroTecnico, codigo: desfecho.codigo } : {})
          });
        };

        // 1ª onda: tribunal(is) prioritário(s) do plano, ou todos. A 2ª onda (demais tribunais) só roda se a 1ª
        // não achou nada e o usuário não encerrou — economiza chamadas pagas quando o processo está onde se esperava.
        // Se não rodar, os tribunais vão no 'done' para a tela oferecer "continuar buscando".
        await Promise.allSettled(targetsPrimeiraOnda.map(t => consultarTarget(t, 1)));
        let tribunaisNaoConsultados: string[] = [];
        if (targetsSegundaOnda.length > 0) {
          if (allProcesses.length === 0 && !consultaEncerrada(consultaId)) {
            await Promise.allSettled(targetsSegundaOnda.map(t => consultarTarget(t, 2)));
          } else {
            tribunaisNaoConsultados = targetsSegundaOnda.map(t => t.label);
          }
        }
        await Promise.allSettled(enriquecimentoPromises);
        await lemit.aguardar();
        custoCobrado += lemit.custo();

        const porNumero = cleanProcessNumber
          ? allProcesses.filter(p => p.numero.replace(/\D/g, '').includes(cleanProcessNumber))
          : allProcesses;
        // Checkbox opcional do Passo 1 ("somente autor"): descarta processos em que o pesquisado está
        // no polo passivo (Réu). Processos sem autor informado pela fonte nunca são descartados por
        // falta de dado — só quando há autor conhecido e ele não bate com o nome pesquisado. Os
        // descartados são reportados à parte (não somem em silêncio) para dar transparência ao usuário.
        const filteredProcesses = somenteAutor ? porNumero.filter(p => pesquisadoEhAutor(fullName, p.autor)) : porNumero;
        const descartadosPorPolo = somenteAutor
          ? porNumero.filter(p => !pesquisadoEhAutor(fullName, p.autor)).map(p => ({ numero: p.numero, tribunal: p.tribunal, autor: p.autor }))
          : [];

        // Gravações (histórico, perfil, monitoramento) rodam em after(): o 'done' sai antes delas, sem esperar o banco.
        persistirDepois = async () => {
          const userId = await getUserId(request);
          await Promise.all([
            trackEvento(request, userId, {
              tipo: 'consulta',
              assunto: filteredProcesses[0]?.tipo,
              classe: filteredProcesses[0]?.tipo,
              tribunal: tribunaisConsultados.join(', '),
              dados: {
                totalProcessos: filteredProcesses.length,
                modo: tipoBusca,
                estado: selectedState || null,
                processos: filteredProcesses.slice(0, 20).map(p => ({ numero: p.numero, tipo: p.tipo, tribunal: p.tribunal }))
              }
            }),
            registrarHistoricoConsulta(userId, {
              tipoBusca,
              termo: valorBusca,
              nomeParte: fullName,
              tribunais: tribunaisConsultados,
              totalProcessos: filteredProcesses.length,
              custoEstimado,
              custoCobrado
            }),
            registrarFontesConsulta(consultaId, userId, tipoBusca, sinais, dividirEmOndas ? prioridade.origem : null, registros),
            (async () => {
              if (!userId) return;
              await salvarProcessos(userId, cpfParaPerfil, fullName, filteredProcesses);
              if (filteredProcesses.length > 0) await sincronizarMonitoramento(userId, filteredProcesses);
              await salvarPreferencias(userId, tribunaisSelecionados, { avisarMovimentacao, canalAviso, resumoLinguagemSimples });
            })()
          ]);
        };

        if (filteredProcesses.length === 0) {
          console.log(`[api/processos] Nenhum processo localizado nos tribunais consultados (${tribunaisConsultados.join(', ')}) para a busca por ${tipoBusca}.`);
          emit({
            type: 'done',
            notFound: true,
            totalProcessos: 0,
            processes: [],
            tribunaisConsultados,
            tribunaisNaoConsultados,
            encerradaPeloUsuario: consultaEncerrada(consultaId),
            custoEstimado,
            custoCobrado,
            descartadosPorPolo
          });
        } else {
          console.log(`[api/processos] Sucesso: ${filteredProcesses.length} processo(s) consolidado(s) de ${tribunaisConsultados.join(', ')}. Custo estimado: R$ ${custoEstimado.toFixed(2)}`);
          emit({
            type: 'done',
            notFound: false,
            totalProcessos: filteredProcesses.length,
            processes: filteredProcesses,
            tribunaisConsultados,
            tribunaisNaoConsultados,
            encerradaPeloUsuario: consultaEncerrada(consultaId),
            custoEstimado,
            custoCobrado,
            descartadosPorPolo
          });
        }

        limparRegistroConsulta(consultaId);
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      }
    });
  } catch (error) {
    console.error('[api/processos] Exceção:', error);
    return NextResponse.json({ error: 'Falha ao processar consulta de processos.' }, { status: 500 });
  }
}
