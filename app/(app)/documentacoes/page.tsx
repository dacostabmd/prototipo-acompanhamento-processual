import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import SpotlightCard from '@/components/SpotlightCard';

export const metadata: Metadata = { title: 'Documentações' };

const paginas = [
  {
    href: '/documentacoes/autenticacao',
    title: 'Autenticação',
    text: 'Medidas de autenticação e controle de acesso implementadas, e gaps conhecidos.',
    icon: ShieldCheck
  }
];

export default function Documentacoes() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-12">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Documentações</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-slate-500">
          Documentação técnica interna do Prosec.
        </p>
      </header>
      <section aria-label="Páginas" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {paginas.map(({ href, title, text, icon: Icon }) => (
          <SpotlightCard key={href} href={href}>
            <span className="bf-spot-icon">
              <Icon size={24} strokeWidth={1.7} />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{text}</p>
          </SpotlightCard>
        ))}
      </section>
    </div>
  );
}
