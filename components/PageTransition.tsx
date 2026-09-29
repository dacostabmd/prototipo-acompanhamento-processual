'use client';

import { useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { navIndex } from '@/lib/nav';

/**
 * Slide entre rotas conforme a posição do item ativo na sidebar:
 * indo para um item mais abaixo, a página sobe (slide up); para um mais acima, desce (slide down).
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const prev = useRef<{ path: string; index: number }>({ path: pathname, index: navIndex(pathname) });

  let direction = 0;
  if (prev.current.path !== pathname) {
    const next = navIndex(pathname);
    direction = next === prev.current.index ? 0 : next > prev.current.index ? 1 : -1;
    prev.current = { path: pathname, index: next };
  }

  return (
    <motion.div
      key={pathname}
      initial={direction === 0 ? { opacity: 0 } : { opacity: 0, y: direction * 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-full"
    >
      {children}
    </motion.div>
  );
}
