import { EquipeEscritorio } from '@/components/equipe/EquipeEscritorio';

export default function Equipe() {
  return (
    <div className="bf-page [--bf-page-max:72rem]">
      <header className="bf-page-titulo">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-white">Equipe</h1>
        <p className="mb-0 mt-2 text-white/60">Convide colegas e acompanhem os processos e o Diário juntos, em modo leitura.</p>
      </header>

      <EquipeEscritorio />
    </div>
  );
}
