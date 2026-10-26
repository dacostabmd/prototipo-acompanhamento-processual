'use client';

import { useState, useEffect, useId, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings,
  SlidersHorizontal,
  Bell,
  Cpu,
  Monitor,
  Check,
  Save,
  Loader2,
  Zap,
  Globe,
  Database,
  Radio,
  Layers,
  CheckCircle2,
  Info,
  type LucideIcon
} from 'lucide-react';

type AbaConfig = 'geral' | 'notificacoes' | 'integracoes' | 'aparencia';

interface ConfigState {
  // Geral
  autoSalvarConsultas: boolean;
  otimizadorVarredura: boolean;
  filtroAutorPadrao: boolean;
  limitePorTribunal: string;
  ordenacaoPadrao: string;
  // Notificacoes
  emailMovimentacoes: boolean;
  alertaPrazos: boolean;
  resumoSemanal: boolean;
  notificacoesPush: boolean;
  // Integracoes
  datajudAtivo: boolean;
  infosimplesAtivo: boolean;
  webhookUrl: string;
  // Aparencia
  efeitoFibers: boolean;
  densidadeTabela: 'confortavel' | 'compacto';
  animacoesReduzidas: boolean;
}

type CampoBooleano = { [K in keyof ConfigState]: ConfigState[K] extends boolean ? K : never }[keyof ConfigState];

const CONFIG_STORAGE_KEY = 'jusconsulta_configuracoes_v1';

const DEFAULT_CONFIG: ConfigState = {
  autoSalvarConsultas: true,
  otimizadorVarredura: true,
  filtroAutorPadrao: false,
  limitePorTribunal: '50',
  ordenacaoPadrao: 'data_desc',
  emailMovimentacoes: true,
  alertaPrazos: true,
  resumoSemanal: false,
  notificacoesPush: false,
  datajudAtivo: true,
  infosimplesAtivo: true,
  webhookUrl: '',
  efeitoFibers: true,
  densidadeTabela: 'confortavel',
  animacoesReduzidas: false
};

const ABAS: { id: AbaConfig; label: string; icon: LucideIcon }[] = [
  { id: 'geral', label: 'Geral & Varredura', icon: SlidersHorizontal },
  { id: 'notificacoes', label: 'Notificações & Alertas', icon: Bell },
  { id: 'integracoes', label: 'Integrações & APIs', icon: Cpu },
  { id: 'aparencia', label: 'Aparência & Interface', icon: Monitor }
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
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-xl sm:p-8">
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

function CartaoFonte({
  icone: Icone,
  nome,
  detalhe,
  status,
  descricao,
  tom
}: {
  icone: LucideIcon;
  nome: string;
  detalhe: string;
  status: string;
  descricao: string;
  tom: 'sucesso' | 'acento';
}) {
  const cores =
    tom === 'sucesso'
      ? { icone: 'bg-tt-success/15 text-tt-success', chip: 'border-tt-success/30 bg-tt-success/10 text-tt-success', ponto: 'bg-tt-success animate-pulse' }
      : {
          icone: 'bg-tt-champagne-300/15 text-tt-champagne-300',
          chip: 'border-tt-champagne-300/30 bg-tt-champagne-300/10 text-tt-champagne-300',
          ponto: 'bg-tt-champagne-300'
        };
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cores.icone}`}>
            <Icone size={18} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">{nome}</h3>
            <p className="text-[13px] text-tt-text-2">{detalhe}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cores.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cores.ponto}`} />
          {status}
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-tt-text-2">{descricao}</p>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const [aba, setAba] = useState<AbaConfig>('geral');
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const webhookId = useId();

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

  const opcaoDensidade = (valor: ConfigState['densidadeTabela'], titulo: string, descricao: string) => {
    const ativa = config.densidadeTabela === valor;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={ativa}
        onClick={() => setValor('densidadeTabela', valor)}
        className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-tt-champagne-300/60 ${
          ativa
            ? 'border-tt-champagne-300/50 bg-tt-champagne-300/10 text-white'
            : 'border-white/10 bg-black/20 text-tt-text-2 hover:border-white/20 hover:text-white'
        }`}
      >
        <div>
          <p className="text-sm font-medium">{titulo}</p>
          <p className="mt-0.5 text-[13px] text-tt-text-2">{descricao}</p>
        </div>
        {ativa && <Check size={16} className="shrink-0 text-tt-champagne-300" />}
      </button>
    );
  };

  return (
    <div className="relative mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-8 lg:p-10 [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0">
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-tt-champagne-300">
              <Settings size={22} strokeWidth={1.8} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Configurações</h1>
          </div>
          <p className="mt-2 text-sm text-tt-text-2">
            Personalize o comportamento da plataforma, parâmetros de busca, alertas e integrações judiciais.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSalvar}
          disabled={salvando}
          className="bf-btn-ouro inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg, #1E7CF2 0%, #3FA0FF 100%)',
            border: '1px solid rgba(201, 214, 238, 0.4)',
            color: '#0B1730'
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
      <div
        role="tablist"
        aria-label="Seções de configuração"
        className="flex gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-2 backdrop-blur-xl"
      >
        {ABAS.map(item => {
          const ativa = aba === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setAba(item.id)}
              className={`relative flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-tt-champagne-300/60 sm:px-5 sm:py-3 ${
                ativa ? 'text-white' : 'text-tt-text-2 hover:bg-white/5 hover:text-white'
              }`}
            >
              {ativa && (
                <motion.div
                  layoutId="tab-pill-config"
                  className="absolute inset-0 rounded-xl border border-tt-champagne-300/40 bg-tt-champagne-300/10"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Icon size={16} strokeWidth={1.8} className={ativa ? 'text-tt-champagne-300' : 'text-tt-text-2'} />
                <span>{item.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo das Abas */}
      <AnimatePresence mode="wait">
        <motion.div
          key={aba}
          role="tabpanel"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {/* ABA 1: GERAL & VARREDURA */}
          {aba === 'geral' && (
            <Secao
              icone={SlidersHorizontal}
              titulo="Parâmetros de Varredura & Consulta"
              descricao="Configure como o motor de busca opera sobre os tribunais"
            >
              <LinhaConfig
                icone={Zap}
                titulo="Otimizador de Varredura Paralela"
                descricao="Dispara consultas assíncronas com timeout inteligente de 15s para evitar bloqueios em tribunais lentos."
              >
                <Toggle
                  ligado={config.otimizadorVarredura}
                  onChange={() => toggle('otimizadorVarredura')}
                  rotulo="Otimizador de Varredura Paralela"
                />
              </LinhaConfig>

              <LinhaConfig
                icone={Database}
                titulo="Auto-armazenamento de Resultados"
                descricao="Salva automaticamente novos processos localizados na sua base pessoal para consultas futuras."
              >
                <Toggle
                  ligado={config.autoSalvarConsultas}
                  onChange={() => toggle('autoSalvarConsultas')}
                  rotulo="Auto-armazenamento de Resultados"
                />
              </LinhaConfig>

              <LinhaConfig
                icone={Layers}
                titulo="Filtro Padrão por Polo Ativo (Autor)"
                descricao="Quando ativado, novas consultas virão pré-configuradas para priorizar apenas processos onde o documento figure como autor."
              >
                <Toggle
                  ligado={config.filtroAutorPadrao}
                  onChange={() => toggle('filtroAutorPadrao')}
                  rotulo="Filtro Padrão por Polo Ativo (Autor)"
                />
              </LinhaConfig>

              <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
                <CampoSelect
                  rotulo="Limite de Processos por Tribunal"
                  valor={config.limitePorTribunal}
                  onChange={v => setValor('limitePorTribunal', v)}
                  opcoes={[
                    { valor: '25', texto: 'Até 25 processos' },
                    { valor: '50', texto: 'Até 50 processos (Recomendado)' },
                    { valor: '100', texto: 'Até 100 processos' },
                    { valor: 'unlimited', texto: 'Sem limite (Varredura completa)' }
                  ]}
                />
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
              </div>
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

          {/* ABA 3: INTEGRAÇÕES & APIS */}
          {aba === 'integracoes' && (
            <Secao
              icone={Cpu}
              titulo="Status das Conexões Judiciais & Provedores"
              descricao="Monitore as fontes integradas de dados processuais"
            >
              <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
                <CartaoFonte
                  icone={Radio}
                  nome="DataJud (CNJ)"
                  detalhe="91 tribunais integrados"
                  status="Operacional"
                  tom="sucesso"
                  descricao="Conexão direta com a API pública do Conselho Nacional de Justiça com endpoints estaduais, federais e trabalhistas."
                />
                <CartaoFonte
                  icone={Globe}
                  nome="InfoSimples"
                  detalhe="Crawler complementar"
                  status="Ativo"
                  tom="acento"
                  descricao="Provedor de varredura profunda com fallback inteligente e captura de metadados estendidos."
                />
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-5">
                <label htmlFor={webhookId} className="block text-xs font-semibold uppercase tracking-wider text-tt-text-2">
                  Webhook de Notificações Externas (Opcional)
                </label>
                <p className="mt-1 text-[13px] text-tt-text-2">
                  Receba payloads JSON em tempo real em seu endpoint seguro ou automações (Zapier, Make, n8n).
                </p>
                <input
                  id={webhookId}
                  type="url"
                  value={config.webhookUrl}
                  onChange={e => setValor('webhookUrl', e.target.value)}
                  placeholder="https://seu-servidor.com/api/webhook-processos"
                  className="bf-input bf-input-sem-icone mt-3 text-sm"
                />
              </div>
            </Secao>
          )}

          {/* ABA 4: APARÊNCIA & INTERFACE */}
          {aba === 'aparencia' && (
            <Secao
              icone={Monitor}
              titulo="Personalização Visual & Performance"
              descricao="Ajuste o estilo e os efeitos de renderização do sistema"
            >
              <LinhaConfig
                titulo="Efeito de Fibras Interativas no Fundo (WebGL)"
                descricao="Renderização dinâmica de feixes dourados decorativos em segundo plano."
              >
                <Toggle
                  ligado={config.efeitoFibers}
                  onChange={() => toggle('efeitoFibers')}
                  rotulo="Efeito de Fibras Interativas no Fundo (WebGL)"
                />
              </LinhaConfig>

              <LinhaConfig
                titulo="Modo de Alta Performance (Reduzir Animações)"
                descricao="Diminui transições pesadas para computadores ou conexões com menor capacidade de processamento."
              >
                <Toggle
                  ligado={config.animacoesReduzidas}
                  onChange={() => toggle('animacoesReduzidas')}
                  rotulo="Modo de Alta Performance (Reduzir Animações)"
                />
              </LinhaConfig>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-5">
                <p id="rotulo-densidade" className="text-xs font-semibold uppercase tracking-wider text-tt-text-2">
                  Densidade da Visualização de Tabelas
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="rotulo-densidade"
                  className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  {opcaoDensidade('confortavel', 'Confortável (Padrão)', 'Maior espaçamento para leitura detalhada')}
                  {opcaoDensidade('compacto', 'Compacto', 'Mais linhas visíveis por tela sem rolagem')}
                </div>
              </div>
            </Secao>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
