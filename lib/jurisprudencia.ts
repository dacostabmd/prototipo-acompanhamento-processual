import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getAdminClient } from '@/lib/track';
import { getRedis } from '@/lib/redis';
import { gerarEmbedding } from '@/lib/ragDocumentos';
import {
  formatarReferencia,
  type CitacaoJurisprudencia,
  type ItemJurisprudencia
} from '@/components/jurisprudencia/utils';

export type { CitacaoJurisprudencia, ItemJurisprudencia } from '@/components/jurisprudencia/utils';

export interface OpcoesBuscaJurisprudencia {
  tribunal?: string | null;
  anoMin?: number | null;
  limite?: number;
}

interface LinhaBase {
  id: string;
  tribunal: string;
  tipo: string;
  classe: string | null;
  numero: string | null;
  relator: string | null;
  orgao_julgador: string | null;
  data_julgamento: string | null;
  data_publicacao: string | null;
  ementa: string;
  fonte_url: string | null;
  fonte: string;
  similarity?: number;
  rank?: number;
}

/** Constante do Reciprocal Rank Fusion (valor usual na literatura). */
const RRF_K = 60;
const LIMITE_PADRAO = 15;
const LIMITE_MAXIMO = 30;
const TAMANHO_TRECHO = 340;

const STOPWORDS = new Set([
  'para', 'com', 'sem', 'sobre', 'entre', 'uma', 'uns', 'umas', 'por', 'que', 'como', 'dos', 'das', 'nos', 'nas',
  'aos', 'pelo', 'pela', 'pelos', 'pelas', 'num', 'numa', 'ser', 'sua', 'seu', 'suas', 'seus', 'ao', 'em', 'de',
  'da', 'do', 'na', 'no', 'os', 'as', 'um', 'ou', 'se', 'ha', 'foi', 'sao', 'mais', 'quando', 'qual', 'quais'
]);

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Termos relevantes da consulta (sem acento, sem stop words, sem repetição). */
export function extrairTermos(consulta: string): string[] {
  const vistos = new Set<string>();
  for (const p of semAcento(consulta).split(/[^a-z0-9]+/)) {
    if (p.length >= 3 && !STOPWORDS.has(p)) vistos.add(p);
  }
  return [...vistos].slice(0, 12);
}

/** Normaliza espaços e quebras de linha herdados do texto do tribunal. */
function limparTexto(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Escolhe da ementa o(s) trecho(s) com mais termos da consulta, começando em limite de frase,
 * com no máximo TAMANHO_TRECHO caracteres.
 */
export function gerarTrecho(ementa: string, termos: string[]): string {
  const texto = limparTexto(ementa);
  if (texto.length <= TAMANHO_TRECHO) return texto;
  if (termos.length === 0) return `${texto.slice(0, TAMANHO_TRECHO - 1).trimEnd()}…`;

  const frases = texto.split(/(?<=[.;:])\s+/);
  let melhor = 0;
  let melhorPontos = -1;
  frases.forEach((f, i) => {
    const norm = semAcento(f);
    const pontos = termos.reduce((acc, t) => acc + (norm.includes(t) ? 1 : 0), 0);
    if (pontos > melhorPontos) {
      melhorPontos = pontos;
      melhor = i;
    }
  });
  let trecho = frases[melhor];
  for (let j = melhor + 1; j < frases.length && trecho.length + frases[j].length + 1 <= TAMANHO_TRECHO; j++) {
    trecho += ` ${frases[j]}`;
  }
  const prefixo = melhor > 0 ? '… ' : '';
  const corte = trecho.length > TAMANHO_TRECHO ? `${trecho.slice(0, TAMANHO_TRECHO - 1).trimEnd()}…` : trecho;
  return prefixo + corte;
}

function paraItem(l: LinhaBase, score: number, termos: string[]): ItemJurisprudencia {
  const base = {
    classe: l.classe,
    numero: l.numero,
    relator: l.relator,
    dataJulgamento: l.data_julgamento
  };
  return {
    id: l.id,
    fonte: l.fonte,
    tribunal: l.tribunal,
    tipo: l.tipo,
    ...base,
    orgaoJulgador: l.orgao_julgador,
    dataPublicacao: l.data_publicacao,
    ementa: limparTexto(l.ementa),
    fonteUrl: l.fonte_url,
    score,
    trecho: gerarTrecho(l.ementa, termos),
    termos,
    referencia: formatarReferencia({ tribunal: l.tribunal, ...base })
  };
}

export interface ResultadoBusca {
  itens: ItemJurisprudencia[];
  /** 'hibrida' = textual + semântica; 'texto' = embedding indisponível; 'vetorial' = só semântica. */
  modo: 'hibrida' | 'texto' | 'vetorial';
}

/** Linha enriquecida com a origem do acerto (usada por citacoesPara para exigir relevância mínima). */
interface Fundida {
  linha: LinhaBase;
  score: number;
  noTexto: boolean;
  similaridade: number | null;
}

async function buscarFundido(consulta: string, opcoes: OpcoesBuscaJurisprudencia): Promise<{ fundidas: Fundida[]; modo: ResultadoBusca['modo'] }> {
  const db = getAdminClient();
  const q = consulta.trim().slice(0, 300);
  if (!db || q.length < 3) return { fundidas: [], modo: 'texto' };

  const limite = Math.min(Math.max(opcoes.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const candidatos = Math.min(limite * 3, 90);
  const filtros = { filtro_tribunal: opcoes.tribunal || null, ano_min: opcoes.anoMin ?? null };

  const embedding = await gerarEmbedding(q);
  const [texto, vetorial] = await Promise.all([
    db.rpc('buscar_jurisprudencia_texto', { consulta: q, match_count: candidatos, ...filtros }),
    embedding
      ? db.rpc('match_jurisprudencia', { query_embedding: embedding, match_count: candidatos, ...filtros })
      : Promise.resolve({ data: null, error: null })
  ]);
  if (texto.error) console.error('[jurisprudencia] busca textual falhou:', texto.error.message);
  if (vetorial.error) console.error('[jurisprudencia] busca vetorial falhou:', vetorial.error.message);

  const listaTexto = (texto.data ?? []) as LinhaBase[];
  const listaVetor = (vetorial.data ?? []) as LinhaBase[];

  const mapa = new Map<string, Fundida>();
  listaTexto.forEach((l, i) => {
    mapa.set(l.id, { linha: l, score: 1 / (RRF_K + i + 1), noTexto: true, similaridade: null });
  });
  listaVetor.forEach((l, i) => {
    const atual = mapa.get(l.id);
    const parcela = 1 / (RRF_K + i + 1);
    if (atual) {
      atual.score += parcela;
      atual.similaridade = l.similarity ?? null;
    } else {
      mapa.set(l.id, { linha: l, score: parcela, noTexto: false, similaridade: l.similarity ?? null });
    }
  });

  // Normaliza para 0-1: o máximo teórico é ser o 1º nas duas listas.
  const maximo = (listaTexto.length > 0 ? 1 : 0) / (RRF_K + 1) + (listaVetor.length > 0 ? 1 : 0) / (RRF_K + 1);
  const fundidas = [...mapa.values()]
    .map(f => ({ ...f, score: maximo > 0 ? Math.min(1, f.score / maximo) : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limite);

  const modo = listaVetor.length > 0 && listaTexto.length > 0 ? 'hibrida' : listaVetor.length > 0 ? 'vetorial' : 'texto';
  return { fundidas, modo };
}

/**
 * Busca híbrida: combina busca textual (tsvector) e semântica (pgvector) por Reciprocal Rank Fusion.
 * Se o embedding não estiver disponível (sem OPENAI_API_KEY ou falha), cai só na busca textual.
 */
export async function buscarJurisprudencia(consulta: string, opcoes: OpcoesBuscaJurisprudencia = {}): Promise<ResultadoBusca> {
  const termos = extrairTermos(consulta);
  const { fundidas, modo } = await buscarFundido(consulta, opcoes);
  return { itens: fundidas.map(f => paraItem(f.linha, f.score, termos)), modo };
}

/** Similaridade (cosseno) mínima para aceitar como citação um julgado achado só pela busca semântica. */
const SIMILARIDADE_MINIMA_CITACAO = 0.4;

/**
 * Julgados reais para a frente de peças citar. Devolve só o que existe na base (nunca inventa) e descarta
 * acertos fracos: serve quem casou na busca textual ou tem similaridade semântica suficiente. Nunca lança.
 */
export async function citacoesPara(consulta: string, n = 3): Promise<CitacaoJurisprudencia[]> {
  try {
    const termos = extrairTermos(consulta);
    const { fundidas } = await buscarFundido(consulta, { limite: Math.max(n * 2, n) });
    return fundidas
      .filter(f => f.noTexto || (f.similaridade ?? 0) >= SIMILARIDADE_MINIMA_CITACAO)
      .slice(0, n)
      .map(f => {
        const item = paraItem(f.linha, f.score, termos);
        return { referencia: item.referencia, ementa: item.ementa, fonteUrl: item.fonteUrl, id: item.id };
      });
  } catch (e) {
    console.error('[jurisprudencia] citacoesPara falhou:', e instanceof Error ? e.message : e);
    return [];
  }
}

export async function obterJurisprudenciaPorId(id: string): Promise<ItemJurisprudencia | null> {
  const db = getAdminClient();
  if (!db) return null;
  const { data, error } = await db
    .from('ap_jurisprudencia')
    .select('id, tribunal, tipo, classe, numero, relator, orgao_julgador, data_julgamento, data_publicacao, ementa, fonte_url, fonte')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return paraItem(data as LinhaBase, 1, []);
}

// ---------------------------------------------------------------------------------------------------------------
// Explicação em linguagem simples
// ---------------------------------------------------------------------------------------------------------------

const TIMEOUT_MS = 25_000;
const CACHE_TTL_SEGUNDOS = 30 * 24 * 3600;
const LIMITE_EMENTA_PROMPT = 6000;

const SYSTEM_PROMPT =
  'Você explica decisões de tribunais brasileiros em linguagem simples, para pessoas leigas. ' +
  'Recebe os dados e a EMENTA de um julgado e responde em português do Brasil.\n\n' +
  'REGRAS:\n' +
  '1. Baseie-se SOMENTE na ementa fornecida. Não invente fatos, partes, valores, datas, nomes, resultados nem leis que não estejam nela.\n' +
  '2. Se a ementa não permitir saber algo, não diga nada sobre isso.\n' +
  '3. Responda exatamente em duas linhas, nesta ordem, sem markdown e sem emojis:\n' +
  'Do que se trata: <1 a 2 frases sobre o tema discutido>\n' +
  'O que foi decidido: <1 a 3 frases com a conclusão do tribunal e o motivo principal>\n' +
  '4. Evite juridiquês; quando um termo técnico for indispensável, explique-o entre parênteses. No máximo 140 palavras no total.\n' +
  '5. Não dê conselho jurídico nem diga que o leitor vai ganhar ou perder uma causa.';

export interface ExplicacaoJurisprudencia {
  explicacao: string;
  modelo: string | null;
  cache: boolean;
}

function montarPrompt(i: Pick<ItemJurisprudencia, 'tribunal' | 'classe' | 'referencia' | 'ementa'>): string {
  const ementa = i.ementa.length > LIMITE_EMENTA_PROMPT ? `${i.ementa.slice(0, LIMITE_EMENTA_PROMPT)}…` : i.ementa;
  return `Julgado: ${i.referencia}\nTipo de recurso: ${i.classe ?? 'não informado'}\n\nEMENTA:\n${ementa}`;
}

function normalizarSaida(t: string): string {
  return t
    .replace(/[*_`#]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Explica a ementa em linguagem leiga (gpt-4o-mini, com fallback para claude-haiku-4-5). Cache em Redis por id.
 * Devolve explicacao vazia quando nenhum modelo respondeu; quem chama mostra a ementa original.
 */
export async function explicarEmLinguagemSimples(
  item: Pick<ItemJurisprudencia, 'id' | 'tribunal' | 'classe' | 'referencia' | 'ementa'>
): Promise<ExplicacaoJurisprudencia> {
  const redis = getRedis();
  const chave = `ap:juris:explica:v1:${item.id}`;

  if (redis) {
    try {
      const guardado = await redis.get<string>(chave);
      if (guardado) return { explicacao: guardado, modelo: null, cache: true };
    } catch (e) {
      console.error('[jurisprudencia] falha ao ler cache da explicação', e);
    }
  }

  const prompt = montarPrompt(item);
  let explicacao = '';
  let modelo: string | null = null;

  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
      const c = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        max_tokens: 400,
        temperature: 0.2
      });
      explicacao = normalizarSaida(c.choices[0]?.message?.content ?? '');
      if (explicacao) modelo = 'gpt-4o-mini';
    } catch (e) {
      console.error('[jurisprudencia] falha na OpenAI:', e instanceof Error ? e.message : e);
    }
  }

  if (!explicacao && process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
      const r = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
      });
      explicacao = normalizarSaida(
        r.content
          .filter(b => b.type === 'text')
          .map(b => (b as { text: string }).text)
          .join('\n')
      );
      if (explicacao) modelo = 'claude-haiku-4-5';
    } catch (e) {
      console.error('[jurisprudencia] falha na Anthropic:', e instanceof Error ? e.message : e);
    }
  }

  if (explicacao && redis) {
    try {
      await redis.set(chave, explicacao, { ex: CACHE_TTL_SEGUNDOS });
    } catch (e) {
      console.error('[jurisprudencia] falha ao gravar cache da explicação', e);
    }
  }

  return { explicacao, modelo, cache: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Limite de requisições por usuário (mesmo padrão do rate limit da busca pública)
// ---------------------------------------------------------------------------------------------------------------

// Sem Redis (dev/local), o limite vale só dentro da instância.
const contagemLocal = new Map<string, { n: number; expira: number }>();

export async function excedeuLimiteUsuario(userId: string, escopo: 'busca' | 'explicar' | 'trabalhista', limite: number, janelaSegundos: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const chave = `ap:juris:${escopo}:user:${userId}`;
      const n = await redis.incr(chave);
      if (n === 1) await redis.expire(chave, janelaSegundos);
      return n > limite;
    } catch (e) {
      console.error('[jurisprudencia] falha no limite por usuário', e);
      return false;
    }
  }
  const chave = `${escopo}:${userId}`;
  const agora = Date.now();
  const atual = contagemLocal.get(chave);
  if (!atual || atual.expira < agora) {
    contagemLocal.set(chave, { n: 1, expira: agora + janelaSegundos * 1000 });
    return false;
  }
  atual.n += 1;
  return atual.n > limite;
}
