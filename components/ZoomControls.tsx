'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { Minus, Plus } from 'lucide-react';

const STORAGE_KEY = 'bf-zoom';
// Degraus do zoom do navegador (50% a 200%). O globals.css compensa as alturas em dvh e o posicionamento dos popups.
const NIVEIS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const NIVEL_PADRAO = 1;
const DESKTOP = '(min-width: 48em)';

function aplicar(nivel: number) {
  const root = document.documentElement;
  if (nivel === 1) {
    root.style.removeProperty('--bf-zoom');
    root.removeAttribute('data-bf-zoom');
    return;
  }
  // O zoom em si é CSS zoom (e não transform: o layout reflui como no Ctrl+/- do navegador), aplicado pelo
  // globals.css em .bf-zoom-root a partir destes dois sinais. --bf-zoom também compensa alturas em dvh, que o
  // zoom multiplica; data-bf-zoom liga os ajustes de componentes que medem o DOM em JS (ex.: destaque do
  // SegmentedControl), cujas medidas o zoom escala duas vezes.
  root.style.setProperty('--bf-zoom', String(nivel));
  root.setAttribute('data-bf-zoom', String(nivel));
}

function lerSalvo(): number {
  try {
    const salvo = Number(localStorage.getItem(STORAGE_KEY));
    return NIVEIS.includes(salvo) ? salvo : NIVEL_PADRAO;
  } catch {
    return NIVEL_PADRAO;
  }
}

/** Botões -/+ do topo (desktop): zoom da interface para acessibilidade, equivalente ao Ctrl+ e Ctrl- do navegador. */
export default function ZoomControls() {
  const [nivel, setNivel] = useState(NIVEL_PADRAO);

  useEffect(() => {
    setNivel(lerSalvo());
  }, []);

  // O zoom só vale no desktop (no mobile os controles ficam ocultos e o layout próprio não suporta zoom).
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const sincronizar = () => aplicar(mq.matches ? nivel : 1);
    sincronizar();
    mq.addEventListener('change', sincronizar);
    return () => {
      mq.removeEventListener('change', sincronizar);
      aplicar(1); // ao sair do shell (ex.: logout) a tela de login não herda o zoom
    };
  }, [nivel]);

  const mudar = (novo: number) => {
    setNivel(novo);
    try {
      localStorage.setItem(STORAGE_KEY, String(novo));
    } catch {}
  };

  const indice = NIVEIS.indexOf(nivel);
  const percentual = `${Math.round(nivel * 100)}%`;

  return (
    <div className="bf-zoom" role="group" aria-label="Zoom da interface">
      <Tooltip label="Diminuir zoom" withArrow>
        <ActionIcon
          variant="subtle"
          size={32}
          radius="xl"
          aria-label="Diminuir zoom"
          disabled={indice <= 0}
          onClick={() => mudar(NIVEIS[Math.max(0, indice - 1)])}
        >
          <Minus size={18} strokeWidth={2} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Restaurar zoom (100%)" withArrow disabled={nivel === NIVEL_PADRAO}>
        <button
          type="button"
          className="bf-zoom-nivel"
          aria-label={`Zoom atual ${percentual}. Restaurar para 100%`}
          onClick={() => mudar(NIVEL_PADRAO)}
          disabled={nivel === NIVEL_PADRAO}
        >
          {percentual}
        </button>
      </Tooltip>
      <Tooltip label="Aumentar zoom" withArrow>
        <ActionIcon
          variant="subtle"
          size={32}
          radius="xl"
          aria-label="Aumentar zoom"
          disabled={indice >= NIVEIS.length - 1}
          onClick={() => mudar(NIVEIS[Math.min(NIVEIS.length - 1, indice + 1)])}
        >
          <Plus size={18} strokeWidth={2} />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}
