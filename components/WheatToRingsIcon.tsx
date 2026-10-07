'use client';

import React from 'react';

/**
 * Ícone animado: um grão do símbolo Techtie se desprende e se transforma
 * suavemente em um ícone de anéis concêntricos (estado "processando").
 * Keyframes (bf-wr-*) definidos em app/globals.css.
 */
export default function WheatToRingsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ overflow: 'visible', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="bf-wheat-rings-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F5E3A8" />
          <stop offset=".45" stopColor="#C9A24B" />
          <stop offset="1" stopColor="#8C6B26" />
        </linearGradient>
      </defs>

      <g className="bf-wr-static" fill="url(#bf-wheat-rings-grad)">
        <path d="M50 20 C56 26 56 36 50 42 C44 36 44 26 50 20Z" transform="translate(0 -4) rotate(0 50 31)" />
        <path d="M50 20 C56 26 56 36 50 42 C44 36 44 26 50 20Z" transform="translate(-10 4) rotate(-30 50 31)" />
        <path d="M50 20 C56 26 56 36 50 42 C44 36 44 26 50 20Z" transform="translate(10 4) rotate(30 50 31)" />
        <rect x="49.3" y="24" width="1.4" height="44" />
      </g>

      <g className="bf-wr-leaf" fill="url(#bf-wheat-rings-grad)">
        <path d="M50 20 C56 26 56 36 50 42 C44 36 44 26 50 20Z" />
      </g>

      <g className="bf-wr-rings" fill="none" stroke="url(#bf-wheat-rings-grad)" strokeWidth="3">
        <circle cx="50" cy="55" r="22" />
        <circle cx="50" cy="55" r="12" strokeWidth="2.4" />
        <circle cx="50" cy="55" r="3.2" fill="url(#bf-wheat-rings-grad)" stroke="none" />
      </g>
    </svg>
  );
}
