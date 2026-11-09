'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Info,
  Loader2,
  Printer,
  Save,
  Trash2,
  TriangleAlert
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { AVISO, conteudoParaTexto, listarPendencias, montarConteudo, nomeArquivo, parsearSecoes, type SecaoPeca } from '@/lib/pecas/formato';
import type { PecaCompleta } from '@/lib/pecas/tipos';
import { abrirImpressao, baixarTxt, BOTAO_SEC, CAMPO, nomeDoTipo, type PecaEditavel } from './pecasUi';

const ROTULO_INTERVENCAO: Record<string, string> = {
  julgado_removido: 'Julgado fora da base removido',
  julgado_corrigido: 'Referência de julgado ajustada à da base',
  dado_inventado: 'Dado que não constava na entrada',
  lei_conferir: 'Lei para conferir',
  artigo_conferir: 'Artigo para conferir',
  sumula_conferir: 'Súmula ou tema para conferir',
  nome_conferir: 'Nome para conferir',
  secao_ausente: 'Seção que a IA não gerou'
};

/** Textarea que cresce com o conteúdo (sem barra de rolagem interna). */
function AreaAutomatica({ id, valor, onChange }: { id: string; valor: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [valor]);
  return <textarea ref={ref} id={id} value={valor} onChange={e => onChange(e.target.value)} rows={3} className={`mt-1.5 resize-none leading-relaxed ${CAMPO}`} />;
}

export function EditorPeca({
  peca,
  onNova,
  onAtualizada,
  onDuplicada,
  onExcluida
}: {
  peca: PecaEditavel;
  onNova: () => void;
  onAtualizada: (p: PecaCompleta) => void;
  onDuplicada: (p: PecaCompleta) => void;
  onExcluida: () => void;
}) {
  const [titulo, setTitulo] = useState(peca.titulo);
  const [secoes, setSecoes] = useState<SecaoPeca[]>(() => parsearSecoes(peca.conteudo));
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState<'duplicar' | 'excluir' | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [correcoesAbertas, setCorrecoesAbertas] = useState(false);
  const [sujo, setSujo] = useState(false);

  // Reabrir outra peça ou gerar uma nova reinicia o editor.
  useEffect(() => {
    setTitulo(peca.titulo);
    setSecoes(parsearSecoes(peca.conteudo));
    setSujo(false);
  }, [peca]);

  const conteudoAtual = useMemo(() => montarConteudo(secoes), [secoes]);
  const pendencias = useMemo(() => listarPendencias(conteudoAtual), [conteudoAtual]);
  const julgados = peca.entrada?.julgadosUsados ?? [];
  const porTipo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const i of peca.intervencoes) mapa.set(i.tipo, (mapa.get(i.tipo) ?? 0) + 1);
    return [...mapa.entries()];
  }, [peca.intervencoes]);

  const editar = (i: number, texto: string) => {
    setSecoes(s => s.map((x, k) => (k === i ? { ...x, texto } : x)));
    setSujo(true);
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(conteudoParaTexto(conteudoAtual));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      notifications.show({ title: 'Não foi possível copiar', message: 'Selecione o texto e copie manualmente.', color: 'red' });
    }
  };

  const salvar = async () => {
    if (!peca.id) return;
    setSalvando(true);
    try {
      const res = await authFetch(`/api/pecas/${peca.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo: titulo.trim() || peca.titulo, conteudo: conteudoAtual })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Não foi possível salvar.');
      setSujo(false);
      onAtualizada(d.peca as PecaCompleta);
      notifications.show({ title: 'Alterações salvas', message: 'A minuta foi atualizada no histórico.', color: 'brand' });
    } catch (e) {
      notifications.show({ title: 'Falha ao salvar', message: e instanceof Error ? e.message : 'Tente novamente.', color: 'red' });
    } finally {
      setSalvando(false);
    }
  };

  const duplicar = async () => {
    if (!peca.id) return;
    setOcupado('duplicar');
    try {
      const res = await authFetch(`/api/pecas/${peca.id}/duplicar`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Não foi possível duplicar.');
      notifications.show({ title: 'Peça duplicada', message: 'A cópia está aberta para edição e no histórico.', color: 'brand' });
      onDuplicada(d.peca as PecaCompleta);
    } catch (e) {
      notifications.show({ title: 'Falha ao duplicar', message: e instanceof Error ? e.message : 'Tente novamente.', color: 'red' });
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async () => {
    if (!peca.id || !confirm('Excluir esta minuta do histórico? Essa ação não pode ser desfeita.')) return;
    setOcupado('excluir');
    try {
      const res = await authFetch(`/api/pecas/${peca.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Não foi possível excluir.');
      notifications.show({ title: 'Minuta excluída', message: 'Ela saiu do seu histórico.', color: 'brand' });
      onExcluida();
    } catch (e) {
      notifications.show({ title: 'Falha ao excluir', message: e instanceof Error ? e.message : 'Tente novamente.', color: 'red' });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onNova} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-medium text-white/60 transition hover:text-white">
            <ArrowLeft size={14} /> Nova peça
          </button>
          <span className="text-[11px] text-white/45">
            {nomeDoTipo(peca.tipo)}
            {peca.modelo ? ` · ${peca.modelo}` : ''}
            {peca.tokensEntrada + peca.tokensSaida > 0 ? ` · ${peca.tokensEntrada.toLocaleString('pt-BR')} tokens de entrada, ${peca.tokensSaida.toLocaleString('pt-BR')} de saída` : ''}
          </span>
        </div>

        <label htmlFor="peca-titulo" className="mt-3 block text-xs font-medium text-white/70">
          Título
        </label>
        <input
          id="peca-titulo"
          value={titulo}
          onChange={e => {
            setTitulo(e.target.value);
            setSujo(true);
          }}
          maxLength={200}
          className={`mt-1.5 font-semibold ${CAMPO}`}
        />

        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="button" onClick={copiar} className={BOTAO_SEC}>
            {copiado ? <Check size={16} /> : <Copy size={16} />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
          <button type="button" onClick={() => baixarTxt(nomeArquivo(titulo), conteudoParaTexto(conteudoAtual))} className={BOTAO_SEC}>
            <Download size={16} /> Baixar .txt
          </button>
          <button type="button" onClick={() => abrirImpressao(titulo, conteudoAtual, peca.id)} className={BOTAO_SEC}>
            <Printer size={16} /> Imprimir / PDF
          </button>
          {peca.id && (
            <>
              <button type="button" onClick={salvar} disabled={salvando || !sujo} className={BOTAO_SEC}>
                {salvando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Salvar alterações
              </button>
              <button type="button" onClick={duplicar} disabled={ocupado !== null} className={BOTAO_SEC}>
                {ocupado === 'duplicar' ? <Loader2 size={16} className="animate-spin" /> : <CopyPlus size={16} />}
                Duplicar
              </button>
              <button
                type="button"
                onClick={excluir}
                disabled={ocupado !== null}
                className="bf-btn-perigo inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-400/40 bg-red-400/10 px-3.5 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ocupado === 'excluir' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Excluir
              </button>
            </>
          )}
        </div>
      </section>

      <div className="flex items-start gap-2.5 rounded-3xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-200" role="note">
        <TriangleAlert size={18} className="mt-0.5 shrink-0" />
        <span>
          <strong>{AVISO}</strong>
        </span>
      </div>

      {!peca.salvo && peca.avisoHistorico && (
        <div className="flex items-start gap-2.5 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-xs text-white/65" role="status">
          <Info size={16} className="mt-0.5 shrink-0 text-[#1E7CF2]" />
          <span>{peca.avisoHistorico} Copie, baixe ou imprima a minuta antes de sair desta tela.</span>
        </div>
      )}

      {(pendencias.preencher > 0 || pendencias.conferir > 0 || peca.semJulgados || julgados.length > 0 || peca.intervencoes.length > 0) && (
        <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {pendencias.preencher > 0 && (
              <span className="rounded-full border border-[#1E7CF2]/40 bg-[#1E7CF2]/10 px-3 py-1 text-xs font-medium text-white/85">
                {pendencias.preencher} {pendencias.preencher === 1 ? 'campo' : 'campos'} [PREENCHER]
              </span>
            )}
            {pendencias.conferir > 0 && (
              <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-200">
                {pendencias.conferir} {pendencias.conferir === 1 ? 'item' : 'itens'} [CONFERIR]
              </span>
            )}
          </div>

          {peca.semJulgados && (
            <p className="mb-0 mt-3 text-xs text-white/60">
              A base de jurisprudência não devolveu julgados pertinentes ao tema. A peça foi gerada sem citar julgados; pesquise na aba Jurisprudência e inclua manualmente, se quiser.
            </p>
          )}

          {julgados.length > 0 && (
            <div className="mt-3">
              <p className="m-0 inline-flex items-center gap-1.5 text-xs font-medium text-white/75">
                <BookOpen size={14} className="text-[#1E7CF2]" /> Julgados da base entregues à IA (os únicos que podem ser citados)
              </p>
              <ul className="mb-0 mt-1.5 list-none space-y-1 p-0">
                {julgados.map(j => (
                  <li key={j.referencia} className="text-xs text-white/60">
                    {j.referencia}
                    {j.fonteUrl && (
                      <a href={j.fonteUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex cursor-pointer items-center gap-0.5 text-[#1E7CF2] hover:underline">
                        inteiro teor <ExternalLink size={11} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mb-0 mt-1.5 text-[11px] text-white/40">Confira o inteiro teor de cada julgado no site do tribunal antes de protocolar.</p>
            </div>
          )}

          {peca.intervencoes.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setCorrecoesAbertas(v => !v)}
                aria-expanded={correcoesAbertas}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-white/75 hover:text-white"
              >
                <ChevronDown size={14} className={`transition-transform ${correcoesAbertas ? 'rotate-180' : ''}`} />
                O sistema ajustou {peca.intervencoes.length} {peca.intervencoes.length === 1 ? 'trecho' : 'trechos'} da IA por segurança
              </button>
              {correcoesAbertas && (
                <ul className="mb-0 mt-2 list-none space-y-1 p-0">
                  {porTipo.map(([tipo, n]) => (
                    <li key={tipo} className="text-xs text-white/60">
                      {n}x {ROTULO_INTERVENCAO[tipo] ?? tipo}
                    </li>
                  ))}
                  <li className="pt-1 text-[11px] text-white/40">
                    Dados, julgados e nomes que não constam no que você informou ou na base viram [PREENCHER] ou [CONFERIR].
                  </li>
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <div className="space-y-5">
          {secoes.map((s, i) => (
            <div key={`${s.titulo}-${i}`}>
              <label htmlFor={`peca-secao-${i}`} className="block text-xs font-semibold uppercase tracking-wide text-[#1E7CF2]">
                {s.titulo}
              </label>
              <AreaAutomatica id={`peca-secao-${i}`} valor={s.texto} onChange={v => editar(i, v)} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
