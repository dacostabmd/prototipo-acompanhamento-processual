'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  Loader2,
  ExternalLink,
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

interface Cobranca {
  pagamentoId: string;
  metodo: 'pix' | 'cartao';
  valor: number;
  invoiceUrl: string | null;
  pix: { imagemBase64: string; copiaECola: string; expiraEm: string | null } | null;
}

const soDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 14);

function formatarDocumento(v: string) {
  const d = soDigitos(v);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

const INTERVALO_CONSULTA_MS = 5000;

export function UpgradeProModal({ opened, onClose, motivo, onSucesso }: UpgradeProModalProps) {
  const { profile, refresh } = useSharedProfile();
  const [metodoPagamento, setMetodoPagamento] = useState<'pix' | 'cartao'>('pix');
  const [documento, setDocumento] = useState('');
  const [gerando, setGerando] = useState(false);
  const [cobranca, setCobranca] = useState<Cobranca | null>(null);
  const [vencida, setVencida] = useState(false);
  const [copiadoPix, setCopiadoPix] = useState(false);
  const concluido = useRef(false);

  const precisaDocumento = !profile.documento;

  // Ao fechar, descarta a cobrança da tela (o servidor reaproveita a pendente se o usuário voltar).
  useEffect(() => {
    if (!opened) {
      setCobranca(null);
      setVencida(false);
      concluido.current = false;
    }
  }, [opened]);

  const dispararConfetti = () => {
    try {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    } catch {}
  };

  const concluir = useCallback(async () => {
    if (concluido.current) return;
    concluido.current = true;
    await refresh();
    dispararConfetti();
    notifications.show({
      title: 'Pagamento confirmado',
      message: 'Seu Plano Pro está ativo. WhatsApp 24h, Smart Digest e Radar de Processos já estão liberados.',
      color: 'green',
      autoClose: 6000
    });
    onSucesso?.();
    onClose();
  }, [refresh, onSucesso, onClose]);

  // Enquanto há cobrança aberta, consulta o status até o Asaas confirmar.
  useEffect(() => {
    if (!opened || !cobranca) return;
    let ativo = true;
    const consultar = async () => {
      try {
        const res = await authFetch(`/api/pagamentos/assinatura?pagamento=${encodeURIComponent(cobranca.pagamentoId)}`);
        if (!res.ok || !ativo) return;
        const dados = await res.json();
        if (dados.status === 'pago') await concluir();
        else if (dados.status === 'vencido') setVencida(true);
      } catch {}
    };
    const id = window.setInterval(consultar, INTERVALO_CONSULTA_MS);
    return () => {
      ativo = false;
      window.clearInterval(id);
    };
  }, [opened, cobranca, concluir]);

  const copiarPix = async () => {
    if (!cobranca?.pix) return;
    try {
      await navigator.clipboard.writeText(cobranca.pix.copiaECola);
      setCopiadoPix(true);
      notifications.show({
        title: 'Código Pix copiado',
        message: 'Abra o app do seu banco e use a opção Pix Copia e Cola.',
        color: 'green'
      });
      setTimeout(() => setCopiadoPix(false), 3000);
    } catch {}
  };

  const gerarCobranca = async () => {
    const doc = soDigitos(documento);
    if (precisaDocumento && doc.length !== 11 && doc.length !== 14) {
      notifications.show({ title: 'CPF ou CNPJ obrigatório', message: 'Informe um CPF ou CNPJ válido para emitir a cobrança.', color: 'red' });
      return;
    }

    // O navegador bloqueia janela aberta depois de um await: abre já, preenche quando o link chegar.
    const janela = metodoPagamento === 'cartao' ? window.open('', '_blank') : null;

    setGerando(true);
    setVencida(false);
    try {
      const res = await authFetch('/api/pagamentos/assinatura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metodo: metodoPagamento, cpfCnpj: doc || undefined })
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados?.error || 'Não foi possível gerar a cobrança.');

      setCobranca(dados as Cobranca);
      if (metodoPagamento === 'cartao' && dados.invoiceUrl) {
        if (janela) janela.location.href = dados.invoiceUrl;
      } else {
        janela?.close();
      }
    } catch (err) {
      janela?.close();
      notifications.show({
        title: 'Não foi possível gerar a cobrança',
        message: err instanceof Error ? err.message : 'Tente novamente em instantes.',
        color: 'red',
        autoClose: 6000
      });
    } finally {
      setGerando(false);
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
            {(['pix', 'cartao'] as const).map(m => (
              <button
                key={m}
                type="button"
                disabled={gerando}
                onClick={() => {
                  setMetodoPagamento(m);
                  setCobranca(null);
                  setVencida(false);
                }}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                  metodoPagamento === m
                    ? 'border border-[#1E7CF2]/40 bg-[#1E7CF2]/20 text-[#1E7CF2]'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {m === 'pix' ? <QrCode size={14} /> : <CreditCard size={14} />}
                {m === 'pix' ? 'Pix' : 'Cartão de Crédito'}
              </button>
            ))}
          </div>

          {precisaDocumento && !cobranca && (
            <div className="mt-3 text-left">
              <label htmlFor="upgrade-documento" className="text-[11px] text-white/60">
                CPF ou CNPJ do titular (exigido para emitir a cobrança)
              </label>
              <input
                id="upgrade-documento"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={formatarDocumento(documento)}
                onChange={e => setDocumento(soDigitos(e.target.value))}
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-[#1E7CF2] focus:outline-none"
              />
            </div>
          )}

          {cobranca?.pix && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-center">
              <p className="text-[11px] text-white/60">Escaneie o QR Code ou copie o código Pix no app do seu banco:</p>
              <div className="mt-2.5 flex items-center justify-center">
                <img
                  src={`data:image/png;base64,${cobranca.pix.imagemBase64}`}
                  alt="QR Code Pix da assinatura Pro"
                  width={152}
                  height={152}
                  className="rounded-xl border border-white/20 bg-white p-1.5"
                />
              </div>
              <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5">
                <span className="truncate font-mono text-[11px] text-white/70">{cobranca.pix.copiaECola}</span>
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
          )}

          {cobranca && !cobranca.pix && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-center">
              <p className="text-[11px] leading-relaxed text-white/60">
                Conclua o pagamento com cartão na página segura do Asaas, aberta em outra aba. Os dados do cartão não passam pelo JusConsulta.
              </p>
              {cobranca.invoiceUrl && (
                <a
                  href={cobranca.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#1E7CF2] hover:underline"
                >
                  <ExternalLink size={13} />
                  Abrir página de pagamento
                </a>
              )}
            </div>
          )}

          {cobranca && (
            <p className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 text-[11px] text-white/50" aria-live="polite">
              {vencida ? (
                'Esta cobrança venceu. Gere uma nova para continuar.'
              ) : (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Aguardando a confirmação do pagamento. Esta janela atualiza sozinha.
                </>
              )}
            </p>
          )}
        </div>

        {/* Card de Preço & CTA */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-xs text-white/50">R$</span>
            <span className="font-mono text-3xl font-bold text-white">79,90</span>
            <span className="text-xs text-white/50">/mês</span>
          </div>
          <p className="mt-0.5 text-[11px] text-white/40">Cobrança mensal. Cancele quando quiser em Planos & Pro.</p>

          {(!cobranca || vencida) && (
            <button
              type="button"
              disabled={gerando}
              onClick={gerarCobranca}
              className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1E7CF2] to-[#3FA0FF] py-3 text-sm font-bold text-[#FFFFFF] shadow-lg transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {gerando ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Gerando cobrança...
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Crown size={16} />
                  {metodoPagamento === 'pix' ? 'Gerar Pix e assinar o Pro' : 'Pagar com cartão e assinar o Pro'}
                  <ArrowRight size={14} />
                </span>
              )}
            </button>
          )}
          <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-white/35">
            <Lock size={10} /> Pagamento processado pelo Asaas
          </p>

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
