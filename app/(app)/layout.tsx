import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import AuthGuard from '@/components/AuthGuard';
import AppShellLayout from '@/components/AppShellLayout';

// Área autenticada: fora do índice dos buscadores.
export const metadata: Metadata = {
  title: 'Área do cliente',
  robots: { index: false, follow: false }
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AppShellLayout>{children}</AppShellLayout>
    </AuthGuard>
  );
}
