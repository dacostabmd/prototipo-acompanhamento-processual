'use client';

import { useState } from 'react';
import { Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import confetti from 'canvas-confetti';
import {
  Crown,
  Sparkles,
  MessageCircle,
  FileText,
  Check,
  ShieldCheck,
  ArrowRight,
  Zap,
  Clock,
  QrCode,
  CreditCard,
  Copy,
  Lock
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
  const [metodoPagamento, setMetodoPagamento] = useState<'pix' | 'cartao'>('pix');
  const [copiadoPix, setCopiadoPix] = useState(false);

  // Payload simulado de Pix Copia e Cola padrão BACEN
  const PIX_COPIA_E_COLA =
    '00020126580014br.gov.bcb.pix0136jusconsulta-assinaturas-pro@techtie.com.br520400005303986540579.905802BR5925TechTie Servicos Juridico6009SAO PAULO62070503***6304E8A2';

  const copiarPix = () => {
    navigator.clipboard.writeText(PIX_COPIA_E_COLA);
    setCopiadoPix(true);
    notifications.show({
      title: 'Código Pix copiado!',
      message: 'Abra o app do seu banco e selecione a opção Pix Copia e Cola.',
      color: 'green'
    });
    setTimeout(() => setCopiadoPix(false), 3000);
  };

  const dispararConfetti = () => {
    try {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch {
      // fallback gracioso se não suportado
    }
  };

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
      dispararConfetti();

      notifications.show({
        title: 'Plano Pro Ativado com Sucesso!',
        message: 'Acompanhamento no WhatsApp 24h, Smart Digest e Radar de Processos já estão liberados.',
        color: 'green',
        autoClose: 6000
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
          backgroundColor: 'var(--tt-ink)',
          border: '1px solid rgba(30, 124, 242, 0.3)',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)'
        },
        body: { padding: '28px' }
      }}
    >
      <div className="relative">
        {/* Badge Superior */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#1E7CF2]/40 bg-[#1E7CF2]/10 px-3 py-1 text-xs font-semibold text-[color:var(--tt-text-2)]">
          <Crown size={14} className="text-[#1E7CF2]" />
          <span>JusConsulta Pro</span>
        </div>

        <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">
          Desbloqueie o Poder Máximo do JusConsulta
        </h2>

        {motivo ? (
          <p className="mt-1 text-sm text-[#1E7CF2]">{motivo}</p>
        ) : (
          <p className="mt-1 text-sm text-white/60">
            Acompanhamento processual de alta fidelidade com inteligência artificial conversacional no WhatsApp.
          </p>
        )}

        {/* Lista de Vantagens */}
        <div className="mt-5 space-y-2.5">
          {RECURSOS_PRO.map((item, idx) => {
            const Icon = item.icone;
            return (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-2.5 transition-colors hover:border-white/10"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 text-[#1E7CF2]">
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

        {/* Escolha do Método de Pagamento */}
        <div className="mt-5">
          <div className="flex rounded-xl border border-white/10 bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={() => setMetodoPagamento('pix')}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                metodoPagamento === 'pix'
                  ? 'border border-[#1E7CF2]/40 bg-[#1E7CF2]/20 text-[#1E7CF2]'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <QrCode size={14} />
              Pix Instantâneo
            </button>
            <button
              type="button"
              onClick={() => setMetodoPagamento('cartao')}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                metodoPagamento === 'cartao'
                  ? 'border border-[#1E7CF2]/40 bg-[#1E7CF2]/20 text-[#1E7CF2]'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              <CreditCard size={14} />
              Cartão de Crédito
            </button>
          </div>

          {/* Área do Método Selecionado */}
          {metodoPagamento === 'pix' ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-center">
              <p className="text-[11px] text-white/60">
                Escaneie o QR Code ou copie o código Pix abaixo para ativação imediata:
              </p>
              <div className="mt-2.5 flex items-center justify-center">
                {/* QR Code SVG Vetorial Renderizado */}
                <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-white/20 bg-white p-2">
                  <QrCode size={92} className="text-black" />
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5">
                <span className="truncate font-mono text-[11px] text-white/70">{PIX_COPIA_E_COLA}</span>
                <button
                  type="button"
                  onClick={copiarPix}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[#1E7CF2]/40 bg-[#1E7CF2]/10 px-2.5 py-1 text-[11px] font-semibold text-[#1E7CF2] transition-colors hover:bg-[#1E7CF2]/20"
                >
                  {copiadoPix ? <Check size={12} /> : <Copy size={12} />}
                  {copiadoPix ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-left">
              <div>
                <label className="text-[11px] text-white/60">Número do Cartão</label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    placeholder="0000 0000 0000 0000"
                    maxLength={19}
                    defaultValue="4532 •••• •••• 8829"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-[#1E7CF2] focus:outline-none"
                  />
                  <Lock size={13} className="absolute top-2.5 right-3 text-white/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-white/60">Validade</label>
                  <input
                    type="text"
                    placeholder="MM/AA"
                    maxLength={5}
                    defaultValue="12/29"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-[#1E7CF2] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-white/60">CVV</label>
                  <input
                    type="text"
                    placeholder="123"
                    maxLength={4}
                    defaultValue="891"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-[#1E7CF2] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Card de Preço & CTA */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
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
            className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E7CF2] to-[#3FA0FF] py-3 text-sm font-bold text-[#FFFFFF] shadow-lg transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ativando ? (
              <span className="inline-flex items-center gap-2">
                <Clock size={16} className="animate-spin" />
                Processando pagamento...
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Crown size={16} />
                Confirmar Pagamento e Ativar Pro
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
