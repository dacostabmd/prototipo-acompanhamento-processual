'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Zap } from 'lucide-react';
import BuscaRapidaModal from '@/components/BuscaRapidaModal';

/**
 * Busca rápida da Visão geral: o campo leva o CPF/CNPJ ou número CNJ para /consulta (que abre preenchido) e o botão
 * "Busca rápida" abre o modal para escolher os tribunais do CPF/CNPJ.
 */
export default function BuscaRapidaPainel() {
  const router = useRouter();
  const [valor, setValor] = useState('');
  const [modalAberto, setModalAberto] = useState(false);

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const digitos = valor.replace(/\D/g, '');
    router.push(digitos ? `/consulta?busca=${digitos}` : '/consulta');
  };

  return (
    <>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
        <form onSubmit={enviar} role="search" className="flex min-w-0 flex-1 gap-2 sm:w-auto sm:flex-none">
          <label className="relative min-w-0 flex-1 sm:w-80">
            <span className="sr-only">Consultar por CPF ou número CNJ</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45" aria-hidden="true" />
            <input
              value={valor}
              onChange={e => setValor(e.target.value)}
              inputMode="numeric"
              placeholder="Consultar por CPF ou número CNJ"
              className="h-10 w-full rounded-lg border border-tt-line bg-tt-surface pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#1E7CF2]"
            />
          </label>
          <button
            type="submit"
            className="h-10 shrink-0 cursor-pointer rounded-lg bg-[#1E6FE8] px-4 text-sm font-semibold !text-white transition-colors hover:bg-[#2B7BF2]"
          >
            Consultar
          </button>
        </form>
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          className="inline-flex h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#1E7CF2]/50 bg-transparent px-4 text-sm font-semibold text-white transition-colors hover:border-[#1E7CF2] hover:bg-[#1E7CF2]/15 sm:w-auto"
        >
          <Zap size={15} className="text-[#1E7CF2]" />
          Busca rápida
        </button>
      </div>

      <BuscaRapidaModal opened={modalAberto} onClose={() => setModalAberto(false)} />
    </>
  );
}
