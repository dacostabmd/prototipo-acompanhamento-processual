import type { MovementTag } from './mockProcesses';

/** Classifica o texto de uma movimentação processual em uma tag de destaque visual. */
export function classifyTag(text: string): MovementTag {
  const t = text.toLowerCase();

  // Atos com constrição patrimonial, medidas coercitivas ou intimações com prazo fixado
  // (devem disparar alerta imediato e não esperar o Smart Digest de sexta-feira)
  if (
    /penhora|bloqueio|sisbajud|pris[aã]o|busca e apreens[aã]o|leil[aã]o|arresto|execu[cç][aã]o|bacenjud|liminar|tutela de urg[eê]ncia|sob pena de/i.test(t) ||
    /(?:no\s+prazo\s+de|prazo\s+de)\s+\d+\s+dias?/i.test(t) ||
    /manifeste-se\s+(?:no\s+prazo|em\s+\d+\s+dias?)/i.test(t)
  ) {
    return 'urgente';
  }

  if (/deferid|procedente|acolhid|extin|baix|cancelad|acordo|favor[aá]vel/i.test(t)) {
    return 'positivo';
  }

  if (/andamento|peti[cç][aã]o|audi[eê]ncia|per[ií]cia|cita[cç][aã]o|despacho|conclus|juntad|intima[cç][aã]o/i.test(t)) {
    return 'andamento';
  }

  return 'informativo';
}
