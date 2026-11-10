import { PecasPage } from '@/components/pecas/PecasPage';

export default function Pecas() {
  return (
    <div className="bf-page [--bf-page-max:72rem]">
      <header className="bf-page-titulo mb-8">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-white">Modelos de peças</h1>
        <p className="mb-0 mt-2 text-white/60">
          Gere minutas de contestação, réplica, recursos e petições com IA, a partir dos seus fatos e dos seus processos, com jurisprudência real da base.
        </p>
      </header>

      <PecasPage />
    </div>
  );
}
