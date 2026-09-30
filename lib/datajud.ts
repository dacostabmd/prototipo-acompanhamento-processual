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
  complementosTabelados?: { nome?: string; descricao?: string }[];
}

interface DataJudSource {
  numeroProcesso?: string;
  classe?: { nome?: string };
  movimentos?: DataJudMovimento[];
}

export interface DataJudResultado {
  movimentos: Movement[];
  classe?: string;
}

const TIMEOUT_MS = 5000;

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
        const complementos = (m.complementosTabelados ?? []).map(c => c.nome || c.descricao).filter(Boolean).join(', ');
        const descricao = complementos ? `${m.nome} (${complementos})` : m.nome || '';
        return {
          data: (m.dataHora || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
          titulo: (m.nome || '').slice(0, 70),
          descricao: descricao || 'Sem descrição detalhada.',
          tag: classifyTag(descricao)
        };
      });

    return { movimentos, classe: source.classe?.nome };
  } catch (e) {
    console.error(`[datajud] falha ao consultar ${tribunalLabel} (${alias})`, e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
