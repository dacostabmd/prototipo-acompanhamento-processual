'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Building2, Check, Copy, Info, Loader2, Search, SearchX } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { formatCnpj } from '@/lib/format';

interface Empresa {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  municipio: string;
  uf: string;
  situacao: string;
}

interface Processo {
  numeroCnj: string;
  numeroFormatado: string;
  tribunal: string;
  classe: string;
  orgao: string;
  polo: 'ativo' | 'passivo' | 'ambos';
  correspondencia: 'exata' | 'semelhante';
  ultimaPublicacao: string;
  tipoUltimaPublicacao: string;
  resumoUltimaPublicacao: string;
  totalPublicacoes: number;
  autores: string[];
  reus: string[];
}

interface Resultado {
  empresa: Empresa | null;
  termo: string;
  processos: Processo[];
  totalPublicacoes: number;
  truncado: boolean;
  periodo: { inicio: string; fim: string };
  trt: number | 'todos';
}

type Estado =
  | { tipo: 'inicial' }
  | { tipo: 'carregando' }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'pronto'; resultado: Resultado };

const TRTS: { value: string; label: string }[] = [
  { value: '1', label: 'TRT1 — Rio de Janeiro' },
  { value: '2', label: 'TRT2 — São Paulo (capital)' },
  { value: '3', label: 'TRT3 — Minas Gerais' },
  { value: '4', label: 'TRT4 — Rio Grande do Sul' },
  { value: '5', label: 'TRT5 — Bahia' },
  { value: '6', label: 'TRT6 — Pernambuco' },
  { value: '7', label: 'TRT7 — Ceará' },
  { value: '8', label: 'TRT8 — Pará e Amapá' },
  { value: '9', label: 'TRT9 — Paraná' },
  { value: '10', label: 'TRT10 — Distrito Federal e Tocantins' },
  { value: '11', label: 'TRT11 — Amazonas e Roraima' },
  { value: '12', label: 'TRT12 — Santa Catarina' },
  { value: '13', label: 'TRT13 — Paraíba' },
  { value: '14', label: 'TRT14 — Rondônia e Acre' },
  { value: '15', label: 'TRT15 — Campinas (SP)' },
  { value: '16', label: 'TRT16 — Maranhão' },
  { value: '17', label: 'TRT17 — Espírito Santo' },
  { value: '18', label: 'TRT18 — Goiás' },
  { value: '19', label: 'TRT19 — Alagoas' },
  { value: '20', label: 'TRT20 — Sergipe' },
  { value: '21', label: 'TRT21 — Rio Grande do Norte' },
  { value: '22', label: 'TRT22 — Piauí' },
  { value: '23', label: 'TRT23 — Mato Grosso' },
  { value: '24', label: 'TRT24 — Mato Grosso do Sul' },
  { value: 'todos', label: 'Todos os TRTs' }
];

const PERIODOS = [
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: '180', label: 'Últimos 6 meses' },
  { value: '365', label: 'Último ano' }
];

const POLO_ROTULO: Record<Processo['polo'], string> = {
  passivo: 'Reclamada (polo passivo)',
  ativo: 'Reclamante (polo ativo)',
  ambos: 'Aparece nos dois polos'
};

const CAMPO =
  'w-full cursor-pointer rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-[#1E7CF2]/60 focus:ring-1 focus:ring-[#1E7CF2]/60';

const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

/** Só dígitos e pontuação de CNPJ vira máscara; qualquer letra mantém o texto como nome de empresa. */
const aplicarMascara = (texto: string) => (/^[\d.\-/\s]*$/.test(texto) ? formatCnpj(texto) : texto);

export function BuscaTrabalhista() {
  const [consulta, setConsulta] = useState('');
  const [trt, setTrt] = useState('1');
  const [dias, setDias] = useState('180');
  const [somenteAutor, setSomenteAutor] = useState(false);
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });
  const [copiado, setCopiado] = useState('');
  const sequencia = useRef(0);

  const pesquisar = async (texto: string, nomeAlternativo?: string) => {
    const q = texto.trim();
    if (q.length < 5) {
      setEstado({ tipo: 'erro', mensagem: 'Digite um CNPJ ou o nome da empresa (ao menos 5 letras).' });
      return;
    }
    const minha = ++sequencia.current;
    setEstado({ tipo: 'carregando' });
    try {
      const params = new URLSearchParams({ q, trt, dias });
      if (somenteAutor) params.set('somenteAutor', '1');
      if (nomeAlternativo) params.set('nome', nomeAlternativo);
      const res = await authFetch(`/api/trabalhista?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (minha !== sequencia.current) return; // chegou depois de uma busca mais nova
      if (!res.ok) {
        setEstado({ tipo: 'erro', mensagem: data.error || 'Não foi possível pesquisar agora. Tente novamente.' });
        return;
      }
      setEstado({ tipo: 'pronto', resultado: data as Resultado });
    } catch {
      if (minha === sequencia.current) setEstado({ tipo: 'erro', mensagem: 'Falha de conexão. Verifique sua internet e tente novamente.' });
    }
  };

  const aoEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    void pesquisar(consulta);
  };

  const copiar = async (numero: string) => {
    try {
      await navigator.clipboard.writeText(numero);
      setCopiado(numero);
      setTimeout(() => setCopiado(''), 1800);
    } catch {
      // Sem permissão de área de transferência: o número continua selecionável na tela.
    }
  };

  const resultado = estado.tipo === 'pronto' ? estado.resultado : null;
  const empresa = resultado?.empresa ?? null;
  const fantasiaDiferente =
    empresa && empresa.nomeFantasia && empresa.nomeFantasia.toUpperCase() !== resultado?.termo.toUpperCase() ? empresa.nomeFantasia : '';
  const rotuloTrt = resultado ? (resultado.trt === 'todos' ? 'todos os TRTs' : `TRT${resultado.trt}`) : '';

  return (
    <>
      <form onSubmit={aoEnviar} className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-6">
        <label htmlFor="trab-consulta" className="block text-sm font-medium text-white/80">
          CNPJ ou nome da empresa
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Building2 size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              id="trab-consulta"
              type="search"
              inputMode="search"
              value={consulta}
              onChange={e => setConsulta(aplicarMascara(e.target.value))}
              placeholder="00.000.000/0000-00 ou razão social"
              maxLength={200}
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
            Buscar
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="trab-trt" className="block text-xs font-medium text-white/60">
              Tribunal
            </label>
            <select id="trab-trt" value={trt} onChange={e => setTrt(e.target.value)} className={`mt-1 ${CAMPO}`}>
              {TRTS.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="trab-dias" className="block text-xs font-medium text-white/60">
              Publicações do diário
            </label>
            <select id="trab-dias" value={dias} onChange={e => setDias(e.target.value)} className={`mt-1 ${CAMPO}`}>
              {PERIODOS.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-3 inline-flex cursor-pointer items-start gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            checked={somenteAutor}
            onChange={e => setSomenteAutor(e.target.checked)}
            className="mt-0.5 cursor-pointer accent-[#1E7CF2]"
          />
          <span>Mostrar apenas processos em que a empresa é autora (reclamante). Empresas costumam ser rés na Justiça do Trabalho.</span>
        </label>
      </form>

      <div className="mt-5" aria-live="polite">
        {estado.tipo === 'inicial' && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <p className="m-0 text-sm font-medium text-white/80">Como funciona</p>
            <p className="mb-0 mt-2 text-sm leading-relaxed text-white/60">
              Informamos o CNPJ, buscamos a razão social na Receita Federal e procuramos o nome da empresa nas publicações do Diário de
              Justiça Eletrônico Nacional dos TRTs. É gratuito e não consome créditos.
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

        {resultado && (
          <>
            {empresa && (
              <div className="bf-paper mb-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-5">
                <p className="m-0 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#1E7CF2]">
                  <Building2 size={13} strokeWidth={1.8} />
                  Empresa (Receita Federal)
                </p>
                <h2 className="m-0 mt-1 break-words text-base font-semibold text-white sm:text-lg">{empresa.razaoSocial}</h2>
                <p className="mb-0 mt-1 text-xs text-white/60">
                  {[formatCnpj(empresa.cnpj), empresa.nomeFantasia, [empresa.municipio, empresa.uf].filter(Boolean).join('/'), empresa.situacao]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {fantasiaDiferente && (
                  <button
                    type="button"
                    onClick={() => void pesquisar(empresa.cnpj, fantasiaDiferente)}
                    className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
                  >
                    <Search size={14} />
                    Buscar também pelo nome fantasia: {fantasiaDiferente}
                  </button>
                )}
              </div>
            )}

            {resultado.processos.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
                <SearchX size={26} className="mx-auto text-white/35" />
                <p className="mb-0 mt-3 text-sm font-medium text-white/75">
                  Nenhum processo de {rotuloTrt} com publicação no período para &quot;{resultado.termo}&quot;.
                </p>
                <p className="mb-0 mt-1 text-xs text-white/50">
                  Isso não prova que não há processos: só aparecem os que tiveram publicação no diário. Tente um período maior, outro TRT ou
                  &quot;Todos os TRTs&quot;.
                </p>
              </div>
            ) : (
              <>
                <p className="mb-3 mt-0 text-xs text-white/50">
                  {resultado.processos.length} processo{resultado.processos.length === 1 ? '' : 's'} em {rotuloTrt} para &quot;{resultado.termo}&quot;
                  ({resultado.totalPublicacoes} publicaç{resultado.totalPublicacoes === 1 ? 'ão' : 'ões'} de {dataBR(resultado.periodo.inicio)} a{' '}
                  {dataBR(resultado.periodo.fim)})
                </p>
                {resultado.truncado && (
                  <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                    <Info size={15} className="mt-0.5 shrink-0" />
                    <span>
                      Há mais publicações do que o limite lido. Os processos mais antigos do período podem ter ficado de fora; reduza o período ou
                      escolha um TRT específico.
                    </span>
                  </div>
                )}
                <div className="space-y-3">
                  {resultado.processos.map(p => (
                    <article key={p.numeroCnj} className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5">
                      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <div className="min-w-0">
                          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[#1E7CF2]">
                            {p.tribunal}
                            {p.classe && <span className="ml-1.5 font-medium normal-case tracking-normal text-white/50">{p.classe}</span>}
                          </p>
                          <h3 className="m-0 mt-1 break-all text-base font-semibold tabular-nums text-white sm:text-lg">{p.numeroFormatado}</h3>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[color:var(--tt-text-2)]">
                            {POLO_ROTULO[p.polo]}
                          </span>
                          {p.correspondencia === 'semelhante' && (
                            <span
                              className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200"
                              title="O nome da parte no processo não é idêntico ao pesquisado (grafia diferente, filial ou homônimo). Confira."
                            >
                              Nome semelhante
                            </span>
                          )}
                        </div>
                      </header>

                      <p className="mb-0 mt-1.5 text-xs text-white/60">
                        {[p.orgao, `Última publicação em ${dataBR(p.ultimaPublicacao)}`, p.tipoUltimaPublicacao, `${p.totalPublicacoes} no período`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>

                      {(p.autores.length > 0 || p.reus.length > 0) && (
                        <p className="mb-0 mt-2 break-words text-xs leading-relaxed text-white/70">
                          {p.autores.length > 0 && (
                            <>
                              <span className="text-white/45">Autor(es): </span>
                              {p.autores.slice(0, 4).join('; ')}
                            </>
                          )}
                          {p.autores.length > 0 && p.reus.length > 0 && <br />}
                          {p.reus.length > 0 && (
                            <>
                              <span className="text-white/45">Réu(s): </span>
                              {p.reus.slice(0, 4).join('; ')}
                            </>
                          )}
                        </p>
                      )}

                      {p.resumoUltimaPublicacao && (
                        <p className="mb-0 mt-3 break-words text-sm leading-relaxed text-white/75">{p.resumoUltimaPublicacao}</p>
                      )}

                      <footer className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void copiar(p.numeroFormatado)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
                        >
                          {copiado === p.numeroFormatado ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                          {copiado === p.numeroFormatado ? 'Copiado' : 'Copiar número'}
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
