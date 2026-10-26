'use client';

import { useCallback, useEffect, useState } from 'react';
import { Switch } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { AnimatePresence, motion } from 'motion/react';
import {
  Fingerprint,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Clock,
  Sparkles,
  MessageCircle,
  Mail,
  Crown,
  Loader2,
  FolderOpen
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import { UpgradeProModal } from '@/components/UpgradeProModal';
import { cleanDigits, formatDocumento, isValidCpf, isValidCnpj } from '@/lib/format';
import type { DocumentoMonitorado } from '@/lib/monitoramentoCpf';

const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : 'Aguardando 1ª varredura');
const fmtDataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function MonitoramentoCpfSection() {
  const { profile } = useSharedProfile();
  const [documentos, setDocumentos] = useState<DocumentoMonitorado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [modalProAberto, setModalProAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Campos do formulário
  const [docInput, setDocInput] = useState('');
  const [nomeInput, setNomeInput] = useState('');
  const [notifWhats, setNotifWhats] = useState(true);
  const [notifMail, setNotifMail] = useState(true);

  const carregarDocumentos = useCallback(async () => {
    try {
      const res = await authFetch('/api/monitoramento-documentos');
      if (res.ok) {
        const data = await res.json();
        setDocumentos(data.documentos || []);
      }
    } catch {
      // Ignora erro de rede silenciosamente
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarDocumentos();
  }, [carregarDocumentos]);

  const handleDocChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDocInput(formatDocumento(raw));
  };

  const handleAdicionar = async (e: React.FormEvent) => {
    e.preventDefault();

    // Verificação de Paywall: Exclusivo do Plano Pro
    if (profile.plano !== 'pro') {
      setModalProAberto(true);
      return;
    }

    const digits = cleanDigits(docInput);
    const ehCpf = digits.length === 11 && isValidCpf(digits);
    const ehCnpj = digits.length === 14 && isValidCnpj(digits);

    if (!ehCpf && !ehCnpj) {
      notifications.show({
        title: 'Documento inválido',
        message: 'Informe um número de CPF (11 dígitos) ou CNPJ (14 dígitos) válido.',
        color: 'red'
      });
      return;
    }

    setSalvando(true);
    try {
      const res = await authFetch('/api/monitoramento-documentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documento: digits,
          nomeTitular: nomeInput.trim() || undefined,
          notificarWhatsapp: notifWhats,
          notificarEmail: notifMail
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.codigo === 'recurso_pro') {
          setModalProAberto(true);
          return;
        }
        throw new Error(data.error || 'Erro ao cadastrar documento.');
      }

      notifications.show({
        title: 'Monitoramento ativado',
        message: 'Varredura automática iniciada. Você será avisado no WhatsApp quando novas ações surgirem.',
        color: 'brand'
      });

      setDocInput('');
      setNomeInput('');
      carregarDocumentos();
    } catch (err: unknown) {
      notifications.show({
        title: 'Falha ao cadastrar',
        message: err instanceof Error ? err.message : 'Tente novamente em instantes.',
        color: 'red'
      });
    } finally {
      setSalvando(false);
    }
  };

  const alternarCanal = async (doc: DocumentoMonitorado, canal: 'notificarWhatsapp' | 'notificarEmail', valor: boolean) => {
    // Atualização otimista
    setDocumentos(docs => docs.map(d => (d.id === doc.id ? { ...d, [canal]: valor } : d)));

    try {
      const res = await authFetch('/api/monitoramento-documentos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doc.id, [canal]: valor })
      });
      if (!res.ok) throw new Error();
    } catch {
      // Reverte em caso de erro
      setDocumentos(docs => docs.map(d => (d.id === doc.id ? { ...d, [canal]: !valor } : d)));
      notifications.show({
        title: 'Erro ao atualizar',
        message: 'Não foi possível alterar o canal de notificação.',
        color: 'red'
      });
    }
  };

  const removerDocumento = async (id: string, numeroFormatado: string) => {
    if (!confirm(`Deseja remover o monitoramento do documento ${numeroFormatado}?`)) return;

    try {
      const res = await authFetch(`/api/monitoramento-documentos?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error();

      setDocumentos(docs => docs.filter(d => d.id !== id));
      notifications.show({
        title: 'Monitoramento removido',
        message: `O documento ${numeroFormatado} não receberá mais alertas de novas distribuições.`,
        color: 'brand'
      });
    } catch {
      notifications.show({
        title: 'Erro ao remover',
        message: 'Não foi possível remover o documento agora.',
        color: 'red'
      });
    }
  };

  return (
    <>
      <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
              <Fingerprint size={19} strokeWidth={1.8} className="text-[#1E7CF2]" />
              Radar de Novos Processos (CPF / CNPJ)
            </h2>
            <p className="mt-1 text-xs text-white/50">
              Varredura contínua em tribunais de todo o Brasil. Seja alertado no WhatsApp no instante em que uma nova ação for distribuída contra ou a favor de você ou seus clientes.
            </p>
          </div>

          {profile.plano !== 'pro' && (
            <button
              type="button"
              onClick={() => setModalProAberto(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#1E7CF2]/40 bg-[#1E7CF2]/15 px-3 py-1 text-xs font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25"
            >
              <Crown size={13} className="text-[#1E7CF2]" />
              Recurso Pro
            </button>
          )}
        </header>

        {/* Formulário de cadastro de novo documento */}
        <form onSubmit={handleAdicionar} className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="doc-input" className="block text-xs font-medium text-white/70">
                CPF ou CNPJ
              </label>
              <input
                id="doc-input"
                type="text"
                value={docInput}
                onChange={handleDocChange}
                placeholder="000.000.000-00 ou CNPJ"
                maxLength={18}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60"
              />
            </div>

            <div>
              <label htmlFor="nome-input" className="block text-xs font-medium text-white/70">
                Nome do Titular / Identificador (opcional)
              </label>
              <input
                id="nome-input"
                type="text"
                value={nomeInput}
                onChange={e => setNomeInput(e.target.value)}
                placeholder="Ex.: Meu CPF, Holding, Cliente X"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60"
              />
            </div>

            <div className="flex flex-col justify-end">
              <span className="block text-xs font-medium text-white/70">Canais de Alerta</span>
              <div className="mt-2.5 flex items-center gap-4">
                <Switch
                  size="sm"
                  color="brand"
                  checked={notifWhats}
                  onChange={e => setNotifWhats(e.currentTarget.checked)}
                  label={
                    <span className="inline-flex items-center gap-1 text-xs text-white/80">
                      <MessageCircle size={13} /> WhatsApp
                    </span>
                  }
                  styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                />
                <Switch
                  size="sm"
                  color="brand"
                  checked={notifMail}
                  onChange={e => setNotifMail(e.currentTarget.checked)}
                  label={
                    <span className="inline-flex items-center gap-1 text-xs text-white/80">
                      <Mail size={13} /> E-mail
                    </span>
                  }
                  styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                />
              </div>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={salvando}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#1E7CF2]/50 bg-[#1E7CF2]/15 px-4 py-2 text-sm font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {salvando ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-[#1E7CF2]" />
                    <span>Cadastrando...</span>
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    <span>Monitorar Documento</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Lista de documentos monitorados */}
        <div className="mt-5">
          {carregando ? (
            <p className="text-xs text-white/40">Carregando documentos monitorados...</p>
          ) : documentos.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 text-center">
              <FolderOpen size={24} className="mx-auto text-white/30" />
              <p className="mt-2 text-xs text-white/50">Nenhum CPF ou CNPJ cadastrado para varredura contínua.</p>
              <p className="mt-0.5 text-[11px] text-white/35">Cadastre seu documento acima para receber alertas automáticos de novas ações judiciais.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence>
                {documentos.map(doc => {
                  const numFormatado = formatDocumento(doc.documento);
                  return (
                    <motion.div
                      key={doc.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--tt-text-2)]">
                            <ShieldCheck size={12} className="text-[#1E7CF2]" />
                            {doc.tipo.toUpperCase()}
                          </span>

                          <button
                            type="button"
                            onClick={() => removerDocumento(doc.id, numFormatado)}
                            aria-label={`Remover ${numFormatado}`}
                            className="cursor-pointer rounded-lg p-1 text-white/40 transition hover:bg-red-400/10 hover:text-red-300"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <p className="mt-2.5 font-mono text-sm font-semibold tracking-wide text-white">{numFormatado}</p>
                        {doc.nomeTitular && <p className="mt-0.5 text-xs text-white/60">{doc.nomeTitular}</p>}

                        <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
                          <Sparkles size={13} className="text-[#1E7CF2]" />
                          <span>
                            {doc.totalProcessosConhecidos} processo{doc.totalProcessosConhecidos === 1 ? '' : 's'} mapeado{doc.totalProcessosConhecidos === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 border-t border-white/5 pt-3">
                        <div className="flex items-center justify-between text-[11px] text-white/40">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} />
                            Últ. varredura: {fmtData(doc.ultimaVarreduraEm)}
                          </span>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
                          <Switch
                            size="xs"
                            color="brand"
                            checked={doc.notificarWhatsapp}
                            onChange={e => alternarCanal(doc, 'notificarWhatsapp', e.currentTarget.checked)}
                            label={
                              <span className="inline-flex items-center gap-1 text-[11px] text-white/70">
                                <MessageCircle size={12} /> WhatsApp
                              </span>
                            }
                            styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                          />

                          <Switch
                            size="xs"
                            color="brand"
                            checked={doc.notificarEmail}
                            onChange={e => alternarCanal(doc, 'notificarEmail', e.currentTarget.checked)}
                            label={
                              <span className="inline-flex items-center gap-1 text-[11px] text-white/70">
                                <Mail size={12} /> E-mail
                              </span>
                            }
                            styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </section>

      <UpgradeProModal
        opened={modalProAberto}
        onClose={() => setModalProAberto(false)}
        motivo="A varredura contínua de novos processos por CPF/CNPJ com alertas imediatos no WhatsApp é um recurso exclusivo do Plano Pro."
      />
    </>
  );
}
