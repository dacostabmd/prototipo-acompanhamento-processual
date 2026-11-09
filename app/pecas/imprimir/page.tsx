import type { Metadata } from 'next';
import ImprimirPeca from '@/components/pecas/ImprimirPeca';

// Página de impressão: fora do AppShell (sem menu/rodapé do app) e fora do índice dos buscadores.
export const metadata: Metadata = {
  title: 'Minuta de peça (impressão)',
  robots: { index: false, follow: false }
};

export default function ImprimirPecaPage() {
  return <ImprimirPeca />;
}
