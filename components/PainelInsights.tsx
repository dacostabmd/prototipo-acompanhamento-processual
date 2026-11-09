'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ActionIcon, Drawer, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  Activity,
  BookmarkCheck,
  BookmarkPlus,
  ChevronRight,
  FolderOpen,
  Mail,
  MessageCircle,
  Receipt,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TriangleAlert
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import AbasDeslizantes, { ConteudoDeslizante, useDirecaoAba } from '@/components/AbasDeslizantes';
import type { ProcessoInsight } from '@/app/api/painel/insights/route';
import type { MovementTag } from '@/lib/mockProcesses';

type Aba = 'andamentos' | 'risco' | 'resumo' | 'custo';
type Filtro = 'todos' | 'salvos' | 'pesquisados';

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'salvos', label: 'Salvos' },
  { value: 'pesquisados', label: 'Só pesquisados' }
];

const ABAS: { value: Aba; label: string; icon: typeof Activity }[] = [
  { value: 'andamentos', label: 'Andamentos', icon: Activity },
  { value: 'risco', label: 'Risco', icon: ShieldAlert },
  { value: 'resumo', label: 'Resumo IA', icon: Sparkles },
  { value: 'custo', label: 'Custo e origem', icon: Receipt }
];

const TAG: Record<MovementTag, { rotulo: string; cor: string }> = {
  urgente: { rotulo: 'Urgente', cor: 'bg-red-400' },
  positivo: { rotulo: 'Favorável', cor: 'bg-emerald-400' },
  andamento: { rotulo: 'Andamento', cor: 'bg-[#1E7CF2]' },
  informativo: { rotulo: 'Informativo', cor: 'bg-white/30' }
};

const ROTULO_BUSCA: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', nome: 'Nome', numero: 'Número do processo' };

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
};
const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

type Criticidade = 'critico' | 'atencao' | 'estavel';

/** Quão crítico está o processo, a partir dos andamentos classificados: urgência recente pesa mais. */
function nivelRisco(p: ProcessoInsight): { nivel: Criticidade; rotulo: string; classe: string; ponto: string } {
  const urgentesRecentes = p.movimentos.slice(0, 5).filter(m => m.tag === 'urgente').length;
  if (urgentesRecentes > 0)
    return { nivel: 'critico', rotulo: 'Crítico', classe: 'border-red-400/40 bg-red-400/15 text-red-300', ponto: 'bg-red-400' };
  if (p.contagem.urgente > 0)
    return { nivel: 'atencao', rotulo: 'Atenção', classe: 'border-amber-300/40 bg-amber-300/15 text-amber-300', ponto: 'bg-amber-300' };
  return { nivel: 'estavel', rotulo: 'Em dia', classe: 'border-[#1E7CF2]/30 bg-[#1E7CF2]/10 text-blue-300', ponto: 'bg-[#1E7CF2]' };
}

/** Cartão de primeiro nível da Visão geral: acompanha o tema (branco no claro, azul-noite no escuro). */
const CARTAO = 'rounded-2xl border border-tt-line bg-tt-surface shadow-sm';

const ordenarPorData = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');

/** Texto curto do que aconteceu: resumo por IA quando existe, senão o último andamento. */
const resumoCurto = (p: ProcessoInsight) => p.resumoIa?.resumo || p.movimentos[0]?.titulo || 'Sem movimentações registradas.';

interface Consumo {
  franquiaReais: number;
  usadoReais: number;
  restanteReais: number;
  percentualUsado: number;
  renovaEm: string;
}

export default function PainelInsights() {
  const [processos, setProcessos] = useState<ProcessoInsight[] | null>(null);
  const [erro, setErro] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [aberto, setAberto] = useState<{ numero: string; aba: Aba } | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const direcaoFiltro = useDirecaoAba(filtro, FILTROS.map(f => f.value));
  const direcaoAba = useDirecaoAba(aberto?.aba ?? 'andamentos', ABAS.map(a => a.value));

  const [atualizando, setAtualizando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  // Mantém a lista na tela enquanto recarrega; sem cache do navegador para sempre trazer o estado atual.
  const carregar = () => {
    setErro(false);
    setAtualizando(true);
    authFetch(`/api/painel/insights?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        setProcessos(d.processos ?? []);
        setAtualizadoEm(new Date());
      })
      .catch(() => {
        setErro(true);
        setProcessos(prev => prev ?? []);
      })
      .finally(() => setAtualizando(false));
  };
  useEffect(carregar, []);

  const [consumo, setConsumo] = useState<Consumo | null>(null);
  useEffect(() => {
    authFetch('/api/planos')
      .then(r => (r.ok ? r.json() : null))
      .then(d => d?.consumo && setConsumo(d.consumo))
      .catch(() => {});
  }, []);

  const lista = useMemo(
    () =>
      (processos ?? [])
        .filter(p => (filtro === 'todos' ? true : filtro === 'salvos' ? p.salvo : !p.salvo))
        .sort((a, b) => ordenarPorData(a.ultimaMovimentacao, b.ultimaMovimentacao)),
    [processos, filtro]
  );
  const criticos = useMemo(
    () =>
      (processos ?? [])
        .filter(p => nivelRisco(p).nivel === 'critico')
        .sort((a, b) => ordenarPorData(a.ultimaMovimentacao, b.ultimaMovimentacao)),
    [processos]
  );
  const kpis = useMemo(() => {
    const l = processos ?? [];
    return {
      total: l.length,
      salvos: l.filter(p => p.salvo).length,
      alto: l.filter(p => nivelRisco(p).nivel === 'critico').length,
      custo: l.reduce((s, p) => s + p.custoPesquisa, 0)
    };
  }, [processos]);

  const atual = aberto ? processos?.find(p => p.numero === aberto.numero) ?? null : null;

  const salvar = async (p: ProcessoInsight) => {
    if (!p.consultaId) return;
    setSalvando(p.numero);
    try {
      const res = await authFetch('/api/processos/salvar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens: [{ numero: p.numero, consultaId: p.consultaId }] })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error);
      if (d.foraDoLimite?.length) {
        notifications.show({ title: 'Limite do plano', message: `Seu plano permite ${d.limite} processos salvos.`, color: 'yellow' });
      } else {
        notifications.show({ title: 'Processo salvo', message: `${p.numero} está em Meus processos.`, color: 'blue' });
        carregar();
      }
    } catch (e: any) {
      notifications.show({ title: 'Não foi possível salvar', message: e?.message || 'Tente novamente.', color: 'red' });
    } finally {
      setSalvando(null);
    }
  };

  const restantePct = consumo ? Math.max(0, Math.min(100, 100 - consumo.percentualUsado)) : 0;

  return (
    <div data-tour="painel-insights" className="bf-cols mt-8 grid items-start lg:grid-cols-12 [&_dd]:m-0 [&_dl]:mb-0 [&_h2]:m-0 [&_ol]:mb-0 [&_p]:m-0 [&_ul]:m-0">
      {/* Coluna principal: o que pede atenção e as últimas movimentações */}
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
        <section aria-labelledby="atencao-titulo" className={CARTAO}>
          <header className="flex items-start justify-between gap-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <TriangleAlert size={20} strokeWidth={1.9} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
              <div>
                <h2 id="atencao-titulo" className="text-base font-semibold text-white">
                  Precisam de atenção
                </h2>
                <p className="text-xs text-white/55">Processos críticos, do mais recente ao mais antigo.</p>
              </div>
            </div>
            <span className="rounded-full border border-red-400/40 bg-red-400/15 px-2.5 py-0.5 text-xs font-semibold text-red-300">
              {processos ? String(criticos.length).padStart(2, '0') : '—'}
            </span>
          </header>

          {processos === null && <p className="border-t border-tt-line px-5 py-4 text-sm text-white/60">Carregando...</p>}
          {processos !== null && criticos.length === 0 && (
            <p className="border-t border-tt-line px-5 py-4 text-sm text-white/60">Nenhum processo crítico no momento.</p>
          )}
          {criticos.length > 0 && (
            <ul className="list-none p-0">
              {criticos.map(p => {
                const ato = p.movimentos.slice(0, 5).find(m => m.tag === 'urgente') ?? p.movimentos[0];
                return (
                  <li key={p.numero} className="border-t border-tt-line">
                    <button
                      type="button"
                      onClick={() => setAberto({ numero: p.numero, aba: 'risco' })}
                      className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-white/5"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-300/20 text-amber-300">
                        <TriangleAlert size={17} strokeWidth={1.9} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">{p.numero}</span>
                          <span className={`rounded-full border px-2 py-px text-[11px] font-semibold ${nivelRisco(p).classe}`}>Crítico</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-white/70" title={ato?.titulo}>
                          {ato?.titulo || resumoCurto(p)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[11px] text-white/50">{data(ato?.data ?? p.ultimaMovimentacao)}</span>
                        {p.valorCausa && <span className="block text-xs font-semibold text-white">{p.valorCausa}</span>}
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-white/40" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="movimentacoes-titulo" className={`${CARTAO} px-5 py-4`}>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="movimentacoes-titulo" className="text-base font-semibold text-white">
                Últimas movimentações
              </h2>
              <p className="text-xs text-white/55">Resumo por IA de cada processo pesquisado ou salvo.</p>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip label={atualizadoEm ? `Atualizado às ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Atualizar'} withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={carregar}
                  disabled={atualizando}
                  aria-label="Atualizar movimentações"
                  className="cursor-pointer"
                >
                  <RefreshCw size={15} className={atualizando ? 'animate-spin' : ''} />
                </ActionIcon>
              </Tooltip>
              <AbasDeslizantes size="xs" ariaLabel="Filtrar processos" value={filtro} onChange={setFiltro} data={FILTROS} />
            </div>
          </div>

          {processos === null && <p className="text-sm text-white/60">Carregando movimentações...</p>}
          {erro && <p className="text-sm text-white/60">Não foi possível carregar as movimentações agora.</p>}
          <ConteudoDeslizante chave={filtro} direcao={direcaoFiltro}>
            {processos !== null && !erro && lista.length === 0 && (
              <p className="rounded-xl border border-tt-line p-5 text-center text-sm text-white/60">
                {processos.length === 0 ? 'Faça uma consulta para acompanhar os processos aqui.' : 'Nenhum processo neste filtro.'}
              </p>
            )}
            {lista.length > 0 && (
              <ol className="relative list-none space-y-1 p-0">
                {/* Linha da linha do tempo, atrás dos pontos */}
                <span className="absolute bottom-3 left-[5px] top-3 w-px bg-tt-line" aria-hidden="true" />
                {lista.map(p => {
                  const risco = nivelRisco(p);
                  return (
                    <li key={p.numero} className="relative">
                      <button
                        type="button"
                        onClick={() => setAberto({ numero: p.numero, aba: 'andamentos' })}
                        className="flex w-full cursor-pointer gap-4 rounded-xl py-2 pr-2 text-left transition-colors hover:bg-white/5"
                      >
                        <span className={`relative z-[1] mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-tt-surface ${risco.ponto}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white">
                              {p.salvo && <BookmarkCheck size={14} className="text-[#1E7CF2]" aria-label="Salvo" />}
                              {p.numero}
                            </span>
                            <span className={`rounded-full border px-2 py-px text-[11px] font-semibold ${risco.classe}`}>{risco.rotulo}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-white/75">{resumoCurto(p)}</span>
                          <span className="mt-0.5 block text-[11px] text-white/45">
                            {[p.tribunal, data(p.ultimaMovimentacao)].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </ConteudoDeslizante>
        </section>
      </div>

      {/* Coluna lateral: números, saldo e atalhos */}
      <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4">
        <section aria-labelledby="resumo-titulo" className={`${CARTAO} p-4`}>
          <h2 id="resumo-titulo" className="text-sm font-semibold text-white">
            Resumo
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {[
              { rotulo: 'Processos', valor: String(kpis.total).padStart(2, '0'), destaque: false },
              { rotulo: 'Salvos', valor: String(kpis.salvos).padStart(2, '0'), destaque: false },
              { rotulo: 'Críticos', valor: String(kpis.alto).padStart(2, '0'), destaque: true },
              { rotulo: 'Custo das pesquisas', valor: reais(kpis.custo), destaque: false }
            ].map(k => (
              <div
                key={k.rotulo}
                className={`rounded-xl px-3 py-2.5 ${k.destaque ? 'bg-amber-300/20 text-amber-300' : 'bg-tt-base text-white'}`}
              >
                <dt className={`text-[11px] ${k.destaque ? '' : 'text-white/55'}`}>{k.rotulo}</dt>
                <dd className="mt-0.5 text-xl font-bold">{processos ? k.valor : '—'}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="saldo-titulo" className="bf-paper rounded-2xl p-4">
          <h2 id="saldo-titulo" className="text-xs font-medium text-white/70">
            Saldo disponível
          </h2>
          <p className="mt-1 text-2xl font-bold text-white">{consumo ? reais(consumo.restanteReais) : '—'}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
            <div className="h-full rounded-full bg-[#3FA0FF]" style={{ width: `${restantePct}%` }} />
          </div>
          {consumo && (
            <p className="mt-2 text-[11px] text-white/55">
              Usado {reais(consumo.usadoReais)} de {reais(consumo.franquiaReais)}. Renova em{' '}
              {new Date(consumo.renovaEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}.
            </p>
          )}
          <Link
            href="/planos"
            className="mt-4 flex cursor-pointer items-center justify-center rounded-lg bg-[#1E6FE8] px-4 py-2.5 text-sm font-semibold !text-white no-underline transition-colors hover:bg-[#2B7BF2]"
          >
            Adicionar créditos
          </Link>
        </section>

        <nav aria-label="Atalhos" className={`${CARTAO} p-2`}>
          {[
            { href: '/consulta', rotulo: 'Consultar processos', icone: Search },
            { href: '/processos', rotulo: 'Meus processos', icone: FolderOpen }
          ].map(a => (
            <Link
              key={a.href}
              href={a.href}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium !text-white no-underline transition-colors hover:bg-white/5"
            >
              <a.icone size={16} strokeWidth={1.8} className="text-white/70" aria-hidden="true" />
              <span className="flex-1">{a.rotulo}</span>
              <ChevronRight size={16} className="text-white/40" aria-hidden="true" />
            </Link>
          ))}
        </nav>
      </aside>

      <Drawer
        opened={!!atual}
        onClose={() => setAberto(null)}
        position="right"
        size="lg"
        padding="lg"
        title={
          atual && (
            <span className="block">
              <span className="block text-base font-semibold text-white">{atual.numero}</span>
              <span className="block text-xs text-white/50">{[atual.tribunal, atual.classe].filter(Boolean).join(' · ')}</span>
            </span>
          )
        }
      >
        {atual && aberto && (
          <>
            <AbasDeslizantes
              fullWidth
              ariaLabel="Informações do processo"
              value={aberto.aba}
              onChange={v => setAberto({ numero: atual.numero, aba: v })}
              data={ABAS.map(a => ({ label: a.label, value: a.value }))}
            />
            <ConteudoDeslizante chave={aberto.aba} direcao={direcaoAba} className="mt-5">
              {aberto.aba === 'andamentos' && <AbaAndamentos p={atual} />}
              {aberto.aba === 'risco' && <AbaRisco p={atual} />}
              {aberto.aba === 'resumo' && <AbaResumo p={atual} />}
              {aberto.aba === 'custo' && <AbaCusto p={atual} />}
            </ConteudoDeslizante>

            {!atual.salvo && (
              <div className="mt-6 rounded-2xl border border-[#1E7CF2]/25 bg-[#1E7CF2]/[0.06] p-4">
                <p className="text-sm text-white/80">Este processo foi só pesquisado. Salve para acompanhar e receber o resumo por IA.</p>
                <button
                  type="button"
                  onClick={() => salvar(atual)}
                  disabled={!atual.consultaId || salvando === atual.numero}
                  className="bf-btn-ouro mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <BookmarkPlus size={15} />
                  {salvando === atual.numero ? 'Salvando...' : 'Salvar em Meus processos'}
                </button>
                {!atual.consultaId && <p className="mt-2 text-xs text-white/50">Pesquisa antiga, sem consulta registrada: refaça a busca para salvar.</p>}
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">{texto}</p>;
}

function AbaAndamentos({ p }: { p: ProcessoInsight }) {
  if (p.movimentos.length === 0) return <Vazio texto="Nenhum andamento registrado para este processo." />;
  return (
    <ol className="relative list-none space-y-4 border-l border-white/10 pl-5">
      {p.movimentos.map((m, i) => (
        <li key={`${m.data}-${i}`} className="relative">
          <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${TAG[m.tag].cor}`} aria-hidden="true" />
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-white/50">
            <span>{data(m.data)}</span>
            <span>·</span>
            <span>{TAG[m.tag].rotulo}</span>
          </div>
          <p className="mt-0.5 text-sm font-medium text-white">{m.titulo}</p>
          {m.descricao && m.descricao !== m.titulo && <p className="mt-0.5 text-xs leading-relaxed text-white/60">{m.descricao}</p>}
        </li>
      ))}
    </ol>
  );
}

function AbaRisco({ p }: { p: ProcessoInsight }) {
  const total = p.movimentos.length || 1;
  const risco = nivelRisco(p);
  const urgentes = p.movimentos.filter(m => m.tag === 'urgente');
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-4">
        <span className="text-sm text-white/70">Nível de risco</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${risco.classe}`}>{risco.rotulo}</span>
      </div>
      <div className="space-y-2.5">
        {(Object.keys(TAG) as MovementTag[]).map(t => (
          <div key={t}>
            <div className="flex justify-between text-xs text-white/60">
              <span>{TAG[t].rotulo}</span>
              <span>{p.contagem[t]}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${TAG[t].cor}`} style={{ width: `${(p.contagem[t] / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">Atos que pedem atenção</h3>
        {urgentes.length === 0 ? (
          <p className="mt-2 text-sm text-white/60">Nenhum ato urgente (penhora, bloqueio, prazo fixado, execução) nos andamentos lidos.</p>
        ) : (
          <ul className="mt-2 list-none space-y-2 pl-0">
            {urgentes.map((m, i) => (
              <li key={i} className="rounded-xl border border-red-400/25 bg-red-400/[0.06] px-3 py-2">
                <p className="text-xs text-white/50">{data(m.data)}</p>
                <p className="text-sm text-white">{m.titulo}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-white/40">Classificação automática pelo texto dos andamentos. Não substitui a análise de um advogado.</p>
    </div>
  );
}

function AbaResumo({ p }: { p: ProcessoInsight }) {
  if (!p.salvo) return <Vazio texto="O resumo por IA é gerado na conferência noturna dos processos salvos. Salve este processo para recebê-lo." />;
  if (!p.resumoIa) return <Vazio texto="Ainda sem resumo: ele é gerado quando a conferência noturna encontrar uma movimentação nova." />;
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <p className="text-white/80">{p.resumoIa.resumo}</p>
      {p.resumoIa.statusAtual && (
        <p className="text-white/70">
          <span className="font-medium text-white">Situação: </span>
          {p.resumoIa.statusAtual}
        </p>
      )}
      {p.resumoIa.proximosPassos && (
        <p className="text-white/70">
          <span className="font-medium text-[#1E7CF2]">Próximo passo: </span>
          {p.resumoIa.proximosPassos}
        </p>
      )}
      <p className="text-[11px] text-white/40">Gerado em {dataHora(p.resumoIa.criadoEm)}. Não substitui a orientação do seu advogado.</p>
    </div>
  );
}

function AbaCusto({ p }: { p: ProcessoInsight }) {
  const linhas: [string, React.ReactNode][] = [
    ['Custo desta pesquisa', <strong key="c" className="text-white">{reais(p.custoPesquisa)}</strong>],
    ['Pesquisado em', dataHora(p.pesquisadoEm)],
    ['Situação', p.salvo ? `Salvo em ${dataHora(p.salvoEm)}` : 'Só pesquisado'],
    ['Valor da causa', p.valorCausa || '—']
  ];
  if (p.consulta) {
    linhas.push(
      ['Busca de origem', `${ROTULO_BUSCA[p.consulta.tipoBusca] ?? p.consulta.tipoBusca}: ${p.consulta.termo}`],
      ['Custo total da busca', `${reais(p.consulta.custoCobrado)} (${p.consulta.totalProcessos} processo(s))`],
      ['Tribunais consultados', p.consulta.tribunais.join(', ') || '—']
    );
  }
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/20">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
            <dt className="text-white/50">{k}</dt>
            <dd className="text-right text-white/80">{v}</dd>
          </div>
        ))}
      </dl>
      {p.canais && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${p.canais.email ? 'border-[#1E7CF2]/40 text-white/80' : 'border-white/10 text-white/40'}`}>
            <Mail size={12} /> E-mail {p.canais.email ? 'ligado' : 'desligado'}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${p.canais.whatsapp ? 'border-[#25d366]/40 text-white/80' : 'border-white/10 text-white/40'}`}>
            <MessageCircle size={12} /> WhatsApp {p.canais.whatsapp ? 'ligado' : 'desligado'}
          </span>
        </div>
      )}
      <p className="text-[11px] text-white/40">O custo de uma busca com vários processos é dividido igualmente entre eles.</p>
    </div>
  );
}
