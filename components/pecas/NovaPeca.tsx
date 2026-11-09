'use client';

import { useEffect, useMemo, useState } from 'react';
import { Switch } from '@mantine/core';
import { AlertCircle, BookOpen, Info, Loader2, Sparkles } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { MODELOS_PECAS, obterModelo } from '@/lib/pecas/modelos';
import type { RespostaGeracao, TipoPecaId } from '@/lib/pecas/tipos';
import { BOTAO_SEC, CAMPO, IconeModelo, type PecaEditavel } from './pecasUi';

interface ProcessoOpcao {
  numero: string;
  origem: 'salvo' | 'pesquisado';
  tribunal: string;
  classe: string;
  parteContraria: string;
}

export function NovaPeca({
  semAcesso,
  onGerada,
  onPedirPro,
  onRestrito
}: {
  semAcesso: boolean;
  onGerada: (p: PecaEditavel) => void;
  onPedirPro: () => void;
  onRestrito: (mensagem: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoPecaId>(MODELOS_PECAS[0].id);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [processos, setProcessos] = useState<ProcessoOpcao[]>([]);
  const [processo, setProcesso] = useState('');
  const [juris, setJuris] = useState(false);
  const [tema, setTema] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const modelo = obterModelo(tipo)!;

  useEffect(() => {
    if (semAcesso) return;
    let ativo = true;
    authFetch('/api/pecas/processos')
      .then(r => (r.ok ? r.json() : { processos: [] }))
      .then(d => ativo && setProcessos(d.processos ?? []))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [semAcesso]);

  // Ao trocar de tipo, mantém o que foi digitado nos campos de mesmo nome (partes, fatos, pedidos...).
  const escolherTipo = (id: TipoPecaId) => {
    setTipo(id);
    setErro(null);
    if (!obterModelo(id)?.usaJurisprudencia) setJuris(false);
    if (!obterModelo(id)?.processual) setProcesso('');
  };

  const faltando = useMemo(() => modelo.campos.filter(c => c.obrigatorio && !(valores[c.id] ?? '').trim()).map(c => c.rotulo), [modelo, valores]);
  const processoEscolhido = processos.find(p => p.numero === processo);

  const gerar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (semAcesso) {
      onPedirPro();
      return;
    }
    if (faltando.length) {
      setErro(`Preencha: ${faltando.join(', ')}.`);
      return;
    }
    setErro(null);
    setGerando(true);
    try {
      const campos: Record<string, string> = {};
      for (const c of modelo.campos) campos[c.id] = (valores[c.id] ?? '').trim();
      const res = await authFetch('/api/pecas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          campos,
          processoNumero: modelo.processual && processo ? processo : undefined,
          usarJurisprudencia: modelo.usaJurisprudencia && juris,
          temaJurisprudencia: modelo.usaJurisprudencia && juris && tema.trim() ? tema.trim() : undefined
        })
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (dados.codigo === 'recurso_pro') onPedirPro();
        else if (dados.codigo === 'restrito_advogado') onRestrito(dados.error);
        else setErro(dados.error || 'Não foi possível gerar a minuta agora.');
        return;
      }
      const r = dados as RespostaGeracao;
      onGerada({
        id: r.peca?.id ?? null,
        tipo: r.tipo,
        titulo: r.titulo,
        conteudo: r.conteudo,
        modelo: r.modelo,
        tokensEntrada: r.tokensEntrada,
        tokensSaida: r.tokensSaida,
        entrada: r.entrada,
        intervencoes: r.intervencoes ?? [],
        salvo: r.salvo,
        avisoHistorico: r.avisoHistorico,
        semJulgados: r.semJulgados
      });
    } catch {
      setErro('Falha de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <form onSubmit={gerar} className="space-y-4">
      <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6">
        <h2 className="m-0 text-base font-semibold text-white">1. Escolha o tipo de peça</h2>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Tipo de peça">
          {MODELOS_PECAS.map(m => {
            const ativo = m.id === tipo;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => escolherTipo(m.id)}
                className={`flex cursor-pointer flex-col items-start gap-1.5 rounded-2xl border p-3.5 text-left transition ${
                  ativo ? 'border-[#1E7CF2]/70 bg-[#1E7CF2]/15' : 'border-white/10 bg-white/[0.03] hover:border-[#1E7CF2]/40 hover:bg-[#1E7CF2]/10'
                }`}
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                  <IconeModelo nome={m.icone} size={18} className="text-[#1E7CF2]" />
                  {m.nome}
                </span>
                <span className="text-xs leading-snug text-white/55">{m.descricao}</span>
              </button>
            );
          })}
        </div>
        <p className="mb-0 mt-3 text-xs text-white/45">
          Estrutura: {modelo.secoes.join(' · ')}
        </p>
      </section>

      <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6">
        <h2 className="m-0 text-base font-semibold text-white">2. Informe os dados</h2>
        <p className="mb-0 mt-1 text-xs text-white/50">
          A IA usa somente o que você escrever aqui e o contexto do processo. O que faltar vira um campo <strong>[PREENCHER]</strong> na minuta, nunca um dado inventado.
        </p>

        {modelo.processual && (
          <div className="mt-4">
            <label htmlFor="peca-processo" className="block text-xs font-medium text-white/70">
              Processo (opcional)
            </label>
            <select
              id="peca-processo"
              value={processo}
              onChange={e => setProcesso(e.target.value)}
              className={`mt-1.5 cursor-pointer ${CAMPO}`}
              disabled={semAcesso && processos.length === 0}
            >
              <option value="">Sem processo: preencho tudo manualmente</option>
              {processos.map(p => (
                <option key={p.numero} value={p.numero}>
                  {p.numero}
                  {p.classe ? ` · ${p.classe}` : ''}
                  {p.tribunal ? ` · ${p.tribunal}` : ''}
                </option>
              ))}
            </select>
            <p className="mb-0 mt-1.5 text-[11px] text-white/45">
              {processoEscolhido
                ? `Partes, vara, assunto e últimos andamentos de ${processoEscolhido.origem === 'salvo' ? 'um processo salvo' : 'um processo pesquisado'} entram como contexto.`
                : processos.length === 0
                  ? 'Seus processos salvos e pesquisados aparecem aqui para servir de contexto à peça.'
                  : 'Escolha um dos seus processos para a IA usar partes, vara, assunto e andamentos.'}
            </p>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {modelo.campos.map(c => {
            const id = `peca-${c.id}`;
            const largo = c.tipo === 'area';
            return (
              <div key={`${tipo}-${c.id}`} className={largo ? 'sm:col-span-2' : ''}>
                <label htmlFor={id} className="block text-xs font-medium text-white/70">
                  {c.rotulo}
                  {c.obrigatorio && <span className="text-[#1E7CF2]"> *</span>}
                </label>
                {c.ajuda && <p className="mb-0 mt-0.5 text-[11px] text-white/40">{c.ajuda}</p>}
                {c.tipo === 'area' ? (
                  <textarea
                    id={id}
                    value={valores[c.id] ?? ''}
                    onChange={e => setValores(v => ({ ...v, [c.id]: e.target.value }))}
                    placeholder={c.placeholder}
                    rows={4}
                    maxLength={6000}
                    className={`mt-1.5 resize-y ${CAMPO}`}
                  />
                ) : c.tipo === 'selecao' ? (
                  <select
                    id={id}
                    value={valores[c.id] ?? ''}
                    onChange={e => setValores(v => ({ ...v, [c.id]: e.target.value }))}
                    className={`mt-1.5 cursor-pointer ${CAMPO}`}
                  >
                    <option value="">Selecione</option>
                    {c.opcoes?.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type="text"
                    value={valores[c.id] ?? ''}
                    onChange={e => setValores(v => ({ ...v, [c.id]: e.target.value }))}
                    placeholder={c.placeholder}
                    maxLength={600}
                    className={`mt-1.5 ${CAMPO}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {modelo.usaJurisprudencia && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 sm:p-4">
            <Switch
              size="sm"
              color="brand"
              checked={juris}
              onChange={e => setJuris(e.currentTarget.checked)}
              label={
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-white/85">
                  <BookOpen size={15} className="text-[#1E7CF2]" /> Fundamentar com jurisprudência
                </span>
              }
              styles={{ track: { cursor: 'pointer' }, label: { cursor: 'pointer' } }}
            />
            <p className="mb-0 mt-2 text-[11px] leading-relaxed text-white/45">
              Busca julgados reais do STJ na base do sistema e entrega à IA só esses. A IA não pode citar nenhum outro; se a base não tiver julgado pertinente, a peça sai sem jurisprudência.
            </p>
            {juris && (
              <div className="mt-3">
                <label htmlFor="peca-tema" className="block text-xs font-medium text-white/70">
                  Tema da busca (opcional)
                </label>
                <input
                  id="peca-tema"
                  type="text"
                  value={tema}
                  onChange={e => setTema(e.target.value)}
                  placeholder="Ex.: inscrição indevida em cadastro de inadimplentes e dano moral"
                  maxLength={300}
                  className={`mt-1.5 ${CAMPO}`}
                />
                <p className="mb-0 mt-1 text-[11px] text-white/40">Sem tema, a busca usa as suas teses e os fatos informados.</p>
              </div>
            )}
          </div>
        )}

        {erro && (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-400/30 bg-red-400/10 p-3.5 text-sm text-red-300" role="alert">
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 inline-flex items-start gap-2 text-[11px] leading-relaxed text-white/45">
            <Info size={13} className="mt-0.5 shrink-0" />
            A minuta é um ponto de partida. Revise tudo antes de protocolar: a responsabilidade técnica é do advogado.
          </p>
          <button type="submit" disabled={gerando} className={`${BOTAO_SEC} w-full px-6 py-3 sm:w-auto`}>
            {gerando ? <Loader2 size={17} className="animate-spin text-[#1E7CF2]" /> : <Sparkles size={17} />}
            {gerando ? 'Gerando a minuta...' : 'Gerar minuta'}
          </button>
        </div>
        {gerando && <p className="mb-0 mt-3 text-xs text-white/50">Redigir uma peça completa leva de 10 a 40 segundos. Não feche esta tela.</p>}
      </section>
    </form>
  );
}
