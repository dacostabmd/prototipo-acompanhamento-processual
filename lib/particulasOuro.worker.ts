// Worker do campo de partículas do login: anima o OffscreenCanvas fora do thread principal.
import { criarControladorParticulas, type MensagemParticulas } from './particulasOuro';

type Inicio = { tipo: 'iniciar'; canvas: OffscreenCanvas; estatico: boolean; w: number; h: number; dpr: number };

const agendar: (cb: (t: number) => void) => number =
  typeof self.requestAnimationFrame === 'function'
    ? cb => self.requestAnimationFrame(cb)
    : cb => self.setTimeout(() => cb(performance.now()), 16) as unknown as number;
const cancelar = (id: number) =>
  typeof self.cancelAnimationFrame === 'function' ? self.cancelAnimationFrame(id) : self.clearTimeout(id);

let controlar: ((m: MensagemParticulas) => void) | null = null;

self.onmessage = (e: MessageEvent<Inicio | MensagemParticulas>) => {
  const m = e.data;
  if (m.tipo === 'iniciar') {
    controlar = criarControladorParticulas(m.canvas, agendar, cancelar);
    controlar({ tipo: 'estatico', valor: m.estatico });
    controlar({ tipo: 'tamanho', w: m.w, h: m.h, dpr: m.dpr });
    return;
  }
  controlar?.(m);
};
