'use client';

import { useSharedProfile } from '@/components/ProfileProvider';
import { AcompanhamentoProcessos } from '@/components/AcompanhamentoProcessos';

export default function Processos() {
  const { profile } = useSharedProfile();
  const isConsultante = profile.role === 'cliente';

  return (
    <div className="bf-page [--bf-page-max:72rem]">
      <header className="bf-page-titulo">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-white">{isConsultante ? 'Processos acompanhados' : 'Meus processos'}</h1>
        <p className="mb-0 mt-2 text-white/60">
          {isConsultante
            ? 'Processos ligados ao seu CPF/CNPJ, localizados nas suas consultas.'
            : 'Processos localizados nas suas pesquisas.'}
        </p>
      </header>

      <div data-tour="proc-acompanhados">
        <AcompanhamentoProcessos />
      </div>
    </div>
  );
}
