import { createHash, randomUUID } from 'crypto';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { NextResponse } from 'next/server';
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
import { classifyTag } from '@/lib/classify';
import { custoTotal } from '@/lib/infosimplesPricing';
import { criarRegistroConsulta, limparRegistroConsulta } from '@/lib/consultaAbort';
import { precoDaRespostaInfosimples, registrarHistoricoConsulta } from '@/lib/historicoConsultas';
import { buscarProcessoPorNumero } from '@/lib/motorConsulta';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';

function convertBrDateToIso(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const clean = dateStr.trim().split(' ')[0];
  const parts = clean.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return dateStr;
}

async function fetchInfosimples(
  service: string,
  token: string,
  params: Record<string, string | undefined>,
  signal: AbortSignal
) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 20000);
  const onSignalAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onSignalAbort);

  try {
    const form = new URLSearchParams();
    form.append('token', token);
    for (const [key, value] of Object.entries(params)) {
      if (value) form.append(key, value);
    }

    const res = await fetch(`https://api.infosimples.com/api/v2/consultas/${service}`, {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: timeoutController.signal
    });

    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onSignalAbort);

    // A Infosimples descreve a falha no próprio envelope ({ code, code_message }), às vezes com HTTP de
    // erro: devolve o corpo sempre que ele vier, para a tela mostrar o motivo em vez de "sem processos".
    const body = await res.json().catch(() => null);
    if (body && typeof body.code === 'number') return body;
    return res.ok ? body : { code: res.status, code_message: `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onSignalAbort);
    if ((err as { name?: string })?.name !== 'AbortError') {
      console.error(`[api/processos] Erro ao consultar ${service}:`, err);
    }
    return { code: 504, code_message: 'Tempo limite esgotado para esta fonte' };
  }
}

/** Campo que alguns serviços devolvem como texto e outros como objeto ({ nome, ... }) — ex.: orgao_julgador do TJRJ eproc. */
function textoDoCampo(v: any): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && typeof v.nome === 'string') return v.nome.trim();
  return '';
}

/** "- BANCO VOTORANTIM S A   (59.5****)" (ou [parte, advogado...]) → "BANCO VOTORANTIM S A". */
function nomeDaParte(entrada: any): string {
  const bruto = Array.isArray(entrada) ? entrada[0] : entrada;
  if (typeof bruto !== 'string') return '';
  return bruto.replace(/^[\s-]+/, '').replace(/\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
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

/**
 * Registros de processo dentro de data[0] da Infosimples. Os serviços variam: lista (processos,
 * lista_processos...), detalhe único em "processo" (objeto) ou o próprio data[0] já como detalhe. Atenção:
 * alguns serviços (ex.: TJRJ eproc) mandam a lista VAZIA junto com o detalhe preenchido, então a lista só
 * vale se tiver itens — com `||` o array vazio (truthy) escondia o processo encontrado.
 */
function extrairProcessosInfosimples(dado: any): any[] {
  if (!dado) return [];
  const lista = [dado.processos, dado.lista_processos, dado.processos_lista, dado.lista_processos_encontrados].find(
    l => Array.isArray(l) && l.length > 0
  );
  if (lista) return lista;
  if (dado.processo && typeof dado.processo === 'object') return [dado.processo];
  if (dado.processo || dado.numero || dado.numero_processo || dado.classe_acao) return [dado];
  return [];
}

/** Converte um registro bruto de processo retornado pela Infosimples para o formato LegalProcess. */
function montarLegalProcessDaInfosimples(p: any, tribunalLabel: string, fullName?: string): LegalProcess {
  const num = (p.processo || p.numero || p.numero_processo || p.numero_cnj || '').trim();
  const movs: Movement[] = [];
  const orgao = textoDoCampo(p.vara) || textoDoCampo(p.foro) || textoDoCampo(p.orgao_julgador);
  // Partes: reqte/reqdo/autor/reu (lista) ou partes_representantes.{exequente|autor...}/{executado|reu...} (eproc).
  const partesRep = p.partes_representantes && typeof p.partes_representantes === 'object' ? p.partes_representantes : {};
  const autor: string =
    textoDoCampo(p.reqte) || textoDoCampo(p.autor) || nomeDaParte(partesRep.exequente?.[0] ?? partesRep.autor?.[0] ?? partesRep.requerente?.[0]);
  const reu: string =
    textoDoCampo(p.reqdo) || textoDoCampo(p.reu) || textoDoCampo(p.exectdo) || nomeDaParte(partesRep.executado?.[0] ?? partesRep.reu?.[0] ?? partesRep.requerido?.[0]);

  const rawMovs =
    p.ultimas_movimentacoes ||
    p.eventos ||
    p.movimento_processo ||
    p.movimentacoes_processo ||
    p.movimentacao ||
    [];
  if (Array.isArray(rawMovs) && rawMovs.length > 0) {
    rawMovs.forEach((m: any) => {
      const fullText = (m.movimento || m.descricao || m.evento || m.movimentacao || '').trim();
      const dashIdx = fullText.indexOf(' - ');
      let titulo = dashIdx > 0 && dashIdx < 60 ? fullText.slice(0, dashIdx) : fullText.slice(0, 70);
      if (titulo.length < fullText.length && !titulo.endsWith('...')) {
        titulo += '...';
      }
      const responsavel = m.responsavel || m.magistrado || textoDoCampo(m.orgao_julgador) || m.orgao;
      const complemento = m.complemento || m.observacao || m.detalhe;
      const extras = [
        responsavel && `Responsável: ${responsavel}`,
        complemento && complemento !== fullText && complemento
      ].filter(Boolean);
      const descricaoCompleta = extras.length > 0 ? `${fullText} — ${extras.join(' · ')}` : fullText;
      movs.push({
        data: convertBrDateToIso(m.data || m.data_evento || m.data_hora || m.data_hora_movimentacao),
        titulo: titulo || 'Movimentação processual',
        descricao: descricaoCompleta || 'Sem descrição detalhada.',
        tag: classifyTag(fullText)
      });
    });
  }

  // "julgamentos" (só no TJSP 2º grau): lista de strings "DD/MM/AAAA <texto do julgamento>", não
  // objetos como os demais formatos — único campo com conteúdo quando o grau não tem movimentações.
  if (movs.length === 0 && Array.isArray(p.julgamentos) && p.julgamentos.length > 0) {
    p.julgamentos.forEach((texto: unknown) => {
      if (typeof texto !== 'string' || !texto.trim()) return;
      const match = /^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/.exec(texto.trim());
      const dataBr = match?.[1];
      const corpo = match?.[2] ?? texto.trim();
      movs.push({
        data: convertBrDateToIso(dataBr),
        titulo: corpo.length > 70 ? `${corpo.slice(0, 70)}...` : corpo,
        descricao: corpo,
        tag: classifyTag(corpo)
      });
    });
  }

  if (movs.length === 0) {
    const classeInfo = p.classe || p.classe_acao || p.assunto;
    const varaInfo = orgao;
    const valorInfo = p.valor_acao || p.valor_causa;
    const partesInfo = [autor, reu].filter(Boolean).join(' x ');
    const situacaoInfo = p.situacao || p.status || p.fase;
    const detalhes = [
      classeInfo && `Classe: ${classeInfo}`,
      varaInfo && `Órgão: ${varaInfo}`,
      valorInfo && `Valor da causa: ${valorInfo}`,
      partesInfo && `Partes: ${partesInfo}`,
      situacaoInfo && `Situação: ${situacaoInfo}`
    ].filter(Boolean);

    movs.push({
      data: convertBrDateToIso(p.distribuicao || p.data_autuacao),
      titulo: p.ultimo_evento ? (p.ultimo_evento.slice(0, 70) + '...') : 'Processo distribuído',
      descricao:
        p.ultimo_evento && detalhes.length > 0
          ? `${p.ultimo_evento} — ${detalhes.join(' · ')}.`
          : p.ultimo_evento ||
            (detalhes.length > 0
              ? `Processo autuado em ${p.distribuicao || p.data_autuacao || 'data não informada'}. ${detalhes.join(' · ')}.`
              : `Processo autuado no tribunal: ${p.distribuicao || p.data_autuacao || 'Data não informada'}. O tribunal ainda não disponibilizou o histórico de movimentações para este processo.`),
      tag: 'informativo'
    });
  }

  let parteContraria = 'Não informada';
  const normUser = (fullName || '').toLowerCase().trim();

  if (autor && reu) {
    if (normUser && autor.toLowerCase().includes(normUser)) {
      parteContraria = reu;
    } else if (normUser && reu.toLowerCase().includes(normUser)) {
      parteContraria = autor;
    } else {
      parteContraria = reu;
    }
  } else {
    parteContraria = reu || autor || 'Não informada';
  }

  let valorCausa = p.valor_acao || p.valor_causa;
  if (!valorCausa && p.normalizado_valor_acao) {
    valorCausa = `R$ ${Number(p.normalizado_valor_acao).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  }

  return {
    numero: num,
    tribunal: `${tribunalLabel} · ${orgao || '1º Grau'}`,
    tipo: p.classe || p.classe_acao || p.assunto || 'Ação Judicial',
    parteContraria,
    valorCausa: valorCausa || 'Não informado',
    distribuicao: p.distribuicao || p.data_autuacao || 'Não informada',
    movimentos: movs,
    assunto: textoDoCampo(p.assunto) || (Array.isArray(p.assuntos) ? p.assuntos.filter((a: unknown) => typeof a === 'string').join(', ') : '') || undefined,
    varaForo: [textoDoCampo(p.vara) || textoDoCampo(p.orgao_julgador), textoDoCampo(p.foro)].filter(Boolean).join(' - ') || undefined,
    autor: autor || undefined,
    reu: reu || undefined
  };
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
          { error: `Nenhuma fonte habilitada para ${targetLabel}. Marque o DataJud ou a Infosimples no Passo 2.` },
          { status: 400 }
        );
      }

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
          const { custoEstimado, custoCobrado } = resultado;
          const formattedNumber = cnjInfo?.numeroFormatado || cleanProcessNumber;

          const userId = await getUserId(request);
          await trackEvento(request, userId, {
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
          });
          await registrarHistoricoConsulta(userId, {
            tipoBusca: 'numero',
            termo: formattedNumber,
            nomeParte: fullName,
            tribunais: [targetLabel],
            totalProcessos: allProcesses.length,
            custoEstimado,
            custoCobrado
          });

          if (userId && allProcesses.length > 0) {
            await salvarProcessos(userId, cpfParaPerfil, fullName, allProcesses);
            await sincronizarMonitoramento(userId, allProcesses);
            await salvarPreferencias(userId, [targetLabel], {
              avisarMovimentacao,
              canalAviso,
              resumoLinguagemSimples
            });
          }

          if (allProcesses.length === 0) {
            emit({
              type: 'done',
              notFound: true,
              totalProcessos: 0,
              processes: [],
              tribunaisConsultados: [targetLabel],
              custoEstimado,
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
        { error: 'Nenhuma fonte habilitada aceita este tipo de busca. Revise as fontes no Passo 2.' },
        { status: 400 }
      );
    }

    // Toggle "economizar busca por DDD / Estado" (Passo 4): com o tribunal prioritário identificado entre os
    // alvos, separa-o numa 1ª onda — só dispara o restante (2ª onda) se nada for achado ali.
    const tribunalPrioritario = forcedTj || (ddd ? tribunalByDdd(ddd) : null);
    const alvosPrioritarios = tribunalPrioritario
      ? targets.filter(t => t.label === tribunalPrioritario || t.label.startsWith(`${tribunalPrioritario} (`))
      : [];
    const dividirPorDdd = !!(economizarPorDdd && alvosPrioritarios.length > 0);
    const targetsPrimeiraOnda = dividirPorDdd ? alvosPrioritarios : targets;
    const targetsSegundaOnda = dividirPorDdd ? targets.filter(t => !alvosPrioritarios.includes(t)) : [];

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

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        emit({ type: 'started', consultaId });

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
          const enriquecido = await consultarDataJud(tribunalLabel, numeroDigits, datajudPermitidos, abortController.signal);
          const cancelado = abortController.signal.aborted;
          abortControllers.delete(dataJudLabel);

          if (cancelado) {
            emit({ type: 'progress', label: dataJudLabel, fonte: 'datajud', found: false, cancelado: true });
            return;
          }

          if (!enriquecido) {
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
          emit({ type: 'progress', label: dataJudLabel, fonte: 'datajud', found: mudou });
        };

        const enriquecimentoPromises: Promise<void>[] = [];

        const consultarTarget = async (target: (typeof targets)[number]) => {
          tribunaisConsultados.push(target.label);
          const abortController = new AbortController();
          abortControllers.set(target.label, abortController);
          emit({ type: 'progress', label: target.label, fonte: 'infosimples', status: 'loading' });
          const result = await fetchInfosimples(target.service, token, { ...target.fixos, [target.campo]: target.valor }, abortController.signal);
          custoCobrado += precoDaRespostaInfosimples(result);
          const cancelado = abortController.signal.aborted;
          abortControllers.delete(target.label);

          if (cancelado) {
            emit({ type: 'progress', label: target.label, fonte: 'infosimples', found: false, cancelado: true });
            return;
          }

          let foundInThisTribunal = false;
          const desfecho = desfechoInfosimples(result);
          console.log(
            result
              ? `[api/processos] ${target.label} (${target.campo}): code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})${desfecho.erro ? ' [ERRO]' : ''}`
              : `[api/processos] ${target.label} (${target.campo}): sem resposta da Infosimples [ERRO]`
          );

          if (result && result.code === 200 && result.data?.[0]) {
            const rawList = extrairProcessosInfosimples(result.data[0]);

            rawList.forEach((p: any) => {
              const num = (p.processo || p.numero || p.numero_processo || p.numero_cnj || '').trim();
              if (!num || seenProcessos.has(num)) return;
              seenProcessos.add(num);
              foundInThisTribunal = true;

              const processo = montarLegalProcessDaInfosimples(p, target.label, fullName);
              processo.origem = 'infosimples';
              allProcesses.push(processo);
              // Dispara o DataJud já aqui, em paralelo com os outros tribunais ainda rodando.
              enriquecimentoPromises.push(enriquecerComDataJud(processo, target));
            });
          }

          // "erro" só quando a fonte falhou; fonte que respondeu "nada encontrado" segue como found:false.
          emit({
            type: 'progress',
            label: target.label,
            fonte: 'infosimples',
            found: foundInThisTribunal,
            ...(desfecho.erro && !foundInThisTribunal ? { erro: desfecho.erro, codigo: desfecho.codigo } : {})
          });
        };

        if (targetsSegundaOnda.length > 0) {
          // Toggle "economizar busca por DDD": 1ª onda só com o(s) tribunal(is) do estado do DDD
          // informado. Só dispara a 2ª onda (demais tribunais selecionados) se nada foi achado ali —
          // economiza chamadas pagas da Infosimples quando o processo está no tribunal esperado.
          await Promise.allSettled(targetsPrimeiraOnda.map(consultarTarget));
          if (allProcesses.length === 0) {
            await Promise.allSettled(targetsSegundaOnda.map(consultarTarget));
          }
        } else {
          await Promise.allSettled(targetsPrimeiraOnda.map(consultarTarget));
        }
        await Promise.allSettled(enriquecimentoPromises);

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

        const userId = await getUserId(request);
        await trackEvento(request, userId, {
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
        });
        await registrarHistoricoConsulta(userId, {
          tipoBusca,
          termo: valorBusca,
          nomeParte: fullName,
          tribunais: tribunaisConsultados,
          totalProcessos: filteredProcesses.length,
          custoEstimado,
          custoCobrado
        });

        if (userId) {
          await salvarProcessos(userId, cpfParaPerfil, fullName, filteredProcesses);
          if (filteredProcesses.length > 0) await sincronizarMonitoramento(userId, filteredProcesses);
          await salvarPreferencias(userId, tribunaisSelecionados, {
            avisarMovimentacao,
            canalAviso,
            resumoLinguagemSimples
          });
        }

        if (filteredProcesses.length === 0) {
          console.log(`[api/processos] Nenhum processo localizado nos tribunais consultados (${tribunaisConsultados.join(', ')}) para a busca por ${tipoBusca}.`);
          emit({ type: 'done', notFound: true, totalProcessos: 0, processes: [], tribunaisConsultados, custoEstimado, descartadosPorPolo });
        } else {
          console.log(`[api/processos] Sucesso: ${filteredProcesses.length} processo(s) consolidado(s) de ${tribunaisConsultados.join(', ')}. Custo estimado: R$ ${custoEstimado.toFixed(2)}`);
          emit({
            type: 'done',
            notFound: false,
            totalProcessos: filteredProcesses.length,
            processes: filteredProcesses,
            tribunaisConsultados,
            custoEstimado,
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
