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

/** Formata o texto das mensagens do chat com excelente escaneabilidade visual, quebras automáticas de linha, listas e destaques */
export function formatChatMessageHtml(raw: string, isUser: boolean = false): string {
  if (!raw) return '';
  if (isUser) {
    return raw.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />');
  }

  let text = raw;

  // 1. Limpeza de placeholders genéricos
  text = text
    .replace(/\[\s*seu nome\s*\]/gi, 'Equipe Blindagem Financeira')
    .replace(/\[\s*nome(?:\s+do\s+advogado)?\s*\]/gi, 'Equipe Blindagem Financeira')
    .replace(/\[\s*seu cargo\s*\]/gi, '')
    .replace(/\[.*?nome.*?\]/gi, 'Equipe Blindagem Financeira');

  // 2. Garante quebras de linha antes de tópicos numerados ou listas que possam ter vindo coladas em uma única linha
  text = text.replace(/([.:!?])\s+(\d+\.\s+\*\*)/g, '$1\n\n$2');
  text = text.replace(/([.:!?])\s+(-\s+\*\*)/g, '$1\n\n$2');
  text = text.replace(/([.:!?])\s+(\*\*[^*]+:\*\*)/g, '$1\n\n$2');
  text = text.replace(
    /([.!?])\s+(Se precisar de mais informações|Caso tenha dúvidas|Fico à disposição|Estou à disposição|Se tiver alguma dúvida)/gi,
    '$1\n\n$2'
  );

  // 3. Normaliza negrito em markdown **texto**
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #0b192c; font-weight: 600;">$1</strong>');

  // 4. Normaliza itálico *texto*
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // 5. Destaca termos de risco e alerta
  const dangerTerms = [
    'penhora de contas',
    'penhora',
    'bloqueio de contas',
    'bloqueio de bens',
    'bloqueio judicial',
    'bloqueios',
    'sisbajud',
    'bacenjud',
    'execução fiscal',
    'execuções fiscais',
    'execução de título',
    'execuções',
    'execução',
    'impugnação',
    'excesso de execução',
    'nulidade de citação'
  ];

  dangerTerms.forEach(term => {
    const reg = new RegExp(`(?<!<[^>]*)\\b(${term})\\b(?![^<]*>)`, 'gi');
    text = text.replace(reg, '<span style="color: #8a2b2b; font-weight: 600;">$1</span>');
  });

  // 6. Destaca termos favoráveis e defesas
  const successTerms = [
    'arquivado definitivamente',
    'arquivado provisoriamente',
    'arquivado',
    'extinta',
    'extinto',
    'acordo com deságio',
    'acordo homologado',
    'prescrição',
    'favorável',
    'sem restrições'
  ];

  successTerms.forEach(term => {
    const reg = new RegExp(`(?<!<[^>]*)\\b(${term})\\b(?![^<]*>)`, 'gi');
    text = text.replace(reg, '<span style="color: #1b6b3e; font-weight: 600;">$1</span>');
  });

  // 7. Quebra em parágrafos e sub-blocos estilizados
  const blocks = text.split(/\n\s*\n/).map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';

    // Se for item com marcador "- " ou "• "
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const items = trimmed.split(/\n(?=[-•]\s*)/).map(item => {
        const clean = item.replace(/^[-•]\s*/, '').replace(/\n/g, '<br />');
        return `<div style="margin: 4px 0 4px 8px; display: flex; align-items: flex-start; gap: 7px;"><span style="color: #2455b8; font-weight: 700; line-height: 1.5;">•</span><span style="flex: 1; line-height: 1.6;">${clean}</span></div>`;
      });
      return items.join('');
    }

    // Se for tópico numerado "1. ", "2. ", etc
    if (/^\d+\.\s+/.test(trimmed)) {
      const lines = trimmed.split(/\n/);
      let html = `<p style="margin: 8px 0 4px; line-height: 1.6;">${lines[0]}</p>`;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('- ') || line.startsWith('• ')) {
          html += `<div style="margin: 4px 0 4px 8px; display: flex; align-items: flex-start; gap: 7px;"><span style="color: #2455b8; font-weight: 700;">•</span><span style="flex: 1; line-height: 1.5;">${line.replace(/^[-•]\s*/, '')}</span></div>`;
        } else if (line) {
          html += `<p style="margin: 4px 0; line-height: 1.6;">${line}</p>`;
        }
      }
      return html;
    }

    return `<p style="margin: 0 0 8px; line-height: 1.65;">${trimmed.replace(/\n/g, '<br />')}</p>`;
  });

  return blocks.filter(Boolean).join('');
}

