'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings,
  SlidersHorizontal,
  Bell,
  Cpu,
  Monitor,
  Check,
  Save,
  ShieldCheck,
  Sparkles,
  Zap,
  Globe,
  Database,
  Radio,
  Clock,
  Layers,
  CheckCircle2,
  Info
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

const CONFIG_STORAGE_KEY = 'prosec_configuracoes_v1';

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

const ABAS: { id: AbaConfig; label: string; icon: typeof Settings }[] = [
  { id: 'geral', label: 'Geral & Varredura', icon: SlidersHorizontal },
  { id: 'notificacoes', label: 'Notificações & Alertas', icon: Bell },
  { id: 'integracoes', label: 'Integrações & APIs', icon: Cpu },
  { id: 'aparencia', label: 'Aparência & Interface', icon: Monitor }
];

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

  const toggle = (campo: keyof ConfigState) => {
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
    <div className="relative flex min-h-[calc(100vh-64px)] w-full items-start justify-center p-4 sm:p-6 lg:p-8">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-20 right-6 z-50 flex items-center gap-3 rounded-2xl border px-5 py-3.5 shadow-2xl backdrop-blur-xl ${
              toast.tipo === 'ok'
                ? 'border-amber-400/40 bg-neutral-900/90 text-amber-200 shadow-amber-950/40'
                : 'border-red-500/40 bg-red-950/90 text-red-200 shadow-red-950/40'
            }`}
          >
            {toast.tipo === 'ok' ? (
              <CheckCircle2 size={18} className="text-amber-400" />
            ) : (
              <Info size={18} className="text-red-400" />
            )}
            <span className="text-sm font-medium">{toast.texto}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-auto w-[80vw] min-h-[80vh] space-y-6">
        {/* Cabeçalho */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-amber-300 shadow-inner">
                <Settings size={22} strokeWidth={1.8} />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Configurações</h1>
            </div>
            <p className="mt-1 text-sm text-neutral-400">
              Personalize o comportamento da plataforma, parâmetros de busca, alertas e integrações judiciais.
            </p>
          </div>

          <button
            onClick={handleSalvar}
            disabled={salvando}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-500/90 via-amber-400 to-amber-500/90 px-5 py-2.5 text-sm font-semibold !text-neutral-950 shadow-md shadow-amber-950/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            style={{ color: '#0e0e0e', textDecoration: 'none' }}
          >
            {salvando ? (
              <>
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                  <Save size={16} />
                </motion.div>
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

        {/* Barra de Abas Estilizada */}
        <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-black/40 p-2.5 backdrop-blur-xl">
          {ABAS.map(item => {
            const ativa = aba === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAba(item.id)}
                className={`relative flex cursor-pointer items-center gap-2.5 rounded-xl px-7 py-4 text-sm font-medium transition-all duration-200 ${
                  ativa ? 'text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
                }`}
              >
                {ativa && (
                  <motion.div
                    layoutId="tab-pill-config"
                    className="absolute inset-0 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-500/20 via-amber-400/15 to-amber-500/20 shadow-lg shadow-amber-950/30"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <Icon
                    size={16}
                    strokeWidth={1.8}
                    className={ativa ? 'text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'text-neutral-400'}
                  />
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
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="space-y-6"
          >
            {/* ABA 1: GERAL & VARREDURA */}
            {aba === 'geral' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl sm:p-8">
                  <div className="flex items-center gap-3 border-b border-white/10 pb-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                      <SlidersHorizontal size={20} />
                    </span>
                    <div>
                      <h2 className="text-base font-semibold text-white">Parâmetros de Varredura & Consulta</h2>
                      <p className="text-xs text-neutral-400">Configure como o motor de busca opera sobre os tribunais</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    {/* Item 1 */}
                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Zap size={16} className="text-amber-400" />
                          <p className="text-sm font-medium text-white">Otimizador de Varredura Paralela</p>
                        </div>
                        <p className="text-xs text-neutral-400">
                          Dispara consultas assíncronas com timeout inteligente de 15s para evitar bloqueios em tribunais lentos.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('otimizadorVarredura')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.otimizadorVarredura ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.otimizadorVarredura ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Item 2 */}
                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Database size={16} className="text-amber-400" />
                          <p className="text-sm font-medium text-white">Auto-armazenamento de Resultados</p>
                        </div>
                        <p className="text-xs text-neutral-400">
                          Salva automaticamente novos processos localizados na sua base pessoal para consultas futuras.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('autoSalvarConsultas')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.autoSalvarConsultas ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.autoSalvarConsultas ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Item 3 */}
                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Layers size={16} className="text-amber-400" />
                          <p className="text-sm font-medium text-white">Filtro Padrão por Polo Ativo (Autor)</p>
                        </div>
                        <p className="text-xs text-neutral-400">
                          Quando ativado, novas consultas virão pré-configuradas para priorizar apenas processos onde o documento figure como autor.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('filtroAutorPadrao')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.filtroAutorPadrao ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.filtroAutorPadrao ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Configurações de Seletores */}
                    <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                          Limite de Processos por Tribunal
                        </label>
                        <select
                          value={config.limitePorTribunal}
                          onChange={e => setValor('limitePorTribunal', e.target.value)}
                          className="mt-2.5 w-full rounded-xl border border-white/15 bg-neutral-900/90 px-3.5 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                        >
                          <option value="25">Até 25 processos</option>
                          <option value="50">Até 50 processos (Recomendado)</option>
                          <option value="100">Até 100 processos</option>
                          <option value="unlimited">Sem limite (Varredura completa)</option>
                        </select>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                          Ordenação Padrão nas Listagens
                        </label>
                        <select
                          value={config.ordenacaoPadrao}
                          onChange={e => setValor('ordenacaoPadrao', e.target.value)}
                          className="mt-2.5 w-full rounded-xl border border-white/15 bg-neutral-900/90 px-3.5 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                        >
                          <option value="data_desc">Última movimentação (Mais recente primeiro)</option>
                          <option value="data_asc">Mais antigo primeiro</option>
                          <option value="tribunal">Agrupar por Tribunal / Instância</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ABA 2: NOTIFICAÇÕES & ALERTAS */}
            {aba === 'notificacoes' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl sm:p-8">
                  <div className="flex items-center gap-3 border-b border-white/10 pb-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                      <Bell size={20} />
                    </span>
                    <div>
                      <h2 className="text-base font-semibold text-white">Canais de Notificação & Avisos</h2>
                      <p className="text-xs text-neutral-400">Defina quais eventos judiciais devem disparar alertas</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white">Alertas de Novas Movimentações por E-mail</p>
                        <p className="text-xs text-neutral-400">
                          Envio imediato quando houver despachos, decisões ou sentenças em processos monitorados.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('emailMovimentacoes')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.emailMovimentacoes ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.emailMovimentacoes ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white">Avisos de Prazos Processuais e Audiências</p>
                        <p className="text-xs text-neutral-400">
                          Lembretes automáticos com 48h e 24h de antecedência para atos com data marcada.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('alertaPrazos')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.alertaPrazos ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.alertaPrazos ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white">Relatório Resumo Semanal da Carteira</p>
                        <p className="text-xs text-neutral-400">
                          Compilado semanal enviado toda segunda-feira com o status consolidado de todos os processos.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('resumoSemanal')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.resumoSemanal ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.resumoSemanal ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white">Notificações Push no Navegador</p>
                        <p className="text-xs text-neutral-400">
                          Exibir notificações na área de trabalho quando a plataforma estiver aberta em segundo plano.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('notificacoesPush')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.notificacoesPush ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.notificacoesPush ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ABA 3: INTEGRAÇÕES & APIS */}
            {aba === 'integracoes' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl sm:p-8">
                  <div className="flex items-center gap-3 border-b border-white/10 pb-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                      <Cpu size={20} />
                    </span>
                    <div>
                      <h2 className="text-base font-semibold text-white">Status das Conexões Judiciais & Provedores</h2>
                      <p className="text-xs text-neutral-400">Monitore as fontes integradas de dados processuais</p>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Card DataJud */}
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                            <Radio size={18} />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-white">DataJud (CNJ)</h3>
                            <p className="text-xs text-neutral-400">91 tribunais integrados</p>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Operacional
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-neutral-400">
                        Conexão direta com a API pública do Conselho Nacional de Justiça com endpoints estaduais, federais e trabalhistas.
                      </p>
                    </div>

                    {/* Card InfoSimples */}
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                            <Globe size={18} />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-white">InfoSimples</h3>
                            <p className="text-xs text-neutral-400">Crawler complementar</p>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          Ativo
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-neutral-400">
                        Provedor de varredura profunda com fallback inteligente e captura de metadados estendidos.
                      </p>
                    </div>
                  </div>

                  {/* Webhook */}
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                      Webhook de Notificações Externas (Opcional)
                    </label>
                    <p className="mt-1 text-xs text-neutral-400">
                      Receba payloads JSON em tempo real em seu endpoint seguro ou automações (Zapier, Make, n8n).
                    </p>
                    <input
                      type="url"
                      value={config.webhookUrl}
                      onChange={e => setValor('webhookUrl', e.target.value)}
                      placeholder="https://seu-servidor.com/api/webhook-processos"
                      className="mt-3 w-full rounded-xl border border-white/15 bg-neutral-900/90 px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-amber-400/50"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ABA 4: APARÊNCIA & INTERFACE */}
            {aba === 'aparencia' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl sm:p-8">
                  <div className="flex items-center gap-3 border-b border-white/10 pb-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                      <Monitor size={20} />
                    </span>
                    <div>
                      <h2 className="text-base font-semibold text-white">Personalização Visual & Performance</h2>
                      <p className="text-xs text-neutral-400">Ajuste o estilo e os efeitos de renderização do sistema</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white">Efeito de Fibras Interativas no Fundo (WebGL)</p>
                        <p className="text-xs text-neutral-400">
                          Renderização dinâmica de feixes dourados decorativos em segundo plano.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('efeitoFibers')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.efeitoFibers ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.efeitoFibers ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white">Modo de Alta Performance (Reduzir Animações)</p>
                        <p className="text-xs text-neutral-400">
                          Diminui transições pesadas para computadores ou conexões com menor capacidade de processamento.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle('animacoesReduzidas')}
                        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
                          config.animacoesReduzidas ? 'bg-amber-400' : 'bg-neutral-800'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
                            config.animacoesReduzidas ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400">
                        Densidade da Visualização de Tabelas
                      </label>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setValor('densidadeTabela', 'confortavel')}
                          className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition-all ${
                            config.densidadeTabela === 'confortavel'
                              ? 'border-amber-400/50 bg-amber-400/10 text-white'
                              : 'border-white/10 bg-black/20 text-neutral-400 hover:text-white'
                          }`}
                        >
                          <div>
                            <p className="text-sm font-medium">Confortável (Padrão)</p>
                            <p className="text-xs text-neutral-400">Maior espaçamento para leitura detalhada</p>
                          </div>
                          {config.densidadeTabela === 'confortavel' && <Check size={16} className="text-amber-400" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => setValor('densidadeTabela', 'compacto')}
                          className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition-all ${
                            config.densidadeTabela === 'compacto'
                              ? 'border-amber-400/50 bg-amber-400/10 text-white'
                              : 'border-white/10 bg-black/20 text-neutral-400 hover:text-white'
                          }`}
                        >
                          <div>
                            <p className="text-sm font-medium">Compacto</p>
                            <p className="text-xs text-neutral-400">Mais linhas visíveis por tela sem rolagem</p>
                          </div>
                          {config.densidadeTabela === 'compacto' && <Check size={16} className="text-amber-400" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
