import type { Metadata } from 'next';
import ImprimirAgenda from '@/components/agenda/ImprimirAgenda';

// Página de impressão: fora do AppShell (sem menu/rodapé do app) e fora do índice dos buscadores.
export const metadata: Metadata = {
  title: 'Agenda de prazos (impressão)',
  robots: { index: false, follow: false }
};

export default function ImprimirAgendaPage() {
  return <ImprimirAgenda />;
}
