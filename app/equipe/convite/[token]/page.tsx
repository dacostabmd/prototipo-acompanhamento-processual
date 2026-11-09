import type { Metadata } from 'next';
import { AceitarConvite } from '@/components/equipe/AceitarConvite';

export const metadata: Metadata = {
  title: 'Convite para o escritório',
  robots: { index: false, follow: false }
};

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AceitarConvite token={token} />;
}
