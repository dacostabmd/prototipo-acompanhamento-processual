'use client';

import { useCallback, useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { FileText, FolderOpen, Info, Loader2, CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import type { PecaCompleta, PecaResumo } from '@/lib/pecas/tipos';
import { BOTAO_SEC, fmtDataHora, nomeDoTipo } from './pecasUi';

export function HistoricoPecas({
  recarregar,
  onAbrir
}: {
  /** Muda quando o histórico precisa ser relido (peça gerada, duplicada ou excluída em outra aba da tela). */
  recarregar: number;
  onAbrir: (p: PecaCompleta) => void;
}) {
  const [pecas, setPecas] = useState<PecaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await authFetch('/api/pecas');
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Não foi possível carregar o histórico.');
      setPecas(d.pecas ?? []);
      setAviso(d.historicoIndisponivel ? d.avisoHistorico || 'O histórico ainda não está disponível neste ambiente.' : null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregar]);

  const acao = async (id: string, tipo: 'abrir' | 'duplicar' | 'excluir') => {
    if (tipo === 'excluir' && !confirm('Excluir esta minuta do histórico? Essa ação não pode ser desfeita.')) return;
    setOcupada(id);
    try {
      const res = await authFetch(tipo === 'duplicar' ? `/api/pecas/${id}/duplicar` : `/api/pecas/${id}`, { method: tipo === 'abrir' ? 'GET' : tipo === 'duplicar' ? 'POST' : 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Não foi possível concluir a ação.');
      if (tipo === 'excluir') {
        setPecas(p => p.filter(x => x.id !== id));
        notifications.show({ title: 'Minuta excluída', message: 'Ela saiu do seu histórico.', color: 'brand' });
      } else {
        if (tipo === 'duplicar') notifications.show({ title: 'Peça duplicada', message: 'A cópia está aberta para edição.', color: 'brand' });
        onAbrir(d.peca as PecaCompleta);
      }
    } catch (e) {
      notifications.show({ title: 'Falha', message: e instanceof Error ? e.message : 'Tente novamente.', color: 'red' });
    } finally {
      setOcupada(null);
    }
  };

  if (carregando) {
    return (
      <div className="space-y-3" role="status" aria-label="Carregando histórico">
        {[0, 1, 2].map(i => (
          <div key={i} className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="h-4 w-1/2 rounded bg-white/10" />
            <div className="mt-3 h-3 w-1/3 rounded bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  if (erro) {
    return <div className="rounded-3xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">{erro}</div>;
  }

  if (aviso) {
    return (
      <div className="flex items-start gap-2.5 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/70">
        <Info size={17} className="mt-0.5 shrink-0 text-[#1E7CF2]" />
        <span>{aviso}</span>
      </div>
    );
  }

  if (pecas.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <FolderOpen size={26} className="mx-auto text-white/35" />
        <p className="mb-0 mt-3 text-sm font-medium text-white/75">Você ainda não gerou nenhuma peça.</p>
        <p className="mb-0 mt-1 text-xs text-white/50">As minutas geradas ficam salvas aqui para reabrir, duplicar ou excluir.</p>
      </div>
    );
  }

  return (
    <ul className="m-0 list-none space-y-3 p-0">
      {pecas.map(p => (
        <li key={p.id} className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 inline-flex items-start gap-2 break-words text-sm font-semibold text-white">
                <FileText size={16} className="mt-0.5 shrink-0 text-[#1E7CF2]" />
                <span className="min-w-0 break-words">{p.titulo}</span>
              </p>
              <p className="mb-0 mt-1 text-xs text-white/50">
                {nomeDoTipo(p.tipo)}
                {p.processoNumero ? ` · Processo ${p.processoNumero}` : ''} · {fmtDataHora(p.createdAt)}
              </p>
              {p.tokensEntrada + p.tokensSaida > 0 && (
                <p className="mb-0 mt-0.5 text-[11px] text-white/35">
                  {p.modelo ?? 'IA'} · {(p.tokensEntrada + p.tokensSaida).toLocaleString('pt-BR')} tokens
                </p>
              )}
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-2">
              <button type="button" onClick={() => acao(p.id, 'abrir')} disabled={ocupada === p.id} className={BOTAO_SEC} aria-label={`Abrir ${p.titulo}`}>
                {ocupada === p.id ? <Loader2 size={15} className="animate-spin" /> : <Pencil size={15} />}
                <span className="hidden sm:inline">Abrir</span>
              </button>
              <button type="button" onClick={() => acao(p.id, 'duplicar')} disabled={ocupada === p.id} className={BOTAO_SEC} aria-label={`Duplicar ${p.titulo}`}>
                <CopyPlus size={15} />
                <span className="hidden sm:inline">Duplicar</span>
              </button>
              <button
                type="button"
                onClick={() => acao(p.id, 'excluir')}
                disabled={ocupada === p.id}
                aria-label={`Excluir ${p.titulo}`}
                className="bf-btn-perigo inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-400/40 bg-red-400/10 px-3.5 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={15} />
                <span className="hidden sm:inline">Excluir</span>
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
