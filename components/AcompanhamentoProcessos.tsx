'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Drawer, Switch } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { AnimatePresence, motion } from 'motion/react';
import {
  Banknote,
  Bell,
  BellRing,
  Building2,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Clock,
  Crown,
  Gavel,
  History,
  Landmark,
  Mail,
  MessageCircle,
  Scale,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  UserRound,
  Zap
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import { UpgradeProModal } from '@/components/UpgradeProModal';
import { WhatsAppSimulatorModal } from './WhatsAppSimulatorModal';
import type {
  ModoSensibilidade,
  PoloProcesso,
  ProcessoAcompanhado,
  RespostaMonitoramento,
  UrgenciaResumo,
  Notificacao
} from '@/lib/types/monitoramento';

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
// Movimentações só têm dia (AAAA-MM-DD, gravado como meia-noite UTC): no fuso local cairia no dia anterior.
const fmtDia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');
const fmtDataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const URGENCIA: Record<UrgenciaResumo, { rotulo: string; classe: string }> = {
  alta: { rotulo: 'Pode exigir ação rápida', classe: 'border-red-400/40 bg-red-400/10 text-red-200' },
  media: { rotulo: 'Movimentação relevante', classe: 'border-[#1E7CF2]/40 bg-[#1E7CF2]/10 text-[color:var(--tt-text-2)]' },
  baixa: { rotulo: 'Rotina', classe: 'border-white/15 bg-white/5 text-white/60' }
};

/** Ponto colorido por tipo de movimentação (classificação gravada na sincronização). */
const COR_MOV: Record<string, string> = {
  urgente: 'bg-red-400',
  positivo: 'bg-emerald-400',
  informativo: 'bg-[#1E7CF2]'
};

const fmtMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Distribuição pode vir como ISO (coluna) ou já como dd/mm/aaaa (metadados da fonte). */
const fmtDistribuicao = (v: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v : fmtDia(v));

/** Nome principal do polo + "e mais N" e o primeiro advogado; lista completa no tooltip. */
function Polo({ rotulo, polo }: { rotulo: string; polo: PoloProcesso }) {
  if (polo.nomes.length === 0) return null;
  const [principal, ...outros] = polo.nomes;
  return (
    <div className="min-w-0 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2" title={polo.nomes.join('\n')}>
      <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/40">
        {rotulo === 'Autor' ? <UserRound size={11} /> : <Building2 size={11} />}
        {rotulo}
      </p>
      <p className="mt-0.5 truncate text-sm text-white/85">
        {principal}
        {outros.length > 0 && <span className="text-white/45"> e mais {outros.length}</span>}
      </p>
      {polo.advogados.length > 0 && (
        <p className="mt-0.5 truncate text-[11px] text-white/45" title={polo.advogados.join('\n')}>
          Adv.: {polo.advogados[0]}
          {polo.advogados.length > 1 && ` +${polo.advogados.length - 1}`}
        </p>
      )}
    </div>
  );
}

/**
 * Todas as movimentações carregadas do processo, cada uma em duas versões: o que significa em
 * linguagem simples (IA) e o texto técnico do tribunal, para o advogado.
 */
function DrawerMovimentacoes({
  processo,
  traduzindo,
  onClose
}: {
  processo: ProcessoAcompanhado | null;
  traduzindo: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer
      opened={!!processo}
      onClose={onClose}
      position="right"
      size="lg"
      padding="lg"
      title={
        processo && (
          <span className="block">
            <span className="block text-base font-semibold text-white">{processo.numeroCnj}</span>
            <span className="block text-xs text-white/50">{[processo.tribunal, processo.classe].filter(Boolean).join(' · ')}</span>
          </span>
        )
      }
    >
      {processo && (
        <ol className="relative list-none space-y-5 border-l border-white/10 pl-5">
          {processo.movimentacoes.map(m => (
            <li key={m.id} className="relative">
              <span
                className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${COR_MOV[m.tipo ?? ''] ?? 'bg-white/30'}`}
                aria-hidden="true"
              />
              <p className="text-xs tabular-nums text-white/50">{fmtDia(m.data)}</p>

              <div className="mt-1.5 rounded-xl border border-[#1E7CF2]/25 bg-[#1E7CF2]/[0.06] px-3 py-2.5">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#1E7CF2]">
                  <Sparkles size={11} />
                  Em linguagem simples
                </p>
                <p className={`mt-1 text-sm leading-relaxed text-white/85 ${!m.traducao && traduzindo ? 'animate-pulse' : ''}`}>
                  {m.traducao ?? (traduzindo ? 'Traduzindo...' : 'Tradução indisponível no momento.')}
                </p>
              </div>

              <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                  <Scale size={11} />
                  Texto do tribunal (para advogados)
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-white/65">{m.textoOriginal}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {processo && (
        <p className="mt-6 text-[11px] text-white/40">Tradução gerada por IA. Não substitui a orientação do seu advogado.</p>
      )}
    </Drawer>
  );
}

type Canal = 'notificarEmail' | 'notificarWhatsapp';

/** Formato único dos botões de ação da seção (cor vem de bf-btn-ouro = principal ou bf-btn-sec = secundário). */
const BOTAO_ACAO =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold whitespace-nowrap';

/**
 * Acompanhamento em "Meus processos": alertas recentes (ap_notificacoes) e, por processo monitorado,
 * o último resumo IA e os canais de aviso (e-mail / WhatsApp). Cards em vez de tabela para caber no
 * celular.
 */
export function AcompanhamentoProcessos() {
  const [dados, setDados] = useState<RespostaMonitoramento | null>(null);
  const { profile } = useSharedProfile();
  const [modalProAberto, setModalProAberto] = useState(false);
  const [modalSimulatorAberto, setModalSimulatorAberto] = useState(false);
  const [motivoPro, setMotivoPro] = useState<string | undefined>();
  const [erroCarga, setErroCarga] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [salvando, setSalvando] = useState<Record<string, boolean>>({});
  const [testandoWhatsapp, setTestandoWhatsapp] = useState<Record<string, boolean>>({});
  const [erroCanal, setErroCanal] = useState<{ processoId: string; mensagem: string; semTelefone: boolean } | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [traduzindo, setTraduzindo] = useState(false);

  /** Pede ao servidor a tradução leiga das movimentações que ainda não têm e aplica na tela. */
  const traduzirPendentes = useCallback((d: RespostaMonitoramento) => {
    const processoIds = d.processos.filter(p => p.movimentacoes.some(m => !m.traducao)).map(p => p.processoId);
    if (processoIds.length === 0) return;
    setTraduzindo(true);
    authFetch('/api/monitoramento/traduzir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processoIds })
    })
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then(({ traducoes }: { traducoes: Record<string, string> }) =>
        setDados(atual =>
          atual && {
            ...atual,
            processos: atual.processos.map(p => ({
              ...p,
              movimentacoes: p.movimentacoes.map(m => (traducoes[m.id] ? { ...m, traducao: traducoes[m.id] } : m))
            }))
          }
        )
      )
      .catch(() => undefined)
      .finally(() => setTraduzindo(false));
  }, []);

  useEffect(() => {
    authFetch('/api/monitoramento')
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((d: RespostaMonitoramento) => {
        setDados(d);
        traduzirPendentes(d);
      })
      .catch(() => {
        setErroCarga(true);
        setDados({ processos: [], telefoneValido: false });
      });
    authFetch('/api/notificacoes')
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((d: { notificacoes: Notificacao[]; naoLidas: number }) => {
        setNotificacoes(d.notificacoes ?? []);
        setNaoLidas(d.naoLidas ?? 0);
      })
      .catch(() => undefined);
  }, [traduzirPendentes]);

  const alternarCanal = useCallback(async (processo: ProcessoAcompanhado, canal: Canal, valor: boolean) => {
    // Paywall do WhatsApp: exclusivo para assinantes do Plano Pro
    if (canal === 'notificarWhatsapp' && valor && profile.plano !== 'pro') {
      setMotivoPro('O acompanhamento e o Agente Jurídico com IA 24h via WhatsApp são exclusivos do Plano Pro.');
      setModalProAberto(true);
      return;
    }

    const chave = `${processo.processoId}:${canal}`;
    setErroCanal(null);
    setSalvando(s => ({ ...s, [chave]: true }));
    const aplicar = (v: boolean) =>
      setDados(d => d && { ...d, processos: d.processos.map(p => (p.processoId === processo.processoId ? { ...p, [canal]: v } : p)) });
    aplicar(valor); // otimista; desfeito se o servidor recusar

    try {
      const res = await authFetch('/api/monitoramento', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processoId: processo.processoId, [canal]: valor })
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        aplicar(!valor);
        setErroCanal({
          processoId: processo.processoId,
          mensagem: corpo.error ?? 'Não foi possível salvar a preferência.',
          semTelefone: corpo.codigo === 'sem_telefone'
        });
      }
    } catch {
      aplicar(!valor);
      setErroCanal({ processoId: processo.processoId, mensagem: 'Sem conexão. Tente de novo.', semTelefone: false });
    } finally {
      setSalvando(s => ({ ...s, [chave]: false }));
    }
  }, []);

  const marcarTodasComoLidas = useCallback(async () => {
    const anteriores = notificacoes;
    setNotificacoes(n => n.map(x => ({ ...x, lida: true })));
    setNaoLidas(0);
    const res = await authFetch('/api/notificacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todas: true })
    }).catch(() => null);
    if (!res?.ok) {
      setNotificacoes(anteriores);
      setNaoLidas(anteriores.filter(n => !n.lida).length);
    }
  }, [notificacoes]);

  const testarEnvioWhatsApp = useCallback(async (processoId: string) => {
    setTestandoWhatsapp(s => ({ ...s, [processoId]: true }));
    try {
      const res = await authFetch('/api/whatsapp/testar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processoId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao enviar mensagem de teste');
      }
      notifications.show({
        title: 'Alerta enviado!',
        message: 'Resumo com IA gerado pelo Agente e enviado ao seu WhatsApp.',
        color: 'green',
        autoClose: 5000
      });
    } catch (err: unknown) {
      notifications.show({
        title: 'Não foi possível enviar',
        message: err instanceof Error ? err.message : 'Verifique se o celular com DDD está salvo no seu perfil.',
        color: 'red',
        autoClose: 6000
      });
    } finally {
      setTestandoWhatsapp(s => ({ ...s, [processoId]: false }));
    }
  }, []);

  const alterarSensibilidade = useCallback(async (processo: ProcessoAcompanhado, novaSensibilidade: ModoSensibilidade) => {
    if (processo.sensibilidade === novaSensibilidade) return;
    const anterior = processo.sensibilidade;
    setDados(d =>
      d
        ? {
            ...d,
            processos: d.processos.map(p => (p.processoId === processo.processoId ? { ...p, sensibilidade: novaSensibilidade } : p))
          }
        : null
    );

    try {
      const res = await authFetch('/api/monitoramento', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processoId: processo.processoId, sensibilidade: novaSensibilidade })
      });
      if (!res.ok) throw new Error();
      notifications.show({
        title: 'Filtro de alertas atualizado',
        message:
          novaSensibilidade === 'smart_digest'
            ? 'Smart Digest ativado: urgências na hora e rotina consolidada na sexta-feira.'
            : novaSensibilidade === 'todas'
            ? 'Notificação imediata para todas as movimentações.'
            : 'Apenas urgências críticas e riscos patrimoniais serão notificados.',
        color: 'brand',
        autoClose: 4000
      });
    } catch {
      setDados(d =>
        d
          ? {
              ...d,
              processos: d.processos.map(p => (p.processoId === processo.processoId ? { ...p, sensibilidade: anterior } : p))
            }
          : null
      );
      notifications.show({
        title: 'Falha ao atualizar',
        message: 'Não foi possível salvar o filtro agora. Tente novamente.',
        color: 'red',
        autoClose: 4000
      });
    }
  }, []);

  if (!dados) {
    return (
      <div className="bf-paper mt-10 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/60 backdrop-blur-md">
        Carregando acompanhamento…
      </div>
    );
  }

  return (
    <>
      {notificacoes.length > 0 && (
        <section className="bf-paper mt-10 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
              {naoLidas > 0 ? <BellRing size={18} strokeWidth={1.8} className="text-[#1E7CF2]" /> : <Bell size={18} strokeWidth={1.8} className="text-white/50" />}
              Alertas recentes
              {naoLidas > 0 && (
                <span className="rounded-full bg-[#1E7CF2] px-2 py-0.5 text-xs font-semibold text-[#FFFFFF]">{naoLidas} novo(s)</span>
              )}
            </h2>
            {naoLidas > 0 && (
              <button
                type="button"
                onClick={marcarTodasComoLidas}
                className="bf-btn-sec inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:border-[#1E7CF2]/50 hover:text-white"
              >
                <CheckCheck size={14} />
                Marcar todos como lidos
              </button>
            )}
          </div>
          <ul className="mt-4 list-none space-y-2 pl-0">
            {notificacoes.slice(0, 8).map(n => (
              <li
                key={n.id}
                className={`rounded-2xl border px-4 py-3 ${n.lida ? 'border-white/5 bg-white/[0.02]' : 'border-[#1E7CF2]/25 bg-[#1E7CF2]/[0.06]'}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className={`text-sm font-medium ${n.lida ? 'text-white/70' : 'text-white'}`}>{n.titulo}</p>
                  <span className="text-xs text-white/40">{fmtDataHora(n.criadaEm)}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-white/60">{n.mensagem}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bf-paper mt-10 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-xl sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
              <Sparkles size={18} strokeWidth={1.8} className="text-[#1E7CF2]" />
              Acompanhamento
            </h2>
            <p className="mt-1 text-xs text-white/50">
              Conferimos seus processos todas as noites. Quando algo muda, você recebe um resumo em linguagem simples pelos canais que escolher.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setModalSimulatorAberto(true)}
              title="Veja como os alertas chegam no WhatsApp, sem enviar nada de verdade"
              className={`bf-btn-sec ${BOTAO_ACAO}`}
            >
              <MessageCircle size={15} className="text-[#25d366]" aria-hidden="true" />
              <span>Simular no WhatsApp</span>
            </button>

            {profile.plano === 'pro' ? (
              <span className={`${BOTAO_ACAO} cursor-default border border-[#1E7CF2]/40 bg-[#1E7CF2]/10 text-[color:var(--tt-text-2)]`}>
                <Crown size={15} className="text-[#1E7CF2]" aria-hidden="true" />
                Plano Pro ativo
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMotivoPro(undefined);
                  setModalProAberto(true);
                }}
                className={`bf-btn-ouro ${BOTAO_ACAO}`}
              >
                <Crown size={15} aria-hidden="true" />
                <span>Assinar o Pro</span>
              </button>
            )}
          </div>
        </div>

        {!dados.telefoneValido && dados.processos.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60 sm:inline-flex">
            <MessageCircle size={14} className="mt-px shrink-0 text-white/40" />
            <span>
              Para receber pelo WhatsApp, cadastre seu celular com DDD no{' '}
              <Link href="/perfil" className="cursor-pointer font-medium text-[#1E7CF2] underline-offset-2 hover:underline">
                perfil
              </Link>
              .
            </span>
          </p>
        )}

        {erroCarga && <p className="mt-4 text-sm text-white/60">Não foi possível carregar o acompanhamento agora.</p>}
        {!erroCarga && dados.processos.length === 0 && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#25d366]/15 text-[#25d366]">
              <MessageCircle size={24} />
            </div>
            <h3 className="mt-3 text-base font-semibold text-white">Nenhum processo acompanhado ainda</h3>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/60">
              Ao pesquisar um processo na tela de busca ou consulta, você pode ativá-lo no WhatsApp com 1 clique.
              Nosso Copiloto Jurídico traduz intimações e te avisa 24h por dia.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const res = await authFetch('/api/processos/seed-demo', { method: 'POST' });
                  if (res.ok) window.location.reload();
                }}
                className={`bf-btn-ouro ${BOTAO_ACAO}`}
              >
                <Sparkles size={15} aria-hidden="true" />
                <span>Carregar processos de exemplo</span>
              </button>
              <button
                type="button"
                onClick={() => setModalSimulatorAberto(true)}
                className={`bf-btn-sec ${BOTAO_ACAO}`}
              >
                <MessageCircle size={15} className="text-[#25d366]" aria-hidden="true" />
                <span>Simular no WhatsApp</span>
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-3">
          {dados.processos.map((p, index) => (
            <motion.article
              key={p.processoId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.5), ease: [0.22, 1, 0.36, 1] }}
              className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)] md:gap-6"
            >
              {/* Coluna esquerda: dados do processo */}
              <div className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1.5 break-all font-medium text-white">
                    <Gavel size={15} strokeWidth={1.8} className="shrink-0 text-white/40" />
                    {p.numeroCnj}
                  </p>
                  <p className="mt-0.5 text-xs text-white/50">
                    {[p.tribunal, p.classe].filter(Boolean).join(' · ') || 'Tribunal não informado'}
                  </p>
                  {p.assunto && <p className="mt-0.5 text-xs text-white/70">{p.assunto}</p>}
                </div>
                {p.resumo?.urgencia && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${URGENCIA[p.resumo.urgencia].classe}`}>
                    {p.resumo.urgencia === 'alta' && <TriangleAlert size={12} />}
                    {URGENCIA[p.resumo.urgencia].rotulo}
                  </span>
                )}
              </div>

              {(p.poloAtivo.nomes.length > 0 || p.poloPassivo.nomes.length > 0) && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Polo rotulo="Autor" polo={p.poloAtivo} />
                  <Polo rotulo="Réu" polo={p.poloPassivo} />
                </div>
              )}

              {(p.vara || p.distribuidoEm || p.valorCausa != null) && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-white/55">
                  {p.vara && (
                    <span className="inline-flex min-w-0 items-center gap-1.5" title={p.vara}>
                      <Landmark size={12} className="shrink-0 text-white/35" />
                      <span className="line-clamp-1">{p.vara}</span>
                    </span>
                  )}
                  {p.distribuidoEm && (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={12} className="text-white/35" />
                      Distribuído em {fmtDistribuicao(p.distribuidoEm)}
                    </span>
                  )}
                  {p.valorCausa != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <Banknote size={12} className="text-white/35" />
                      {fmtMoeda(p.valorCausa)}
                    </span>
                  )}
                </div>
              )}

              {p.movimentacoes.length > 0 && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setAbertoId(p.processoId)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setAbertoId(p.processoId);
                    }
                  }}
                  aria-label={`Ver movimentações do processo ${p.numeroCnj}`}
                  className="group -mx-2 mt-3 cursor-pointer rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/40">
                      <History size={12} />
                      Últimas movimentações
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-white/40 transition-colors group-hover:text-[#1E7CF2]">
                      Ver detalhes
                      <ChevronRight size={12} />
                    </span>
                  </span>
                  <ul className="mt-1.5 list-none space-y-1 pl-0">
                    {p.movimentacoes.slice(0, 3).map(m => (
                      <li key={m.id} className="flex min-w-0 items-baseline gap-2 text-xs">
                        <span className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${COR_MOV[m.tipo ?? ''] ?? 'bg-white/30'}`} />
                        <span className="shrink-0 tabular-nums text-white/45">{fmtDia(m.data)}</span>
                        {m.traducao ? (
                          <span className="min-w-0 line-clamp-2 text-white/80" title={m.traducao}>
                            {m.traducao}
                          </span>
                        ) : (
                          <span className={`min-w-0 truncate text-white/55 ${traduzindo ? 'animate-pulse' : ''}`} title={m.titulo}>
                            {m.titulo}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {p.resumo ? (
                <div className="mt-3 space-y-1.5 text-sm leading-relaxed">
                  <p className="text-white/80">{p.resumo.resumo}</p>
                  {p.resumo.proximoPasso && (
                    <p className="text-white/60">
                      <span className="font-medium text-[#1E7CF2]">Próximo passo: </span>
                      {p.resumo.proximoPasso}
                    </p>
                  )}
                  <p className="text-[11px] text-white/35">Resumo gerado por IA em {fmtData(p.resumo.criadoEm)}. Não substitui a orientação do seu advogado.</p>
                </div>
              ) : p.movimentacoes.length === 0 ? (
                <p className="mt-3 text-sm text-white/50">Sem movimentação nova desde que começamos a acompanhar.</p>
              ) : null}

              <p className="mt-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-[11px] text-white/40">
                <span>Últ. movimentação: {fmtDia(p.ultimaMovimentacaoEm)}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  Próxima conferência: {p.proximaConsultaEm ? fmtData(p.proximaConsultaEm) : 'esta noite'}
                </span>
              </p>
              </div>

              {/* Coluna direita: canais e frequência dos alertas */}
              <div className="min-w-0 border-t border-white/5 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <Switch
                    size="sm"
                    color="brand"
                    checked={p.notificarEmail}
                    disabled={salvando[`${p.processoId}:notificarEmail`]}
                    onChange={e => alternarCanal(p, 'notificarEmail', e.currentTarget.checked)}
                    label={
                      <span className="inline-flex items-center gap-1.5 text-sm text-white/80">
                        <Mail size={14} /> E-mail
                      </span>
                    }
                    styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                  />
                  <Switch
                    size="sm"
                    color="brand"
                    checked={p.notificarWhatsapp}
                    disabled={salvando[`${p.processoId}:notificarWhatsapp`]}
                    onChange={e => alternarCanal(p, 'notificarWhatsapp', e.currentTarget.checked)}
                    label={
                      <span className="inline-flex items-center gap-1.5 text-sm text-white/80">
                        <MessageCircle size={14} /> WhatsApp
                      </span>
                    }
                    styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                  />
                </div>

                {(p.notificarEmail || p.notificarWhatsapp) && (
                  <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/80">
                        <SlidersHorizontal size={13} className="text-[#1E7CF2]" />
                        Frequência de alertas
                      </span>
                      <span className="text-[11px] text-white/40">
                        {p.sensibilidade === 'smart_digest'
                          ? 'Anti-spam inteligente'
                          : p.sensibilidade === 'todas'
                          ? 'Instantâneo'
                          : 'Apenas crítico'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => alterarSensibilidade(p, 'smart_digest')}
                        className={`inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border py-1.5 px-2 text-center transition-all ${
                          p.sensibilidade === 'smart_digest'
                            ? 'border-[#1E7CF2]/60 bg-[#1E7CF2]/15 text-[color:var(--tt-text-2)] shadow-sm'
                            : 'border-white/5 bg-white/[0.02] text-white/50 hover:border-white/15 hover:text-white/80'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1 text-[11px] font-medium">
                          <Sparkles size={11} className={p.sensibilidade === 'smart_digest' ? 'text-[#1E7CF2]' : 'text-white/40'} />
                          Smart Digest
                        </div>
                        <span className="text-[10px] text-white/40">Recomendado</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => alterarSensibilidade(p, 'todas')}
                        className={`inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border py-1.5 px-2 text-center transition-all ${
                          p.sensibilidade === 'todas'
                            ? 'border-[#1E7CF2]/60 bg-[#1E7CF2]/15 text-[color:var(--tt-text-2)] shadow-sm'
                            : 'border-white/5 bg-white/[0.02] text-white/50 hover:border-white/15 hover:text-white/80'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1 text-[11px] font-medium">
                          <Zap size={11} className={p.sensibilidade === 'todas' ? 'text-[#1E7CF2]' : 'text-white/40'} />
                          Todas
                        </div>
                        <span className="text-[10px] text-white/40">Sem filtro</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => alterarSensibilidade(p, 'urgentes_apenas')}
                        className={`inline-flex flex-col items-center justify-center gap-0.5 rounded-lg border py-1.5 px-2 text-center transition-all ${
                          p.sensibilidade === 'urgentes_apenas'
                            ? 'border-[#1E7CF2]/60 bg-[#1E7CF2]/15 text-[color:var(--tt-text-2)] shadow-sm'
                            : 'border-white/5 bg-white/[0.02] text-white/50 hover:border-white/15 hover:text-white/80'
                        }`}
                      >
                        <div className="inline-flex items-center gap-1 text-[11px] font-medium">
                          <ShieldAlert size={11} className={p.sensibilidade === 'urgentes_apenas' ? 'text-[#1E7CF2]' : 'text-white/40'} />
                          Urgências
                        </div>
                        <span className="text-[10px] text-white/40">Apenas risco</span>
                      </button>
                    </div>
                  </div>
                )}

                {p.notificarWhatsapp && (
                  <div className="mt-5 flex justify-center">
                    <button
                      type="button"
                      disabled={testandoWhatsapp[p.processoId]}
                      onClick={() => testarEnvioWhatsApp(p.processoId)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--tt-text-2)] transition-colors hover:bg-[#1E7CF2]/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send size={12} className={testandoWhatsapp[p.processoId] ? 'animate-pulse' : ''} />
                      {testandoWhatsapp[p.processoId] ? 'Enviando...' : 'Testar WhatsApp'}
                    </button>
                  </div>
                )}
                <AnimatePresence>
                  {erroCanal?.processoId === p.processoId && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 text-xs text-red-200"
                    >
                      {erroCanal.mensagem}{' '}
                      {erroCanal.semTelefone && (
                        <Link href="/perfil" className="cursor-pointer font-medium text-[#1E7CF2] underline underline-offset-2">
                          Ir para o perfil
                        </Link>
                      )}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      <DrawerMovimentacoes
        processo={dados.processos.find(p => p.processoId === abertoId) ?? null}
        traduzindo={traduzindo}
        onClose={() => setAbertoId(null)}
      />

      <UpgradeProModal
        opened={modalProAberto}
        onClose={() => setModalProAberto(false)}
        motivo={motivoPro}
      />

      <WhatsAppSimulatorModal
        opened={modalSimulatorAberto}
        onClose={() => setModalSimulatorAberto(false)}
        processoIdPadrao={dados?.processos?.[0]?.processoId}
      />
    </>
  );
}
