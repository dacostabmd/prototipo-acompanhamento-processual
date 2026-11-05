import type { Metadata } from 'next';
import PainelInsights from '@/components/PainelInsights';
import BuscaRapidaPainel from '@/components/BuscaRapidaPainel';

export const metadata: Metadata = { title: 'Visão geral' };

export default function Painel() {
  return (
    <div className="bf-page [--bf-page-max:80rem]">
      <header className="bf-page-titulo flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-3xl font-bold tracking-tight text-white">Visão geral</h1>
          <p className="mb-0 mt-1 text-[15px] leading-relaxed text-white/60">Bem-vindo ao acompanhamento processual do JusConsulta.</p>
        </div>
        <div className="bf-page-titulo-acoes w-full sm:w-auto">
          <BuscaRapidaPainel />
        </div>
      </header>

      {/* Duas colunas no desktop: atenção e movimentações à esquerda; resumo, saldo e atalhos à direita. */}
      <PainelInsights />
    </div>
  );
}
