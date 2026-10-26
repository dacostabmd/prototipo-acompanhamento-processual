'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Switch } from '@mantine/core';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, BellRing, CheckCheck, Clock, Gavel, Mail, MessageCircle, Sparkles, TriangleAlert } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import type { ProcessoAcompanhado, RespostaMonitoramento, UrgenciaResumo } from '@/app/api/monitoramento/route';
import type { Notificacao } from '@/app/api/notificacoes/route';

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
// Movimentações só têm dia (AAAA-MM-DD, gravado como meia-noite UTC): no fuso local cairia no dia anterior.
const fmtDia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');
const fmtDataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const URGENCIA: Record<UrgenciaResumo, { rotulo: string; classe: string }> = {
  alta: { rotulo: 'Pode exigir ação rápida', classe: 'border-red-400/40 bg-red-400/10 text-red-200' },
  media: { rotulo: 'Movimentação relevante', classe: 'border-[#e8d5b0]/40 bg-[#e8d5b0]/10 text-[#f6e7cc]' },
  baixa: { rotulo: 'Rotina', classe: 'border-white/15 bg-white/5 text-white/60' }
};

type Canal = 'notificarEmail' | 'notificarWhatsapp';

/**
 * Acompanhamento em "Meus processos": alertas recentes (ap_notificacoes) e, por processo monitorado,
 * o último resumo IA e os canais de aviso (e-mail / WhatsApp). Cards em vez de tabela para caber no
 * celular.
 */
export function AcompanhamentoProcessos() {
  const [dados, setDados] = useState<RespostaMonitoramento | null>(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [salvando, setSalvando] = useState<Record<string, boolean>>({});
  const [erroCanal, setErroCanal] = useState<{ processoId: string; mensagem: string; semTelefone: boolean } | null>(null);

  useEffect(() => {
    authFetch('/api/monitoramento')
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((d: RespostaMonitoramento) => setDados(d))
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
  }, []);

  const alternarCanal = useCallback(async (processo: ProcessoAcompanhado, canal: Canal, valor: boolean) => {
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

  if (!dados) {
    return (
      <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/60 backdrop-blur-md">
        Carregando acompanhamento…
      </div>
    );
  }

  return (
    <>
      {notificacoes.length > 0 && (
        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
              {naoLidas > 0 ? <BellRing size={18} strokeWidth={1.8} className="text-[#e8d5b0]" /> : <Bell size={18} strokeWidth={1.8} className="text-white/50" />}
              Alertas recentes
              {naoLidas > 0 && (
                <span className="rounded-full bg-[#e8d5b0] px-2 py-0.5 text-xs font-semibold text-[#15161a]">{naoLidas} novo(s)</span>
              )}
            </h2>
            {naoLidas > 0 && (
              <button
                type="button"
                onClick={marcarTodasComoLidas}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:border-[#e8d5b0]/50 hover:text-white"
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
                className={`rounded-2xl border px-4 py-3 ${n.lida ? 'border-white/5 bg-white/[0.02]' : 'border-[#e8d5b0]/25 bg-[#e8d5b0]/[0.06]'}`}
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

      <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md">
        <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
          <Sparkles size={18} strokeWidth={1.8} className="text-[#e8d5b0]" />
          Acompanhamento
        </h2>
        <p className="mt-1 text-xs text-white/50">
          Conferimos seus processos todas as noites. Quando algo muda, você recebe um resumo em linguagem simples pelos canais que escolher.
        </p>

        {!dados.telefoneValido && dados.processos.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60 sm:inline-flex">
            <MessageCircle size={14} className="mt-px shrink-0 text-white/40" />
            <span>
              Para receber pelo WhatsApp, cadastre seu celular com DDD no{' '}
              <Link href="/perfil" className="cursor-pointer font-medium text-[#e8d5b0] underline-offset-2 hover:underline">
                perfil
              </Link>
              .
            </span>
          </p>
        )}

        {erroCarga && <p className="mt-4 text-sm text-white/60">Não foi possível carregar o acompanhamento agora.</p>}
        {!erroCarga && dados.processos.length === 0 && (
          <p className="mt-4 text-sm text-white/60">Nenhum processo acompanhado ainda. Os processos que você consulta entram aqui automaticamente.</p>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {dados.processos.map((p, index) => (
            <motion.article
              key={p.processoId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.5), ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1.5 break-all font-medium text-white">
                    <Gavel size={15} strokeWidth={1.8} className="shrink-0 text-white/40" />
                    {p.numeroCnj}
                  </p>
                  <p className="mt-0.5 text-xs text-white/50">
                    {[p.tribunal, p.classe].filter(Boolean).join(' · ') || 'Tribunal não informado'}
                  </p>
                </div>
                {p.resumo?.urgencia && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${URGENCIA[p.resumo.urgencia].classe}`}>
                    {p.resumo.urgencia === 'alta' && <TriangleAlert size={12} />}
                    {URGENCIA[p.resumo.urgencia].rotulo}
                  </span>
                )}
              </div>

              {p.resumo ? (
                <div className="mt-3 space-y-1.5 text-sm leading-relaxed">
                  <p className="text-white/80">{p.resumo.resumo}</p>
                  {p.resumo.proximoPasso && (
                    <p className="text-white/60">
                      <span className="font-medium text-[#e8d5b0]">Próximo passo: </span>
                      {p.resumo.proximoPasso}
                    </p>
                  )}
                  <p className="text-[11px] text-white/35">Resumo gerado por IA em {fmtData(p.resumo.criadoEm)}. Não substitui a orientação do seu advogado.</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-white/50">Sem movimentação nova desde que começamos a acompanhar.</p>
              )}

              <div className="mt-auto pt-4">
                <p className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
                  <span>Últ. movimentação: {fmtDia(p.ultimaMovimentacaoEm)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={11} />
                    Próxima conferência: {p.proximaConsultaEm ? fmtData(p.proximaConsultaEm) : 'esta noite'}
                  </span>
                </p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/5 pt-3">
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
                        <Link href="/perfil" className="cursor-pointer font-medium text-[#e8d5b0] underline underline-offset-2">
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
    </>
  );
}
