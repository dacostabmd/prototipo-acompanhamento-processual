import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { Movement } from '@/lib/mockProcesses';

export type UrgenciaAndamento = 'baixa' | 'media' | 'alta';

/** Resumo de uma ou mais movimentações novas, em texto puro (vai para WhatsApp, e-mail e app). */
export interface ResumoAndamento {
  /** O que aconteceu, em 1-2 frases. */
  resumo: string;
  /** O que isso significa para a pessoa. */
  significado: string;
  /** O que fazer agora. */
  proximoPasso: string;
  urgencia: UrgenciaAndamento;
  modelo: string;
  totalTokens?: number;
}

export interface DadosProcessoResumo {
  numeroCnj: string;
  tribunal?: string | null;
  classe?: string | null;
  assunto?: string | null;
}

const LIMITE_RESUMO = 400;
const LIMITE_SIGNIFICADO = 400;
const LIMITE_PROXIMO_PASSO = 240;
const TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT =
  'Você explica andamentos de processos judiciais brasileiros para pessoas leigas, em nome da TechTie. ' +
  'Recebe as movimentações NOVAS de um processo (e algumas anteriores, só como contexto) e responde SOMENTE um objeto JSON ' +
  'com as chaves "resumo", "significado", "proximoPasso" e "urgencia".\n\n' +
  'REGRAS:\n' +
  '1. "resumo": o que aconteceu nas movimentações novas, em até 2 frases curtas, sem juridiquês (se usar um termo técnico, explique entre parênteses).\n' +
  '2. "significado": o que isso significa na prática para quem acompanha o processo, em até 2 frases.\n' +
  '3. "proximoPasso": o que a pessoa deve fazer agora, em 1 frase. Se não houver nada a fazer, diga que é só acompanhar. ' +
  'Se houver prazo, intimação, penhora, bloqueio, audiência ou sentença, oriente a falar com o advogado responsável.\n' +
  '4. "urgencia": "alta" para prazo correndo, intimação para agir, penhora/bloqueio, leilão, audiência marcada ou sentença; ' +
  '"media" para decisões, despachos com determinação ou juntada relevante; "baixa" para atos de rotina (conclusos, remessa, certidão, juntada de AR).\n' +
  '5. Baseie-se estritamente nos dados recebidos. Não invente datas, valores, nomes ou resultados. Não prometa resultado.\n' +
  '6. Texto puro: sem HTML, sem markdown, sem emojis, sem quebras de linha dentro dos valores.';

function textoLimpo(valor: unknown, limite: number): string {
  if (typeof valor !== 'string') return '';
  const limpo = valor
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
}

function normalizarUrgencia(valor: unknown): UrgenciaAndamento {
  const v = typeof valor === 'string' ? valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : '';
  return v === 'alta' || v === 'media' || v === 'baixa' ? v : 'media';
}

/** Aceita o JSON puro ou cercado de texto/cercas de código (resposta da Anthropic sem modo JSON). */
function extrairJson(texto: string): Record<string, unknown> | null {
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try {
    const obj = JSON.parse(texto.slice(inicio, fim + 1));
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function montarResumo(obj: Record<string, unknown> | null, modelo: string, totalTokens?: number): ResumoAndamento | null {
  if (!obj) return null;
  const resumo = textoLimpo(obj.resumo, LIMITE_RESUMO);
  const significado = textoLimpo(obj.significado, LIMITE_SIGNIFICADO);
  const proximoPasso = textoLimpo(obj.proximoPasso ?? obj.proximo_passo, LIMITE_PROXIMO_PASSO);
  if (!resumo || !proximoPasso) return null;
  return { resumo, significado: significado || resumo, proximoPasso, urgencia: normalizarUrgencia(obj.urgencia), modelo, totalTokens };
}

function linhaMovimento(m: Pick<Movement, 'data' | 'titulo' | 'descricao'>): string {
  const descricao = m.descricao && m.descricao !== m.titulo ? ` — ${m.descricao.slice(0, 600)}` : '';
  return `- ${m.data}: ${m.titulo}${descricao}`;
}

/**
 * Gera o resumo em linguagem simples das movimentações novas de um processo. Uma chamada só ao LLM
 * (não o agente ReAct de lib/agent): mais barato e previsível para um texto curto e estruturado.
 * gpt-4o-mini com fallback claude-haiku-4-5, mesmo padrão de app/api/ai/summary. Sem chave de IA ou
 * em qualquer falha devolve null — quem chama segue com o alerta sem resumo, nunca quebra o cron.
 */
export async function gerarResumoAndamento(
  processo: DadosProcessoResumo,
  movimentosNovos: Pick<Movement, 'data' | 'titulo' | 'descricao'>[],
  historico: Pick<Movement, 'data' | 'titulo' | 'descricao'>[] = []
): Promise<ResumoAndamento | null> {
  if (movimentosNovos.length === 0) return null;

  const promptUser =
    `Processo: ${processo.numeroCnj}\n` +
    (processo.tribunal ? `Tribunal: ${processo.tribunal}\n` : '') +
    (processo.classe ? `Classe: ${processo.classe}\n` : '') +
    (processo.assunto ? `Assunto: ${processo.assunto}\n` : '') +
    `\nMovimentações NOVAS (mais recentes primeiro):\n${movimentosNovos.slice(0, 10).map(linhaMovimento).join('\n')}\n` +
    (historico.length > 0 ? `\nMovimentações anteriores (só contexto):\n${historico.slice(0, 5).map(linhaMovimento).join('\n')}\n` : '') +
    '\nResponda só o JSON.';

  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptUser }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0.3
      });
      const resumo = montarResumo(
        extrairJson(completion.choices[0]?.message?.content ?? ''),
        'gpt-4o-mini',
        completion.usage?.total_tokens
      );
      if (resumo) return resumo;
      console.error('[resumoAndamento] resposta da OpenAI sem os campos esperados:', processo.numeroCnj);
    } catch (e) {
      console.error('[resumoAndamento] falha na OpenAI:', processo.numeroCnj, e instanceof Error ? e.message : e);
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: promptUser }]
      });
      const texto = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { text: string }).text)
        .join('\n');
      const resumo = montarResumo(
        extrairJson(texto),
        'claude-haiku-4-5',
        response.usage ? response.usage.input_tokens + response.usage.output_tokens : undefined
      );
      if (resumo) return resumo;
      console.error('[resumoAndamento] resposta da Anthropic sem os campos esperados:', processo.numeroCnj);
    } catch (e) {
      console.error('[resumoAndamento] falha na Anthropic:', processo.numeroCnj, e instanceof Error ? e.message : e);
    }
  }

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.log('[resumoAndamento] OPENAI_API_KEY/ANTHROPIC_API_KEY não configuradas — alerta segue sem resumo:', processo.numeroCnj);
  }
  return null;
}
