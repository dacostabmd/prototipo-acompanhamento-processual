import { Redis } from '@upstash/redis';

let client: Redis | null | undefined;

/** Cliente Upstash (REST/serverless). Sem as variáveis de ambiente, retorna null — quem chama cai no Postgres. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

export const cacheKeyProcessos = (userId: string) => `ap:processos:${userId}`;

const PROCESSOS_TTL_SECONDS = 300;

export async function getProcessosCache<T>(userId: string): Promise<T[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<T[]>(cacheKeyProcessos(userId));
  } catch (e) {
    console.error('[redis] falha ao ler cache de processos', e);
    return null;
  }
}

export async function setProcessosCache<T>(userId: string, rows: T[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(cacheKeyProcessos(userId), rows, { ex: PROCESSOS_TTL_SECONDS });
  } catch (e) {
    console.error('[redis] falha ao gravar cache de processos', e);
  }
}

export async function invalidateProcessosCache(userId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(cacheKeyProcessos(userId));
  } catch (e) {
    console.error('[redis] falha ao invalidar cache de processos', e);
  }
}
