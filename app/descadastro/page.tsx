import type { Metadata } from 'next';
import ConfirmarDescadastro from '@/components/ConfirmarDescadastro';

export const metadata: Metadata = {
  title: 'Parar avisos do processo',
  robots: { index: false, follow: false }
};

export default async function DescadastroPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return <ConfirmarDescadastro token={typeof t === 'string' ? t : ''} />;
}
