'use client';

import { motion } from 'motion/react';

const DOT_TRANSITION = (delay: number) => ({
  duration: 1,
  repeat: Infinity,
  ease: 'easeInOut' as const,
  delay
});

export default function PageLoader({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        color: 'rgba(229,231,235,0.85)'
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            animate={{ y: [0, -8, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ ...DOT_TRANSITION(i * 0.15) }}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#c4a86f',
              display: 'inline-block'
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 13, letterSpacing: 0.3 }}>{label}</span>
    </div>
  );
}
