import type { CSSProperties } from 'react';
import { LayoutDashboard, Search, Sparkles, Zap } from 'lucide-react';
import ParticulasOuro from './ParticulasOuro';
import styles from './TechTieHero.module.css';

type Faceta = {
  pontos: string;
  fill: 'claro' | 'medio' | 'escuro';
  /** De onde a faceta "voa" até o lugar (unidades do viewBox) e com que giro. */
  dx: number;
  dy: number;
  r: number;
  /** Atraso (s) da montagem; o contorno da mesma faceta é desenhado ~0,75s antes. */
  d: number;
};

// T-gravata da marca (geometria das asas e do nó igual à do logo em public/techtie-logo-horizontal-gold.svg;
// lâmina em facetas, como no logo 3D). viewBox 0 0 120 210.
const FACETAS: Faceta[] = [
  { pontos: '2,8 56,13 27.5,24', fill: 'claro', dx: -70, dy: -30, r: -25, d: 0.9 },
  { pontos: '27.5,24 56,13 53,40', fill: 'medio', dx: -55, dy: 25, r: 20, d: 1.0 },
  { pontos: '118,8 64,13 92.5,24', fill: 'medio', dx: 70, dy: -30, r: 25, d: 0.95 },
  { pontos: '92.5,24 64,13 67,40', fill: 'escuro', dx: 55, dy: 25, r: -20, d: 1.05 },
  { pontos: '52,15 60,15 60,42 56,42', fill: 'claro', dx: -10, dy: -60, r: 0, d: 1.15 },
  { pontos: '60,15 68,15 64,42 60,42', fill: 'escuro', dx: 10, dy: -60, r: 0, d: 1.2 },
  { pontos: '56,44 60,44 60,176 40,165', fill: 'medio', dx: -50, dy: 70, r: -10, d: 1.3 },
  { pontos: '60,44 64,44 80,165 60,176', fill: 'escuro', dx: 50, dy: 70, r: 10, d: 1.35 },
  { pontos: '40,165 60,176 60,204', fill: 'claro', dx: -35, dy: 80, r: -20, d: 1.45 },
  { pontos: '80,165 60,176 60,204', fill: 'medio', dx: 35, dy: 80, r: 20, d: 1.5 }
];

const GRADIENTE = { claro: 'url(#tt-g-claro)', medio: 'url(#tt-g-medio)', escuro: 'url(#tt-g-escuro)' };

type Pt = [number, number];

/** Raio (unidades do viewBox, ~10px no desktop) dos cantos externos do T. */
const RAIO_CANTO = 8;

// Cantos externos arredondados: vértice e seus dois vizinhos na silhueta. Quando o canto é dividido entre
// duas facetas, ambas passam pelo ponto médio da curva, então a junção continua sem fresta.
const CANTOS: { v: Pt; a: Pt; b: Pt }[] = [
  { v: [2, 8], a: [56, 13], b: [53, 40] },
  { v: [118, 8], a: [64, 13], b: [67, 40] },
  { v: [40, 165], a: [56, 44], b: [60, 204] },
  { v: [80, 165], a: [64, 44], b: [60, 204] },
  { v: [60, 204], a: [40, 165], b: [80, 165] }
];

const unit = (de: Pt, para: Pt): Pt => {
  const dx = para[0] - de[0];
  const dy = para[1] - de[1];
  const n = Math.hypot(dx, dy);
  return [dx / n, dy / n];
};
const fmt = (p: Pt) => `${+p[0].toFixed(2)},${+p[1].toFixed(2)}`;

/** Polígono da faceta como path, com os vértices de CANTOS trocados por curvas. */
function caminhoArredondado(pontos: string): string {
  const vs = pontos.split(' ').map(p => p.split(',').map(Number) as Pt);
  const trechos = vs.map((v, i) => {
    const canto = CANTOS.find(c => c.v[0] === v[0] && c.v[1] === v[1]);
    if (!canto) return `${i ? 'L' : 'M'}${fmt(v)}`;
    const ua = unit(v, canto.a);
    const ub = unit(v, canto.b);
    const angulo = Math.acos(ua[0] * ub[0] + ua[1] * ub[1]);
    const lim = 0.4 * Math.min(Math.hypot(canto.a[0] - v[0], canto.a[1] - v[1]), Math.hypot(canto.b[0] - v[0], canto.b[1] - v[1]));
    const d = Math.min(RAIO_CANTO / Math.tan(angulo / 2), lim);
    const pa: Pt = [v[0] + ua[0] * d, v[1] + ua[1] * d];
    const pb: Pt = [v[0] + ub[0] * d, v[1] + ub[1] * d];
    const meio: Pt = [(pa[0] + 2 * v[0] + pb[0]) / 4, (pa[1] + 2 * v[1] + pb[1]) / 4];
    // lado da curva em que cada vizinho da faceta encosta: borda da silhueta (pa/pb) ou aresta interna (meio)
    const lado = (w: Pt): Pt => {
      const u = unit(v, w);
      if (u[0] * ua[0] + u[1] * ua[1] > 0.999) return pa;
      if (u[0] * ub[0] + u[1] * ub[1] > 0.999) return pb;
      return meio;
    };
    const ini = lado(vs[(i - 1 + vs.length) % vs.length]);
    const fim = lado(vs[(i + 1) % vs.length]);
    const ponta = ini === meio ? fim : ini;
    const ctrl: Pt = ini === meio || fim === meio ? [(ponta[0] + v[0]) / 2, (ponta[1] + v[1]) / 2] : v;
    return `${i ? 'L' : 'M'}${fmt(ini)} Q${fmt(ctrl)} ${fmt(fim)}`;
  });
  return `${trechos.join(' ')}Z`;
}

const CAMINHOS = Object.fromEntries(FACETAS.map(f => [f.pontos, caminhoArredondado(f.pontos)]));

// Silhueta do T (união das facetas) como máscara CSS do reflexo: o reflexo anima fora do SVG, só com
// transform, e o SVG montado não precisa ser repintado a cada quadro.
const MASCARA_T = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 210'>${FACETAS.map(f => `<path d='${CAMINHOS[f.pontos]}'/>`).join('')}</svg>`
)}")`;

const DIFERENCIAIS = [
  { icon: Search, texto: 'Busca unificada em tribunais estaduais, federais e na base nacional do CNJ.' },
  { icon: Zap, texto: 'Varredura inteligente que começa pelo tribunal mais provável e reduz o custo da consulta.' },
  { icon: Sparkles, texto: 'Resumo de cada andamento gerado por IA, sem juridiquês.' },
  { icon: LayoutDashboard, texto: 'Todos os processos que você acompanha em um painel único.' }
];

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/** Coluna esquerda do login: T da TechTie se montando + copy de acompanhamento processual. Só SVG e CSS. */
export default function TechTieHero() {
  return (
    <>
      <div className={styles.fundo} aria-hidden>
        <div className={styles.brilho} />
      </div>

      <div className={styles.palco}>
        {/* dentro do palco (área do T), e não no fundo da tela inteira: nada anima atrás do cartão de vidro,
            cujo backdrop-filter teria de ser recalculado a cada quadro */}
        <ParticulasOuro className={styles.particulas} />
        <div className={styles.marcaWrap}>
          <svg className={styles.marca} viewBox="0 0 120 210" aria-hidden focusable="false">
            <defs>
              <linearGradient id="tt-g-claro" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#FFF1C4" />
                <stop offset=".5" stopColor="#E2BE6A" />
                <stop offset="1" stopColor="#B98E3C" />
              </linearGradient>
              <linearGradient id="tt-g-medio" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#E9CB7F" />
                <stop offset=".55" stopColor="#C49A48" />
                <stop offset="1" stopColor="#8E6A27" />
              </linearGradient>
              <linearGradient id="tt-g-escuro" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#B48B3E" />
                <stop offset=".6" stopColor="#7E5E22" />
                <stop offset="1" stopColor="#4A3510" />
              </linearGradient>
            </defs>

            {/* 1) contorno desenhado */}
            <g>
              {FACETAS.map(f => (
                <path key={f.pontos} d={CAMINHOS[f.pontos]} pathLength={1} className={styles.contorno} style={v({ '--d': `${f.d - 0.75}s` })} />
              ))}
            </g>

            {/* 2) facetas que voam até o lugar e formam o T */}
            <g>
              {FACETAS.map(f => (
                <path
                  key={f.pontos}
                  d={CAMINHOS[f.pontos]}
                  fill={GRADIENTE[f.fill]}
                  className={styles.faceta}
                  style={v({ '--dx': `${f.dx}px`, '--dy': `${f.dy}px`, '--r': `${f.r}deg`, '--d': `${f.d}s` })}
                />
              ))}
            </g>
          </svg>
          {/* 3) reflexo que atravessa o T montado (fora do SVG, recortado pela silhueta) */}
          <div className={styles.reflexoMascara} style={{ maskImage: MASCARA_T, WebkitMaskImage: MASCARA_T }}>
            <span className={styles.reflexo} />
          </div>
        </div>

        <div className={styles.copy}>
          <p className={styles.eyebrow}>TechTie · Acompanhamento processual</p>
          <h1 className={styles.titulo}>Acompanhamento processual otimizado, do primeiro andamento à decisão final.</h1>
          <p className={styles.lead}>
            Consulte processos por CPF, CNPJ ou número CNJ, entenda cada movimentação em linguagem clara e mantenha tudo o que
            importa em um só lugar.
          </p>
          <ul className={styles.diferenciais}>
            {DIFERENCIAIS.map(({ icon: Icon, texto }, i) => (
              <li key={texto} className={styles.diferencial} style={v({ '--i': i })}>
                <span className={styles.icone}>
                  <Icon size={16} strokeWidth={1.8} />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
