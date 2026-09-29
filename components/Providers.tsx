'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { MantineProvider } from '@mantine/core';
import { theme } from '@/lib/theme';

// Só existe no bundle de desenvolvimento; em produção vira `null` e é eliminado.
const DevMetrics = process.env.NODE_ENV === 'development' ? dynamic(() => import('./DevMetrics'), { ssr: false }) : null;

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      {children}
      {DevMetrics && <DevMetrics />}
    </MantineProvider>
  );
}
