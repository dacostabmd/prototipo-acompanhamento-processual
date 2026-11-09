'use client';

import Link from 'next/link';
import { CalendarClock, CheckCircle2, Circle, ClipboardList, Gavel, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { digitosCnj, diaDaSemanaTexto, formatarData, ROTULO_TIPO, urgenciaDe, type PrazoAgenda, type TipoPrazo } from './agendaUtil';

const ICONE_TIPO = { prazo: Gavel, tarefa: ClipboardList, audiencia: CalendarClock } as const satisfies Record<TipoPrazo, unknown>;

interface Props {
  prazo: PrazoAgenda;
  hoje: string;
  ocupado?: boolean;
  onAlternarConcluido: (prazo: PrazoAgenda) => void;
  onEditar: (prazo: PrazoAgenda) => void;
  onExcluir: (prazo: PrazoAgenda) => void;
}

export function PrazoCard({ prazo, hoje, ocupado, onAlternarConcluido, onEditar, onExcluir }: Props) {
  const urgencia = urgenciaDe(prazo, hoje);
  const Icone = ICONE_TIPO[prazo.tipo];

  return (
    <article className={`flex gap-3 rounded-2xl border p-3.5 sm:p-4 ${urgencia.borda} ${urgencia.fundo}`}>
      <button
        type="button"
        onClick={() => onAlternarConcluido(prazo)}
        disabled={ocupado}
        aria-label={prazo.concluido ? `Reabrir: ${prazo.titulo}` : `Concluir: ${prazo.titulo}`}
        title={prazo.concluido ? 'Reabrir' : 'Marcar como concluído'}
        className="mt-0.5 h-7 w-7 shrink-0 cursor-pointer self-start rounded-full text-white/50 transition hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {prazo.concluido ? <CheckCircle2 size={24} className="text-emerald-400" /> : <Circle size={24} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className={`m-0 min-w-0 break-words text-[15px] font-semibold text-white ${prazo.concluido ? 'line-through opacity-60' : ''}`}>
            {prazo.titulo}
          </h3>
          <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${urgencia.texto}`}>
            <span className={`h-2 w-2 rounded-full ${urgencia.ponto}`} aria-hidden />
            {urgencia.rotulo}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
          <span className="inline-flex items-center gap-1">
            <Icone size={13} aria-hidden />
            {ROTULO_TIPO[prazo.tipo]}
          </span>
          <span>
            {formatarData(prazo.dataVencimento)} ({diaDaSemanaTexto(prazo.dataVencimento)})
          </span>
          {prazo.numeroCnj && (
            <Link
              href={`/processo/${digitosCnj(prazo.numeroCnj)}`}
              className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] text-[color:var(--tt-champagne-500)] underline-offset-2 hover:underline"
            >
              <Gavel size={12} aria-hidden />
              {prazo.numeroCnj}
            </Link>
          )}
          {prazo.origem !== 'manual' && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--tt-text-2)]"
              title="Data estimada automaticamente a partir de uma movimentação. Confira no processo."
            >
              <Sparkles size={10} aria-hidden />
              Automático
            </span>
          )}
        </div>

        {prazo.descricao && <p className="mb-0 mt-2 line-clamp-3 break-words text-xs leading-relaxed text-white/50">{prazo.descricao}</p>}
      </div>

      <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-start">
        <button
          type="button"
          onClick={() => onEditar(prazo)}
          aria-label={`Editar: ${prazo.titulo}`}
          title="Editar"
          className="cursor-pointer rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          onClick={() => onExcluir(prazo)}
          aria-label={`Excluir: ${prazo.titulo}`}
          title="Excluir"
          className="cursor-pointer rounded-lg p-1.5 text-white/40 transition hover:bg-red-400/10 hover:text-red-300"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}
