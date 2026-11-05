'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import styles from './AbasDeslizantes.module.css';

export interface OpcaoAba<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * Controle segmentado padrão do sistema (substitui o SegmentedControl do Mantine): sem borda e sem fundo,
 * só o destaque azul da opção ativa, que desliza entre as opções.
 *
 * O destaque é posicionado em PORCENTAGEM da largura do controle (medida da opção / medida do controle).
 * A razão independe do zoom da interface (CSS zoom em .bf-zoom-root), que distorce posições absolutas em px.
 */
export default function AbasDeslizantes<T extends string>({
  value,
  onChange,
  data,
  ariaLabel,
  fullWidth = false,
  rolavel = false,
  size = 'sm',
  className,
  style
}: {
  /** Rola na horizontal quando as opções não cabem. */
  rolavel?: boolean;
  value: T;
  onChange: (v: T) => void;
  data: OpcaoAba<T>[];
  ariaLabel?: string;
  /** Opções com a mesma largura, ocupando todo o espaço. */
  fullWidth?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}) {
  const raizRef = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const indice = Math.max(0, data.findIndex(a => a.value === value));
  const [posicao, setPosicao] = useState<{ left: number; width: number } | null>(null);
  const [animar, setAnimar] = useState(false);

  useLayoutEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    const medir = () => {
      const botao = refs.current[indice];
      if (!botao) return;
      const r = raiz.getBoundingClientRect();
      const b = botao.getBoundingClientRect();
      if (!r.width || !raiz.offsetWidth) return;
      // Controle com rolagem horizontal (muitas opções no celular): scrollLeft vem em px CSS; converte para a
      // mesma escala das medidas visuais (que já incluem o zoom) antes de somar.
      const escala = r.width / raiz.offsetWidth;
      const left = b.left - r.left + raiz.scrollLeft * escala;
      setPosicao({ left: (left / r.width) * 100, width: (b.width / r.width) * 100 });
    };
    medir();
    // Só anima depois da primeira medida, para o destaque não "voar" ao montar.
    const id = requestAnimationFrame(() => setAnimar(true));
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(id);
    const obs = new ResizeObserver(medir);
    obs.observe(raiz);
    refs.current.forEach(b => b && obs.observe(b));
    return () => {
      cancelAnimationFrame(id);
      obs.disconnect();
    };
  }, [indice, data.length]);

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    const passo = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!passo) return;
    e.preventDefault();
    for (let i = 1; i <= data.length; i++) {
      const proximo = (indice + passo * i + data.length) % data.length;
      if (!data[proximo].disabled) {
        onChange(data[proximo].value);
        refs.current[proximo]?.focus();
        return;
      }
    }
  };

  return (
    <div
      ref={raizRef}
      role="tablist"
      aria-label={ariaLabel}
      className={[styles.raiz, className].filter(Boolean).join(' ')}
      data-full-width={fullWidth || undefined}
      data-rolavel={rolavel || undefined}
      data-size={size}
      style={style}
      onKeyDown={aoTeclar}
    >
      {posicao && (
        <span
          aria-hidden="true"
          className={styles.indicador}
          data-animar={animar || undefined}
          style={{ left: `${posicao.left}%`, width: `${posicao.width}%` }}
        />
      )}
      {data.map((a, i) => (
        <button
          key={a.value}
          ref={el => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={i === indice}
          tabIndex={i === indice ? 0 : -1}
          disabled={a.disabled}
          data-ativo={i === indice || undefined}
          className={styles.aba}
          onClick={() => onChange(a.value)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Direção da troca de opção: 1 = foi para uma opção à direita, -1 = à esquerda.
 * Calculada no render comparando com o valor anterior (sem estado extra).
 */
export function useDirecaoAba<T>(value: T, ordem: readonly T[]): 1 | -1 {
  const anterior = useRef(value);
  const direcao = useRef<1 | -1>(1);
  if (anterior.current !== value) {
    direcao.current = ordem.indexOf(value) >= ordem.indexOf(anterior.current) ? 1 : -1;
    anterior.current = value;
  }
  return direcao.current;
}

const VARIANTES_SLIDE: Variants = {
  entrada: (d: number) => ({ x: d * 40, opacity: 0 }),
  centro: { x: 0, opacity: 1 },
  saida: (d: number) => ({ x: d * -40, opacity: 0 })
};
const VARIANTES_FADE: Variants = { entrada: { opacity: 0 }, centro: { opacity: 1 }, saida: { opacity: 0 } };

/**
 * Conteúdo que acompanha o controle segmentado: ao trocar a chave, o conteúdo atual sai e o novo entra
 * deslizando no sentido da troca (slide left / slide right). Com "reduzir movimento", só esmaece.
 */
export function ConteudoDeslizante({
  chave,
  direcao: direcaoExterna,
  ordem,
  children,
  className,
  classNameItem,
  style
}: {
  chave: string;
  /** Classe do item animado (filho direto), ex.: para participar de um layout flex de altura fixa. */
  classNameItem?: string;
  /** Direção já calculada (useDirecaoAba). Sem ela, é deduzida de `ordem`. */
  direcao?: 1 | -1;
  /** Ordem das opções (da esquerda para a direita), para deduzir a direção da troca. */
  ordem?: readonly string[];
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduzir = useReducedMotion();
  const direcaoDeduzida = useDirecaoAba(chave, ordem ?? [chave]);
  const direcao = direcaoExterna ?? direcaoDeduzida;
  return (
    <div className={[styles.conteudo, className].filter(Boolean).join(' ')} style={style}>
      <AnimatePresence mode="wait" initial={false} custom={direcao}>
        <motion.div
          key={chave}
          className={classNameItem}
          custom={direcao}
          variants={reduzir ? VARIANTES_FADE : VARIANTES_SLIDE}
          initial="entrada"
          animate="centro"
          exit="saida"
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
