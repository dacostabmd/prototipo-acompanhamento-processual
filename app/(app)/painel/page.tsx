import type { Metadata } from 'next';
import { Search, Gavel, MessageCircle } from 'lucide-react';
import SpotlightCard from '@/components/SpotlightCard';

export const metadata: Metadata = { title: 'Visão geral' };

const cards = [
  { href: '/consulta', title: 'Consultar processos', text: 'Busque por CPF ou número CNJ e receba o resumo em linguagem jurídica.', icon: Search },
  { href: '/processos', title: 'Meus processos', text: 'Acompanhe os processos que você monitora e suas últimas movimentações.', icon: Gavel },
  { href: '/processos', title: 'Copiloto WhatsApp 24h', text: 'Alertas automáticos a cada andamento com IA e consultoria jurídica 24h no WhatsApp.', icon: MessageCircle }
];

export default function Painel() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-12">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-white">Visão geral</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/60">
          Bem-vindo ao acompanhamento processual do JusConsulta.
        </p>
      </header>
      <section aria-label="Atalhos" className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, title, text, icon: Icon }) => (
          <SpotlightCard key={title} href={href}>
            <span className="bf-spot-icon">
              <Icon size={24} strokeWidth={1.7} />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-white/60">{text}</p>
          </SpotlightCard>
        ))}
      </section>
    </div>
  );
}
