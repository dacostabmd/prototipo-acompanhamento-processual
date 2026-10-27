import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { cleanDigits } from '@/lib/format';
import {
  buscarProcessoPorNumeroDjen,
  buscarProcessosPorNomeDjen,
  DjenIndisponivelError,
  extrairNumeroCnj,
  normalizarNome,
  paraPublico,
  type ProcessoDjen
} from '@/lib/djen';

/**
 * Busca pública da tela de login (sem conta), no modelo Jusbrasil: qualquer pessoa vê a prévia dos processos por
 * nome ou número CNJ; detalhes completos e acompanhamento pedem cadastro. Só usa o DJEN (grátis) — a varredura por
 * CPF via Infosimples (paga) continua restrita a quem tem conta.
 */

const LIMITE_POR_IP = 10; // buscas por janela
const JANELA_SEGUNDOS = 600;
const CACHE_SEGUNDOS = 6 * 3600; // o DJEN publica uma vez por dia útil
const MAX_RESULTADOS = 30;

// Sem Redis (dev/local), o limite por IP vale só dentro da instância.
const contagemLocal = new Map<string, { n: number; expira: number }>();

async function excedeuLimite(ip: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const chave = `ap:busca-publica:ip:${ip}`;
      const n = await redis.incr(chave);
      if (n === 1) await redis.expire(chave, JANELA_SEGUNDOS);
      return n > LIMITE_POR_IP;
    } catch (e) {
      console.error('[busca-publica] falha no limite por IP', e);
      return false;
    }
  }
  const agora = Date.now();
  const atual = contagemLocal.get(ip);
  if (!atual || atual.expira < agora) {
    contagemLocal.set(ip, { n: 1, expira: agora + JANELA_SEGUNDOS * 1000 });
    return false;
  }
  atual.n += 1;
  return atual.n > LIMITE_POR_IP;
}

async function lerCache(chave: string): Promise<ProcessoDjen[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<ProcessoDjen[]>(chave);
  } catch {
    return null;
  }
}

async function gravarCache(chave: string, valor: ProcessoDjen[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(chave, valor, { ex: CACHE_SEGUNDOS });
  } catch (e) {
    console.error('[busca-publica] falha ao gravar cache', e);
  }
}

// O cache guarda o processo completo; para fora (sem login) só vai o recorte público — partes, órgão e datas nem
// chegam ao navegador, então o desfoque da tela não é contornável pelo DevTools.
function responder(processos: ProcessoDjen[], cache: boolean) {
  return NextResponse.json({ processos: processos.slice(0, MAX_RESULTADOS).map(paraPublico), total: processos.length, fonte: 'djen', cache });
}

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 120);
  // Sem letras = número (CNJ ou documento). Aceita a pontuação torta de formulários: vírgulas, "/30", dois números.
  const ehNumero = !/\p{L}/u.test(q);
  const digitos = (ehNumero && extrairNumeroCnj(q)) || cleanDigits(q);

  if (ehNumero && (digitos.length === 11 || digitos.length === 14)) {
    return NextResponse.json(
      { erro: 'cpf_requer_conta', mensagem: 'A busca por CPF ou CNPJ consulta todos os tribunais e exige uma conta gratuita.' },
      { status: 422 }
    );
  }
  if (ehNumero && digitos.length !== 20) {
    return NextResponse.json({ erro: 'entrada_invalida', mensagem: 'Informe o nome completo ou o número CNJ com 20 dígitos.' }, { status: 400 });
  }
  if (!ehNumero && (normalizarNome(q).split(' ').length < 2 || q.length < 6)) {
    return NextResponse.json({ erro: 'nome_curto', mensagem: 'Informe nome e sobrenome para evitar resultados de homônimos.' }, { status: 400 });
  }

  const chaveCache = ehNumero ? `ap:djen:cnj:${digitos}` : `ap:djen:nome:${normalizarNome(q)}`;
  const emCache = await lerCache(chaveCache);
  if (emCache) return responder(emCache, true);

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconhecido';
  if (await excedeuLimite(ip)) {
    return NextResponse.json({ erro: 'limite', mensagem: 'Muitas buscas seguidas. Crie uma conta gratuita ou tente em alguns minutos.' }, { status: 429 });
  }

  try {
    let processos: ProcessoDjen[];
    if (ehNumero) {
      const p = await buscarProcessoPorNumeroDjen(digitos);
      processos = p ? [p] : [];
    } else {
      processos = await buscarProcessosPorNomeDjen(q);
    }
    await gravarCache(chaveCache, processos);
    return responder(processos, false);
  } catch (e) {
    if (e instanceof DjenIndisponivelError) {
      console.error('[busca-publica]', e.message);
      return NextResponse.json({ erro: 'djen_indisponivel', mensagem: 'O Diário Nacional não respondeu agora. Tente novamente em instantes.' }, { status: 503 });
    }
    throw e;
  }
}
