'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Switch } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { AnimatePresence, motion } from 'motion/react';
import {
  Newspaper,
  Plus,
  Trash2,
  Users,
  Clock,
  MessageCircle,
  Mail,
  Crown,
  Loader2,
  FolderOpen,
  ShieldAlert,
  CircleCheck,
  Gavel,
  Info,
  Scale,
  UserRound,
  TextSearch,
  CheckCheck,
  ExternalLink,
  ChevronDown,
  AlertTriangle
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { UpgradeProModal } from '@/components/UpgradeProModal';
import AbasDeslizantes, { ConteudoDeslizante, useDirecaoAba } from '@/components/AbasDeslizantes';
import { UFS_OAB, validarBuscaDiario } from '@/lib/djen';
import type { BuscaDiario, PublicacaoDiario, TagPublicacao, UsoLimiteDiario } from '@/lib/monitoramentoDiario';

type Tipo = 'oab' | 'nome' | 'termo';
const ORDEM_TIPOS: readonly Tipo[] = ['oab', 'nome', 'termo'];
const POR_PAGINA = 15;

const CAMPO =
  'mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60';

const TAGS: Record<TagPublicacao, { rotulo: string; classe: string; Icone: typeof Info }> = {
  urgente: { rotulo: 'Urgente', classe: 'border-red-400/40 bg-red-400/10 text-red-200', Icone: ShieldAlert },
  positivo: { rotulo: 'Favorável', classe: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200', Icone: CircleCheck },
  andamento: { rotulo: 'Andamento', classe: 'border-[#1E7CF2]/40 bg-[#1E7CF2]/10 text-[color:var(--tt-text-2)]', Icone: Gavel },
  informativo: { rotulo: 'Informativo', classe: 'border-white/15 bg-white/5 text-white/60', Icone: Info }
};

const TIPO_INFO: Record<Tipo, { rotulo: string; Icone: typeof Info }> = {
  oab: { rotulo: 'OAB', Icone: Scale },
  nome: { rotulo: 'Nome', Icone: UserRound },
  termo: { rotulo: 'Termo', Icone: TextSearch }
};

const fmtDia = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fmtDataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Aguardando 1ª varredura';

export function MonitoramentoDiarioSection() {
  const [buscas, setBuscas] = useState<BuscaDiario[]>([]);
  const [uso, setUso] = useState<UsoLimiteDiario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [modalPro, setModalPro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Formulário
  const [tipo, setTipo] = useState<Tipo>('oab');
  const direcao = useDirecaoAba(tipo, ORDEM_TIPOS);
  const [oabNumero, setOabNumero] = useState('');
  const [oabUf, setOabUf] = useState('');
  const [nome, setNome] = useState('');
  const [termo, setTermo] = useState('');
  const [notifWhats, setNotifWhats] = useState(true);
  const [notifMail, setNotifMail] = useState(true);

  // Feed
  const [feed, setFeed] = useState<PublicacaoDiario[]>([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedPagina, setFeedPagina] = useState(1);
  const [feedBusca, setFeedBusca] = useState('');
  const [feedFiltro, setFeedFiltro] = useState<'todas' | 'nao_lidas'>('todas');
  const [carregandoFeed, setCarregandoFeed] = useState(false);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const noLimite = uso !== null && uso.limite !== null && uso.ativas >= uso.limite;
  const ehFree = uso?.plano !== 'pro' && uso?.ilimitado !== true;
  const totalNaoLidas = useMemo(() => buscas.reduce((soma, b) => soma + b.naoLidas, 0), [buscas]);

  const carregarBuscas = useCallback(async () => {
    try {
      const res = await authFetch('/api/monitoramento-diario');
      if (res.ok) {
        const data = await res.json();
        setBuscas(data.buscas || []);
        setUso(data.uso || null);
      }
    } catch {
      // erro de rede: mantém o estado atual
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarFeed = useCallback(
    async (pagina: number, acumular: boolean) => {
      setCarregandoFeed(true);
      try {
        const qs = new URLSearchParams({ publicacoes: '1', pagina: String(pagina), porPagina: String(POR_PAGINA) });
        if (feedBusca) qs.set('busca', feedBusca);
        if (feedFiltro === 'nao_lidas') qs.set('naoLidas', '1');
        const res = await authFetch(`/api/monitoramento-diario?${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        setFeed(atual => (acumular ? [...atual, ...(data.publicacoes || [])] : data.publicacoes || []));
        setFeedTotal(data.total || 0);
        setFeedPagina(pagina);
      } catch {
        // erro de rede: mantém o feed atual
      } finally {
        setCarregandoFeed(false);
      }
    },
    [feedBusca, feedFiltro]
  );

  useEffect(() => {
    carregarBuscas();
  }, [carregarBuscas]);

  useEffect(() => {
    carregarFeed(1, false);
  }, [carregarFeed]);

  const erro = (title: string, message: string) => notifications.show({ title, message, color: 'red' });

  const handleAdicionar = async (e: React.FormEvent) => {
    e.preventDefault();

    const valor = tipo === 'oab' ? oabNumero : tipo === 'nome' ? nome : termo;
    const validacao = validarBuscaDiario(tipo, valor, oabUf);
    if (!validacao.ok) {
      erro('Dados da busca', validacao.erro);
      return;
    }

    if (noLimite && ehFree) {
      setModalPro(`Seu plano gratuito permite ${uso?.limite} busca monitorada ativa no Diário. No Plano Pro você monitora até 10 buscas (OAB, nomes e termos).`);
      return;
    }

    setSalvando(true);
    try {
      const res = await authFetch('/api/monitoramento-diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, valor, ufOab: tipo === 'oab' ? oabUf : undefined, notificarWhatsapp: notifWhats, notificarEmail: notifMail })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.codigo === 'limite_plano' && ehFree) {
          setModalPro(data.error || 'Você chegou ao limite de buscas do plano gratuito.');
          return;
        }
        throw new Error(data.error || 'Erro ao cadastrar a busca.');
      }

      notifications.show({
        title: 'Busca monitorada',
        message: data.aviso
          ? data.aviso
          : data.importadas > 0
            ? `${data.importadas} publicação(ões) dos últimos 7 dias já estão no seu feed. Novas publicações serão avisadas.`
            : 'Nenhuma publicação nos últimos 7 dias. Você será avisado quando surgir uma nova.',
        color: 'brand'
      });
      setOabNumero('');
      setNome('');
      setTermo('');
      await Promise.all([carregarBuscas(), carregarFeed(1, false)]);
    } catch (err: unknown) {
      erro('Falha ao cadastrar', err instanceof Error ? err.message : 'Tente novamente em instantes.');
    } finally {
      setSalvando(false);
    }
  };

  const alterar = async (busca: BuscaDiario, campos: Partial<Pick<BuscaDiario, 'ativo' | 'notificarWhatsapp' | 'notificarEmail'>>) => {
    const anterior = busca;
    setBuscas(lista => lista.map(b => (b.id === busca.id ? { ...b, ...campos } : b)));
    try {
      const res = await authFetch('/api/monitoramento-diario', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: busca.id, ...campos })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBuscas(lista => lista.map(b => (b.id === busca.id ? anterior : b)));
        if (data.codigo === 'limite_plano' && ehFree) setModalPro(data.error || null);
        else erro('Erro ao atualizar', data.error || 'Não foi possível alterar a busca.');
        return;
      }
      if ('ativo' in campos) carregarBuscas();
    } catch {
      setBuscas(lista => lista.map(b => (b.id === busca.id ? anterior : b)));
      erro('Erro ao atualizar', 'Não foi possível alterar a busca.');
    }
  };

  const remover = async (busca: BuscaDiario) => {
    if (!confirm(`Excluir a busca "${busca.rotulo}" e as publicações guardadas dela?`)) return;
    try {
      const res = await authFetch(`/api/monitoramento-diario?id=${encodeURIComponent(busca.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      if (feedBusca === busca.id) setFeedBusca('');
      notifications.show({ title: 'Busca excluída', message: `"${busca.rotulo}" não será mais monitorada.`, color: 'brand' });
      await Promise.all([carregarBuscas(), carregarFeed(1, false)]);
    } catch {
      erro('Erro ao excluir', 'Não foi possível excluir a busca agora.');
    }
  };

  const marcarLidas = async (alvo: { ids?: string[]; busca?: string }) => {
    try {
      const res = await authFetch('/api/monitoramento-diario', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lidas: true, ...alvo })
      });
      if (!res.ok) throw new Error();
      setFeed(lista =>
        lista.map(p => (alvo.ids ? (alvo.ids.includes(p.id) ? { ...p, lida: true } : p) : !alvo.busca || p.buscaId === alvo.busca ? { ...p, lida: true } : p))
      );
      carregarBuscas();
    } catch {
      erro('Erro', 'Não foi possível marcar como lida.');
    }
  };

  const alternarTexto = (id: string) =>
    setAbertas(atual => {
      const novo = new Set(atual);
      if (!novo.delete(id)) novo.add(id);
      return novo;
    });

  const percentualUso = uso && uso.limite ? Math.min(100, Math.round((uso.ativas / uso.limite) * 100)) : 0;

  return (
    <>
      <section className="bf-paper mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="inline-flex flex-wrap items-center gap-2 text-lg font-semibold text-white">
              <Newspaper size={19} strokeWidth={1.8} className="shrink-0 text-[#1E7CF2]" />
              Monitoramento do Diário de Justiça
              {totalNaoLidas > 0 && (
                <span className="rounded-full bg-[#1E7CF2] px-2 py-0.5 text-[11px] font-semibold text-white">{totalNaoLidas} nova{totalNaoLidas === 1 ? '' : 's'}</span>
              )}
            </h2>
            <p className="mt-1 text-xs text-white/50">
              Acompanhe as publicações do Diário de Justiça Eletrônico Nacional por OAB, nome ou termo. A varredura roda a cada cerca de 6 horas e avisa só o que for novo.
            </p>
          </div>

          {uso && (
            <div className="w-full shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 sm:w-56">
              <p className="text-xs font-medium text-white/70">
                {uso.limite === null ? (
                  <>Buscas ativas: {uso.ativas} (sem limite)</>
                ) : (
                  <>
                    {uso.ativas} de {uso.limite} {uso.limite === 1 ? 'busca ativa' : 'buscas ativas'}
                  </>
                )}
              </p>
              {uso.limite !== null && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={uso.ativas} aria-valuemin={0} aria-valuemax={uso.limite}>
                  <div className={`h-full rounded-full transition-all ${noLimite ? 'bg-amber-400' : 'bg-[#1E7CF2]'}`} style={{ width: `${percentualUso}%` }} />
                </div>
              )}
              {noLimite && ehFree && (
                <button
                  type="button"
                  onClick={() => setModalPro('No Plano Pro você monitora até 10 buscas no Diário (OAB, nomes e termos), com alertas no WhatsApp e e-mail.')}
                  className="bf-btn-sec mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[#1E7CF2]/40 bg-[#1E7CF2]/15 px-3 py-1 text-xs font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25"
                >
                  <Crown size={13} className="text-[#1E7CF2]" />
                  Ampliar com o Pro
                </button>
              )}
            </div>
          )}
        </header>

        {/* Formulário */}
        <form onSubmit={handleAdicionar} className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <AbasDeslizantes<Tipo>
            value={tipo}
            onChange={setTipo}
            ariaLabel="Tipo de busca no Diário"
            data={ORDEM_TIPOS.map(t => ({
              value: t,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {(() => {
                    const { Icone } = TIPO_INFO[t];
                    return <Icone size={14} />;
                  })()}
                  {TIPO_INFO[t].rotulo}
                </span>
              )
            }))}
          />

          <ConteudoDeslizante chave={tipo} direcao={direcao} className="mt-4">
            {tipo === 'oab' && (
              <div>
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                  <div>
                    <label htmlFor="diario-oab" className="block text-xs font-medium text-white/70">
                      Número da OAB
                    </label>
                    <input
                      id="diario-oab"
                      type="text"
                      inputMode="numeric"
                      value={oabNumero}
                      onChange={e => setOabNumero(e.target.value.replace(/\D/g, '').slice(0, 7))}
                      placeholder="Ex.: 228729"
                      className={CAMPO}
                    />
                  </div>
                  <div>
                    <label htmlFor="diario-uf" className="block text-xs font-medium text-white/70">
                      UF
                    </label>
                    <select id="diario-uf" value={oabUf} onChange={e => setOabUf(e.target.value)} className={`${CAMPO} cursor-pointer`}>
                      <option value="">Escolha</option>
                      {UFS_OAB.map(uf => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-white/40">Traz as publicações em que o advogado é citado, tanto pelo polo ativo quanto pelo passivo.</p>
              </div>
            )}

            {tipo === 'nome' && (
              <div>
                <label htmlFor="diario-nome" className="block text-xs font-medium text-white/70">
                  Nome completo
                </label>
                <input id="diario-nome" type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Maria da Silva Souza" maxLength={120} className={CAMPO} />
                <p className="mt-2 text-[11px] text-white/40">Só entram processos em que essa pessoa é Autora (polo ativo), com o nome completo exatamente igual (sem diferenciar acentos).</p>
              </div>
            )}

            {tipo === 'termo' && (
              <div>
                <label htmlFor="diario-termo" className="block text-xs font-medium text-white/70">
                  Termo ou frase
                </label>
                <input id="diario-termo" type="text" value={termo} onChange={e => setTermo(e.target.value)} placeholder="Ex.: nome de uma empresa, número de contrato" maxLength={120} className={CAMPO} />
                <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] text-white/40">
                  <AlertTriangle size={12} className="mt-px shrink-0 text-amber-300/70" />
                  <span>Procura a frase no texto das publicações de todos os tribunais. Use termos específicos: termos comuns (ex.: &quot;penhora&quot;) trazem milhares de resultados e só os mais recentes de cada varredura são guardados.</span>
                </p>
              </div>
            )}
          </ConteudoDeslizante>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs font-medium text-white/70">Avisar por</span>
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

            <button
              type="submit"
              disabled={salvando}
              className="bf-btn-sec inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#1E7CF2]/50 bg-[#1E7CF2]/15 px-4 py-2 text-sm font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {salvando ? (
                <>
                  <Loader2 size={16} className="animate-spin text-[#1E7CF2]" />
                  <span>Buscando no Diário...</span>
                </>
              ) : noLimite && ehFree ? (
                <>
                  <Crown size={16} />
                  <span>Ampliar com o Pro</span>
                </>
              ) : (
                <>
                  <Plus size={16} />
                  <span>Monitorar busca</span>
                </>
              )}
            </button>
          </div>
          {noLimite && !ehFree && (
            <p className="mt-3 text-[11px] text-amber-200/80">Você atingiu o limite de buscas ativas do seu plano. Pause ou exclua uma busca para cadastrar outra.</p>
          )}
        </form>

        {/* Buscas */}
        <div className="mt-5">
          {carregando ? (
            <p className="text-xs text-white/40">Carregando buscas monitoradas...</p>
          ) : buscas.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 text-center">
              <FolderOpen size={24} className="mx-auto text-white/30" />
              <p className="mt-2 text-xs text-white/50">Nenhuma busca monitorada no Diário.</p>
              <p className="mt-0.5 text-[11px] text-white/35">Cadastre sua OAB, um nome ou um termo acima para receber as publicações aqui e no WhatsApp.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence>
                {buscas.map(b => {
                  const { Icone, rotulo } = TIPO_INFO[b.tipo];
                  return (
                    <motion.div
                      key={b.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      className={`flex min-w-0 flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${b.ativo ? '' : 'opacity-70'}`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--tt-text-2)]">
                            <Icone size={12} className="text-[#1E7CF2]" />
                            {rotulo}
                          </span>
                          <div className="flex items-center gap-1">
                            {b.naoLidas > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setFeedBusca(b.id);
                                  setFeedFiltro('nao_lidas');
                                }}
                                title="Ver as não lidas desta busca"
                                className="cursor-pointer rounded-full bg-[#1E7CF2] px-2 py-0.5 text-[11px] font-semibold text-white"
                              >
                                {b.naoLidas} nova{b.naoLidas === 1 ? '' : 's'}
                              </button>
                            )}
                            {!b.somenteLeitura && (
                              <button
                                type="button"
                                onClick={() => remover(b)}
                                aria-label={`Excluir ${b.rotulo}`}
                                className="cursor-pointer rounded-lg p-1 text-white/40 transition hover:bg-red-400/10 hover:text-red-300"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        <p className="mt-2.5 break-words text-sm font-semibold text-white">{b.rotulo}</p>
                        {b.somenteLeitura && (
                          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-white/50">
                            <Users size={11} className="text-[#1E7CF2]" />
                            Compartilhada por {b.compartilhadoPor || 'um colega'}
                          </p>
                        )}

                        <div className="mt-2 flex items-center gap-2">
                          <Switch
                            size="xs"
                            color="brand"
                            checked={b.ativo}
                            disabled={b.somenteLeitura}
                            onChange={e => alterar(b, { ativo: e.currentTarget.checked })}
                            label={<span className="text-[11px] text-white/70">{b.ativo ? 'Ativa' : 'Pausada'}</span>}
                            styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
                          />
                        </div>
                        {b.ultimoErro && b.ativo && (
                          <p className="mt-2 inline-flex items-start gap-1 text-[11px] text-amber-200/80">
                            <AlertTriangle size={11} className="mt-px shrink-0" />
                            Diário indisponível na última tentativa. Tentaremos de novo.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 border-t border-white/5 pt-3">
                        <span className="inline-flex items-center gap-1 text-[11px] text-white/40">
                          <Clock size={11} />
                          Últ. varredura: {fmtDataHora(b.ultimaVarreduraEm)}
                        </span>
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2">
                          <Switch
                            size="xs"
                            color="brand"
                            checked={b.notificarWhatsapp}
                            disabled={b.somenteLeitura}
                            onChange={e => alterar(b, { notificarWhatsapp: e.currentTarget.checked })}
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
                            checked={b.notificarEmail}
                            disabled={b.somenteLeitura}
                            onChange={e => alterar(b, { notificarEmail: e.currentTarget.checked })}
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

        {/* Feed de publicações */}
        {buscas.length > 0 && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white">Publicações</h3>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <select
                  value={feedBusca}
                  onChange={e => setFeedBusca(e.target.value)}
                  aria-label="Filtrar por busca"
                  className="min-w-0 flex-1 cursor-pointer rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white outline-none transition focus:border-[#1E7CF2]/60 sm:flex-none"
                >
                  <option value="">Todas as buscas</option>
                  {buscas.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.rotulo}
                    </option>
                  ))}
                </select>
                <AbasDeslizantes<'todas' | 'nao_lidas'>
                  value={feedFiltro}
                  onChange={setFeedFiltro}
                  size="xs"
                  ariaLabel="Filtro de leitura"
                  data={[
                    { value: 'todas', label: 'Todas' },
                    { value: 'nao_lidas', label: 'Não lidas' }
                  ]}
                />
                {totalNaoLidas > 0 && (
                  <button
                    type="button"
                    onClick={() => marcarLidas(feedBusca ? { busca: feedBusca } : {})}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs text-white/60 transition hover:bg-white/5 hover:text-white"
                  >
                    <CheckCheck size={13} />
                    Marcar lidas
                  </button>
                )}
              </div>
            </div>

            {feed.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-white/5 bg-white/[0.01] p-6 text-center">
                {carregandoFeed ? (
                  <Loader2 size={20} className="mx-auto animate-spin text-white/30" />
                ) : (
                  <>
                    <Newspaper size={22} className="mx-auto text-white/30" />
                    <p className="mt-2 text-xs text-white/50">{feedFiltro === 'nao_lidas' ? 'Nenhuma publicação não lida.' : 'Nenhuma publicação encontrada ainda.'}</p>
                    <p className="mt-0.5 text-[11px] text-white/35">As publicações dos últimos 7 dias aparecem aqui logo após o cadastro; as novas chegam a cada varredura.</p>
                  </>
                )}
              </div>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {feed.map(p => {
                  const tag = TAGS[p.tag] ?? TAGS.informativo;
                  const aberta = abertas.has(p.id);
                  return (
                    <li key={p.id} className={`min-w-0 rounded-2xl border bg-white/[0.03] p-3.5 ${p.lida ? 'border-white/10' : 'border-[#1E7CF2]/30'}`}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tag.classe}`}>
                          <tag.Icone size={12} />
                          {tag.rotulo}
                        </span>
                        {!p.lida && <span className="h-2 w-2 shrink-0 rounded-full bg-[#1E7CF2]" aria-label="Não lida" />}
                        <span className="text-xs font-medium text-white/80">{[p.tribunal, p.tipoComunicacao].filter(Boolean).join(' · ')}</span>
                        <span className="text-[11px] text-white/40">{fmtDia(p.dataDisponibilizacao)}</span>
                      </div>

                      <p className="mt-1.5 break-words text-[11px] text-white/45">
                        {p.numeroCnj ? <span className="font-mono">{p.numeroCnj.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')}</span> : 'Sem número de processo'}
                        {p.orgao ? ` · ${p.orgao}` : ''}
                        {` · busca: ${p.buscaRotulo}`}
                      </p>

                      {p.texto && (
                        <p className={`mt-2 whitespace-pre-line break-words text-xs leading-relaxed text-white/65 ${aberta ? '' : 'line-clamp-3'}`}>{p.texto}</p>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        {p.texto && p.texto.length > 220 && (
                          <button
                            type="button"
                            onClick={() => alternarTexto(p.id)}
                            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[color:var(--tt-text-2)] hover:underline"
                          >
                            <ChevronDown size={12} className={`transition-transform ${aberta ? 'rotate-180' : ''}`} />
                            {aberta ? 'Recolher texto' : 'Ler texto completo'}
                          </button>
                        )}
                        {p.numeroCnj && (
                          <Link
                            href={`/processo/${p.numeroCnj}`}
                            onClick={() => !p.lida && marcarLidas({ ids: [p.id] })}
                            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[color:var(--tt-text-2)] hover:underline"
                          >
                            <ExternalLink size={12} />
                            Ver processo
                          </Link>
                        )}
                        {!p.lida && (
                          <button
                            type="button"
                            onClick={() => marcarLidas({ ids: [p.id] })}
                            className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-white/50 hover:text-white"
                          >
                            <CheckCheck size={12} />
                            Marcar como lida
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {feed.length > 0 && feed.length < feedTotal && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  disabled={carregandoFeed}
                  onClick={() => carregarFeed(feedPagina + 1, true)}
                  className="bf-btn-sec inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 px-4 py-1.5 text-xs font-medium text-white/80 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {carregandoFeed && <Loader2 size={13} className="animate-spin" />}
                  Carregar mais ({feedTotal - feed.length})
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <UpgradeProModal
        opened={modalPro !== null}
        onClose={() => setModalPro(null)}
        motivo={modalPro ?? undefined}
      />
    </>
  );
}
