import type { Metadata, Viewport } from 'next';
import { ColorSchemeScript } from '@mantine/core';
import '@mantine/core/styles.css';
import './globals.css';
import Providers from '@/components/Providers';

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F1F4F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1730' }
  ]
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
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap"
        />
        <ColorSchemeScript defaultColorScheme="dark" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body style={{ fontFamily: 'var(--font-inter-tight), "Inter Tight", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
