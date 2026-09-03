import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Blindagem Financeira | Acompanhamento de Processos',
  description:
    'Consulte processos judiciais vinculados ao seu CPF, acompanhe atualizações e fale com um advogado.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={poppins.variable}>
      <body style={{ fontFamily: 'var(--font-poppins), sans-serif' }}>{children}</body>
    </html>
  );
}
