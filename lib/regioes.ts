/**
 * Estados (UF) atendidos por cada tribunal, para filtrar as fontes do Passo 2 por estado
 * (ex.: "tribunais do RJ" = TJRJ, TRF2, TRT1, TRE-RJ). Tribunais superiores não têm UF (abrangência nacional).
 */
export const UFS: { sigla: string; nome: string }[] = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' }
];

const NOME_POR_UF = new Map(UFS.map(u => [u.sigla, u.nome]));

export const nomeDaUf = (sigla: string): string => NOME_POR_UF.get(sigla) ?? sigla;

/** UFs de maior movimento, exibidas como atalhos de filtro. */
export const UFS_RAPIDAS = ['SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'DF'];

// Regiões da Justiça Federal (o TRF6 passou a cobrir Minas Gerais em 2022).
const UFS_POR_TRF: Record<string, string[]> = {
  trf1: ['AC', 'AM', 'AP', 'BA', 'DF', 'GO', 'MA', 'MT', 'PA', 'PI', 'RO', 'RR', 'TO'],
  trf2: ['RJ', 'ES'],
  trf3: ['SP', 'MS'],
  trf4: ['RS', 'SC', 'PR'],
  trf5: ['AL', 'CE', 'PB', 'PE', 'RN', 'SE'],
  trf6: ['MG']
};

// Regiões da Justiça do Trabalho (TRT1 a TRT24).
const UFS_POR_TRT: Record<number, string[]> = {
  1: ['RJ'], 2: ['SP'], 3: ['MG'], 4: ['RS'], 5: ['BA'], 6: ['PE'], 7: ['CE'], 8: ['PA', 'AP'],
  9: ['PR'], 10: ['DF', 'TO'], 11: ['AM', 'RR'], 12: ['SC'], 13: ['PB'], 14: ['RO', 'AC'], 15: ['SP'],
  16: ['MA'], 17: ['ES'], 18: ['GO'], 19: ['AL'], 20: ['SE'], 21: ['RN'], 22: ['PI'], 23: ['MT'], 24: ['MS']
};

/** Sigla da UF no sufixo de um alias (tjsp -> SP, tjdft e tre-dft -> DF). */
const ufDoSufixo = (sufixo: string): string => (sufixo === 'dft' ? 'DF' : sufixo.toUpperCase());

/**
 * UFs atendidas por um alias do DataJud (tjsp, tre-rj, tjmmg, trf2, trt1...). Lista vazia = tribunal
 * de abrangência nacional (STJ, STM, TSE, TST) ou alias desconhecido.
 */
export function ufsDoAlias(alias: string): string[] {
  const militar = /^tjm(mg|rs|sp)$/.exec(alias);
  if (militar) return [militar[1].toUpperCase()];
  const tre = /^tre-([a-z]+)$/.exec(alias);
  if (tre) return [ufDoSufixo(tre[1])];
  const tj = /^tj([a-z]{2,3})$/.exec(alias);
  if (tj) return [ufDoSufixo(tj[1])];
  if (alias in UFS_POR_TRF) return UFS_POR_TRF[alias];
  const trt = /^trt(\d+)$/.exec(alias);
  if (trt) return UFS_POR_TRT[Number(trt[1])] ?? [];
  return [];
}
