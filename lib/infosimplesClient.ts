import { createHmac } from 'crypto';
import { desfechoInfosimples } from '@/lib/infosimplesResposta';
import { getRedis } from '@/lib/redis';

// Os robôs da Infosimples navegam o site do tribunal (às vezes com captcha) e levam de 30s a vários minutos: um limite curto
// corta consultas que achariam o processo. O mesmo valor vai como parâmetro `timeout` para a Infosimples encerrar
// do lado dela também, em vez de seguir rodando (e cobrando) depois que desistimos.
const TIMEOUT_SEGUNDOS = Number(process.env.INFOSIMPLES_TIMEOUT_SEGUNDOS) || 240;
// Margem para a Infosimples devolver o próprio erro de timeout antes de abortarmos a conexão.
const MARGEM_TIMEOUT_MS = 10000;
const PAUSA_ENTRE_TENTATIVAS_MS = 600;
const MAX_TENTATIVAS = 2;
const RETRY_SO_ATE_MS = 15000;

// Circuit breaker por serviço: N falhas transitórias seguidas dentro da janela pausam a fonte.
const FALHAS_PARA_ABRIR = 3;
const JANELA_CIRCUITO_SEGUNDOS = 300;

const CACHE_NEGATIVO_TTL_SEGUNDOS = Number(process.env.INFOSIMPLES_CACHE_NEGATIVO_TTL_SEGUNDOS) || 6 * 3600;

export interface OpcoesInfosimples {
  /** Guarda "não encontrado" por serviço+parâmetros, evitando pagar de novo pela mesma consulta. Use só em buscas por parte (CPF/CNPJ/nome). */
  cacheNegativo?: boolean;
  /** Limite desta chamada, em segundos (ex.: o que resta do prazo da varredura). Padrão: TIMEOUT_SEGUNDOS. */
  timeoutSegundos?: number;
}

/**
 * Origem de uma falha gerada aqui (não pela Infosimples), anexada ao envelope em `_motivo` para
 * lib/infosimplesResposta.ts explicar o porquê na tela. Envelopes vindos da Infosimples não têm `_motivo`.
 */
export type MotivoLocal = 'circuito_aberto' | 'timeout_local' | 'rede' | 'resposta_invalida' | 'cancelado' | 'cache_negativo';

// ---------------------------------------------------------------- circuit breaker
const falhasEmMemoria = new Map<string, { n: number; expiraEm: number; ultimoMotivo?: string }>();
const chaveCircuito = (service: string) => `ap:infosimples:falhas:${service}`;
const chaveUltimoMotivo = (service: string) => `ap:infosimples:falhas:${service}:motivo`;

interface EstadoCircuito {
  aberto: boolean;
  falhas: number;
  reabreEmSegundos?: number;
  ultimoMotivo?: string;
}

async function estadoCircuito(service: string): Promise<EstadoCircuito> {
  const redis = getRedis();
  if (redis) {
    try {
      const falhas = (await redis.get<number>(chaveCircuito(service))) ?? 0;
      if (falhas < FALHAS_PARA_ABRIR) return { aberto: false, falhas };
      const [ttl, ultimoMotivo] = await Promise.all([redis.ttl(chaveCircuito(service)), redis.get<string>(chaveUltimoMotivo(service))]);
      return { aberto: true, falhas, reabreEmSegundos: ttl > 0 ? ttl : undefined, ultimoMotivo: ultimoMotivo ?? undefined };
    } catch {
      /* cai para a memória */
    }
  }
  const e = falhasEmMemoria.get(service);
  if (!e || e.expiraEm <= Date.now() || e.n < FALHAS_PARA_ABRIR) return { aberto: false, falhas: e?.n ?? 0 };
  return { aberto: true, falhas: e.n, reabreEmSegundos: Math.ceil((e.expiraEm - Date.now()) / 1000), ultimoMotivo: e.ultimoMotivo };
}

async function registrarFalha(service: string, motivo: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const n = await redis.incr(chaveCircuito(service));
      if (n === 1 || n === FALHAS_PARA_ABRIR) await redis.expire(chaveCircuito(service), JANELA_CIRCUITO_SEGUNDOS);
      await redis.set(chaveUltimoMotivo(service), motivo, { ex: JANELA_CIRCUITO_SEGUNDOS });
      if (n === FALHAS_PARA_ABRIR) console.warn(`[infosimples] ${service}: circuito aberto por ${JANELA_CIRCUITO_SEGUNDOS}s após ${n} falhas seguidas (última: ${motivo}).`);
      return;
    } catch {
      /* cai para a memória */
    }
  }
  const atual = falhasEmMemoria.get(service);
  const n = atual && atual.expiraEm > Date.now() ? atual.n + 1 : 1;
  falhasEmMemoria.set(service, { n, expiraEm: Date.now() + JANELA_CIRCUITO_SEGUNDOS * 1000, ultimoMotivo: motivo });
  if (n === FALHAS_PARA_ABRIR) console.warn(`[infosimples] ${service}: circuito aberto por ${JANELA_CIRCUITO_SEGUNDOS}s após ${n} falhas seguidas (última: ${motivo}).`);
}

async function registrarSucesso(service: string): Promise<void> {
  falhasEmMemoria.delete(service);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(chaveCircuito(service), chaveUltimoMotivo(service));
  } catch {
    /* ignora */
  }
}

// ---------------------------------------------------------------- cache negativo
function chaveNegativa(service: string, params: Record<string, string | undefined>, token: string): string {
  const canonico = JSON.stringify(Object.entries(params).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)));
  // HMAC com o token do servidor: o CPF nunca fica em claro (nem como hash reversível por força bruta) no Redis.
  return `ap:infosimples:neg:${createHmac('sha256', token).update(`${service}|${canonico}`).digest('hex')}`;
}

async function lerNegativo(chave: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    return (await redis.get(chave)) != null;
  } catch {
    return false;
  }
}

async function gravarNegativo(chave: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(chave, 1, { ex: CACHE_NEGATIVO_TTL_SEGUNDOS });
  } catch {
    /* ignora */
  }
}

/** Resposta limpa de "nada encontrado" (a fonte funcionou, só não há processo) — a única que vale cachear. */
function ehNaoEncontrado(resultado: any): boolean {
  if (!resultado) return false;
  if (resultado.code === 200) return Number(resultado.data_count) === 0;
  return !desfechoInfosimples(resultado).erro;
}

// ---------------------------------------------------------------- chamada
interface Tentativa {
  corpo: any;
  /** Falha que vale retry/circuit breaker: timeout local, rede, HTTP 5xx, ou código 6xx do envelope da Infosimples. */
  transitoria: boolean;
}

/** Código de erro de rede do Node (ENOTFOUND, ECONNRESET, UND_ERR_CONNECT_TIMEOUT...), quando houver. */
function codigoDeRede(err: unknown): string | undefined {
  const causa = (err as { cause?: { code?: string } })?.cause;
  return causa?.code ?? (err as { code?: string })?.code;
}

async function tentarUmaVez(
  service: string,
  token: string,
  params: Record<string, string | undefined>,
  signal: AbortSignal,
  timeoutSegundos: number
): Promise<Tentativa> {
  const timeoutController = new AbortController();
  let estourouTempo = false;
  const timeoutId = setTimeout(() => {
    estourouTempo = true;
    timeoutController.abort();
  }, timeoutSegundos * 1000 + MARGEM_TIMEOUT_MS);
  const onSignalAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onSignalAbort);

  try {
    const form = new URLSearchParams();
    form.append('token', token);
    form.append('timeout', String(timeoutSegundos));
    for (const [key, value] of Object.entries(params)) {
      if (value) form.append(key, value);
    }

    const res = await fetch(`https://api.infosimples.com/api/v2/consultas/${service}`, {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: timeoutController.signal
    });

    // A Infosimples descreve a falha no próprio envelope ({ code, code_message }), às vezes com HTTP de
    // erro: devolve o corpo sempre que ele vier, para a tela mostrar o motivo em vez de "sem processos".
    const body = await res.json().catch(() => null);
    if (body && typeof body.code === 'number') return { corpo: body, transitoria: res.status >= 500 || body.code >= 600 };
    return {
      corpo: {
        code: res.status,
        code_message: res.ok ? 'A Infosimples respondeu sem um envelope JSON válido.' : `A Infosimples respondeu HTTP ${res.status} sem detalhes.`,
        _motivo: 'resposta_invalida' satisfies MotivoLocal
      },
      transitoria: !res.ok && res.status >= 500
    };
  } catch (err) {
    if (signal.aborted) {
      return { corpo: { code: 499, code_message: 'Consulta cancelada pelo usuário.', _motivo: 'cancelado' satisfies MotivoLocal }, transitoria: false };
    }
    if (estourouTempo) {
      return {
        corpo: {
          code: 504,
          code_message: `Sem resposta da Infosimples em ${timeoutSegundos + MARGEM_TIMEOUT_MS / 1000}s; o Prosec abortou a chamada.`,
          _motivo: 'timeout_local' satisfies MotivoLocal
        },
        transitoria: true
      };
    }
    const codigo = codigoDeRede(err);
    console.error(`[infosimples] Erro de rede ao consultar ${service}:`, err);
    return {
      corpo: {
        code: 502,
        code_message: `Falha de rede ao chamar a Infosimples${codigo ? ` (${codigo})` : ''}: ${(err as Error)?.message ?? String(err)}`,
        _motivo: 'rede' satisfies MotivoLocal
      },
      transitoria: true
    };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onSignalAbort);
  }
}

/**
 * Consulta um serviço da Infosimples com timeout de até 4min, 1 retry em falha transitória rápida (5xx/6xx/rede,
 * não em timeout — que já custou o tempo todo), circuit breaker por serviço e, opcionalmente, cache negativo.
 * Nunca lança: devolve sempre um envelope { code, code_message, ... } com `_duracaoMs`/`_tentativas` e, quando a
 * falha é local, `_motivo` (ver MotivoLocal).
 */
export async function consultarInfosimples(
  service: string,
  token: string,
  params: Record<string, string | undefined>,
  signal: AbortSignal,
  opcoes: OpcoesInfosimples = {}
): Promise<any> {
  const chaveNeg = opcoes.cacheNegativo ? chaveNegativa(service, params, token) : null;
  if (chaveNeg && (await lerNegativo(chaveNeg))) {
    console.log(`[infosimples] ${service}: cache negativo (sem custo).`);
    return {
      code: 404,
      code_message: 'Nenhum processo encontrado (resultado em cache das últimas horas, sem nova cobrança).',
      data: [],
      data_count: 0,
      _motivo: 'cache_negativo' satisfies MotivoLocal
    };
  }

  const circuito = await estadoCircuito(service);
  if (circuito.aberto) {
    const minutos = circuito.reabreEmSegundos ? Math.max(1, Math.ceil(circuito.reabreEmSegundos / 60)) : null;
    return {
      code: 503,
      code_message:
        `Fonte pausada pelo Prosec após ${circuito.falhas} falhas seguidas${circuito.ultimoMotivo ? ` (última: ${circuito.ultimoMotivo})` : ''}; ` +
        `a Infosimples não foi chamada nem cobrou. ${minutos ? `Volta a ser consultada em ~${minutos} min.` : 'Volta a ser consultada em alguns minutos.'}`,
      _motivo: 'circuito_aberto' satisfies MotivoLocal,
      _duracaoMs: 0
    };
  }

  const timeoutSegundos = Math.max(15, Math.min(TIMEOUT_SEGUNDOS, opcoes.timeoutSegundos ?? TIMEOUT_SEGUNDOS));
  const inicio = Date.now();
  let tentativas = 1;
  let tentativa = await tentarUmaVez(service, token, params, signal, timeoutSegundos);
  // Só repete falha rápida: uma que já consumiu o tempo todo (timeout local ou da própria fonte) dobraria a espera.
  const falhaRapida = () => Date.now() - inicio < RETRY_SO_ATE_MS;
  while (tentativas < MAX_TENTATIVAS && tentativa.transitoria && !signal.aborted && tentativa.corpo._motivo !== 'timeout_local' && falhaRapida()) {
    console.warn(`[infosimples] ${service}: falha transitória (code ${tentativa.corpo.code}: ${tentativa.corpo.code_message}), tentando de novo.`);
    await new Promise(r => setTimeout(r, PAUSA_ENTRE_TENTATIVAS_MS));
    if (signal.aborted) break;
    tentativas++;
    tentativa = await tentarUmaVez(service, token, params, signal, timeoutSegundos);
  }

  if (tentativa.transitoria) await registrarFalha(service, `código ${tentativa.corpo.code} — ${String(tentativa.corpo.code_message ?? '').slice(0, 80)}`);
  else if (!signal.aborted) await registrarSucesso(service);

  if (chaveNeg && !tentativa.transitoria && ehNaoEncontrado(tentativa.corpo)) await gravarNegativo(chaveNeg);

  const corpo = tentativa.corpo && typeof tentativa.corpo === 'object' ? tentativa.corpo : { code: 0, code_message: 'Resposta vazia.' };
  corpo._duracaoMs = Date.now() - inicio;
  corpo._tentativas = tentativas;
  return corpo;
}
