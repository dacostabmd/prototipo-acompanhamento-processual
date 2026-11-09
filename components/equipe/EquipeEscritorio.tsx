'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  Building2,
  Check,
  Clock,
  Copy,
  Crown,
  Eye,
  LogOut,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users
} from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import { UpgradeProModal } from '@/components/UpgradeProModal';
import type { Escritorio } from '@/lib/equipe';

interface DadosEquipe {
  escritorio: Escritorio | null;
  podeCriar: boolean;
  limiteDoPlano: number;
}

const MOTIVO_PRO =
  'O escritório com vários usuários (até 3 pessoas compartilhando o acompanhamento de processos e do Diário) é um recurso exclusivo do Plano Pro.';

const fmtData = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const inputCls =
  'w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60';
const btnPrimario =
  'bf-btn-sec inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#1E7CF2]/50 bg-[#1E7CF2]/15 px-4 py-2.5 text-sm font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25 disabled:cursor-not-allowed disabled:opacity-50';
const btnPerigo =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-400/40 px-4 py-2.5 text-sm font-semibold text-red-300 transition-all hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50';

export function EquipeEscritorio() {
  const { profile } = useSharedProfile();
  const [dados, setDados] = useState<DadosEquipe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [modalProAberto, setModalProAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [nomeEscritorio, setNomeEscritorio] = useState('');
  const [emailConvite, setEmailConvite] = useState('');
  const [copiado, setCopiado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<null | { tipo: 'encerrar' | 'sair' } | { tipo: 'remover'; userId: string; nome: string }>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await authFetch('/api/equipe');
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(corpo.error || 'Não foi possível carregar o escritório.');
      setDados(corpo as DadosEquipe);
      setErroCarga('');
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : 'Não foi possível carregar o escritório.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const avisar = (title: string, message: string, color: 'brand' | 'red' = 'brand') => notifications.show({ title, message, color });

  /** Chamada com tratamento comum de erro; `recurso_pro` abre o modal de upgrade. */
  async function chamar(url: string, init: RequestInit): Promise<{ ok: boolean; corpo: Record<string, unknown> }> {
    setOcupado(true);
    try {
      const res = await authFetch(url, init);
      const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        if (corpo.codigo === 'recurso_pro') setModalProAberto(true);
        else avisar('Não foi possível concluir', String(corpo.error || 'Tente novamente em instantes.'), 'red');
        return { ok: false, corpo };
      }
      return { ok: true, corpo };
    } catch {
      avisar('Sem conexão', 'Verifique sua internet e tente novamente.', 'red');
      return { ok: false, corpo: {} };
    } finally {
      setOcupado(false);
    }
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!dados?.podeCriar) {
      setModalProAberto(true);
      return;
    }
    const r = await chamar('/api/equipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: nomeEscritorio })
    });
    if (r.ok) {
      setNomeEscritorio('');
      avisar('Escritório criado', 'Agora convide seus colegas por e-mail.');
      await carregar();
    }
  }

  async function convidar(e: FormEvent) {
    e.preventDefault();
    const r = await chamar('/api/equipe/convites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailConvite })
    });
    if (r.ok) {
      setEmailConvite('');
      if (r.corpo.emailEnviado) avisar('Convite enviado', 'A pessoa recebeu o link por e-mail.');
      else avisar('Convite criado', 'O e-mail não pôde ser enviado agora. Copie o link e envie você mesmo.');
      await carregar();
    }
  }

  async function revogar(id: string) {
    const r = await chamar(`/api/equipe/convites?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.ok) {
      avisar('Convite revogado', 'O link deixou de funcionar.');
      await carregar();
    }
  }

  async function copiarLink(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(id);
      setTimeout(() => setCopiado(atual => (atual === id ? null : atual)), 2000);
    } catch {
      avisar('Não foi possível copiar', 'Selecione o link e copie manualmente.', 'red');
    }
  }

  async function confirmarAcao() {
    const acao = confirmando;
    if (!acao) return;
    const r =
      acao.tipo === 'remover'
        ? await chamar(`/api/equipe/membros/${encodeURIComponent(acao.userId)}`, { method: 'DELETE' })
        : await chamar('/api/equipe', { method: 'DELETE' });
    setConfirmando(null);
    if (r.ok) {
      avisar(
        acao.tipo === 'encerrar' ? 'Escritório encerrado' : acao.tipo === 'sair' ? 'Você saiu do escritório' : 'Membro removido',
        acao.tipo === 'remover' ? `${acao.nome} não vê mais o acompanhamento do escritório.` : 'O compartilhamento foi desfeito.'
      );
      await carregar();
    }
  }

  if (carregando) {
    return (
      <div className="bf-paper mt-8 flex items-center gap-2 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
        <Loader2 size={16} className="animate-spin text-[#1E7CF2]" /> Carregando escritório...
      </div>
    );
  }

  if (erroCarga || !dados) {
    return (
      <div className="bf-paper mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
        <p className="m-0">{erroCarga || 'Não foi possível carregar o escritório.'}</p>
        <button type="button" onClick={() => { setCarregando(true); carregar(); }} className={`${btnPrimario} mt-4`}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const esc = dados.escritorio;
  const eDono = esc?.meuPapel === 'dono';
  const convitesValidos = esc?.convites.filter(c => !c.expirado) ?? [];
  const usados = esc ? esc.membros.length + convitesValidos.length : 0;
  const percentual = esc ? Math.min(100, Math.round((usados / Math.max(1, esc.limiteMembros)) * 100)) : 0;
  const cheio = esc ? usados >= esc.limiteMembros : false;

  return (
    <>
      {!esc ? (
        <section className="bf-paper mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md sm:p-6">
          <h2 className="m-0 inline-flex items-center gap-2 text-lg font-semibold text-white">
            <Building2 size={19} strokeWidth={1.8} className="text-[#1E7CF2]" />
            Trabalhe em equipe
          </h2>
          <p className="mb-0 mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
            Crie um escritório e convide colegas por e-mail. Todos passam a ver, em modo leitura, os processos acompanhados e as buscas do Diário uns dos
            outros. Cada pessoa continua sendo a única a alterar o que cadastrou, e cada uma recebe os próprios avisos.
          </p>
          <ul className="mb-0 mt-4 grid list-none gap-2 p-0 text-sm text-white/70 sm:grid-cols-3">
            <li className="flex items-start gap-2"><Users size={16} className="mt-0.5 shrink-0 text-[#1E7CF2]" /> Até 3 pessoas no Plano Pro</li>
            <li className="flex items-start gap-2"><Eye size={16} className="mt-0.5 shrink-0 text-[#1E7CF2]" /> Compartilhamento somente leitura</li>
            <li className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#1E7CF2]" /> Convite válido por 7 dias, só para o e-mail convidado</li>
          </ul>

          <form onSubmit={criar} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="nome-escritorio" className="block text-xs font-medium text-white/70">Nome do escritório</label>
              <input
                id="nome-escritorio"
                value={nomeEscritorio}
                onChange={e => setNomeEscritorio(e.target.value)}
                maxLength={80}
                placeholder="Ex.: Silva & Associados"
                className={`${inputCls} mt-1.5`}
                required={dados.podeCriar}
              />
            </div>
            {dados.podeCriar ? (
              <button type="submit" disabled={ocupado || nomeEscritorio.trim().length < 2} className={btnPrimario}>
                {ocupado ? <Loader2 size={16} className="animate-spin" /> : <Building2 size={16} />} Criar escritório
              </button>
            ) : (
              <button type="button" onClick={() => setModalProAberto(true)} className={btnPrimario}>
                <Crown size={16} className="text-[#1E7CF2]" /> {profile.plano === 'pro' ? 'Criar escritório' : 'Assinar o Pro para criar'}
              </button>
            )}
          </form>
        </section>
      ) : (
        <div className="mt-8 grid gap-6">
          <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="m-0 inline-flex items-center gap-2 break-words text-lg font-semibold text-white">
                  <Building2 size={19} strokeWidth={1.8} className="shrink-0 text-[#1E7CF2]" />
                  {esc.nome}
                </h2>
                <p className="mb-0 mt-1 text-xs text-white/50">
                  {eDono ? 'Você é o dono deste escritório' : 'Você é membro deste escritório'} · criado em {fmtData(esc.criadoEm)}
                </p>
              </div>
              {eDono ? (
                <button type="button" onClick={() => setConfirmando({ tipo: 'encerrar' })} className={btnPerigo}>
                  <Trash2 size={15} /> Encerrar escritório
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmando({ tipo: 'sair' })} className={btnPerigo}>
                  <LogOut size={15} /> Sair do escritório
                </button>
              )}
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">
                  <strong className="text-white">{usados}</strong> de <strong className="text-white">{esc.limiteMembros}</strong>{' '}
                  {esc.limiteMembros === 1 ? 'usuário' : 'usuários'}
                </span>
                <span className="text-xs text-white/40">Plano {esc.planoDono} do dono</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={usados} aria-valuemin={0} aria-valuemax={esc.limiteMembros}>
                <div className={`h-full rounded-full ${cheio ? 'bg-amber-400' : 'bg-[#1E7CF2]'}`} style={{ width: `${percentual}%` }} />
              </div>
              {eDono && convitesValidos.length > 0 && <p className="mb-0 mt-1.5 text-[11px] text-white/40">Convites pendentes contam como vaga.</p>}
            </div>
          </section>

          <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md sm:p-6">
            <h2 className="m-0 inline-flex items-center gap-2 text-base font-semibold text-white">
              <Users size={18} strokeWidth={1.8} className="text-[#1E7CF2]" /> Membros
            </h2>
            <ul className="mb-0 mt-4 grid list-none gap-2 p-0">
              {esc.membros.map(m => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-white">{m.nome}</p>
                    {m.email && <p className="m-0 truncate text-xs text-white/50">{m.email}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        m.papel === 'dono' ? 'border-[#1E7CF2]/40 bg-[#1E7CF2]/10 text-[color:var(--tt-text-2)]' : 'border-white/15 text-white/60'
                      }`}
                    >
                      {m.papel === 'dono' ? <Crown size={11} className="text-[#1E7CF2]" /> : <Eye size={11} />}
                      {m.papel === 'dono' ? 'Dono' : 'Membro'}
                    </span>
                    {eDono && m.papel !== 'dono' && (
                      <button
                        type="button"
                        onClick={() => setConfirmando({ tipo: 'remover', userId: m.userId, nome: m.nome })}
                        aria-label={`Remover ${m.nome}`}
                        className="cursor-pointer rounded-lg p-1.5 text-white/40 transition hover:bg-red-400/10 hover:text-red-300"
                      >
                        <UserMinus size={16} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {eDono && (
            <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md sm:p-6">
              <h2 className="m-0 inline-flex items-center gap-2 text-base font-semibold text-white">
                <UserPlus size={18} strokeWidth={1.8} className="text-[#1E7CF2]" /> Convidar por e-mail
              </h2>
              <form onSubmit={convidar} className="mt-4 flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="email"
                    value={emailConvite}
                    onChange={e => setEmailConvite(e.target.value)}
                    placeholder="colega@escritorio.com.br"
                    aria-label="E-mail do convidado"
                    className={`${inputCls} pl-9`}
                    required
                  />
                </div>
                <button type="submit" disabled={ocupado || cheio || !emailConvite.trim()} className={btnPrimario}>
                  {ocupado ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar convite
                </button>
              </form>
              {cheio && <p className="mb-0 mt-2 text-xs text-amber-300">O escritório chegou ao limite do plano. Remova alguém ou revogue um convite para convidar outra pessoa.</p>}

              {esc.convites.length > 0 && (
                <div className="mt-5">
                  <h3 className="m-0 text-sm font-semibold text-white/80">Convites pendentes</h3>
                  <ul className="mb-0 mt-3 grid list-none gap-2 p-0">
                    {esc.convites.map(c => (
                      <li key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-medium text-white">{c.email}</p>
                            <p className={`m-0 mt-0.5 inline-flex items-center gap-1 text-xs ${c.expirado ? 'text-red-300' : 'text-white/50'}`}>
                              <Clock size={11} /> {c.expirado ? 'Expirou' : 'Expira'} em {fmtData(c.expiraEm)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {!c.expirado && (
                              <button
                                type="button"
                                onClick={() => copiarLink(c.id, c.link)}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-[#1E7CF2]/50 hover:text-white"
                              >
                                {copiado === c.id ? <Check size={13} className="text-[#25D366]" /> : <Copy size={13} />}
                                {copiado === c.id ? 'Copiado' : 'Copiar link'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => revogar(c.id)}
                              disabled={ocupado}
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:border-red-400/50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 size={13} /> Revogar
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <Modal
        opened={confirmando !== null}
        onClose={() => setConfirmando(null)}
        centered
        radius="lg"
        size="sm"
        title={
          <span className="font-semibold text-white">
            {confirmando?.tipo === 'encerrar' ? 'Encerrar o escritório?' : confirmando?.tipo === 'sair' ? 'Sair do escritório?' : 'Remover membro?'}
          </span>
        }
      >
        <p className="m-0 text-sm leading-relaxed text-white/70">
          {confirmando?.tipo === 'encerrar' &&
            'Todos os membros perdem o acesso ao acompanhamento uns dos outros e os convites pendentes deixam de valer. Os processos e buscas de cada pessoa continuam na conta dela.'}
          {confirmando?.tipo === 'sair' && 'Você deixa de ver os processos e buscas dos colegas. Os seus continuam na sua conta.'}
          {confirmando?.tipo === 'remover' && `${confirmando.nome} deixa de ver o acompanhamento do escritório. Os dados da conta dela continuam com ela.`}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmando(null)}
            className="cursor-pointer rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition hover:text-white"
          >
            Cancelar
          </button>
          <button type="button" onClick={confirmarAcao} disabled={ocupado} className={btnPerigo}>
            {ocupado && <Loader2 size={15} className="animate-spin" />}
            {confirmando?.tipo === 'encerrar' ? 'Encerrar escritório' : confirmando?.tipo === 'sair' ? 'Sair' : 'Remover'}
          </button>
        </div>
      </Modal>

      <UpgradeProModal opened={modalProAberto} onClose={() => setModalProAberto(false)} motivo={MOTIVO_PRO} onSucesso={() => carregar()} />
    </>
  );
}
