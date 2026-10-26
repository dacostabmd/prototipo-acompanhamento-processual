'use client';

import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { motion } from 'motion/react';
import {
  Crown,
  Check,
  Zap,
  Sparkles,
  MessageCircle,
  ShieldCheck,
  FileSearch,
  Fingerprint,
  Headphones,
  HelpCircle,
  Loader2,
  ArrowRight
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import { UpgradeProModal } from '@/components/UpgradeProModal';

const RECURSOS_COMPARATIVOS = [
  {
    nome: 'Processos monitorados simultâneos',
    free: 'Até 2 processos',
    pro: 'Até 50 processos',
    destaque: true
  },
  {
    nome: 'Agente Jurídico 24/7 no WhatsApp (LangChain)',
    free: false,
    pro: true,
    destaque: true
  },
  {
    nome: 'Smart Digest Anti-Spam (Sexta-feira)',
    free: false,
    pro: true,
    destaque: true
  },
  {
    nome: 'Leitura Multimodal de Intimações e Fotos (Vision OCR)',
    free: false,
    pro: true,
    destaque: true
  },
  {
    nome: 'Radar Contínuo de Novos Processos (CPF/CNPJ)',
    free: false,
    pro: true,
    destaque: true
  },
  {
    nome: 'Resumo com IA em Linguagem Humana',
    free: 'Básico (Web)',
    pro: 'Completo (Web + WhatsApp)',
    destaque: false
  },
  {
    nome: 'Detecção de Risco Patrimonial e Sisbajud',
    free: true,
    pro: true,
    destaque: false
  },
  {
    nome: 'Notificações por E-mail',
    free: true,
    pro: true,
    destaque: false
  },
  {
    nome: 'Observabilidade & Tracing (Langfuse v3)',
    free: false,
    pro: true,
    destaque: false
  },
  {
    nome: 'Suporte Prioritário por Especialista',
    free: false,
    pro: true,
    destaque: false
  }
];

const FAQS = [
  {
    pergunta: 'Como funciona o cancelamento do Plano Pro?',
    resposta: 'Você pode cancelar a qualquer momento em 1 clique, sem carência, sem multas contratuais e sem pegadinhas. Ao cancelar, você mantém o acesso Pro até o final do período vigente.'
  },
  {
    pergunta: 'Como funciona o envio de fotos de intimações pelo WhatsApp?',
    resposta: 'Basta tirar uma foto ou encaminhar o PDF da notificação ou mandado judicial para o nosso número no WhatsApp. Nossa visão computacional com IA analisa o documento em segundos, identifica prazos em dias úteis pelo CPC e explica o que deve ser feito.'
  },
  {
    pergunta: 'O Smart Digest substitui meu advogado?',
    resposta: 'Não. O JusConsulta v2.0 traduz o andamento burocrático para linguagem didática e orienta seus próximos passos, mas nunca substitui o aconselhamento jurídico formal de um advogado devidamente inscrito na OAB.'
  },
  {
    pergunta: 'O sistema cobre todos os tribunais do Brasil?',
    resposta: 'Sim. Cobrimos todos os 27 Tribunais de Justiça estaduais, os 6 Tribunais Regionais Federais (TRFs), todos os 24 Tribunais Regionais do Trabalho (TRTs), STJ, TST e STF via integração oficial DataJud e diários de justiça.'
  }
];

export default function PlanosPage() {
  const { profile, refresh } = useSharedProfile();
  const [modalProAberto, setModalProAberto] = useState(false);
  const [atualizando, setAtualizando] = useState(false);

  const isPro = profile.plano === 'pro';

  const handleMudarPlano = async (novoPlano: 'free' | 'pro') => {
    if (novoPlano === 'pro') {
      setModalProAberto(true);
      return;
    }

    if (!confirm('Tem certeza de que deseja voltar para o Plano Gratuito? Os alertas no WhatsApp e a varredura contínua de CPF serão pausados.')) {
      return;
    }

    setAtualizando(true);
    try {
      const res = await authFetch('/api/planos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plano: 'free' })
      });
      if (!res.ok) throw new Error();

      notifications.show({
        title: 'Plano alterado',
        message: 'Você retornou para o Plano Gratuito.',
        color: 'brand'
      });
      await refresh();
    } catch {
      notifications.show({
        title: 'Erro ao alterar',
        message: 'Não foi possível alterar seu plano agora.',
        color: 'red'
      });
    } finally {
      setAtualizando(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-12">
      <header className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1E7CF2]/40 bg-[#1E7CF2]/10 px-3.5 py-1 text-xs font-semibold text-[color:var(--tt-text-2)]">
          <Sparkles size={13} className="text-[#1E7CF2]" />
          Planos Transparentes
        </span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Acompanhamento Processual com Inteligência de Verdade
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-white/60">
          Chega de alertas frios de Diário Oficial e sustos de penhora. Escolha a tranquilidade de ter um assistente jurídico no seu WhatsApp.
        </p>
      </header>

      {/* Grid de Planos */}
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {/* Card Plano Gratuito */}
        <div
          className={`relative flex flex-col justify-between rounded-3xl border p-6 backdrop-blur-xl sm:p-8 ${
            !isPro ? 'border-white/20 bg-white/5 ring-1 ring-white/10' : 'border-white/10 bg-white/[0.02]'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wider text-white/60">Gratuito</span>
              {!isPro && (
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-0.5 text-xs font-medium text-white">
                  Seu Plano Atual
                </span>
              )}
            </div>

            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight text-white">R$ 0</span>
              <span className="text-sm text-white/40">/ mês</span>
            </div>
            <p className="mt-2 text-xs text-white/50">Para quem quer apenas consultar e testar a plataforma.</p>

            <ul className="mt-6 space-y-3 text-sm text-white/70">
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-white/40" />
                <span>Até 2 processos monitorados</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-white/40" />
                <span>Consultas públicas DataJud ilimitadas</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-white/40" />
                <span>Notificações por e-mail</span>
              </li>
              <li className="flex items-center gap-2.5 text-white/35">
                <span className="h-4 w-4 shrink-0 rounded-full border border-white/15" />
                <span>Sem WhatsApp conversacional com IA</span>
              </li>
              <li className="flex items-center gap-2.5 text-white/35">
                <span className="h-4 w-4 shrink-0 rounded-full border border-white/15" />
                <span>Sem Smart Digest semanal</span>
              </li>
              <li className="flex items-center gap-2.5 text-white/35">
                <span className="h-4 w-4 shrink-0 rounded-full border border-white/15" />
                <span>Sem leitura de intimações por foto</span>
              </li>
              <li className="flex items-center gap-2.5 text-white/35">
                <span className="h-4 w-4 shrink-0 rounded-full border border-white/15" />
                <span>Sem radar de novos processos por CPF</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4 border-t border-white/5">
            {isPro ? (
              <button
                type="button"
                disabled={atualizando}
                onClick={() => handleMudarPlano('free')}
                className="w-full cursor-pointer rounded-xl border border-white/15 bg-white/5 py-2.5 text-center text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                Voltar para o Gratuito
              </button>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-center text-sm font-medium text-white/50">
                Plano em uso
              </div>
            )}
          </div>
        </div>

        {/* Card Plano Pro */}
        <div
          className={`relative flex flex-col justify-between rounded-3xl border p-6 shadow-2xl backdrop-blur-xl sm:p-8 ${
            isPro
              ? 'border-[#1E7CF2]/60 bg-gradient-to-b from-[#1E7CF2]/15 to-white/5 ring-1 ring-[#1E7CF2]/40'
              : 'border-[#1E7CF2]/40 bg-gradient-to-b from-[#1E7CF2]/10 to-white/5 ring-1 ring-[#1E7CF2]/20'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-[#1E7CF2]">
                <Crown size={15} />
                Plano Pro
              </span>
              <span className="rounded-full border border-[#1E7CF2]/50 bg-[#1E7CF2]/20 px-3 py-0.5 text-xs font-semibold text-[color:var(--tt-text-2)]">
                {isPro ? 'Plano Ativo' : 'Mais Popular'}
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight text-white">R$ 79,90</span>
              <span className="text-sm text-white/50">/ mês</span>
            </div>
            <p className="mt-2 text-xs text-[color:var(--tt-text-2)]/80">Para clientes e advogados que exigem acompanhamento completo e sem ruído.</p>

            <ul className="mt-6 space-y-3 text-sm text-white">
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-[#1E7CF2]" />
                <span className="font-medium text-white">Até 50 processos monitorados</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-[#1E7CF2]" />
                <span>
                  <strong className="text-white">WhatsApp Conversacional 24/7</strong>: tire dúvidas com o Agente Jurídico por mensagem
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-[#1E7CF2]" />
                <span>
                  <strong className="text-white">Smart Digest Anti-Spam</strong>: urgências na hora e rotina consolidada às sextas
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-[#1E7CF2]" />
                <span>
                  <strong className="text-white">Leitura Multimodal de Intimações</strong>: envie fotos/PDFs no WhatsApp para decifrar prazos CPC
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-[#1E7CF2]" />
                <span>
                  <strong className="text-white">Radar de Novos Processos</strong>: alerta imediato de novas ações distribuídas no seu CPF/CNPJ
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-[#1E7CF2]" />
                <span>Detecção proativa de bloqueios judiciais (Sisbajud)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check size={16} className="shrink-0 text-[#1E7CF2]" />
                <span>Suporte prioritário da equipe</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4 border-t border-white/10">
            {isPro ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[#1E7CF2]/40 bg-[#1E7CF2]/20 py-2.5 text-center text-sm font-semibold text-[color:var(--tt-text-2)]">
                <ShieldCheck size={16} className="text-[#1E7CF2]" />
                Você já é assinante Pro
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleMudarPlano('pro')}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#1E7CF2]/80 bg-[#1E7CF2] py-3 text-center text-sm font-bold text-[#FFFFFF] shadow-lg transition-all hover:bg-[#eddcb9]"
              >
                <span>Fazer Upgrade para Pro</span>
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabela de Comparação */}
      <section className="mt-16 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl sm:p-8">
        <h2 className="text-xl font-bold text-white">Comparativo Detalhado de Recursos</h2>
        <p className="mt-1 text-xs text-white/50">Veja todas as diferenças entre os planos lado a lado.</p>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/40">
                <th className="pb-3 font-semibold">Recurso</th>
                <th className="pb-3 text-center font-semibold">Gratuito</th>
                <th className="pb-3 text-center font-semibold text-[#1E7CF2]">Pro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {RECURSOS_COMPARATIVOS.map((r, i) => (
                <tr key={i} className="hover:bg-white/[0.02]">
                  <td className="py-3.5 pr-4 text-white/80">
                    <span className={r.destaque ? 'font-medium text-white' : ''}>{r.nome}</span>
                  </td>
                  <td className="py-3.5 text-center text-white/60">
                    {typeof r.free === 'boolean' ? (
                      r.free ? (
                        <Check size={16} className="mx-auto text-white/60" />
                      ) : (
                        <span className="text-white/20">—</span>
                      )
                    ) : (
                      <span>{r.free}</span>
                    )}
                  </td>
                  <td className="py-3.5 text-center text-[color:var(--tt-text-2)]">
                    {typeof r.pro === 'boolean' ? (
                      r.pro ? (
                        <Check size={16} className="mx-auto text-[#1E7CF2]" />
                      ) : (
                        <span className="text-white/20">—</span>
                      )
                    ) : (
                      <span className="font-semibold text-[#1E7CF2]">{r.pro}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="mt-16">
        <h2 className="inline-flex items-center gap-2 text-xl font-bold text-white">
          <HelpCircle size={20} className="text-[#1E7CF2]" />
          Dúvidas Frequentes
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {FAQS.map((faq, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="text-sm font-semibold text-white">{faq.pergunta}</h3>
              <p className="mt-2 text-xs leading-relaxed text-white/60">{faq.resposta}</p>
            </div>
          ))}
        </div>
      </section>

      <UpgradeProModal
        opened={modalProAberto}
        onClose={() => setModalProAberto(false)}
      />
    </div>
  );
}
