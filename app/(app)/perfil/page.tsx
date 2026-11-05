'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  Check,
  Coins,
  Compass,
  Crown,
  Eye,
  EyeOff,
  FileBadge,
  Gavel,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  Phone,
  Save,
  ShieldCheck,
  User,
  UserCog,
  X,
  type LucideIcon
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { authFetch } from '@/lib/authFetch';
import { cleanDigits, formatCpf, formatDocumento, formatPhone, isValidCpf } from '@/lib/format';
import { useSharedProfile } from '@/components/ProfileProvider';
import { EVENTO_TOUR, EVENTO_TOUR_ALVO } from '@/components/tour/TourGuiado';
import AbasDeslizantes, { ConteudoDeslizante } from '@/components/AbasDeslizantes';

interface Conta {
  email: string;
  nome: string;
  cpf: string;
  oab: string;
  telefone: string;
  role: string;
  documento: string;
  documentoTipo: string;
  plano: 'free' | 'pro';
  provedores: string[];
  criadoEm: string | null;
}

interface StatusPlano {
  plano: 'free' | 'pro';
  regras: { nome: string; limiteProcessosMonitorados: number; whatsappConversacional: boolean };
  totalProcessosMonitorados: number;
  consumo: { franquiaReais: number; usadoReais: number; restanteReais: number; percentualUsado: number; renovaEm: string };
}

const ROTULO_ROLE: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  broker: 'Broker',
  advogado: 'Advogado',
  cliente: 'Consulta Avulsa'
};

const PERMISSOES_ROLE: Record<string, string[]> = {
  advogado: [
    'Consulta qualquer processo pelo número',
    'Busca por pessoa ou empresa (CPF/CNPJ) em vários tribunais',
    'Gestão da carteira de processos e alertas'
  ],
  broker: [
    'Consulta livre por número, CPF ou CNPJ',
    'Análise de precatórios e ativos judiciais',
    'Gestão da carteira de processos e alertas'
  ],
  cliente: [
    'Consulta restrita ao CPF/CNPJ do titular',
    'Acompanhamento dos processos desse documento',
    'Alertas traduzidos por IA no e-mail e no WhatsApp'
  ],
  admin: ['Todas as consultas liberadas', 'Histórico de consultas de todos os usuários', 'Liberação manual de planos'],
  owner: ['Todas as consultas liberadas', 'Histórico de consultas de todos os usuários', 'Publicação de novidades e liberação de planos']
};

type AbaPerfil = 'dados' | 'acesso' | 'alertas' | 'seguranca';

/** Abas da coluna principal. `tour` = data-tour do cartão: o tour guiado abre a aba certa antes de destacá-lo. */
const ABAS_PERFIL: { value: AbaPerfil; label: string; icone: LucideIcon; tour: string }[] = [
  { value: 'dados', label: 'Dados pessoais', icone: User, tour: 'perfil-dados' },
  { value: 'acesso', label: 'Tipo de acesso', icone: UserCog, tour: 'perfil-acesso' },
  { value: 'alertas', label: 'Alertas', icone: BellRing, tour: 'perfil-notificacoes' },
  { value: 'seguranca', label: 'Segurança', icone: KeyRound, tour: 'perfil-seguranca' }
];

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' });
const iniciarTour = (id?: string) => window.dispatchEvent(new CustomEvent(EVENTO_TOUR, { detail: id }));

const INPUT =
  'w-full rounded-xl border border-white/15 bg-black/30 py-2.5 pr-4 pl-10 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-[#1E7CF2]/70 focus:ring-1 focus:ring-[#1E7CF2]/40';
const BOTAO_PRIMARIO =
  'bf-btn-ouro inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const BOTAO_SECUNDARIO =
  'bf-btn-sec inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white/80 disabled:cursor-not-allowed disabled:opacity-50';

function Cartao({
  icone: Icone,
  titulo,
  descricao,
  tour,
  acao,
  children
}: {
  icone: LucideIcon;
  titulo: string;
  descricao?: string;
  tour: string;
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-tour={tour} className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-xl sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1E7CF2]/12 text-[#3FA0FF]">
            <Icone size={19} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">{titulo}</h2>
            {descricao && <p className="mt-0.5 text-[13px] leading-snug text-white/55">{descricao}</p>}
          </div>
        </div>
        {acao}
      </header>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Campo({
  id,
  rotulo,
  icone: Icone,
  dica,
  children
}: {
  id: string;
  rotulo: string;
  icone: LucideIcon;
  dica?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-semibold text-white/70">
        {rotulo}
      </label>
      <div className="relative mt-1.5">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-white/40">
          <Icone size={16} />
        </span>
        {children}
      </div>
      {dica && <p className="mt-1 text-[11.5px] leading-snug text-white/45">{dica}</p>}
    </div>
  );
}

function Barra({ percentual, nivel }: { percentual: number; nivel: 'ok' | 'atencao' | 'critico' }) {
  const cor = nivel === 'critico' ? '#f31260' : nivel === 'atencao' ? '#f5a524' : '#1E7CF2';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, percentual))}%`, background: cor }} />
    </div>
  );
}

export default function Perfil() {
  const { refresh: atualizarPerfilCompartilhado } = useSharedProfile();
  const [conta, setConta] = useState<Conta | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPlano | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cpf, setCpf] = useState('');
  const [oab, setOab] = useState('');
  const [email, setEmail] = useState('');
  const [salvandoDados, setSalvandoDados] = useState(false);

  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [senhaConfirma, setSenhaConfirma] = useState('');
  const [mostrarSenhas, setMostrarSenhas] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [encerrandoSessoes, setEncerrandoSessoes] = useState(false);
  const [aba, setAba] = useState<AbaPerfil>('dados');

  // Tour guiado: quando um passo aponta para o cartão de uma aba, abre essa aba para o alvo existir.
  useEffect(() => {
    const aoPedirAlvo = (e: Event) => {
      const alvo = (e as CustomEvent<string>).detail;
      const destino = ABAS_PERFIL.find(a => a.tour === alvo);
      if (destino) setAba(destino.value);
    };
    window.addEventListener(EVENTO_TOUR_ALVO, aoPedirAlvo);
    return () => window.removeEventListener(EVENTO_TOUR_ALVO, aoPedirAlvo);
  }, []);

  useEffect(() => {
    const carregar = async () => {
      const supabase = getSupabase();
      if (!supabase) {
        // Modo demonstração (sem Supabase configurado)
        const demo = localStorage.getItem('bf-demo-user') || 'demo@jusconsulta.com.br';
        const c: Conta = {
          email: demo,
          nome: 'Usuário de demonstração',
          cpf: '',
          oab: '',
          telefone: '',
          role: localStorage.getItem('bf-demo-role') || 'advogado',
          documento: localStorage.getItem('bf-demo-documento') || '',
          documentoTipo: localStorage.getItem('bf-demo-documento-tipo') || '',
          plano: (localStorage.getItem('bf-demo-plano') as 'free' | 'pro') || 'free',
          provedores: ['email'],
          criadoEm: null
        };
        preencher(c);
        return;
      }

      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (!u) return;
      setUserId(u.id);
      const { data: p } = await supabase
        .from('ap_perfis')
        .select('nome,cpf,oab,telefone,role,documento,documento_tipo,plano')
        .eq('id', u.id)
        .maybeSingle();
      const provedores = Array.isArray(u.app_metadata?.providers) ? (u.app_metadata.providers as string[]) : [u.app_metadata?.provider ?? 'email'];
      preencher({
        email: u.email ?? '',
        nome: p?.nome ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? '',
        cpf: p?.cpf ? formatCpf(p.cpf) : '',
        oab: p?.oab ?? '',
        telefone: p?.telefone ? formatPhone(p.telefone) : '',
        role: p?.role ?? 'advogado',
        documento: p?.documento ?? '',
        documentoTipo: p?.documento_tipo ?? '',
        plano: p?.plano === 'pro' ? 'pro' : 'free',
        provedores,
        criadoEm: u.created_at ?? null
      });
    };

    const preencher = (c: Conta) => {
      setConta(c);
      setNome(c.nome);
      setTelefone(c.telefone);
      setCpf(c.cpf);
      setOab(c.oab);
      setEmail(c.email);
    };

    carregar().catch(err => {
      console.error('[Perfil] Falha ao carregar:', err);
      setMensagem({ tipo: 'erro', texto: 'Não foi possível carregar seu perfil agora.' });
    });

    authFetch('/api/planos')
      .then(r => (r.ok ? r.json() : null))
      .then(d => d?.consumo && setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!mensagem) return;
    const t = setTimeout(() => setMensagem(null), 6000);
    return () => clearTimeout(t);
  }, [mensagem]);

  if (!conta) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
          <p className="text-sm text-white/50">Carregando seu perfil...</p>
        </div>
      </div>
    );
  }

  const isConsultante = conta.role === 'cliente';
  const isPro = (status?.plano ?? conta.plano) === 'pro';
  const temSenha = conta.provedores.includes('email');
  const temGoogle = conta.provedores.includes('google');
  const telefoneDigitos = cleanDigits(telefone);
  const telefoneValido = telefoneDigitos.length === 0 || telefoneDigitos.length >= 10;
  const whatsappCadastrado = cleanDigits(conta.telefone).length >= 10;

  const iniciais =
    conta.nome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(n => n[0].toUpperCase())
      .join('') || 'U';

  const alterado =
    nome.trim() !== conta.nome ||
    telefone !== conta.telefone ||
    cpf !== conta.cpf ||
    oab.trim() !== conta.oab ||
    email.trim().toLowerCase() !== conta.email.toLowerCase();

  const salvarDados = async (e: FormEvent) => {
    e.preventDefault();
    setMensagem(null);
    if (nome.trim().length < 3) return setMensagem({ tipo: 'erro', texto: 'Informe seu nome completo.' });
    if (!telefoneValido) return setMensagem({ tipo: 'erro', texto: 'O WhatsApp precisa do DDD e do número completo.' });
    const cpfDigitos = cleanDigits(cpf);
    if (!isConsultante && cpfDigitos && !isValidCpf(cpfDigitos)) return setMensagem({ tipo: 'erro', texto: 'CPF inválido. Confira os números.' });

    const supabase = getSupabase();
    if (!supabase || !userId) {
      setConta(c => (c ? { ...c, nome: nome.trim(), telefone, cpf, oab: oab.trim(), email: email.trim() } : c));
      return setMensagem({ tipo: 'ok', texto: 'Dados atualizados (modo demonstração).' });
    }

    setSalvandoDados(true);
    try {
      const alteracao: Record<string, string | null> = {
        nome: nome.trim(),
        telefone: telefoneDigitos || null,
        oab: isConsultante ? null : oab.trim() || null
      };
      if (!isConsultante) alteracao.cpf = cpfDigitos || null;
      const { error } = await supabase.from('ap_perfis').update(alteracao).eq('id', userId);
      if (error) throw error;

      let aviso = '';
      if (email.trim().toLowerCase() !== conta.email.toLowerCase()) {
        const { error: erroEmail } = await supabase.auth.updateUser({ email: email.trim() });
        if (erroEmail) throw erroEmail;
        aviso = ' Confirme o novo e-mail pelo link que enviamos para ele.';
      }

      setConta(c =>
        c
          ? {
              ...c,
              nome: nome.trim(),
              telefone: telefoneDigitos ? formatPhone(telefoneDigitos) : '',
              cpf: cpfDigitos ? formatCpf(cpfDigitos) : '',
              oab: oab.trim()
            }
          : c
      );
      if (aviso) setEmail(conta.email);
      await atualizarPerfilCompartilhado();
      setMensagem({ tipo: 'ok', texto: `Dados salvos.${aviso}` });
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Não foi possível salvar seus dados.' });
    } finally {
      setSalvandoDados(false);
    }
  };

  const salvarSenha = async (e: FormEvent) => {
    e.preventDefault();
    setMensagem(null);
    if (senhaNova.length < 6) return setMensagem({ tipo: 'erro', texto: 'A nova senha precisa de pelo menos 6 caracteres.' });
    if (senhaNova !== senhaConfirma) return setMensagem({ tipo: 'erro', texto: 'A confirmação não é igual à nova senha.' });

    const supabase = getSupabase();
    if (!supabase) {
      setSenhaAtual('');
      setSenhaNova('');
      setSenhaConfirma('');
      return setMensagem({ tipo: 'ok', texto: 'Senha alterada (modo demonstração).' });
    }

    setSalvandoSenha(true);
    try {
      if (temSenha) {
        const { error } = await supabase.auth.signInWithPassword({ email: conta.email, password: senhaAtual });
        if (error) throw new Error('A senha atual está incorreta.');
      }
      const { error } = await supabase.auth.updateUser({ password: senhaNova });
      if (error) throw error;
      setSenhaAtual('');
      setSenhaNova('');
      setSenhaConfirma('');
      if (!temSenha) setConta(c => (c ? { ...c, provedores: [...c.provedores, 'email'] } : c));
      setMensagem({ tipo: 'ok', texto: temSenha ? 'Senha atualizada.' : 'Senha criada. Agora você também pode entrar com e-mail e senha.' });
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Não foi possível alterar a senha.' });
    } finally {
      setSalvandoSenha(false);
    }
  };

  const encerrarOutrasSessoes = async () => {
    const supabase = getSupabase();
    if (!supabase) return setMensagem({ tipo: 'ok', texto: 'Sessões encerradas (modo demonstração).' });
    setEncerrandoSessoes(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'others' });
      if (error) throw error;
      setMensagem({ tipo: 'ok', texto: 'Pronto. Os outros aparelhos precisarão entrar de novo.' });
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Não foi possível encerrar as outras sessões.' });
    } finally {
      setEncerrandoSessoes(false);
    }
  };

  const consumo = status?.consumo;
  const nivelConsumo = !consumo ? 'ok' : consumo.percentualUsado >= 90 ? 'critico' : consumo.percentualUsado >= 70 ? 'atencao' : 'ok';
  const limiteMonitorados = status?.regras.limiteProcessosMonitorados ?? (isPro ? 50 : 2);
  const monitorados = status?.totalProcessosMonitorados ?? 0;
  const pctMonitorados = limiteMonitorados > 0 ? Math.round((monitorados / limiteMonitorados) * 100) : 0;

  return (
    <div className="bf-page [--bf-page-max:72rem]">
      <header className="bf-page-titulo flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Meu perfil</h1>
          <p className="mt-1 text-sm text-white/60">Seus dados, o WhatsApp dos alertas, seu acesso, seu plano e a segurança da conta.</p>
        </div>
        <button type="button" onClick={() => iniciarTour('perfil')} className={`bf-page-titulo-acoes ${BOTAO_SECUNDARIO}`}>
          <Compass size={16} /> Tour desta tela
        </button>
      </header>

      {mensagem && (
        <div
          role={mensagem.tipo === 'erro' ? 'alert' : 'status'}
          className={`mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
            mensagem.tipo === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {mensagem.tipo === 'ok' ? <Check size={18} className="mt-0.5 shrink-0" /> : <X size={18} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1">{mensagem.texto}</span>
          <button type="button" onClick={() => setMensagem(null)} className="cursor-pointer text-current opacity-70 hover:opacity-100" aria-label="Fechar aviso">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="bf-cols mt-10 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Coluna lateral: identidade + plano */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          <section data-tour="perfil-identidade" className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#1E7CF2]/40 bg-[#1E7CF2]/15 text-lg font-bold text-white">
                {iniciais}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-white">{conta.nome || 'Sem nome'}</p>
                <p className="truncate text-xs text-white/55">{conta.email}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80">
                <UserCog size={13} /> {ROTULO_ROLE[conta.role] ?? 'Advogado'}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  isPro ? 'border-[#1E7CF2]/50 bg-[#1E7CF2]/15 text-[#3FA0FF]' : 'border-white/15 bg-white/5 text-white/70'
                }`}
              >
                <Crown size={13} /> {isPro ? 'Pro' : 'Gratuito'}
              </span>
            </div>
            <dl className="mt-4 space-y-2 border-t border-white/10 pt-4 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-white/50">Forma de entrar</dt>
                <dd className="text-right text-white/85">{[temGoogle && 'Google', temSenha && 'E-mail e senha'].filter(Boolean).join(' + ') || 'E-mail'}</dd>
              </div>
              {conta.criadoEm && (
                <div className="flex justify-between gap-3">
                  <dt className="text-white/50">Conta criada em</dt>
                  <dd className="text-white/85">{new Date(conta.criadoEm).toLocaleDateString('pt-BR')}</dd>
                </div>
              )}
            </dl>
          </section>

          <section data-tour="perfil-plano" className="bf-paper rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Coins size={16} className="text-[#3FA0FF]" /> Plano e consumo
            </h2>
            {consumo ? (
              <div className="mt-4 space-y-5">
                <div>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-white/55">Créditos de consulta</span>
                    <span className="font-semibold text-white">{brl(consumo.restanteReais)} restantes</span>
                  </div>
                  <div className="mt-2">
                    <Barra percentual={consumo.percentualUsado} nivel={nivelConsumo} />
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-white/45">
                    Usado {brl(consumo.usadoReais)} de {brl(consumo.franquiaReais)}. Renova em {dataCurta(consumo.renovaEm)}.
                  </p>
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-white/55">Processos acompanhados</span>
                    <span className="font-semibold text-white">
                      {monitorados} de {limiteMonitorados}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Barra percentual={pctMonitorados} nivel={pctMonitorados >= 100 ? 'critico' : pctMonitorados >= 70 ? 'atencao' : 'ok'} />
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-white/50">O consumo aparece aqui assim que a conta tiver o plano carregado.</p>
            )}
            <Link
              href="/planos"
              className={`${isPro ? BOTAO_SECUNDARIO : BOTAO_PRIMARIO} mt-5 w-full !no-underline`}
              style={{ textDecoration: 'none' }}
            >
              {isPro ? 'Gerenciar assinatura' : 'Conhecer o Pro'} <ArrowRight size={15} />
            </Link>
          </section>
        </aside>

        {/* Coluna principal: uma seção por vez, escolhida nas abas */}
        <div className="flex min-w-0 flex-col gap-6">
          <AbasDeslizantes
            fullWidth
            rolavel
            ariaLabel="Seções do perfil"
            value={aba}
            onChange={setAba}
            data={ABAS_PERFIL.map(a => ({
              value: a.value,
              label: (
                <>
                  <a.icone size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>{a.label}</span>
                </>
              )
            }))}
          />

          <ConteudoDeslizante chave={aba} ordem={ABAS_PERFIL.map(a => a.value)}>
          {aba === 'dados' && (
          <form onSubmit={salvarDados} noValidate>
            <Cartao icone={User} titulo="Dados pessoais" descricao="Usados na sua identificação e nos alertas." tour="perfil-dados">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Campo id="perfil-nome" rotulo="Nome completo" icone={User}>
                    <input id="perfil-nome" className={INPUT} value={nome} onChange={e => setNome(e.target.value)} autoComplete="name" />
                  </Campo>
                </div>
                <Campo
                  id="perfil-whatsapp"
                  rotulo="WhatsApp para alertas"
                  icone={Phone}
                  dica={telefoneValido ? 'Recebe os avisos dos processos acompanhados.' : 'Informe o DDD e o número completo.'}
                >
                  <input
                    id="perfil-whatsapp"
                    className={INPUT}
                    value={telefone}
                    onChange={e => setTelefone(formatPhone(cleanDigits(e.target.value)))}
                    placeholder="(11) 98765-4321"
                    inputMode="tel"
                    maxLength={15}
                    autoComplete="tel"
                    aria-invalid={!telefoneValido}
                  />
                </Campo>
                <Campo
                  id="perfil-email"
                  rotulo="E-mail de acesso"
                  icone={Mail}
                  dica={temGoogle && !temSenha ? 'Conta ligada ao Google.' : 'Ao trocar, confirme pelo link enviado ao novo e-mail.'}
                >
                  <input
                    id="perfil-email"
                    type="email"
                    className={INPUT}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    disabled={temGoogle && !temSenha}
                  />
                </Campo>
                {!isConsultante && (
                  <>
                    <Campo id="perfil-cpf" rotulo="Seu CPF (opcional)" icone={FileBadge}>
                      <input
                        id="perfil-cpf"
                        className={INPUT}
                        value={cpf}
                        onChange={e => setCpf(formatCpf(cleanDigits(e.target.value)))}
                        placeholder="000.000.000-00"
                        inputMode="numeric"
                        maxLength={14}
                      />
                    </Campo>
                    <Campo id="perfil-oab" rotulo="OAB (opcional)" icone={Gavel}>
                      <input id="perfil-oab" className={INPUT} value={oab} onChange={e => setOab(e.target.value)} placeholder="123456/SP" />
                    </Campo>
                  </>
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-4">
                {alterado && <span className="mr-auto text-xs text-white/50">Há alterações não salvas.</span>}
                <button type="submit" disabled={salvandoDados || !alterado} className={BOTAO_PRIMARIO}>
                  {salvandoDados ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {salvandoDados ? 'Salvando...' : 'Salvar dados'}
                </button>
              </div>
            </Cartao>
          </form>
          )}

          {aba === 'acesso' && (
          <Cartao icone={UserCog} titulo="Tipo de acesso" descricao="Define o que você pode consultar." tour="perfil-acesso">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="text-sm font-semibold text-white">{ROTULO_ROLE[conta.role] ?? 'Advogado'}</p>
                <ul className="mt-2 space-y-1.5">
                  {(PERMISSOES_ROLE[conta.role] ?? PERMISSOES_ROLE.advogado).map(item => (
                    <li key={item} className="flex items-start gap-2 text-[13px] text-white/70">
                      <Check size={15} className="mt-0.5 shrink-0 text-[#3FA0FF]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              {isConsultante ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="flex items-center gap-2 text-xs font-semibold text-white/70">
                    <Lock size={14} /> {conta.documentoTipo === 'cnpj' ? 'CNPJ' : 'CPF'} do titular
                  </p>
                  <p className="mt-1.5 font-mono text-sm text-white">{formatDocumento(conta.documento) || 'Não definido'}</p>
                  <p className="mt-2 text-[11.5px] leading-snug text-white/45">
                    Documento fixo: suas consultas ficam restritas a ele e ele não pode ser trocado.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-[12.5px] leading-relaxed text-white/60">
                  As consultas por CPF/CNPJ usam bases pagas e descontam da franquia de créditos. A busca por número do processo é
                  gratuita.
                </div>
              )}
            </div>
          </Cartao>
          )}

          {aba === 'alertas' && (
          <Cartao
            icone={BellRing}
            titulo="Alertas"
            descricao="Para onde vão os avisos dos processos acompanhados."
            tour="perfil-notificacoes"
            acao={
              <Link href="/processos" className={`${BOTAO_SECUNDARIO} !no-underline`} style={{ textDecoration: 'none' }}>
                Canais por processo <ArrowRight size={14} />
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <Mail size={18} className="mt-0.5 shrink-0 text-white/60" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">E-mail</p>
                  <p className="truncate text-xs text-white/55">{conta.email}</p>
                  <p className="mt-1 text-[11.5px] text-emerald-300/90">Ativo em todos os planos</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <MessageCircle size={18} className="mt-0.5 shrink-0 text-[#25D366]" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">WhatsApp</p>
                  <p className="text-xs text-white/55">{whatsappCadastrado ? conta.telefone : 'Nenhum número cadastrado'}</p>
                  <p className={`mt-1 text-[11.5px] ${whatsappCadastrado ? 'text-emerald-300/90' : 'text-amber-300/90'}`}>
                    {whatsappCadastrado
                      ? isPro
                        ? 'Alertas e conversa com a IA'
                        : 'Alertas ativos. Conversa com a IA no Pro'
                      : (
                        <button type="button" onClick={() => setAba('dados')} className="cursor-pointer underline underline-offset-2">
                          Cadastre em Dados pessoais
                        </button>
                      )}
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-white/50">
              Urgências (penhora, bloqueio, prazo correndo) chegam na hora. A rotina vem num resumo às sextas. Para parar os envios
              no WhatsApp, responda SAIR a qualquer mensagem.
            </p>
          </Cartao>
          )}

          {aba === 'seguranca' && (
          <form onSubmit={salvarSenha} noValidate>
            <Cartao
              icone={KeyRound}
              titulo="Segurança"
              descricao={temSenha ? 'Troque sua senha de acesso.' : 'Sua conta usa o Google. Crie uma senha para entrar também com e-mail.'}
              tour="perfil-seguranca"
              acao={
                <button type="button" onClick={() => setMostrarSenhas(v => !v)} className={BOTAO_SECUNDARIO} aria-pressed={mostrarSenhas}>
                  {mostrarSenhas ? <EyeOff size={14} /> : <Eye size={14} />}
                  {mostrarSenhas ? 'Ocultar' : 'Mostrar'}
                </button>
              }
            >
              <div className={`grid grid-cols-1 gap-4 ${temSenha ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                {temSenha && (
                  <Campo id="perfil-senha-atual" rotulo="Senha atual" icone={Lock}>
                    <input
                      id="perfil-senha-atual"
                      type={mostrarSenhas ? 'text' : 'password'}
                      className={INPUT}
                      value={senhaAtual}
                      onChange={e => setSenhaAtual(e.target.value)}
                      autoComplete="current-password"
                    />
                  </Campo>
                )}
                <Campo id="perfil-senha-nova" rotulo="Nova senha" icone={KeyRound} dica="Pelo menos 6 caracteres.">
                  <input
                    id="perfil-senha-nova"
                    type={mostrarSenhas ? 'text' : 'password'}
                    className={INPUT}
                    value={senhaNova}
                    onChange={e => setSenhaNova(e.target.value)}
                    autoComplete="new-password"
                  />
                </Campo>
                <Campo id="perfil-senha-confirma" rotulo="Confirmar nova senha" icone={KeyRound}>
                  <input
                    id="perfil-senha-confirma"
                    type={mostrarSenhas ? 'text' : 'password'}
                    className={INPUT}
                    value={senhaConfirma}
                    onChange={e => setSenhaConfirma(e.target.value)}
                    autoComplete="new-password"
                  />
                </Campo>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                <button type="button" onClick={encerrarOutrasSessoes} disabled={encerrandoSessoes} className={BOTAO_SECUNDARIO}>
                  {encerrandoSessoes ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
                  Sair dos outros aparelhos
                </button>
                <button
                  type="submit"
                  disabled={salvandoSenha || !senhaNova || !senhaConfirma || (temSenha && !senhaAtual)}
                  className={BOTAO_PRIMARIO}
                >
                  {salvandoSenha ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  {temSenha ? 'Atualizar senha' : 'Criar senha'}
                </button>
              </div>
            </Cartao>
          </form>
          )}
          </ConteudoDeslizante>

          <section data-tour="perfil-ajuda" className="bf-paper flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[#1E7CF2]/25 bg-[#1E7CF2]/[0.06] p-5 sm:p-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1E7CF2]/15 text-[#3FA0FF]">
                <Compass size={19} strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Dúvidas sobre como usar?</p>
                <p className="text-[13px] text-white/55">Tours guiados de busca, créditos, pagamento, processos salvos e do sistema como um todo.</p>
              </div>
            </div>
            <button type="button" onClick={() => iniciarTour()} className={BOTAO_SECUNDARIO}>
              Ver tours <ArrowRight size={14} />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
