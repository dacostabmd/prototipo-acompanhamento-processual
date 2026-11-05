'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@mantine/core';
import { AlertTriangle, Check, Coins, Search, ShieldCheck } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { formatarReais } from '@/lib/infosimplesPricing';
import { formatarTokens, reaisParaTokens } from '@/lib/tokens';

export interface ResumoBusca {
  /** "Número do processo", "CPF", "CNPJ" ou "Nome da parte". */
  tipo: string;
  /** O que será pesquisado (já formatado para exibir). */
  termo: string;
  /** Documentos extras (botão "+"), já formatados. */
  extras?: string[];
  /** Custo máximo previsto em APIs pagas, em reais. */
  custoReais: number;
  /** true quando o custo é teto (várias fontes em sequência: pode sair menor). */
  custoEhTeto: boolean;
  qtdFontesPagas: number;
  qtdFontesGratuitas: number;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  onConfirmar: () => void;
  resumo: ResumoBusca | null;
}

/**
 * Dialog antes de iniciar a busca: confirma o que será pesquisado e quanto vai custar em tokens
 * (custo previsto das APIs pagas convertido por lib/tokens.ts), comparando com o saldo do mês.
 */
export default function ConfirmarBuscaModal({ opened, onClose, onConfirmar, resumo }: Props) {
  const [saldoReais, setSaldoReais] = useState<number | null>(null);

  useEffect(() => {
    if (!opened) return;
    setSaldoReais(null);
    authFetch('/api/planos')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const restante = d?.consumo?.restanteReais;
        if (typeof restante === 'number') setSaldoReais(restante);
      })
      .catch(() => {});
  }, [opened]);

  if (!resumo) return null;

  const tokens = reaisParaTokens(resumo.custoReais);
  const saldoTokens = saldoReais === null ? null : reaisParaTokens(saldoReais);
  const semSaldo = saldoTokens !== null && tokens > saldoTokens;
  const gratuita = tokens === 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="lg"
      size="md"
      title={
        <span className="inline-flex items-center gap-2 font-semibold text-white">
          <Search size={18} className="text-[#1E7CF2]" />
          Confirmar pesquisa
        </span>
      }
    >
      <dl className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/20 text-sm">
        <div className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
          <dt className="text-white/50">{resumo.tipo}</dt>
          <dd className="break-all text-right font-medium text-white">{resumo.termo}</dd>
        </div>
        {!!resumo.extras?.length && (
          <div className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
            <dt className="text-white/50">Documentos adicionais</dt>
            <dd className="text-right text-white/80">{resumo.extras.join(', ')}</dd>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
          <dt className="text-white/50">Fontes</dt>
          <dd className="text-right text-white/80">
            {resumo.qtdFontesPagas} paga{resumo.qtdFontesPagas === 1 ? '' : 's'} · {resumo.qtdFontesGratuitas} gratuita
            {resumo.qtdFontesGratuitas === 1 ? '' : 's'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded-2xl border border-[#1E7CF2]/30 bg-[#1E7CF2]/[0.07] p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm text-white/70">
            <Coins size={16} className="text-[#1E7CF2]" />
            Custo {resumo.custoEhTeto && !gratuita ? 'máximo' : 'previsto'}
          </span>
          <span className="text-xl font-bold text-white">{gratuita ? 'Gratuita' : formatarTokens(tokens)}</span>
        </div>
        {!gratuita && (
          <p className="mt-1 text-right text-xs text-white/50">equivale a {formatarReais(resumo.custoReais)} em consultas aos tribunais</p>
        )}
        {saldoTokens !== null && (
          <p className="mt-3 border-t border-white/10 pt-3 text-xs text-white/60">
            Saldo do mês: <strong className="text-white">{formatarTokens(saldoTokens)}</strong>
            {!gratuita && !semSaldo && <> · depois desta pesquisa: até {formatarTokens(saldoTokens - tokens)}</>}
          </p>
        )}
      </div>

      <ul className="mt-4 list-none space-y-1.5 pl-0 text-xs text-white/60">
        {resumo.custoEhTeto && !gratuita && (
          <li className="flex gap-2">
            <ShieldCheck size={14} className="mt-px shrink-0 text-emerald-400" />
            Os sistemas são consultados em sequência e a busca para quando acha o processo: o gasto real pode ser menor.
          </li>
        )}
        <li className="flex gap-2">
          <ShieldCheck size={14} className="mt-px shrink-0 text-emerald-400" />
          Só é descontado o que os tribunais cobrarem de fato. Fontes que não responderem não consomem tokens.
        </li>
        {semSaldo && (
          <li className="flex gap-2 text-amber-300">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            O custo previsto passa do seu saldo do mês.
          </li>
        )}
      </ul>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="bf-btn-sec cursor-pointer rounded-xl px-4 py-2 text-sm">
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          className="bf-btn-ouro inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold"
        >
          <Check size={15} />
          {gratuita ? 'Pesquisar' : `Pesquisar por ${formatarTokens(tokens)}`}
        </button>
      </div>
    </Modal>
  );
}
