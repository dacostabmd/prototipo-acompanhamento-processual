/**
 * Simulação e desenho do campo de partículas douradas do login (components/ParticulasOuro.tsx).
 * Roda dentro de um Web Worker com OffscreenCanvas (lib/particulasOuro.worker.ts) e, sem esse suporte,
 * no thread principal com o mesmo código. Um sprite de brilho pré-renderizado + um drawImage por partícula;
 * nada de gradiente ou sombra por quadro.
 */

export type MensagemParticulas =
  | { tipo: 'tamanho'; w: number; h: number; dpr: number }
  | { tipo: 'pausar' }
  | { tipo: 'retomar' }
  | { tipo: 'estatico'; valor: boolean };

type Superficie = HTMLCanvasElement | OffscreenCanvas;
type Contexto = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Agendar = (cb: (t: number) => void) => number;

type Camada = { fracao: number; tamanho: [number, number]; velocidade: [number, number]; alfa: [number, number]; oscilacao: [number, number]; cintila: boolean };

// Três profundidades: longe (pequenas, lentas e apagadas) → perto (maiores, rápidas, brilhantes e cintilando).
const CAMADAS: Camada[] = [
  { fracao: 0.55, tamanho: [2, 3.2], velocidade: [20, 30], alfa: [0.35, 0.55], oscilacao: [4, 8], cintila: false },
  { fracao: 0.31, tamanho: [4, 6.5], velocidade: [34, 48], alfa: [0.5, 0.75], oscilacao: [6, 12], cintila: false },
  { fracao: 0.14, tamanho: [8, 12], velocidade: [55, 75], alfa: [0.65, 0.95], oscilacao: [8, 16], cintila: true }
];

// Densidade de referência: 130 partículas numa área de 720×900 (metade da tela de um notebook).
const DENSIDADE = 130 / (720 * 900);
const MIN_PARTICULAS = 36; // campo pequeno do mobile continua cheio
const MAX_PARTICULAS = 170;
// Faixas (fração da área) onde a partícula aparece/some suavemente; a de baixo é maior porque no mobile o
// campo termina onde começa o cartão de login.
const FADE = { topo: 0.14, base: 0.2, lados: 0.06 };
// Teto de ~60 quadros/s: em telas de 120/144 Hz o laço não redesenha à toa.
const INTERVALO_MIN_MS = 15;

type Particula = { camada: Camada; x0: number; y: number; tam: number; vel: number; alfa: number; amp: number; freq: number; fase: number };

const entre = ([a, b]: [number, number]) => a + Math.random() * (b - a);

function criarSprite(): Superficie {
  const s: Superficie = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(64, 64) : document.createElement('canvas');
  s.width = s.height = 64;
  const c = s.getContext('2d') as Contexto;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,240,1)');
  g.addColorStop(0.22, 'rgba(201, 214, 238,0.95)');
  g.addColorStop(0.5, 'rgba(30, 124, 242,0.3)');
  g.addColorStop(1, 'rgba(30, 124, 242,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return s;
}

function criarParticula(w: number, h: number, camada: Camada, emQualquerAltura: boolean): Particula {
  return {
    camada,
    x0: Math.random() * w,
    // na criação inicial o campo já nasce preenchido; nas reciclagens, a partícula entra por baixo
    y: emQualquerAltura ? Math.random() * h : h + 12,
    tam: entre(camada.tamanho),
    vel: entre(camada.velocidade),
    alfa: entre(camada.alfa),
    amp: entre(camada.oscilacao),
    freq: (Math.PI * 2) / entre([4, 9]),
    fase: Math.random() * Math.PI * 2
  };
}

/** Recebe as mensagens de controle (tamanho, pausa, modo estático) e anima o canvas dado. */
export function criarControladorParticulas(canvas: Superficie, agendar: Agendar, cancelar: (id: number) => void) {
  const ctx = canvas.getContext('2d') as Contexto | null;
  const sprite = criarSprite();
  let particulas: Particula[] = [];
  let w = 0;
  let h = 0;
  let dpr = 1;
  let id = 0;
  let ultimo = 0;
  let pausado = false;
  let estatico = false;
  const inicio = performance.now();

  const popular = () => {
    const total = Math.max(MIN_PARTICULAS, Math.min(MAX_PARTICULAS, Math.round(w * h * DENSIDADE)));
    particulas = CAMADAS.flatMap(camada =>
      Array.from({ length: Math.round(total * camada.fracao) }, () => criarParticula(w, h, camada, true))
    );
  };

  const desenhar = (t: number) => {
    if (!ctx || !w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // entrada suave do campo inteiro ao abrir a página
    const entrada = Math.min(1, Math.max(0, (t - inicio - 200) / 1600));
    const seg = t / 1000;
    for (const p of particulas) {
      const x = p.x0 + Math.sin(seg * p.freq + p.fase) * p.amp;
      const fy = Math.min(1, p.y / (h * FADE.topo), (h - p.y) / (h * FADE.base));
      const fx = Math.min(1, x / (w * FADE.lados), (w - x) / (w * FADE.lados));
      let a = p.alfa * entrada * Math.max(0, Math.min(fy, fx));
      if (p.camada.cintila) a *= 0.7 + 0.3 * Math.sin(seg * 2.4 + p.fase);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, x - p.tam / 2, p.y - p.tam / 2, p.tam, p.tam);
    }
    ctx.globalAlpha = 1;
  };

  const quadro = (t: number) => {
    id = 0;
    if (pausado || estatico) return;
    id = agendar(quadro);
    if (t - ultimo < INTERVALO_MIN_MS) return;
    const dt = Math.min(0.05, (t - ultimo) / 1000); // após pausa/aba oculta, não "teleporta" as partículas
    ultimo = t;
    for (const p of particulas) {
      p.y -= p.vel * dt;
      if (p.y < -12) Object.assign(p, criarParticula(w, h, p.camada, false));
    }
    desenhar(t);
  };

  const continuar = () => {
    if (id || pausado || estatico) return;
    ultimo = performance.now();
    id = agendar(quadro);
  };
  const parar = () => {
    if (id) cancelar(id);
    id = 0;
  };
  // quadro parado já com o campo totalmente visível
  const quadroEstatico = () => desenhar(inicio + 5000);

  return (m: MensagemParticulas) => {
    if (m.tipo === 'tamanho') {
      if (!m.w || !m.h) return;
      const mudouArea = Math.abs(m.w * m.h - w * h) > w * h * 0.25;
      w = m.w;
      h = m.h;
      dpr = m.dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (!particulas.length || mudouArea) popular();
      if (estatico) quadroEstatico();
      else continuar();
    } else if (m.tipo === 'pausar') {
      pausado = true;
      parar();
    } else if (m.tipo === 'retomar') {
      pausado = false;
      continuar();
    } else if (m.tipo === 'estatico') {
      estatico = m.valor;
      if (estatico) {
        parar();
        quadroEstatico();
      } else continuar();
    }
  };
}
