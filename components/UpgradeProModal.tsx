'use client';

import { useState } from 'react';
import { Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  Crown,
  Sparkles,
  MessageCircle,
  FileText,
  Check,
  ShieldCheck,
  ArrowRight,
  Zap,
  Clock
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';

interface UpgradeProModalProps {
  opened: boolean;
  onClose: () => void;
  motivo?: string;
  onSucesso?: () => void;
}

export function UpgradeProModal({ opened, onClose, motivo, onSucesso }: UpgradeProModalProps) {
  const { refresh } = useSharedProfile();
  const [ativando, setAtivando] = useState(false);

  const ativarPlanoPro = async () => {
    setAtivando(true);
    try {
      const res = await authFetch('/api/planos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plano: 'pro' })
      });

      if (!res.ok) {
        throw new Error('Falha ao processar ativação do plano Pro.');
      }

      await refresh();

      notifications.show({
        title: 'Plano Pro Ativado!',
        message: 'Acompanhamento no WhatsApp, Smart Digest e Agente IA 24h liberados na sua conta.',
        color: 'green',
        autoClose: 5000
      });

      onSucesso?.();
      onClose();
    } catch (err) {
      notifications.show({
        title: 'Não foi possível ativar',
        message: err instanceof Error ? err.message : 'Tente novamente em instantes.',
        color: 'red',
        autoClose: 5000
      });
    } finally {
      setAtivando(false);
    }
  };

  const RECURSOS_PRO = [
    {
      titulo: 'WhatsApp Conversacional 24h',
      descricao: 'Converse com o Agente Jurídico com IA direto no WhatsApp sobre qualquer processo da sua carteira.',
      icone: MessageCircle
    },
    {
      titulo: 'Smart Digest Anti-Spam',
      descricao: 'Urgências e penhoras avisadas imediatamente; atos burocráticos consolidados na sexta-feira.',
      icone: Sparkles
    },
    {
      titulo: 'Leitura de Intimações e Fotos',
      descricao: 'Envie fotos de mandados ou PDFs recebidos: nossa IA analisa prazos e riscos na hora.',
      icone: FileText
    },
    {
      titulo: 'Até 50 Processos Monitorados',
      descricao: 'Capacidade expandida para acompanhar toda a sua carteira pessoal ou de clientes.',
      icone: Zap
    },
    {
      titulo: 'Varredura Contínua por CPF/CNPJ',
      descricao: 'Alerta instantâneo no seu celular assim que uma nova ação for distribuída contra seu nome.',
      icone: ShieldCheck
    }
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="lg"
      withCloseButton={false}
      styles={{
        content: {
          backgroundColor: '#15161a',
          border: '1px solid rgba(232, 213, 176, 0.3)',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)'
        },
        body: { padding: '28px' }
      }}
    >
      <div className="relative">
        {/* Badge Superior */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#e8d5b0]/40 bg-[#e8d5b0]/10 px-3 py-1 text-xs font-semibold text-[#f6e7cc]">
          <Crown size={14} className="text-[#e8d5b0]" />
          <span>JusConsulta Pro</span>
        </div>

        <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">
          Desbloqueie o Poder Máximo do JusConsulta
        </h2>

        {motivo ? (
          <p className="mt-1 text-sm text-[#e8d5b0]">{motivo}</p>
        ) : (
          <p className="mt-1 text-sm text-white/60">
            Acompanhamento processual de alta fidelidade com inteligência artificial conversacional no WhatsApp.
          </p>
        )}

        {/* Lista de Vantagens */}
        <div className="mt-5 space-y-3">
          {RECURSOS_PRO.map((item, idx) => {
            const Icon = item.icone;
            return (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-colors hover:border-white/10"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#e8d5b0]/30 bg-[#e8d5b0]/10 text-[#e8d5b0]">
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-white">{item.titulo}</h4>
                  <p className="text-[11px] leading-relaxed text-white/60">{item.descricao}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Card de Preço & CTA */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-xs text-white/50">R$</span>
            <span className="font-mono text-3xl font-bold text-white">79,90</span>
            <span className="text-xs text-white/50">/mês</span>
          </div>
          <p className="mt-0.5 text-[11px] text-white/40">Cancele quando quiser. Sem fidelidade.</p>

          <button
            type="button"
            disabled={ativando}
            onClick={ativarPlanoPro}
            className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#e8d5b0] to-[#c7b288] py-3 text-sm font-bold text-[#15161a] shadow-lg transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ativando ? (
              <span className="inline-flex items-center gap-2">
                <Clock size={16} className="animate-spin" />
                Ativando...
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Crown size={16} />
                Ativar Plano Pro Agora
                <ArrowRight size={14} />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mt-2.5 inline-block cursor-pointer text-xs text-white/40 hover:text-white/70"
          >
            Continuar no plano Gratuito
          </button>
        </div>
      </div>
    </Modal>
  );
}
