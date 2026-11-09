'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Gavel, Sparkles } from 'lucide-react';
import { Destaque } from './Destaque';
import { formatarDataBR, formatarNumeroProcesso, nomePropio, type ItemJurisprudencia } from './utils';

export function CartaoJulgado({ item, onExplicar }: { item: ItemJurisprudencia; onExplicar: (item: ItemJurisprudencia) => void }) {
  const [copiado, setCopiado] = useState(false);

  const copiarReferencia = async () => {
    try {
      await navigator.clipboard.writeText(item.referencia);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // Sem permissão de área de transferência: o usuário ainda pode selecionar o texto.
    }
  };

  const titulo = [item.classe, formatarNumeroProcesso(item.numero)].filter(Boolean).join(' ');
  const meta = [
    item.relator ? `Rel. Min. ${nomePropio(item.relator)}` : null,
    item.orgaoJulgador,
    item.dataJulgamento ? `Julgado em ${formatarDataBR(item.dataJulgamento)}` : null
  ].filter(Boolean) as string[];

  return (
    <article className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="m-0 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1E7CF2]">
            <Gavel size={13} strokeWidth={1.8} />
            {item.tribunal}
            <span className="font-medium normal-case tracking-normal text-white/50">
              {item.tipo === 'acordao' ? 'Acórdão' : item.tipo === 'decisao_monocratica' ? 'Decisão monocrática' : item.tipo}
            </span>
          </p>
          <h3 className="m-0 mt-1 break-words text-base font-semibold text-white sm:text-lg">{titulo || 'Julgado'}</h3>
        </div>
        <span
          className="shrink-0 rounded-full border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[color:var(--tt-text-2)]"
          title="Relevância para a sua busca"
        >
          {Math.round(item.score * 100)}% relevante
        </span>
      </header>

      {meta.length > 0 && <p className="mb-0 mt-1.5 text-xs text-white/60">{meta.join(' · ')}</p>}

      <p className="mb-0 mt-3 break-words text-sm leading-relaxed text-white/80">
        <Destaque texto={item.trecho} termos={item.termos} />
      </p>

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onExplicar(item)}
          className="bf-btn-sec inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#1E7CF2]/50 bg-[#1E7CF2]/15 px-3.5 py-2 text-xs font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25"
        >
          <Sparkles size={14} className="text-[#1E7CF2]" />
          Explicar em linguagem simples
        </button>
        <button
          type="button"
          onClick={copiarReferencia}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
          title={item.referencia}
        >
          {copiado ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copiado ? 'Copiado' : 'Copiar citação'}
        </button>
        {item.fonteUrl && (
          <a
            href={item.fonteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70 no-underline transition hover:bg-white/10"
          >
            <ExternalLink size={14} />
            Inteiro teor no {item.tribunal}
          </a>
        )}
      </footer>
    </article>
  );
}
