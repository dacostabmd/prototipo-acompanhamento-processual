import type { Metadata, Viewport } from 'next';
import { Inter_Tight, Outfit } from 'next/font/google';
import { ColorSchemeScript } from '@mantine/core';
import '@mantine/core/styles.css';
import './globals.css';
import Providers from '@/components/Providers';

// Briefing JusConsulta: Outfit em títulos/logotipo, Inter Tight em interface e texto corrido
const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter-tight',
  display: 'swap'
});
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap'
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const DESCRIPTION = 'Consulte processos judiciais vinculados ao seu CPF, acompanhe atualizações e fale com um advogado.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'JusConsulta | Acompanhamento Processual Inteligente', template: '%s | JusConsulta' },
  description: DESCRIPTION,
  applicationName: 'JusConsulta',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'JusConsulta',
    title: 'JusConsulta | Acompanhamento Processual Inteligente',
    description: DESCRIPTION,
    images: [{ url: '/techtie-og.png', width: 1200, height: 630, alt: 'JusConsulta' }]
  },
  twitter: { card: 'summary_large_image', title: 'JusConsulta', description: DESCRIPTION, images: ['/techtie-og.png'] },
  icons: { icon: '/jusconsulta-mark.png', apple: '/jusconsulta-mark.png' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B1730'
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'JusConsulta',
  url: SITE_URL,
  logo: `${SITE_URL}/jusconsulta-mark.png`
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${interTight.variable} ${outfit.variable}`} suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className={interTight.className} style={{ fontFamily: 'var(--font-inter-tight), "Inter Tight", sans-serif' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
