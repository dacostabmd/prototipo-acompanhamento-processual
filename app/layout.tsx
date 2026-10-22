import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ColorSchemeScript } from '@mantine/core';
import '@mantine/core/styles.css';
import './globals.css';
import Providers from '@/components/Providers';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap'
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const DESCRIPTION = 'Consulte processos judiciais vinculados ao seu CPF, acompanhe atualizações e fale com um advogado.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'TechTie | Acompanhamento de Processos', template: '%s | TechTie' },
  description: DESCRIPTION,
  applicationName: 'TechTie',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'TechTie',
    title: 'TechTie | Acompanhamento de Processos',
    description: DESCRIPTION,
    images: [{ url: '/techtie-og.png', width: 1200, height: 630, alt: 'TechTie' }]
  },
  twitter: { card: 'summary_large_image', title: 'TechTie', description: DESCRIPTION, images: ['/techtie-og.png'] },
  icons: { icon: '/favicon.svg' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1c1d21'
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'TechTie',
  url: SITE_URL,
  logo: `${SITE_URL}/techtie-logo-horizontal-gold.svg`
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className={inter.className} style={{ fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
