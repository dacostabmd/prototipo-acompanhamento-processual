import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://prosec.com.br';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/processo/'],
      disallow: [
        '/api/',
        '/painel',
        '/consulta',
        '/processos',
        '/perfil',
        '/configuracoes',
        '/redefinir-senha'
      ]
    },
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
