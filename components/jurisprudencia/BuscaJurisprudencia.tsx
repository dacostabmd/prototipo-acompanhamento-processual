'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Crown, Info, Loader2, Search, SearchX } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import { UpgradeProModal } from '@/components/UpgradeProModal';
import { CartaoJulgado } from './CartaoJulgado';
import { DrawerExplicacao } from './DrawerExplicacao';
import { TRIBUNAIS_DISPONIVEIS, type ItemJurisprudencia } from './utils';

const SUGESTOES = [
  'negativa de cobertura pelo plano de saúde',
  'dano moral por inscrição indevida em cadastro de inadimplentes',
  'prescrição intercorrente na execução fiscal',
  'responsabilidade do banco por fraude em transferência'
];

const CAMPO =
  'w-full cursor-pointer rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60';

type Estado =
  | { tipo: 'inicial' }
  | { tipo: 'carregando' }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'pronto'; itens: ItemJurisprudencia[]; consulta: string; tribunal: string };

export function BuscaJurisprudencia() {
  const { profile } = useSharedProfile();
  const semAcesso = profile.plano !== 'pro' && profile.role !== 'owner' && profile.role !== 'admin';

  const [consulta, setConsulta] = useState('');
  const [tribunal, setTribunal] = useState<string>(TRIBUNAIS_DISPONIVEIS[0].value);
  const [anoMin, setAnoMin] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });
  const [modalPro, setModalPro] = useState(false);
  const [explicando, setExplicando] = useState<ItemJurisprudencia | null>(null);
  const sequencia = useRef(0);

  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 11 }, (_, i) => anoAtual - i);

  const pesquisar = async (texto: string) => {
    const q = texto.trim();
    if (q.length < 3) {
      setEstado({ tipo: 'erro', mensagem: 'Digite ao menos 3 caracteres para pesquisar.' });
      return;
    }
    const minha = ++sequencia.current;
    setEstado({ tipo: 'carregando' });
    try {
      const params = new URLSearchParams({ q, tribunal, limite: '20' });
      if (anoMin) params.set('anoMin', anoMin);
      const res = await authFetch(`/api/jurisprudencia?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (minha !== sequencia.current) return; // chegou depois de uma busca mais nova
      if (!res.ok) {
        if (data.codigo === 'recurso_pro') {
          setModalPro(true);
          setEstado({ tipo: 'inicial' });
          return;
        }
        setEstado({ tipo: 'erro', mensagem: data.error || 'Não foi possível pesquisar agora. Tente novamente.' });
        return;
      }
      setEstado({ tipo: 'pronto', itens: data.itens ?? [], consulta: q, tribunal });
    } catch {
      if (minha === sequencia.current) setEstado({ tipo: 'erro', mensagem: 'Falha de conexão. Verifique sua internet e tente novamente.' });
    }
  };

  const aoEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    void pesquisar(consulta);
  };

  const usarSugestao = (s: string) => {
    setConsulta(s);
    void pesquisar(s);
  };

  return (
    <>
      {semAcesso && (
        <div className="bf-paper mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 p-4 sm:p-5">
          <p className="m-0 inline-flex items-start gap-2 text-sm text-white/80">
            <Crown size={17} className="mt-0.5 shrink-0 text-[#1E7CF2]" />
            A pesquisa de jurisprudência é um recurso do Plano Pro. Conheça como funciona e libere o acesso.
          </p>
          <button
            type="button"
            onClick={() => setModalPro(true)}
            className="bf-btn-sec inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#1E7CF2]/50 bg-[#1E7CF2]/15 px-3.5 py-2 text-xs font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25"
          >
            <Crown size={14} className="text-[#1E7CF2]" />
            Conhecer o Plano Pro
          </button>
        </div>
      )}

      <form onSubmit={aoEnviar} className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6">
        <label htmlFor="juris-consulta" className="block text-sm font-medium text-white/80">
          Descreva o tema ou a tese que você procura
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              id="juris-consulta"
              type="search"
              value={consulta}
              onChange={e => setConsulta(e.target.value)}
              placeholder="Ex.: negativa de cobertura de tratamento pelo plano de saúde"
              maxLength={300}
              autoComplete="off"
              className="w-full rounded-xl border border-white/10 bg-black/30 py-3 pl-10 pr-3.5 text-base text-white placeholder-white/30 outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60"
            />
          </div>
          <button
            type="submit"
            disabled={estado.tipo === 'carregando'}
            className="bf-btn-sec inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#1E7CF2]/50 bg-[#1E7CF2]/15 px-6 py-3 text-sm font-semibold text-[color:var(--tt-text-2)] transition-all hover:bg-[#1E7CF2]/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {estado.tipo === 'carregando' ? <Loader2 size={17} className="animate-spin text-[#1E7CF2]" /> : <Search size={17} />}
            Pesquisar
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="juris-tribunal" className="block text-xs font-medium text-white/60">
              Tribunal
            </label>
            <select id="juris-tribunal" value={tribunal} onChange={e => setTribunal(e.target.value)} className={`mt-1 ${CAMPO}`}>
              {TRIBUNAIS_DISPONIVEIS.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="juris-ano" className="block text-xs font-medium text-white/60">
              Julgados a partir de
            </label>
            <select id="juris-ano" value={anoMin} onChange={e => setAnoMin(e.target.value)} className={`mt-1 ${CAMPO}`}>
              <option value="">Qualquer data</option>
              {anos.map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>

      <div className="mt-5" aria-live="polite">
        {estado.tipo === 'inicial' && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <p className="m-0 text-sm font-medium text-white/80">Experimente uma destas buscas</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGESTOES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => usarSugestao(s)}
                  className="cursor-pointer rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-left text-xs text-white/75 transition hover:border-[#1E7CF2]/40 hover:bg-[#1E7CF2]/10"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="mb-0 mt-4 text-xs text-white/50">
              A busca entende o sentido da sua frase e também as palavras exatas, então você pode escrever como falaria com um colega.
            </p>
          </div>
        )}

        {estado.tipo === 'carregando' && (
          <div className="space-y-3" role="status" aria-label="Pesquisando">
            {[0, 1, 2].map(i => (
              <div key={i} className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                <div className="h-3 w-28 rounded bg-white/10" />
                <div className="mt-3 h-4 w-2/3 rounded bg-white/10" />
                <div className="mt-4 h-3 w-full rounded bg-white/10" />
                <div className="mt-2 h-3 w-5/6 rounded bg-white/10" />
              </div>
            ))}
          </div>
        )}

        {estado.tipo === 'erro' && (
          <div className="flex items-start gap-2.5 rounded-3xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{estado.mensagem}</span>
          </div>
        )}

        {estado.tipo === 'pronto' && estado.itens.length === 0 && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <SearchX size={26} className="mx-auto text-white/35" />
            <p className="mb-0 mt-3 text-sm font-medium text-white/75">Nenhum julgado encontrado para essa busca.</p>
            <p className="mb-0 mt-1 text-xs text-white/50">Tente outras palavras, descreva o tema com mais detalhes ou escolha &quot;Qualquer data&quot;.</p>
          </div>
        )}

        {estado.tipo === 'pronto' && estado.itens.length > 0 && (
          <>
            <p className="mb-3 mt-0 text-xs text-white/50">
              {estado.itens.length} julgado{estado.itens.length === 1 ? '' : 's'} mais relevante{estado.itens.length === 1 ? '' : 's'} para &quot;{estado.consulta}&quot;
            </p>
            <div className="space-y-3">
              {estado.itens.map(item => (
                <CartaoJulgado key={item.id} item={item} onExplicar={setExplicando} />
              ))}
            </div>
          </>
        )}
      </div>

      <p className="mb-0 mt-6 inline-flex items-start gap-2 text-[11px] leading-relaxed text-white/45">
        <Info size={13} className="mt-0.5 shrink-0" />
        Fonte: {estado.tipo === 'pronto' ? estado.tribunal : tribunal}, dados abertos (licença CC-BY). Confira sempre o inteiro teor no site do tribunal antes de citar um julgado.
      </p>

      <DrawerExplicacao item={explicando} onClose={() => setExplicando(null)} onRecursoPro={() => setModalPro(true)} />

      <UpgradeProModal
        opened={modalPro}
        onClose={() => setModalPro(false)}
        motivo="A pesquisa de jurisprudência com busca por significado e explicação dos julgados em linguagem simples é um recurso exclusivo do Plano Pro."
      />
    </>
  );
}
