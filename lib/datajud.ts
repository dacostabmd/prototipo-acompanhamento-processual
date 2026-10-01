import type { Movement, LegalProcess } from './mockProcesses';
import { classifyTag } from './classify';
import { parseCnj, formatProcessNumber } from './cnj';

/**
 * Mapa dos labels de tribunal já usados na varredura Infosimples (ProcessTracker.tsx / route.ts)
 * para o alias da API pública DataJud (CNJ). Variantes de sistema (eproc) apontam para o mesmo
 * alias base, pois o DataJud indexa por tribunal, não por sistema de origem do processo.
 * Lista de aliases confirmada no tutorial oficial do CNJ (datajud-wiki.cnj.jus.br).
 */
const DATAJUD_ALIAS_BY_TRIBUNAL_LABEL: Record<string, string> = {
  TJSP: 'tjsp',
  'TJSP (eproc)': 'tjsp',
  TJRJ: 'tjrj',
  TJMG: 'tjmg',
  TJPR: 'tjpr',
  TJBA: 'tjba',
  TJRS: 'tjrs',
  TJSC: 'tjsc',
  TRF1: 'trf1',
  TRF2: 'trf2',
  'TRF2 (eproc)': 'trf2',
  TRF3: 'trf3',
  TRF5: 'trf5',
  TRF6: 'trf6'
};

interface DataJudMovimento {
  nome?: string;
  dataHora?: string;
  complementosTabelados?: { codigo?: number; valor?: number; nome?: string; descricao?: string }[];
  // A doc oficial do CNJ lista este campo como "nomeOrgao", mas a resposta real da API usa "nome"
  // (confirmado por teste direto) — aceita ambos por segurança.
  orgaoJulgador?: { nome?: string; nomeOrgao?: string };
}

interface DataJudSource {
  numeroProcesso?: string;
  dataAjuizamento?: string;
  grau?: string;
  classe?: { nome?: string };
  assuntos?: { nome?: string }[];
  orgaoJulgador?: { nome?: string; nomeOrgao?: string };
  movimentos?: DataJudMovimento[];
  valorCausa?: number;
  dadosBasicos?: { valorCausa?: number };
  polos?: any[];
}

export interface DataJudResultado {
  movimentos: Movement[];
  classe?: string;
  assuntos: string[];
  orgaoJulgador?: string;
  grau?: string;
  dataAjuizamento?: string;
}

const TIMEOUT_MS = 5000;

/**
 * dataAjuizamento do processo vem em dois formatos observados na API: ISO ("2018-10-29T00:00:00Z")
 * ou compacto sem separadores ("20181029000000", AAAAMMDDhhmmss). Normaliza para "AAAA-MM-DD".
 */
export function parseDataAjuizamento(raw: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{14}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return undefined;
}

/**
 * Consulta a API pública do DataJud (CNJ) por número de processo, para enriquecer um processo
 * já localizado pela Infosimples. Nunca lança erro — sem DATAJUD_API_KEY configurada, ou em
 * qualquer falha/timeout, retorna null e o fluxo principal segue sem o enriquecimento.
 */
export async function consultarDataJud(tribunalLabel: string, numeroProcessoDigits: string): Promise<DataJudResultado | null> {
  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) return null;

  let alias = DATAJUD_ALIAS_BY_TRIBUNAL_LABEL[tribunalLabel];
  if (!alias) {
    const cnjInfo = parseCnj(numeroProcessoDigits);
    if (cnjInfo?.datajudAlias) alias = cnjInfo.datajudAlias;
  }

  if (!alias || numeroProcessoDigits.length !== 20) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`, {
      method: 'POST',
      headers: {
        Authorization: `APIKey ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: numeroProcessoDigits } } }),
      signal: controller.signal
    });
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    const source: DataJudSource | undefined = data?.hits?.hits?.[0]?._source;
    if (!source) return null;

    const movimentos: Movement[] = (source.movimentos ?? [])
      .filter(m => m.nome)
      .map(m => {
        // Complemento tabelado da TPU pode trazer só um rótulo (nome/descrição) ou também um valor
        // monetário/numérico associado (ex.: valor de uma penhora, percentual de uma multa).
        const complementos = (m.complementosTabelados ?? [])
          .map(c => {
            const label = c.nome || c.descricao;
            if (!label) return null;
            return c.valor !== undefined ? `${label}: ${c.valor.toLocaleString('pt-BR')}` : label;
          })
          .filter(Boolean)
          .join(', ');
        const orgaoMovimento = m.orgaoJulgador?.nome || m.orgaoJulgador?.nomeOrgao;
        const partes = [m.nome, complementos && `(${complementos})`, orgaoMovimento && `— ${orgaoMovimento}`]
          .filter(Boolean)
          .join(' ');
        return {
          data: (m.dataHora || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
          titulo: m.nome || 'Movimentação',
          descricao: partes || 'Sem descrição detalhada.',
          tag: classifyTag(partes)
        };
      });

    return {
      movimentos,
      classe: source.classe?.nome,
      assuntos: (source.assuntos ?? []).map(a => a.nome).filter((n): n is string => !!n),
      orgaoJulgador: source.orgaoJulgador?.nome || source.orgaoJulgador?.nomeOrgao,
      grau: source.grau,
      dataAjuizamento: source.dataAjuizamento ? parseDataAjuizamento(source.dataAjuizamento) : undefined
    };
  } catch (e) {
    console.error(`[datajud] falha ao consultar ${tribunalLabel} (${alias})`, e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Busca direta e completa de um processo exclusivamente pelo número CNJ via API pública do DataJud.
 * Identifica o tribunal correto a partir do CNJ (ex: 8.26 -> TJSP) e retorna o LegalProcess pronto.
 */
export async function buscarProcessoDiretoDataJud(numeroProcessoDigits: string): Promise<LegalProcess | null> {
  const info = parseCnj(numeroProcessoDigits);
  if (!info || !info.valido || !info.datajudAlias) return null;

  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://api-publica.datajud.cnj.jus.br/api_publica_${info.datajudAlias}/_search`, {
      method: 'POST',
      headers: {
        Authorization: `APIKey ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: info.numeroLimpo } } }),
      signal: controller.signal
    });
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    const source: DataJudSource | undefined = data?.hits?.hits?.[0]?._source;
    if (!source) return null;

    const movimentos: Movement[] = (source.movimentos ?? [])
      .filter(m => m.nome)
      .map(m => {
        const complementos = (m.complementosTabelados ?? [])
          .map(c => {
            const label = c.nome || c.descricao;
            if (!label) return null;
            return c.valor !== undefined ? `${label}: ${c.valor.toLocaleString('pt-BR')}` : label;
          })
          .filter(Boolean)
          .join(', ');
        const orgaoMovimento = m.orgaoJulgador?.nome || m.orgaoJulgador?.nomeOrgao;
        const partes = [m.nome, complementos && `(${complementos})`, orgaoMovimento && `— ${orgaoMovimento}`]
          .filter(Boolean)
          .join(' ');
        return {
          data: (m.dataHora || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
          titulo: m.nome || 'Movimentação',
          descricao: partes || 'Sem descrição detalhada.',
          tag: classifyTag(partes)
        };
      });

    const assuntos = (source.assuntos ?? []).map(a => a.nome).filter((n): n is string => !!n);
    const varaOrgao = source.orgaoJulgador?.nome || source.orgaoJulgador?.nomeOrgao || (source.grau ? `Grau ${source.grau}` : '1º Grau');
    const valorCausaNum = source.valorCausa || source.dadosBasicos?.valorCausa;
    const valorCausaStr =
      typeof valorCausaNum === 'number'
        ? `R$ ${valorCausaNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        : 'Não informado';

    let parteContraria = 'Não informada';
    if (Array.isArray(source.polos)) {
      const passivo = source.polos.find((p: any) => p.polo === 'PA' || p.tipo === 'PASSIVO');
      const ativo = source.polos.find((p: any) => p.polo === 'AT' || p.tipo === 'ATIVO');
      const nomePassivo = passivo?.partes?.[0]?.nome || passivo?.nome;
      const nomeAtivo = ativo?.partes?.[0]?.nome || ativo?.nome;
      parteContraria = nomePassivo || nomeAtivo || 'Não informada';
    }

    return {
      numero: formatProcessNumber(source.numeroProcesso || info.numeroLimpo),
      tribunal: `${info.tribunalLabel} · ${varaOrgao}`,
      tipo: source.classe?.nome || 'Ação Judicial',
      parteContraria,
      valorCausa: valorCausaStr,
      distribuicao: source.dataAjuizamento ? parseDataAjuizamento(source.dataAjuizamento) || 'Não informada' : 'Não informada',
      movimentos:
        movimentos.length > 0
          ? movimentos
          : [
              {
                data: source.dataAjuizamento
                  ? parseDataAjuizamento(source.dataAjuizamento) || new Date().toISOString().slice(0, 10)
                  : new Date().toISOString().slice(0, 10),
                titulo: 'Processo autuado no tribunal',
                descricao: `Processo em tramitação no ${info.tribunalNome} (${varaOrgao}). Classe: ${source.classe?.nome || 'Ação Judicial'}.`,
                tag: 'informativo'
              }
            ],
      assuntosDataJud: assuntos,
      orgaoJulgadorDataJud: varaOrgao,
      grauDataJud: source.grau,
      enriquecidoDataJud: true
    };
  } catch (e) {
    console.error(`[datajud] erro ao buscar processo direto ${info.numeroLimpo} no ${info.tribunalLabel}`, e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
