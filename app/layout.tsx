import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ColorSchemeScript } from '@mantine/core';
import '@mantine/core/styles.css';
import './globals.css';
import Providers from '@/components/Providers';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap'
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const DESCRIPTION = 'Consulte processos judiciais vinculados ao seu CPF, acompanhe atualizações e fale com um advogado.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Blindagem Financeira | Acompanhamento de Processos', template: '%s | Blindagem Financeira' },
  description: DESCRIPTION,
  applicationName: 'Blindagem Financeira',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Blindagem Financeira',
    title: 'Blindagem Financeira | Acompanhamento de Processos',
    description: DESCRIPTION,
    images: [{ url: '/blindagem-logo.png', width: 224, height: 74 }]
  },
  twitter: { card: 'summary', title: 'Blindagem Financeira', description: DESCRIPTION },
  icons: { icon: '/blindagem-logo.png' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1636'
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Blindagem Financeira',
  url: SITE_URL,
  logo: `${SITE_URL}/blindagem-logo.png`
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body style={{ fontFamily: 'var(--font-inter), sans-serif' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
