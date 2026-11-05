'use client';

import { useRef, type ReactNode } from 'react';
import Link from 'next/link';

/** Estilo React Bits "Spotlight Card": brilho que segue o cursor, sem re-render (só CSS vars). */
export default function SpotlightCard({ href, children, compacto }: { href: string; children: ReactNode; compacto?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);

  const onMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  return (
    <Link ref={ref} href={href} onPointerMove={onMove} className={compacto ? 'bf-spot bf-spot-compacto bf-paper' : 'bf-spot bf-paper'}>
      {children}
    </Link>
  );
}
