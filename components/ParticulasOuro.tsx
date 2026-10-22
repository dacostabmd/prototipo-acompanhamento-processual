'use client';

import { useEffect, useRef } from 'react';
import { criarControladorParticulas, type MensagemParticulas } from '@/lib/particulasOuro';

/**
 * Campo de partículas douradas do login (TechTieHero). A animação roda num Web Worker com OffscreenCanvas:
 * o thread principal (formulário de login) não faz trabalho nenhum por quadro. Sem suporte a
 * OffscreenCanvas, o mesmo código (lib/particulasOuro.ts) roda aqui mesmo. Pausa fora da tela e com a aba
 * oculta; quem prefere menos movimento recebe um quadro estático.
 *
 * O <canvas> é criado no efeito (e não no JSX) porque transferControlToOffscreen só pode ser chamado uma
 * vez por elemento — com o StrictMode o efeito roda duas vezes em desenvolvimento.
 */
export default function ParticulasOuro({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    host.appendChild(canvas);

    const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
    const medir = () => {
      const r = host.getBoundingClientRect();
      return { w: r.width, h: r.height, dpr: Math.min(2, window.devicePixelRatio || 1) };
    };

    let worker: Worker | null = null;
    let enviar: (m: MensagemParticulas) => void;

    if (typeof canvas.transferControlToOffscreen === 'function' && typeof Worker !== 'undefined') {
      try {
        const offscreen = canvas.transferControlToOffscreen();
        worker = new Worker(new URL('../lib/particulasOuro.worker.ts', import.meta.url));
        worker.postMessage({ tipo: 'iniciar', canvas: offscreen, estatico: reduzirMovimento.matches, ...medir() }, [offscreen]);
      } catch {
        worker?.terminate();
        worker = null;
      }
    }

    if (worker) {
      const w = worker;
      enviar = m => w.postMessage(m);
    } else {
      enviar = criarControladorParticulas(canvas, cb => requestAnimationFrame(cb), id => cancelAnimationFrame(id));
      enviar({ tipo: 'estatico', valor: reduzirMovimento.matches });
      enviar({ tipo: 'tamanho', ...medir() });
    }

    const ro = new ResizeObserver(() => enviar({ tipo: 'tamanho', ...medir() }));
    ro.observe(host);

    // Pausa quando o campo sai da tela (ex.: celular rolado até o formulário) ou a aba fica oculta.
    let naTela = true;
    const sincronizarPausa = () => enviar({ tipo: naTela && !document.hidden ? 'retomar' : 'pausar' });
    const io = new IntersectionObserver(([e]) => {
      naTela = e.isIntersecting;
      sincronizarPausa();
    });
    io.observe(host);
    document.addEventListener('visibilitychange', sincronizarPausa);

    const aoMudarPreferencia = () => enviar({ tipo: 'estatico', valor: reduzirMovimento.matches });
    reduzirMovimento.addEventListener('change', aoMudarPreferencia);

    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', sincronizarPausa);
      reduzirMovimento.removeEventListener('change', aoMudarPreferencia);
      enviar({ tipo: 'pausar' });
      worker?.terminate();
      canvas.remove();
    };
  }, []);

  return <div ref={ref} className={className} aria-hidden />;
}
