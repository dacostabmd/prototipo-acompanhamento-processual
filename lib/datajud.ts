import type { Movement } from './mockProcesses';
import { classifyTag } from './classify';

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
  orgaoJulgador?: { nome?: string };
  movimentos?: DataJudMovimento[];
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
function parseDataAjuizamento(raw: string): string | undefined {
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

  const alias = DATAJUD_ALIAS_BY_TRIBUNAL_LABEL[tribunalLabel];
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
          titulo: (m.nome || '').slice(0, 70),
          descricao: partes || 'Sem descrição detalhada.',
          tag: classifyTag(partes)
        };
      });

    return {
      movimentos,
      classe: source.classe?.nome,
      assuntos: (source.assuntos ?? []).map(a => a.nome).filter((n): n is string => !!n),
      orgaoJulgador: source.orgaoJulgador?.nome,
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
