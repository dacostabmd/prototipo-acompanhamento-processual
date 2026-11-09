/**
 * Tipos e helpers puros da jurisprudência. Sem dependência de servidor: usados pela lib, pela API e pela UI.
 */

export interface ItemJurisprudencia {
  id: string;
  fonte: string;
  tribunal: string;
  tipo: string;
  classe: string | null;
  numero: string | null;
  relator: string | null;
  orgaoJulgador: string | null;
  dataJulgamento: string | null;
  dataPublicacao: string | null;
  ementa: string;
  fonteUrl: string | null;
  /** Relevância 0-1 (fusão da busca textual com a semântica). */
  score: number;
  /** Trecho da ementa mais próximo dos termos buscados. */
  trecho: string;
  /** Termos a destacar no trecho. */
  termos: string[];
  referencia: string;
}

export interface CitacaoJurisprudencia {
  /** Ex.: 'STJ, AgInt no AREsp 2.628.498, Rel. Min. Daniela Teixeira, j. 24/08/2026' */
  referencia: string;
  ementa: string;
  fonteUrl: string | null;
  id: string;
}

export const TRIBUNAIS_DISPONIVEIS = [{ value: 'STJ', label: 'STJ - Superior Tribunal de Justiça' }] as const;

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** 'DANIELA TEIXEIRA' -> 'Daniela Teixeira'. */
export function nomePropio(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/** '2628498' -> '2.628.498'. Textos que não são só dígitos voltam como vieram. */
export function formatarNumeroProcesso(numero: string | null | undefined): string {
  if (!numero) return '';
  const t = numero.trim();
  return /^\d+$/.test(t) ? t.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : t;
}

/** '2026-08-24' -> '24/08/2026'. */
export function formatarDataBR(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * Referência bibliográfica curta para citar o julgado.
 * Só usa campos que a fonte informa: o STJ não publica a UF de origem nos espelhos, então ela não entra.
 */
export function formatarReferencia(i: {
  tribunal: string;
  classe: string | null;
  numero: string | null;
  relator: string | null;
  dataJulgamento: string | null;
}): string {
  const partes = [i.tribunal];
  const proc = [i.classe, formatarNumeroProcesso(i.numero)].filter(Boolean).join(' ');
  if (proc) partes.push(proc);
  if (i.relator) partes.push(`Rel. Min. ${nomePropio(i.relator)}`);
  const data = formatarDataBR(i.dataJulgamento);
  if (data) partes.push(`j. ${data}`);
  return partes.join(', ');
}
