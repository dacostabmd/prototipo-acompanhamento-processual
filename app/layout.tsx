import type { Metadata } from 'next';
import { Cinzel } from 'next/font/google';
import './globals.css';

const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cinzel',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Blindagem Financeira | Acompanhamento de Processos',
  description:
    'Consulte processos judiciais vinculados ao seu CPF, acompanhe atualizações e fale com um advogado.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={cinzel.variable}>
      <body style={{ fontFamily: 'var(--font-cinzel), serif' }}>{children}</body>
    </html>
  );
}
