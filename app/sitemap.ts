import type { MetadataRoute } from 'next';
import { getAdminClient } from '@/lib/track';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://jusconsulta.com.br';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rotasEstaticas: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/consulta`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/descadastro`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 }
  ];

  try {
    const db = getAdminClient();
    if (!db) return rotasEstaticas;

    // Inclui os processos mais recentes para indexação orgânica no Google (Superando JusBrasil)
    const { data: processos } = await db
      .from('ap_processos')
      .select('numero_cnj, ultima_movimentacao_em')
      .not('numero_cnj', 'is', null)
      .order('ultima_movimentacao_em', { ascending: false, nullsFirst: false })
      .limit(300);

    const rotasProcessos: MetadataRoute.Sitemap = (processos ?? []).map(p => ({
      url: `${SITE_URL}/processo/${p.numero_cnj}`,
      lastModified: p.ultima_movimentacao_em ? new Date(p.ultima_movimentacao_em) : new Date(),
      changeFrequency: 'weekly',
      priority: 0.8
    }));

    return [...rotasEstaticas, ...rotasProcessos];
  } catch (err) {
    console.error('[sitemap] Falha ao carregar processos para sitemap:', err);
    return rotasEstaticas;
  }
}
