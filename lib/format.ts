export const cleanDigits = (value: string): string => (value || '').replace(/\D/g, '');

export const formatCpf = (value: string): string => {
  const d = cleanDigits(value).slice(0, 11);
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
  return d;
};

/** Validação real de CPF (dígitos verificadores mod 11). */
export const isValidCpf = (digits: string): boolean => {
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
  let rev = 11 - (sum % 11);
  const d1 = rev >= 10 ? 0 : rev;
  if (d1 !== parseInt(digits[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * (11 - i);
  rev = 11 - (sum % 11);
  const d2 = rev >= 10 ? 0 : rev;
  return d2 === parseInt(digits[10], 10);
};

/** Máscara de telefone brasileiro: (00) 0000-0000 / (00) 00000-0000 */
export const formatPhone = (value: string): string => {
  const d = cleanDigits(value).slice(0, 11);
  if (d.length > 10) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d;
};

const LOWER_WORDS = ['de', 'da', 'do', 'das', 'dos', 'e'];

/** Normaliza nome completo: espaços colapsados + capitalização brasileira. */
export const normalizeName = (value: string): string =>
  (value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && LOWER_WORDS.includes(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');

/** '2026-08-22' -> '22/08/2026' */
export const formatDateLabel = (isoDate: string): string => {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};
