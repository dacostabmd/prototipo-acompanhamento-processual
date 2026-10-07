/**
 * Mapeia o DDD do celular informado no Passo 4 para o tribunal estadual (TJ) correspondente.
 * A lista cobre todos os DDDs do país; a priorização só tem efeito quando o TJ está entre as
 * fontes consultadas (lib/fontes.ts). DDD desconhecido retorna null e a ordem padrão é mantida.
 */
const UF_POR_DDD: Record<number, string> = {
  11: 'TJSP', 12: 'TJSP', 13: 'TJSP', 14: 'TJSP', 15: 'TJSP', 16: 'TJSP', 17: 'TJSP', 18: 'TJSP', 19: 'TJSP',
  21: 'TJRJ', 22: 'TJRJ', 24: 'TJRJ',
  27: 'TJES', 28: 'TJES',
  31: 'TJMG', 32: 'TJMG', 33: 'TJMG', 34: 'TJMG', 35: 'TJMG', 37: 'TJMG', 38: 'TJMG',
  41: 'TJPR', 42: 'TJPR', 43: 'TJPR', 44: 'TJPR', 45: 'TJPR', 46: 'TJPR',
  47: 'TJSC', 48: 'TJSC', 49: 'TJSC',
  51: 'TJRS', 53: 'TJRS', 54: 'TJRS', 55: 'TJRS',
  61: 'TJDFT',
  62: 'TJGO', 64: 'TJGO',
  63: 'TJTO',
  65: 'TJMT', 66: 'TJMT',
  67: 'TJMS',
  68: 'TJAC',
  69: 'TJRO',
  71: 'TJBA', 73: 'TJBA', 74: 'TJBA', 75: 'TJBA', 77: 'TJBA',
  79: 'TJSE',
  81: 'TJPE', 87: 'TJPE',
  82: 'TJAL',
  83: 'TJPB',
  84: 'TJRN',
  85: 'TJCE', 88: 'TJCE',
  86: 'TJPI', 89: 'TJPI',
  91: 'TJPA', 93: 'TJPA', 94: 'TJPA',
  92: 'TJAM', 97: 'TJAM',
  95: 'TJRR',
  96: 'TJAP',
  98: 'TJMA', 99: 'TJMA'
};

export const ESTADOS_BRASIL: { uf: string; nome: string; tj: string }[] = [
  { uf: 'AC', nome: 'Acre', tj: 'TJAC' },
  { uf: 'AL', nome: 'Alagoas', tj: 'TJAL' },
  { uf: 'AP', nome: 'Amapá', tj: 'TJAP' },
  { uf: 'AM', nome: 'Amazonas', tj: 'TJAM' },
  { uf: 'BA', nome: 'Bahia', tj: 'TJBA' },
  { uf: 'CE', nome: 'Ceará', tj: 'TJCE' },
  { uf: 'DF', nome: 'Distrito Federal', tj: 'TJDFT' },
  { uf: 'ES', nome: 'Espírito Santo', tj: 'TJES' },
  { uf: 'GO', nome: 'Goiás', tj: 'TJGO' },
  { uf: 'MA', nome: 'Maranhão', tj: 'TJMA' },
  { uf: 'MT', nome: 'Mato Grosso', tj: 'TJMT' },
  { uf: 'MS', nome: 'Mato Grosso do Sul', tj: 'TJMS' },
  { uf: 'MG', nome: 'Minas Gerais', tj: 'TJMG' },
  { uf: 'PA', nome: 'Pará', tj: 'TJPA' },
  { uf: 'PB', nome: 'Paraíba', tj: 'TJPB' },
  { uf: 'PR', nome: 'Paraná', tj: 'TJPR' },
  { uf: 'PE', nome: 'Pernambuco', tj: 'TJPE' },
  { uf: 'PI', nome: 'Piauí', tj: 'TJPI' },
  { uf: 'RJ', nome: 'Rio de Janeiro', tj: 'TJRJ' },
  { uf: 'RN', nome: 'Rio Grande do Norte', tj: 'TJRN' },
  { uf: 'RS', nome: 'Rio Grande do Sul', tj: 'TJRS' },
  { uf: 'RO', nome: 'Rondônia', tj: 'TJRO' },
  { uf: 'RR', nome: 'Roraima', tj: 'TJRR' },
  { uf: 'SC', nome: 'Santa Catarina', tj: 'TJSC' },
  { uf: 'SP', nome: 'São Paulo', tj: 'TJSP' },
  { uf: 'SE', nome: 'Sergipe', tj: 'TJSE' },
  { uf: 'TO', nome: 'Tocantins', tj: 'TJTO' }
];

/** Retorna o tribunal estadual correspondente à sigla da UF (ex: 'SP' -> 'TJSP'). */
export function tribunalByUf(uf: string): string | null {
  const match = ESTADOS_BRASIL.find(e => e.uf.toUpperCase() === uf.toUpperCase());
  return match?.tj ?? null;
}

/** Extrai o DDD de um telefone (com ou sem formatação) já contendo DDD + número. */
export function extractDdd(phoneDigits: string): number {
  return phoneDigits.length >= 10 ? parseInt(phoneDigits.slice(0, 2), 10) : 0;
}

/** Retorna o label do tribunal estadual associado ao DDD, ou null se não mapeado. */
export function tribunalByDdd(ddd: number): string | null {
  return UF_POR_DDD[ddd] ?? null;
}

/**
 * Reordena a lista de tribunais colocando primeiro o tribunal do estado escolhido manualmente
 * ou, se não informado, o tribunal do estado do DDD informado, mantendo a ordem original para os demais.
 */
export function prioritizeByTribunalOrDdd<T extends { label: string }>(
  items: T[],
  forcedTj?: string | null,
  ddd?: number
): T[] {
  const priority = forcedTj || (ddd ? tribunalByDdd(ddd) : null);
  if (!priority) return items;
  return [...items].sort((a, b) => {
    const aPriority = a.label === priority || a.label.startsWith(`${priority} (`) || a.label.startsWith(`${priority} `);
    const bPriority = b.label === priority || b.label.startsWith(`${priority} (`) || b.label.startsWith(`${priority} `);
    if (aPriority && !bPriority) return -1;
    if (!aPriority && bPriority) return 1;
    return 0;
  });
}

/** Mantém compatibilidade com a assinatura anterior. */
export function prioritizeByDdd<T extends { label: string }>(items: T[], ddd: number): T[] {
  return prioritizeByTribunalOrDdd(items, null, ddd);
}

