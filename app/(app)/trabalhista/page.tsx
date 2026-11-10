'use client';

import { BuscaTrabalhista } from '@/components/trabalhista/BuscaTrabalhista';

export default function Trabalhista() {
  return (
    <div className="bf-page [--bf-page-max:72rem]">
      <header className="bf-page-titulo mb-8">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-white">Processos trabalhistas</h1>
        <p className="mb-0 mt-2 text-white/60">
          Busca rápida e gratuita por CNPJ ou nome de empresa nas publicações dos TRTs, como o TRT1 do Rio de Janeiro.
        </p>
      </header>

      <BuscaTrabalhista />
    </div>
  );
}
