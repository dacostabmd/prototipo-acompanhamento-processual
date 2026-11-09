import {
  ArrowUpRight,
  FilePlus,
  FileSearch,
  FileText,
  Mail,
  MessageSquareText,
  Reply,
  Scale,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';
import { obterModelo } from '@/lib/pecas/modelos';
import type { EntradaPeca, Intervencao } from '@/lib/pecas/tipos';

/** Ícones dos modelos (nomes lucide definidos em lib/pecas/modelos.ts). */
const ICONES: Record<string, LucideIcon> = { ShieldCheck, Reply, Scale, ArrowUpRight, FileSearch, MessageSquareText, Mail, FilePlus };

export function IconeModelo({ nome, size = 20, className }: { nome: string | undefined; size?: number; className?: string }) {
  const Icone = (nome && ICONES[nome]) || FileText;
  return <Icone size={size} strokeWidth={1.8} className={className} />;
}

export const nomeDoTipo = (tipo: string) => obterModelo(tipo)?.nome ?? tipo;

export const CAMPO =
  'w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-base text-white placeholder-white/30 outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60 sm:text-sm';

export const BOTAO_SEC =
  'bf-btn-sec inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#1E7CF2]/50 bg-[#1E7CF2]/15 px-3.5 py-2 text-sm font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25 disabled:cursor-not-allowed disabled:opacity-50';

export const fmtDataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/** Peça aberta no editor: recém-gerada (com o que o código corrigiu) ou reaberta do histórico. */
export interface PecaEditavel {
  id: string | null;
  tipo: string;
  titulo: string;
  conteudo: string;
  modelo: string | null;
  tokensEntrada: number;
  tokensSaida: number;
  entrada: EntradaPeca | null;
  intervencoes: Intervencao[];
  /** false = não foi gravada no histórico (migration ausente ou falha). */
  salvo: boolean;
  avisoHistorico?: string;
  semJulgados?: boolean;
}

/** Chave do rascunho enviado à página de impressão (localStorage, porque ela abre em outra aba). */
export const CHAVE_IMPRESSAO = 'bf-peca-impressao';

export function abrirImpressao(titulo: string, conteudo: string, id: string | null) {
  try {
    localStorage.setItem(CHAVE_IMPRESSAO, JSON.stringify({ titulo, conteudo, id, em: Date.now() }));
  } catch {
    // Sem localStorage a página de impressão busca pelo id (se houver).
  }
  window.open(`/pecas/imprimir?auto=1${id ? `&id=${encodeURIComponent(id)}` : ''}`, '_blank');
}

export function baixarTxt(nome: string, texto: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Peça do histórico (sem as correções automáticas, que só existem na geração) pronta para o editor. */
export function paraEditavel(p: import('@/lib/pecas/tipos').PecaCompleta): PecaEditavel {
  return {
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    conteudo: p.conteudo,
    modelo: p.modelo,
    tokensEntrada: p.tokensEntrada,
    tokensSaida: p.tokensSaida,
    entrada: p.entrada,
    intervencoes: [],
    salvo: true
  };
}
