import { TRIBUNAIS_ESTADUAIS, TRIBUNAIS_FEDERAIS, TRIBUNAIS_MILITARES_ESTADUAIS, ufDoAliasTj } from './cnj';

/**
 * Catálogo dos endpoints da API pública do DataJud (CNJ): um por tribunal, todos gratuitos.
 * Lista conferida na página oficial de endpoints (datajud-wiki.cnj.jus.br/api-publica/endpoints):
 * 91 endpoints — 4 superiores (STJ, STM, TSE, TST), 6 TRFs, 27 TJs, 24 TRTs, 27 TREs e 3 tribunais
 * de Justiça Militar estadual. STF e CNJ NÃO têm endpoint. O DataJud só busca por número de processo
 * (não por CPF/CNPJ/nome), então serve à busca por número e ao enriquecimento de processos já achados.
 */
export type GrupoFonte =
  | 'Tribunais superiores'
  | 'Justiça Federal'
  | 'Justiça Estadual'
  | 'Justiça do Trabalho'
  | 'Justiça Eleitoral'
  | 'Justiça Militar';

export interface FonteDatajud {
  /** Alias do endpoint (api_publica_<alias>); também é o identificador usado na seleção. */
  id: string;
  label: string;
  nome: string;
  grupo: GrupoFonte;
}

const SUPERIORES: FonteDatajud[] = [
  { id: 'stj', label: 'STJ', nome: 'Superior Tribunal de Justiça', grupo: 'Tribunais superiores' },
  { id: 'stm', label: 'STM', nome: 'Superior Tribunal Militar', grupo: 'Tribunais superiores' },
  { id: 'tse', label: 'TSE', nome: 'Tribunal Superior Eleitoral', grupo: 'Tribunais superiores' },
  { id: 'tst', label: 'TST', nome: 'Tribunal Superior do Trabalho', grupo: 'Tribunais superiores' }
];

const FEDERAIS: FonteDatajud[] = Object.values(TRIBUNAIS_FEDERAIS).map(t => ({
  id: t.alias,
  label: t.label,
  nome: t.nome,
  grupo: 'Justiça Federal'
}));

const ESTADUAIS: FonteDatajud[] = Object.values(TRIBUNAIS_ESTADUAIS).map(t => ({
  id: t.alias,
  label: t.label,
  nome: t.nome,
  grupo: 'Justiça Estadual'
}));

const TRABALHO: FonteDatajud[] = Array.from({ length: 24 }, (_, i) => ({
  id: `trt${i + 1}`,
  label: `TRT${i + 1}`,
  nome: `Tribunal Regional do Trabalho da ${i + 1}ª Região`,
  grupo: 'Justiça do Trabalho' as const
}));

const ELEITORAIS: FonteDatajud[] = Object.values(TRIBUNAIS_ESTADUAIS).map(t => {
  const uf = ufDoAliasTj(t.alias);
  return { id: `tre-${uf}`, label: `TRE-${uf.toUpperCase()}`, nome: `Tribunal Regional Eleitoral (${uf.toUpperCase()})`, grupo: 'Justiça Eleitoral' as const };
});

const MILITARES: FonteDatajud[] = Object.values(TRIBUNAIS_MILITARES_ESTADUAIS).map(t => ({
  id: t.alias,
  label: t.label,
  nome: t.nome,
  grupo: 'Justiça Militar'
}));

export const FONTES_DATAJUD: FonteDatajud[] = [...SUPERIORES, ...FEDERAIS, ...ESTADUAIS, ...TRABALHO, ...ELEITORAIS, ...MILITARES];

/** Ordem de exibição dos grupos (também usada pelo catálogo da Infosimples): estadual e federal primeiro. */
export const GRUPOS_FONTES: GrupoFonte[] = [
  'Justiça Estadual',
  'Justiça Federal',
  'Justiça do Trabalho',
  'Justiça Eleitoral',
  'Tribunais superiores',
  'Justiça Militar'
];

const ALIASES_VALIDOS = new Set(FONTES_DATAJUD.map(f => f.id));

/**
 * Normaliza a seleção vinda do cliente: ausente (null/undefined) = todos os endpoints (retorna null);
 * lista vazia = nenhum (Set vazio); ignora aliases desconhecidos.
 */
export function aliasesDatajudPermitidos(selecionados: unknown): Set<string> | null {
  if (!Array.isArray(selecionados)) return null;
  return new Set(selecionados.filter((a): a is string => typeof a === 'string' && ALIASES_VALIDOS.has(a)));
}
