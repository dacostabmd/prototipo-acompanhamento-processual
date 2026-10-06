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

/** Extrai o DDD de um telefone (com ou sem formatação) já contendo DDD + número. */
export function extractDdd(phoneDigits: string): number {
  return phoneDigits.length >= 10 ? parseInt(phoneDigits.slice(0, 2), 10) : 0;
}

/** Retorna o label do tribunal estadual associado ao DDD, ou null se não mapeado. */
function tribunalByDdd(ddd: number): string | null {
  return UF_POR_DDD[ddd] ?? null;
}

/**
 * Reordena a lista de tribunais colocando primeiro o tribunal do estado do DDD informado
 * (e suas variantes de sistema, ex.: "TJSP" + "TJSP (eproc)"), mantendo a ordem original
 * para os demais. Sem DDD mapeado, retorna a lista original sem alterações.
 */
export function prioritizeByDdd<T extends { label: string }>(items: T[], ddd: number): T[] {
  const priority = tribunalByDdd(ddd);
  if (!priority) return items;
  return [...items].sort((a, b) => {
    const aPriority = a.label === priority || a.label.startsWith(`${priority} (`);
    const bPriority = b.label === priority || b.label.startsWith(`${priority} (`);
    if (aPriority && !bPriority) return -1;
    if (!aPriority && bPriority) return 1;
    return 0;
  });
}
