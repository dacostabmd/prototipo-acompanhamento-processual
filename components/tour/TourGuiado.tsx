'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Compass, Square, X } from 'lucide-react';
import { TOURS, tourPorId, type TourId } from './tours';
import styles from './TourGuiado.module.css';

/** Abre o controle remoto (sem detalhe) ou inicia direto um tour: window.dispatchEvent(new CustomEvent(EVENTO_TOUR, { detail: 'pesquisa' })). */
export const EVENTO_TOUR = 'bf:tour';
/** Disparado antes de procurar o alvo de um passo (detail = valor do data-tour). Telas com abas escutam e abrem a aba que contém o alvo. */
export const EVENTO_TOUR_ALVO = 'bf:tour-alvo';

const CHAVE_CONCLUIDOS = 'bf-tours-concluidos';
const CHAVE_ATIVO = 'bf-tour-ativo';
const ESPERA_ALVO_MS = 4000;
const FOLGA = 6;
const MARGEM = 16;
const MOBILE = 640;

interface Retangulo {
  top: number;
  left: number;
  width: number;
  height: number;
}

const lerConcluidos = (): TourId[] => {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CONCLUIDOS) ?? '[]');
  } catch {
    return [];
  }
};

/**
 * Tour guiado do app: um "controle remoto" fixo no canto inferior direito lista os tours; cada passo
 * navega até a rota certa, espera o elemento marcado com data-tour aparecer, destaca-o e mostra um
 * cartão explicativo ao lado. Sem alvo visível (ex.: menu recolhido no celular), o cartão vem centralizado.
 */
export default function TourGuiado({ oculto = false }: { oculto?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [painelAberto, setPainelAberto] = useState(false);
  const [tourId, setTourId] = useState<TourId | null>(null);
  const [passo, setPasso] = useState(0);
  const [alvo, setAlvo] = useState<Retangulo | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [concluidos, setConcluidos] = useState<TourId[]>([]);
  const [viewport, setViewport] = useState({ w: 1280, h: 800 });
  const [alturaCartao, setAlturaCartao] = useState(220);
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const tour = tourPorId(tourId);
  const passoAtual = tour?.passos[passo] ?? null;

  useEffect(() => {
    setConcluidos(lerConcluidos());
    try {
      const salvo = JSON.parse(sessionStorage.getItem(CHAVE_ATIVO) ?? 'null');
      if (salvo && tourPorId(salvo.id)) {
        setTourId(salvo.id);
        setPasso(Number(salvo.passo) || 0);
      }
    } catch {}
    const medir = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  // Mantém o tour em andamento se a página recarregar.
  useEffect(() => {
    try {
      if (tourId) sessionStorage.setItem(CHAVE_ATIVO, JSON.stringify({ id: tourId, passo }));
      else sessionStorage.removeItem(CHAVE_ATIVO);
    } catch {}
  }, [tourId, passo]);

  const iniciar = useCallback((id: TourId) => {
    setPainelAberto(false);
    setAlvo(null);
    setPasso(0);
    setTourId(id);
  }, []);

  const encerrar = useCallback(() => {
    setTourId(null);
    setPasso(0);
    setAlvo(null);
  }, []);

  const concluir = useCallback(() => {
    if (tourId) {
      const lista = Array.from(new Set([...lerConcluidos(), tourId]));
      try {
        localStorage.setItem(CHAVE_CONCLUIDOS, JSON.stringify(lista));
      } catch {}
      setConcluidos(lista);
    }
    encerrar();
    setPainelAberto(true);
  }, [tourId, encerrar]);

  const avancar = useCallback(() => {
    if (!tour) return;
    if (passo >= tour.passos.length - 1) concluir();
    else setPasso(p => p + 1);
  }, [tour, passo, concluir]);

  const voltar = useCallback(() => setPasso(p => Math.max(0, p - 1)), []);

  // Atalho externo (ex.: botão no perfil).
  useEffect(() => {
    const aoPedir = (e: Event) => {
      const id = (e as CustomEvent<string | undefined>).detail;
      if (id && tourPorId(id)) iniciar(id as TourId);
      else {
        encerrar();
        setPainelAberto(true);
      }
    };
    window.addEventListener(EVENTO_TOUR, aoPedir);
    return () => window.removeEventListener(EVENTO_TOUR, aoPedir);
  }, [iniciar, encerrar]);

  // Navega até a rota do passo, procura o alvo e acompanha a posição dele (rolagem, redimensionamento, animações).
  useEffect(() => {
    if (!passoAtual) return;
    if (passoAtual.rota && pathname !== passoAtual.rota) {
      setAlvo(null);
      setProcurando(true);
      router.push(passoAtual.rota);
      return;
    }
    if (!passoAtual.alvo) {
      setAlvo(null);
      setProcurando(false);
      return;
    }

    let cancelado = false;
    let elemento: Element | null = null;
    let tentativa: ReturnType<typeof setTimeout> | undefined;
    const inicio = Date.now();

    const visivel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
    };

    const medir = () => {
      if (cancelado) return;
      if (!elemento || !elemento.isConnected || !visivel(elemento)) {
        setAlvo(null);
        return;
      }
      const r = elemento.getBoundingClientRect();
      setAlvo(atual =>
        atual && atual.top === r.top && atual.left === r.left && atual.width === r.width && atual.height === r.height
          ? atual
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    };

    const procurar = () => {
      if (cancelado) return;
      const el = document.querySelector(`[data-tour="${passoAtual.alvo}"]`);
      if (el && visivel(el)) {
        elemento = el;
        const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const r = el.getBoundingClientRect();
        if (r.top < 80 || r.bottom > window.innerHeight - 80) {
          el.scrollIntoView({ block: 'center', behavior: reduzir ? 'auto' : 'smooth' });
        }
        medir();
        setProcurando(false);
        return;
      }
      if (Date.now() - inicio > ESPERA_ALVO_MS) {
        setAlvo(null);
        setProcurando(false);
        return;
      }
      tentativa = setTimeout(procurar, 150);
    };

    setProcurando(true);
    window.dispatchEvent(new CustomEvent(EVENTO_TOUR_ALVO, { detail: passoAtual.alvo }));
    procurar();
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    const intervalo = setInterval(medir, 350);
    return () => {
      cancelado = true;
      clearTimeout(tentativa);
      clearInterval(intervalo);
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
    };
  }, [passoAtual, pathname, router]);

  // Teclado: setas navegam, Esc encerra (fora de campos de texto).
  useEffect(() => {
    if (!tour) return;
    const aoTeclar = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (e.key === 'Escape') encerrar();
      else if (e.key === 'ArrowRight') avancar();
      else if (e.key === 'ArrowLeft') voltar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [tour, avancar, voltar, encerrar]);

  useEffect(() => {
    if (!painelAberto) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setPainelAberto(false);
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [painelAberto]);

  // O AnimatePresence monta o cartão novo sem re-renderizar este componente: mede pelo próprio elemento.
  const observadorRef = useRef<ResizeObserver | null>(null);
  const cartaoRef = useCallback((el: HTMLDivElement | null) => {
    observadorRef.current?.disconnect();
    observadorRef.current = null;
    if (!el) return;
    setAlturaCartao(el.offsetHeight);
    if (typeof ResizeObserver !== 'undefined') {
      observadorRef.current = new ResizeObserver(() => setAlturaCartao(el.offsetHeight));
      observadorRef.current.observe(el);
    }
  }, []);
  useEffect(() => () => observadorRef.current?.disconnect(), []);

  if (oculto || !montado) return null;

  const mobile = viewport.w < MOBILE;
  const larguraCartao = Math.min(380, viewport.w - MARGEM * 2);
  const destaque = alvo
    ? { top: alvo.top - FOLGA, left: alvo.left - FOLGA, width: alvo.width + FOLGA * 2, height: alvo.height + FOLGA * 2 }
    : null;

  let posicaoCartao: CSSProperties;
  if (!destaque) {
    posicaoCartao = {
      width: larguraCartao,
      left: (viewport.w - larguraCartao) / 2,
      top: Math.max(MARGEM, (viewport.h - alturaCartao) / 2)
    };
  } else if (mobile) {
    // No celular o cartão fica preso embaixo; se o alvo estiver lá, sobe para o topo.
    const alvoEmbaixo = destaque.top + destaque.height > viewport.h - alturaCartao - 96;
    posicaoCartao = alvoEmbaixo ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 84 };
  } else {
    const espacoAbaixo = viewport.h - (destaque.top + destaque.height);
    const espacoAcima = destaque.top;
    const left = Math.min(Math.max(destaque.left + destaque.width / 2 - larguraCartao / 2, MARGEM), viewport.w - larguraCartao - MARGEM);
    let top: number;
    if (espacoAbaixo >= alturaCartao + 28) top = destaque.top + destaque.height + 14;
    else if (espacoAcima >= alturaCartao + 28) top = destaque.top - alturaCartao - 14;
    else top = viewport.h - alturaCartao - MARGEM;
    posicaoCartao = { width: larguraCartao, left, top: Math.max(MARGEM, top) };
  }

  const ultimo = tour ? passo === tour.passos.length - 1 : false;
  const nenhumConcluido = concluidos.length === 0;

  // Portal no <body>: fora do .bf-zoom-root (CSS zoom), senão as medidas de getBoundingClientRect
  // (pixels reais) são escaladas de novo pelo zoom e o destaque sai deslocado do alvo.
  return createPortal(
    <>
      {tour && passoAtual && (
        <div className={styles.camada} aria-hidden={false}>
          {destaque ? (
            <div className={styles.destaque} style={destaque} />
          ) : (
            <div className={styles.veu} />
          )}

          <AnimatePresence mode="wait">
            {!procurando && (
              <motion.div
                key={`${tour.id}-${passo}`}
                ref={cartaoRef}
                role="dialog"
                aria-modal="false"
                aria-labelledby="bf-tour-titulo"
                className={styles.cartao}
                style={posicaoCartao}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className={styles.cartaoTopo}>
                  <span className={styles.cartaoTour}>
                    <tour.icone size={14} strokeWidth={1.8} aria-hidden="true" />
                    {tour.titulo}
                  </span>
                  <button type="button" className={styles.botaoIcone} onClick={encerrar} aria-label="Encerrar tour">
                    <X size={16} />
                  </button>
                </div>
                <h3 id="bf-tour-titulo" className={styles.cartaoTitulo}>
                  {passoAtual.titulo}
                </h3>
                <div className={styles.cartaoCorpo}>{passoAtual.conteudo}</div>
                <div className={styles.progresso} aria-hidden="true">
                  {tour.passos.map((_, i) => (
                    <span key={i} className={styles.ponto} data-ativo={i === passo || undefined} data-feito={i < passo || undefined} />
                  ))}
                </div>
                <div className={styles.cartaoRodape}>
                  <span className={styles.contador}>
                    {passo + 1} de {tour.passos.length}
                  </span>
                  <div className={styles.acoes}>
                    {passo > 0 && (
                      <button type="button" className={styles.botaoSec} onClick={voltar}>
                        <ArrowLeft size={14} /> Anterior
                      </button>
                    )}
                    <button type="button" className={styles.botaoPri} onClick={avancar} autoFocus>
                      {ultimo ? (
                        <>
                          <Check size={14} /> Concluir
                        </>
                      ) : (
                        <>
                          Próximo <ArrowRight size={14} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Controle remoto */}
      <div className={styles.controle} data-tour="tour-controle">
        <AnimatePresence>
          {painelAberto && !tour && (
            <motion.div
              id="bf-tour-painel"
              role="dialog"
              aria-label="Escolha um tour guiado"
              className={styles.painel}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className={styles.painelTopo}>
                <div>
                  <div className={styles.painelTitulo}>Tour guiado</div>
                  <div className={styles.painelSub}>
                    {concluidos.length} de {TOURS.length} concluídos
                  </div>
                </div>
                <button type="button" className={styles.botaoIcone} onClick={() => setPainelAberto(false)} aria-label="Fechar">
                  <X size={16} />
                </button>
              </div>
              <ul className={styles.painelLista}>
                {TOURS.map(t => {
                  const feito = concluidos.includes(t.id);
                  return (
                    <li key={t.id}>
                      <button type="button" className={styles.opcao} onClick={() => iniciar(t.id)}>
                        <span className={styles.opcaoIcone}>
                          <t.icone size={17} strokeWidth={1.8} aria-hidden="true" />
                        </span>
                        <span className={styles.opcaoTexto}>
                          <span className={styles.opcaoTitulo}>{t.titulo}</span>
                          <span className={styles.opcaoResumo}>{t.resumo}</span>
                        </span>
                        <span className={styles.opcaoMeta}>
                          {feito ? (
                            <CheckCircle2 size={16} className={styles.feito} aria-label="Concluído" />
                          ) : (
                            <span>{t.passos.length} passos</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {tour ? (
          <div className={styles.remotoAtivo} role="group" aria-label={`Controle do tour ${tour.titulo}`}>
            <button type="button" className={styles.remotoBotao} onClick={voltar} disabled={passo === 0} aria-label="Passo anterior">
              <ArrowLeft size={16} />
            </button>
            <span className={styles.remotoPasso}>
              {passo + 1}/{tour.passos.length}
            </span>
            <button type="button" className={styles.remotoBotao} onClick={avancar} aria-label={ultimo ? 'Concluir tour' : 'Próximo passo'}>
              {ultimo ? <Check size={16} /> : <ArrowRight size={16} />}
            </button>
            <button type="button" className={`${styles.remotoBotao} ${styles.remotoParar}`} onClick={encerrar} aria-label="Encerrar tour">
              <Square size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.lancador}
            onClick={() => setPainelAberto(v => !v)}
            aria-expanded={painelAberto}
            aria-controls="bf-tour-painel"
            aria-label="Abrir tour guiado"
          >
            <Compass size={18} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.lancadorTexto}>Tour guiado</span>
            {nenhumConcluido && !painelAberto && <span className={styles.pulso} aria-hidden="true" />}
          </button>
        )}
      </div>
    </>,
    document.body
  );
}
