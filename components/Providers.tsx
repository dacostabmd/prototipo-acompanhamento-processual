'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { MantineProvider } from '@mantine/core';
import { theme } from '@/lib/theme';

// Controle de simulação pagante/não pagante do protótipo
const DevMetrics = dynamic(() => import('./DevMetrics'), { ssr: false });

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      {children}
      <DevMetrics />
    </MantineProvider>
  );
}
