import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface MovimentoParaTraduzir {
  id: string;
  texto: string;
}

const TIMEOUT_MS = 25_000;
const LIMITE_TEXTO = 260;
/** Máximo de movimentações por chamada ao LLM (mantém a resposta curta e o tempo baixo). */
export const LOTE_TRADUCAO = 30;

const SYSTEM_PROMPT =
  'Você traduz movimentações de processos judiciais brasileiros para linguagem simples, para pessoas leigas. ' +
  'Recebe uma lista JSON de itens {"id","texto"} e responde SOMENTE um objeto JSON {"traducoes":[{"id","texto"}]}, um por item recebido, mesmo id.\n\n' +
  'REGRAS:\n' +
  '1. Cada tradução tem 1 frase curta (no máximo 25 palavras), começando pelo que aconteceu, sem juridiquês. ' +
  'Ex.: "Conclusos para Decisão" -> "O processo foi enviado ao juiz, que vai analisar e decidir."\n' +
  '2. Não repita códigos, números de documento, nomes de setor em caixa alta nem siglas sem explicar.\n' +
  '3. Baseie-se só no texto recebido. Não invente datas, valores, nomes ou resultados.\n' +
  '4. Texto puro: sem markdown, sem emojis, sem quebras de linha.';

function limpar(valor: unknown): string {
  if (typeof valor !== 'string') return '';
  const t = valor.replace(/<[^>]*>/g, ' ').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > LIMITE_TEXTO ? `${t.slice(0, LIMITE_TEXTO - 1).trimEnd()}…` : t;
}

/** Aceita {"traducoes":[...]}, uma lista solta ou um objeto id->texto. */
function interpretar(conteudo: string, ids: Set<string>): Map<string, string> {
  const saida = new Map<string, string>();
  const inicio = conteudo.search(/[[{]/);
  if (inicio < 0) return saida;
  let obj: unknown;
  try {
    obj = JSON.parse(conteudo.slice(inicio, Math.max(conteudo.lastIndexOf('}'), conteudo.lastIndexOf(']')) + 1));
  } catch {
    return saida;
  }
  const lista = Array.isArray(obj)
    ? obj
    : obj && typeof obj === 'object'
    ? (Object.values(obj as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ??
      Object.entries(obj as Record<string, unknown>).map(([id, texto]) => ({ id, texto }))
    : [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = String(r.id ?? '');
    const texto = limpar(r.texto ?? r.traducao ?? r.text);
    if (ids.has(id) && texto) saida.set(id, texto);
  }
  return saida;
}

/**
 * Traduz um lote de movimentações para linguagem leiga numa única chamada ao LLM.
 * Devolve só as que vieram traduzidas; em falha devolve mapa vazio (quem chama mostra o texto original).
 */
export async function traduzirMovimentacoes(
  itens: MovimentoParaTraduzir[]
): Promise<{ traducoes: Map<string, string>; modelo: string | null }> {
  const lote = itens.slice(0, LOTE_TRADUCAO).map(i => ({ id: i.id, texto: i.texto.slice(0, 500) }));
  if (lote.length === 0) return { traducoes: new Map(), modelo: null };
  const ids = new Set(lote.map(i => i.id));
  const promptUser = `${JSON.stringify(lote)}\n\nResponda só o JSON.`;

  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
      const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptUser }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 60 * lote.length + 100,
        temperature: 0.2
      });
      const traducoes = interpretar(c.choices[0]?.message?.content ?? '', ids);
      if (traducoes.size > 0) return { traducoes, modelo: 'gpt-4o-mini' };
      console.error('[traducaoMovimentacoes] OpenAI sem traduções reconhecíveis; chaves esperadas:', [...ids].slice(0, 3));
    } catch (e) {
      console.error('[traducaoMovimentacoes] falha na OpenAI:', e instanceof Error ? e.message : e);
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
      const r = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 80 * lote.length + 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: promptUser }]
      });
      const texto = r.content
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('\n');
      const traducoes = interpretar(texto, ids);
      if (traducoes.size > 0) return { traducoes, modelo: 'claude-haiku-4-5' };
      console.error('[traducaoMovimentacoes] Anthropic sem traduções reconhecíveis.');
    } catch (e) {
      console.error('[traducaoMovimentacoes] falha na Anthropic:', e instanceof Error ? e.message : e);
    }
  }

  return { traducoes: new Map(), modelo: null };
}
