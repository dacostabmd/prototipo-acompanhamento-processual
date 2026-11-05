'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Botões flutuantes (novidades, simulação de conta, tour) só existem em desenvolvimento. */
export const IS_DEV = process.env.NODE_ENV === 'development';

const DOCK_ID = 'bf-dev-dock';

/**
 * Encaixa um botão flutuante na coluna única do canto inferior direito (#bf-dev-dock, no <body>).
 * Ficar no <body> evita o zoom do shell e mantém todos alinhados; `ordem` define a posição (1 = mais embaixo).
 */
export function DockSlot({ ordem, children }: { ordem: number; children: ReactNode }) {
  const [dock, setDock] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let el = document.getElementById(DOCK_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = DOCK_ID;
      el.className = 'bf-dev-dock';
      document.body.appendChild(el);
    }
    setDock(el);
  }, []);

  if (!dock) return null;
  return createPortal(<div style={{ order: ordem, display: 'flex' }}>{children}</div>, dock);
}
