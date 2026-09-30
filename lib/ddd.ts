/**
 * Mapeia o DDD do celular informado no Passo 4 para o tribunal estadual (TJ) correspondente,
 * entre os 8 tribunais estaduais hoje suportados na varredura multi-tribunal
 * (app/api/processos/route.ts). DDDs de estados sem TJ próprio na lista (ou de tribunais
 * federais) retornam null e a ordem padrão é mantida.
 */
const DDD_TO_TRIBUNAL: Record<number, string> = {
  // SP — TJSP
  11: 'TJSP', 12: 'TJSP', 13: 'TJSP', 14: 'TJSP', 15: 'TJSP', 16: 'TJSP', 17: 'TJSP', 18: 'TJSP', 19: 'TJSP',
  // RJ — TJRJ
  21: 'TJRJ', 22: 'TJRJ', 24: 'TJRJ',
  // MG — TJMG
  31: 'TJMG', 32: 'TJMG', 33: 'TJMG', 34: 'TJMG', 35: 'TJMG', 37: 'TJMG', 38: 'TJMG',
  // PR — TJPR
  41: 'TJPR', 42: 'TJPR', 43: 'TJPR', 44: 'TJPR', 45: 'TJPR', 46: 'TJPR',
  // SC — TJSC
  47: 'TJSC', 48: 'TJSC', 49: 'TJSC',
  // RS — TJRS
  51: 'TJRS', 53: 'TJRS', 54: 'TJRS', 55: 'TJRS',
  // BA — TJBA
  71: 'TJBA', 73: 'TJBA', 74: 'TJBA', 75: 'TJBA', 77: 'TJBA'
};

/** Extrai o DDD de um telefone (com ou sem formatação) já contendo DDD + número. */
export function extractDdd(phoneDigits: string): number {
  return phoneDigits.length >= 10 ? parseInt(phoneDigits.slice(0, 2), 10) : 0;
}

/** Retorna o label do tribunal estadual associado ao DDD, ou null se não mapeado. */
export function tribunalByDdd(ddd: number): string | null {
  return DDD_TO_TRIBUNAL[ddd] ?? null;
}

/**
 * Reordena a lista de tribunais colocando primeiro o tribunal do estado do DDD informado
 * (e sua variante eproc, se existir, ex.: "TJSP" + "TJSP (eproc)"), mantendo a ordem original
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
