'use client';

import { useState, useEffect, useId, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import AbasDeslizantes, { ConteudoDeslizante } from '@/components/AbasDeslizantes';
import {
  Settings,
  SlidersHorizontal,
  Bell,
  Save,
  Loader2,
  CheckCircle2,
  Info,
  type LucideIcon
} from 'lucide-react';

type AbaConfig = 'geral' | 'notificacoes';

interface ConfigState {
  // Geral
  ordenacaoPadrao: string;
  // Notificacoes
  emailMovimentacoes: boolean;
  alertaPrazos: boolean;
  resumoSemanal: boolean;
  notificacoesPush: boolean;
}

type CampoBooleano = { [K in keyof ConfigState]: ConfigState[K] extends boolean ? K : never }[keyof ConfigState];

const CONFIG_STORAGE_KEY = 'jusconsulta_configuracoes_v1';

const DEFAULT_CONFIG: ConfigState = {
  ordenacaoPadrao: 'data_desc',
  emailMovimentacoes: true,
  alertaPrazos: true,
  resumoSemanal: false,
  notificacoesPush: false
};

const ABAS: { id: AbaConfig; label: string; icon: LucideIcon }[] = [
  { id: 'geral', label: 'Geral & Varredura', icon: SlidersHorizontal },
  { id: 'notificacoes', label: 'Notificações & Alertas', icon: Bell }
];

// Interruptor: o knob é absoluto dentro da trilha (um inline-block dentro do <button> seria centralizado
// pelo text-align do botão e o deslocamento estouraria a trilha).
function Toggle({ ligado, onChange, rotulo }: { ligado: boolean; onChange: () => void; rotulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-tt-champagne-300/60 ${
        ligado ? 'bg-tt-champagne-300' : 'bg-tt-active'
      }`}
    >
      <span
        className={`absolute top-1 left-1 h-4 w-4 rounded-full transition-transform duration-200 ${
          ligado ? 'translate-x-5 bg-tt-ink' : 'translate-x-0 bg-tt-text-2'
        }`}
      />
    </button>
  );
}

function Secao({
  icone: Icone,
  titulo,
  descricao,
  children
}: {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  children: ReactNode;
}) {
  return (
    <section className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-xl sm:p-8">
      <header className="flex items-center gap-3 border-b border-white/10 pb-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tt-champagne-300/10 text-tt-champagne-300">
          <Icone size={20} strokeWidth={1.8} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-white">{titulo}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-tt-text-2">{descricao}</p>
        </div>
      </header>
      <div className="mt-6 space-y-3 sm:space-y-4">{children}</div>
    </section>
  );
}

function LinhaConfig({
  icone: Icone,
  titulo,
  descricao,
  children
}: {
  icone?: LucideIcon;
  titulo: string;
  descricao: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icone && <Icone size={16} strokeWidth={1.8} className="shrink-0 text-tt-champagne-300" />}
          <p className="text-sm font-medium text-white">{titulo}</p>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-tt-text-2">{descricao}</p>
      </div>
      {children}
    </div>
  );
}

function CampoSelect({
  rotulo,
  valor,
  onChange,
  opcoes
}: {
  rotulo: string;
  valor: string;
  onChange: (valor: string) => void;
  opcoes: { valor: string; texto: string }[];
}) {
  const id = useId();
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 sm:px-5">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wider text-tt-text-2">
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={e => onChange(e.target.value)}
        className="bf-input bf-input-sem-icone mt-2.5 text-sm"
      >
        {opcoes.map(o => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const [aba, setAba] = useState<AbaConfig>('geral');
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (salvo) {
        setConfig(prev => ({ ...prev, ...JSON.parse(salvo) }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const toggle = (campo: CampoBooleano) => {
    setConfig(prev => {
      const novo = { ...prev, [campo]: !prev[campo] };
      try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(novo));
      } catch {}
      return novo;
    });
  };

  const setValor = <K extends keyof ConfigState>(campo: K, valor: ConfigState[K]) => {
    setConfig(prev => {
      const novo = { ...prev, [campo]: valor };
      try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(novo));
      } catch {}
      return novo;
    });
  };

  const handleSalvar = () => {
    setSalvando(true);
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
      setTimeout(() => {
        setSalvando(false);
        setToast({ tipo: 'ok', texto: 'Configurações salvas com sucesso!' });
      }, 400);
    } catch {
      setSalvando(false);
      setToast({ tipo: 'erro', texto: 'Erro ao salvar configurações no navegador.' });
    }
  };

  return (
    <div className="bf-page relative [--bf-page-max:72rem] space-y-6 [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-20 right-4 z-50 flex items-center gap-3 rounded-2xl border bg-tt-ink/95 px-5 py-3.5 shadow-2xl shadow-black/40 backdrop-blur-xl sm:right-6 ${
              toast.tipo === 'ok'
                ? 'border-tt-champagne-300/40 text-tt-champagne-100'
                : 'border-tt-danger/40 text-tt-danger'
            }`}
          >
            {toast.tipo === 'ok' ? (
              <CheckCircle2 size={18} className="shrink-0 text-tt-champagne-300" />
            ) : (
              <Info size={18} className="shrink-0 text-tt-danger" />
            )}
            <span className="text-sm font-medium">{toast.texto}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cabeçalho */}
      <div className="bf-page-titulo flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-tt-champagne-300">
              <Settings size={22} strokeWidth={1.8} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Configurações</h1>
          </div>
          <p className="mt-2 text-sm text-tt-text-2">
            Personalize o comportamento da plataforma, parâmetros de busca e alertas.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSalvar}
          disabled={salvando}
          className="bf-page-titulo-acoes bf-btn-ouro inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg, #1E7CF2 0%, var(--tt-accent-2) 100%)',
            border: '1px solid rgb(var(--bf-fg) / 0.4)',
            color: 'var(--tt-base)'
          }}
        >
          {salvando ? (
            <>
              <motion.span
                className="inline-flex"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              >
                <Loader2 size={16} />
              </motion.span>
              <span>Salvando...</span>
            </>
          ) : (
            <>
              <Save size={16} />
              <span>Salvar Alterações</span>
            </>
          )}
        </button>
      </div>

      {/* Barra de Abas */}
      <AbasDeslizantes
        rolavel
        size="md"
        ariaLabel="Seções de configuração"
        value={aba}
        onChange={setAba}
        data={ABAS.map(item => ({
          value: item.id,
          label: (
            <>
              <item.icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </>
          )
        }))}
      />

      {/* Conteúdo das Abas: desliza para a esquerda/direita conforme a aba escolhida */}
      <ConteudoDeslizante chave={aba} ordem={ABAS.map(item => item.id)}>
        <div role="tabpanel">
          {/* ABA 1: GERAL & VARREDURA */}
          {aba === 'geral' && (
            <Secao
              icone={SlidersHorizontal}
              titulo="Parâmetros de Varredura & Consulta"
              descricao="Configure como o motor de busca opera sobre os tribunais"
            >
              <CampoSelect
                rotulo="Ordenação Padrão nas Listagens"
                valor={config.ordenacaoPadrao}
                onChange={v => setValor('ordenacaoPadrao', v)}
                opcoes={[
                  { valor: 'data_desc', texto: 'Última movimentação (Mais recente primeiro)' },
                  { valor: 'data_asc', texto: 'Mais antigo primeiro' },
                  { valor: 'tribunal', texto: 'Agrupar por Tribunal / Instância' }
                ]}
              />
            </Secao>
          )}

          {/* ABA 2: NOTIFICAÇÕES & ALERTAS */}
          {aba === 'notificacoes' && (
            <Secao
              icone={Bell}
              titulo="Canais de Notificação & Avisos"
              descricao="Defina quais eventos judiciais devem disparar alertas"
            >
              <LinhaConfig
                titulo="Alertas de Novas Movimentações por E-mail"
                descricao="Envio imediato quando houver despachos, decisões ou sentenças em processos monitorados."
              >
                <Toggle
                  ligado={config.emailMovimentacoes}
                  onChange={() => toggle('emailMovimentacoes')}
                  rotulo="Alertas de Novas Movimentações por E-mail"
                />
              </LinhaConfig>

              <LinhaConfig
                titulo="Avisos de Prazos Processuais e Audiências"
                descricao="Lembretes automáticos com 48h e 24h de antecedência para atos com data marcada."
              >
                <Toggle
                  ligado={config.alertaPrazos}
                  onChange={() => toggle('alertaPrazos')}
                  rotulo="Avisos de Prazos Processuais e Audiências"
                />
              </LinhaConfig>

              <LinhaConfig
                titulo="Relatório Resumo Semanal da Carteira"
                descricao="Compilado semanal enviado toda segunda-feira com o status consolidado de todos os processos."
              >
                <Toggle
                  ligado={config.resumoSemanal}
                  onChange={() => toggle('resumoSemanal')}
                  rotulo="Relatório Resumo Semanal da Carteira"
                />
              </LinhaConfig>

              <LinhaConfig
                titulo="Notificações Push no Navegador"
                descricao="Exibir notificações na área de trabalho quando a plataforma estiver aberta em segundo plano."
              >
                <Toggle
                  ligado={config.notificacoesPush}
                  onChange={() => toggle('notificacoesPush')}
                  rotulo="Notificações Push no Navegador"
                />
              </LinhaConfig>
            </Secao>
          )}
        </div>
      </ConteudoDeslizante>
    </div>
  );
}
