'use client';

import { useEffect, useState } from 'react';
import { Checkbox, Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { BookmarkPlus, Check, Gavel, Receipt } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { formatarReais } from '@/lib/infosimplesPricing';

export interface ProcessoParaSalvar {
  numero: string;
  /** consultaId recebido no evento 'started' da busca que encontrou o processo. */
  consultaId: string;
  tribunal?: string;
  classe?: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  processos: ProcessoParaSalvar[];
  /** Custo cobrado nas consultas desta busca (exibido no dialog). */
  custoBusca: number;
  onSalvo?: (numeros: string[]) => void;
}

/**
 * Dialog que abre ao fim da busca: pergunta se o usuário quer salvar os processos encontrados em
 * Meus processos. Só os confirmados passam a ser acompanhados (cron noturno, alertas, Visão geral).
 */
export default function SalvarProcessosModal({ opened, onClose, processos, custoBusca, onSalvo }: Props) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (opened) setMarcados(new Set(processos.map(p => p.numero)));
  }, [opened, processos]);

  const alternar = (numero: string) =>
    setMarcados(prev => {
      const novo = new Set(prev);
      if (novo.has(numero)) novo.delete(numero);
      else novo.add(numero);
      return novo;
    });

  const salvar = async () => {
    const itens = processos.filter(p => marcados.has(p.numero)).map(p => ({ numero: p.numero, consultaId: p.consultaId }));
    if (itens.length === 0) return onClose();
    setSalvando(true);
    try {
      const res = await authFetch('/api/processos/salvar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Não foi possível salvar agora.');

      const salvos: string[] = d.salvos ?? [];
      const jaSalvos: string[] = d.jaSalvos ?? [];
      const fora: string[] = d.foraDoLimite ?? [];
      const naoEncontrados: string[] = d.naoEncontrados ?? [];
      const partes = [
        salvos.length ? `${salvos.length} salvo(s) em Meus processos.` : '',
        jaSalvos.length ? `${jaSalvos.length} já estava(m) salvo(s).` : '',
        fora.length ? `${fora.length} fora do limite do plano (${d.limite} processos).` : '',
        naoEncontrados.length ? `${naoEncontrados.length} ainda não registrado(s); tente de novo em instantes.` : ''
      ].filter(Boolean);
      notifications.show({
        title: salvos.length ? 'Processos salvos' : 'Nada novo para salvar',
        message: partes.join(' '),
        color: fora.length || naoEncontrados.length ? 'yellow' : 'blue'
      });
      onSalvo?.([...salvos, ...jaSalvos]);
      onClose();
    } catch (e: any) {
      notifications.show({ title: 'Não foi possível salvar', message: e?.message ?? 'Tente novamente.', color: 'red' });
    } finally {
      setSalvando(false);
    }
  };

  const total = marcados.size;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="lg"
      size="lg"
      title={
        <span className="inline-flex items-center gap-2 font-semibold text-white">
          <BookmarkPlus size={18} className="text-[#1E7CF2]" />
          Salvar em Meus processos?
        </span>
      }
    >
      <p className="text-sm leading-relaxed text-white/70">
        Os processos salvos ficam na sua conta: conferimos todas as noites, avisamos quando houver novidade e eles aparecem nos
        insights da Visão geral.
      </p>

      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
        <Receipt size={13} className="text-[#1E7CF2]" />
        Custo desta pesquisa: <strong className="text-white">{formatarReais(custoBusca)}</strong>
      </div>

      <ul className="mt-4 max-h-72 list-none space-y-2 overflow-y-auto pl-0">
        {processos.map(p => (
          <li key={`${p.consultaId}-${p.numero}`}>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition hover:border-[#1E7CF2]/40">
              <Checkbox checked={marcados.has(p.numero)} onChange={() => alternar(p.numero)} mt={2} aria-label={`Salvar ${p.numero}`} />
              <span className="min-w-0">
                <span className="inline-flex items-center gap-1.5 break-all text-sm font-medium text-white">
                  <Gavel size={14} className="shrink-0 text-white/40" />
                  {p.numero}
                </span>
                {(p.tribunal || p.classe) && (
                  <span className="block text-xs text-white/50">{[p.tribunal, p.classe].filter(Boolean).join(' · ')}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="bf-btn-sec cursor-pointer rounded-xl px-4 py-2 text-sm">
          Agora não
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || total === 0}
          className="bf-btn-ouro inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={15} />
          {salvando ? 'Salvando...' : `Salvar ${total} processo${total === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
