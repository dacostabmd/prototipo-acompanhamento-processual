'use client';

import { BuscaJurisprudencia } from '@/components/jurisprudencia/BuscaJurisprudencia';

export default function Jurisprudencia() {
  return (
    <div className="bf-page [--bf-page-max:72rem]">
      <header className="bf-page-titulo">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-white">Jurisprudência</h1>
        <p className="mb-0 mt-2 text-white/60">
          Encontre julgados pelo sentido do que você procura e peça uma explicação em linguagem simples.
        </p>
      </header>

      <BuscaJurisprudencia />
    </div>
  );
}
