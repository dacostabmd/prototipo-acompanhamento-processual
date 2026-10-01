import { getRedis } from './redis';
import { getAdminClient } from './track';

/**
 * Cache de "já tentei enriquecer este deal" por 7 dias, independente do resultado (achou ou não
 * dado no InfoSimples/DataJud). Evita reprocessar o mesmo deal a cada clique em "Buscar mais N"
 * sem precisar persistir deals sem dado em ap_automacao_deals (que só guarda os enriquecidos).
 * Usa Redis (Upstash) quando configurado; sem isso, cai em ap_automacao_tentativas (Postgres).
 */
const TTL_SECONDS = 7 * 24 * 60 * 60;

const cacheKey = (regraId: string, dealId: number) => `ap:automacao:tentativa:${regraId}:${dealId}`;

export async function foiTentadoRecentemente(regraId: string, dealId: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const v = await redis.get(cacheKey(regraId, dealId));
      if (v !== null) return true;
    } catch (e) {
      console.error('[cacheTentativas] falha ao ler Redis, caindo para Postgres', e);
    }
  }

  const db = getAdminClient();
  if (!db) return false;
  const limite = new Date(Date.now() - TTL_SECONDS * 1000).toISOString();
  const { data } = await db
    .from('ap_automacao_tentativas')
    .select('id')
    .eq('regra_id', regraId)
    .eq('deal_id', dealId)
    .gte('tentado_em', limite)
    .maybeSingle();
  return !!data;
}

export async function registrarTentativa(regraId: string, dealId: number, numeroCnj: string | null): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(cacheKey(regraId, dealId), '1', { ex: TTL_SECONDS });
    } catch (e) {
      console.error('[cacheTentativas] falha ao gravar Redis, caindo para Postgres', e);
    }
  }

  const db = getAdminClient();
  if (!db) return;
  try {
    await db
      .from('ap_automacao_tentativas')
      .upsert({ regra_id: regraId, deal_id: dealId, numero_cnj: numeroCnj, tentado_em: new Date().toISOString() }, { onConflict: 'regra_id,deal_id' });
  } catch (e) {
    console.error('[cacheTentativas] falha ao gravar tentativa no Postgres', e);
  }
}
