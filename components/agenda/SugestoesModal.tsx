'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@mantine/core';
import { CalendarPlus, Gavel, Loader2, SearchCheck } from 'lucide-react';
import { formatarData, type SugestaoPrazo } from './agendaUtil';

interface Props {
  opened: boolean;
  onClose: () => void;
  /** null enquanto a varredura roda. */
  sugestoes: SugestaoPrazo[] | null;
  importando: boolean;
  onImportar: (escolhidas: SugestaoPrazo[]) => void;
}

const ROTULO_UNIDADE = { dias_uteis: 'dias úteis', dias_corridos: 'dias corridos', horas: 'horas' } as const;

export function SugestoesModal({ opened, onClose, sugestoes, importando, onImportar }: Props) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (opened && sugestoes) setMarcadas(new Set(sugestoes.map(s => s.origemHash)));
  }, [opened, sugestoes]);

  const alternar = (hash: string) =>
    setMarcadas(atual => {
      const novo = new Set(atual);
      if (novo.has(hash)) novo.delete(hash);
      else novo.add(hash);
      return novo;
    });

  const escolhidas = (sugestoes ?? []).filter(s => marcadas.has(s.origemHash));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="lg"
      size="lg"
      title={
        <span className="inline-flex items-center gap-2 font-semibold text-white">
          <SearchCheck size={18} className="text-[#1E7CF2]" />
          Prazos encontrados nas movimentações
        </span>
      }
    >
      {sugestoes === null ? (
        <div className="flex items-center gap-2 py-8 text-sm text-white/60">
          <Loader2 size={18} className="animate-spin text-[#1E7CF2]" />
          Lendo as movimentações dos últimos 60 dias dos seus processos...
        </div>
      ) : sugestoes.length === 0 ? (
        <p className="py-6 text-sm text-white/60">
          Nenhum prazo novo encontrado. Só aparecem prazos que ainda não venceram e que ainda não estão na sua agenda.
        </p>
      ) : (
        <>
          <p className="mb-3 mt-0 text-xs text-white/60">
            Datas estimadas pela regra do CPC (dias úteis, sem fins de semana, feriados nacionais e o recesso de 20/12 a 20/01). Prazo em dobro e
            feriados locais não entram na conta: confira cada data no processo.
          </p>
          <ul className="m-0 grid max-h-[55vh] list-none gap-2 overflow-y-auto p-0 pr-1">
            {sugestoes.map(s => (
              <li key={s.origemHash}>
                <label className="flex cursor-pointer gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-[#1E7CF2]/40">
                  <input
                    type="checkbox"
                    checked={marcadas.has(s.origemHash)}
                    onChange={() => alternar(s.origemHash)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[#1E7CF2]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold text-white">{s.titulo}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
                      <span className="font-semibold text-[color:var(--tt-champagne-500)]">Vence em {formatarData(s.dataVencimento)}</span>
                      <span>
                        {s.quantidade} {ROTULO_UNIDADE[s.unidade]} a partir de {formatarData(s.dataBase)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <Gavel size={12} aria-hidden />
                        {s.numeroCnj}
                      </span>
                    </span>
                    <span className="mt-1 block break-words text-[11px] italic text-white/40">&ldquo;{s.trecho}&rdquo;</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="bf-btn-sec cursor-pointer rounded-xl px-4 py-2 text-sm">
          {sugestoes && sugestoes.length > 0 ? 'Cancelar' : 'Fechar'}
        </button>
        {sugestoes && sugestoes.length > 0 && (
          <button
            type="button"
            disabled={importando || escolhidas.length === 0}
            onClick={() => onImportar(escolhidas)}
            className="bf-btn-ouro inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importando ? <Loader2 size={15} className="animate-spin" /> : <CalendarPlus size={15} />}
            Adicionar {escolhidas.length} à agenda
          </button>
        )}
      </div>
    </Modal>
  );
}
