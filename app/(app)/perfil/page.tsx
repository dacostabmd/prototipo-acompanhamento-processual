'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import {
  User,
  Mail,
  CreditCard,
  Phone,
  Gavel,
  Lock,
  Check,
  Loader2,
  KeyRound,
  ShieldCheck,
  Save,
  Eye,
  EyeOff,
  Sparkles,
  ArrowRight,
  BadgeCheck,
  FileBadge
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { formatDocumento, isValidCpf, formatPhone, formatCpf, cleanDigits } from '@/lib/format';

interface Dados {
  nome: string;
  email: string;
  cpf: string;
  oab: string;
  telefone: string;
  total: number;
  role: string;
  documento: string;
  documentoTipo: string;
}

export default function Perfil() {
  const [d, setD] = useState<Dados>({
    nome: '',
    email: '',
    cpf: '',
    oab: '',
    telefone: '',
    total: 0,
    role: 'advogado',
    documento: '',
    documentoTipo: ''
  });
  const [userId, setUserId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Form states
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [oab, setOab] = useState('');
  const [telefone, setTelefone] = useState('');
  const [salvandoDados, setSalvandoDados] = useState(false);

  // Password states
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [senhaConfirma, setSenhaConfirma] = useState('');
  const [mostrarSenhas, setMostrarSenhas] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  // Notifications
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const supabase = getSupabase();
      if (!supabase) {
        // Fallback demo
        const demoUser = typeof window !== 'undefined' ? localStorage.getItem('bf-demo-user') || 'demo@prosec.com.br' : 'demo@prosec.com.br';
        const demoRole = typeof window !== 'undefined' ? localStorage.getItem('bf-demo-role') || 'advogado' : 'advogado';
        setD({
          nome: 'Usuário Homologação',
          email: demoUser,
          cpf: '123.456.789-00',
          oab: '123456/SP',
          telefone: '(11) 98765-4321',
          total: 0,
          role: demoRole,
          documento: '',
          documentoTipo: ''
        });
        setNome('Usuário Homologação');
        setEmail(demoUser);
        setCpf('123.456.789-00');
        setOab('123456/SP');
        setTelefone('(11) 98765-4321');
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const u = authData.user;
      if (!u) return;

      const [perfil, procs] = await Promise.all([
        supabase
          .from('ap_perfis')
          .select('nome,cpf,oab,telefone,role,documento,documento_tipo')
          .eq('id', u.id)
          .maybeSingle(),
        supabase.from('ap_processos_pesquisados').select('id', { count: 'exact', head: true })
      ]);

      setUserId(u.id);

      const nomeFinal = perfil.data?.nome ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? '';
      const emailFinal = u.email ?? '';
      const cpfFinal = perfil.data?.cpf ? formatCpf(perfil.data.cpf) : '';
      const oabFinal = perfil.data?.oab ?? '';
      const telefoneFinal = perfil.data?.telefone ? formatPhone(perfil.data.telefone) : '';
      const roleFinal = perfil.data?.role ?? 'advogado';
      const docFinal = perfil.data?.documento ?? '';
      const docTipoFinal = perfil.data?.documento_tipo ?? '';

      setD({
        nome: nomeFinal,
        email: emailFinal,
        cpf: cpfFinal,
        oab: oabFinal,
        telefone: telefoneFinal,
        total: procs.count ?? 0,
        role: roleFinal,
        documento: docFinal,
        documentoTipo: docTipoFinal
      });

      setNome(nomeFinal);
      setEmail(emailFinal);
      setCpf(cpfFinal);
      setOab(oabFinal);
      setTelefone(telefoneFinal);
    } catch (err: any) {
      console.error('[Perfil] Erro ao carregar perfil:', err);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  useEffect(() => {
    if (!mensagem) return;
    const t = setTimeout(() => setMensagem(null), 5000);
    return () => clearTimeout(t);
  }, [mensagem]);

  const isConsultante = d.role === 'cliente';

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner':
        return 'Proprietário (Owner)';
      case 'admin':
        return 'Administrador';
      case 'broker':
        return 'Broker (Ativos & Precatórios)';
      case 'cliente':
        return 'Consulta Avulsa';
      default:
        return 'Advogado';
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'admin':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      case 'broker':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'cliente':
        return 'bg-teal-500/15 text-teal-300 border-teal-500/30';
      default:
        return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
    }
  };

  // Salvar Dados Pessoais / Cadastrais
  const handleSalvarDados = async (e: FormEvent) => {
    e.preventDefault();
    setMensagem(null);

    const supabase = getSupabase();
    if (!supabase || !userId) {
      setD(prev => ({ ...prev, nome, email, cpf, oab, telefone }));
      setMensagem({ tipo: 'ok', texto: 'Dados atualizados localmente com sucesso.' });
      return;
    }

    const cleanCpf = cleanDigits(cpf);
    if (cleanCpf && !isValidCpf(cleanCpf)) {
      setMensagem({ tipo: 'erro', texto: 'CPF informado é inválido. Verifique os números.' });
      return;
    }

    setSalvandoDados(true);
    try {
      // 1. Atualiza ap_perfis
      const updatePayload: Record<string, any> = {
        nome: nome.trim(),
        telefone: cleanDigits(telefone) || null,
        oab: oab.trim() || null
      };

      if (!isConsultante) {
        updatePayload.cpf = cleanCpf || null;
      }

      const { error: perfilErr } = await supabase.from('ap_perfis').update(updatePayload).eq('id', userId);
      if (perfilErr) throw perfilErr;

      // 2. Se o e-mail foi alterado, solicita update no Supabase Auth
      let emailAviso = '';
      if (email.trim().toLowerCase() !== d.email.trim().toLowerCase()) {
        const { error: authErr } = await supabase.auth.updateUser({ email: email.trim() });
        if (authErr) throw authErr;
        emailAviso = ' Verifique seu novo e-mail para confirmar a alteração.';
      }

      // 3. Atualiza estado
      setD(prev => ({
        ...prev,
        nome: nome.trim(),
        email: email.trim(),
        cpf: cleanCpf ? formatCpf(cleanCpf) : '',
        oab: oab.trim(),
        telefone: cleanDigits(telefone) ? formatPhone(cleanDigits(telefone)) : ''
      }));

      setMensagem({ tipo: 'ok', texto: `Dados do perfil salvos com sucesso!${emailAviso}` });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err?.message || 'Falha ao salvar os dados do perfil.' });
    } finally {
      setSalvandoDados(false);
    }
  };

  // Salvar Senha
  const handleSalvarSenha = async (e: FormEvent) => {
    e.preventDefault();
    setMensagem(null);

    if (senhaNova.length < 6) {
      setMensagem({ tipo: 'erro', texto: 'A nova senha deve possuir ao menos 6 caracteres.' });
      return;
    }

    if (senhaNova !== senhaConfirma) {
      setMensagem({ tipo: 'erro', texto: 'A confirmação de senha não coincide com a nova senha digitada.' });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setSenhaAtual('');
      setSenhaNova('');
      setSenhaConfirma('');
      setMensagem({ tipo: 'ok', texto: 'Senha alterada com sucesso (modo simulado).' });
      return;
    }

    setSalvandoSenha(true);
    try {
      if (d.email && senhaAtual) {
        const { error: errLogin } = await supabase.auth.signInWithPassword({
          email: d.email,
          password: senhaAtual
        });
        if (errLogin) throw new Error('A senha atual informada está incorreta.');
      }

      const { error } = await supabase.auth.updateUser({ password: senhaNova });
      if (error) throw error;

      setSenhaAtual('');
      setSenhaNova('');
      setSenhaConfirma('');
      setMensagem({ tipo: 'ok', texto: 'Senha de acesso atualizada com sucesso!' });
    } catch (err: any) {
      setMensagem({ tipo: 'erro', texto: err?.message || 'Não foi possível alterar sua senha.' });
    } finally {
      setSalvandoSenha(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
          <p className="text-sm text-white/50">Carregando dados do perfil...</p>
        </div>
      </div>
    );
  }

  const userInitials = d.nome
    ? d.nome
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(n => n[0].toUpperCase())
        .join('')
    : 'U';

  return (
    <div className="mx-auto max-w-4xl p-6 sm:p-10">
      {/* HEADER HERO */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-white/15 to-white/5 text-xl font-bold text-white shadow-lg backdrop-blur-md">
            {userInitials}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Meu Perfil</h1>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getRoleBadgeColor(d.role)}`}>
                <BadgeCheck size={12} />
                {getRoleLabel(d.role)}
              </span>
            </div>
            <p className="mt-1 text-sm text-white/60">
              Gerencie suas informações cadastrais, contatos e configurações de segurança da conta.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            Conta Ativa
          </div>
        </div>
      </div>

      {/* FEEDBACK ALERTS */}
      {mensagem && (
        <div
          className={`mt-6 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm backdrop-blur-md transition-all ${
            mensagem.tipo === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200'
              : 'border-red-500/30 bg-red-500/15 text-red-200'
          }`}
        >
          {mensagem.tipo === 'ok' ? (
            <Check size={18} className="shrink-0 text-emerald-400" />
          ) : (
            <Lock size={18} className="shrink-0 text-red-400" />
          )}
          <span>{mensagem.texto}</span>
        </div>
      )}

      {/* GRID PRINCIPAL */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* COLUNA ESQUERDA: FORMULÁRIO DE DADOS PESSOAIS (2 colunas) */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSalvarDados} className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl sm:p-8">
            <div className="flex items-center justify-between border-b border-white/10 pb-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
                  <User size={20} strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-white">Dados Cadastrais</h2>
                  <p className="text-xs text-white/50">Mantenha seus dados e contatos de comunicação atualizados</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
              {/* Nome Completo */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                  Nome Completo
                </label>
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-white/40">
                    <User size={16} />
                  </div>
                  <input
                    type="text"
                    value={nome}
                    onChange={e => setNome(e.target.value)}
                    placeholder="Seu nome completo"
                    className="w-full rounded-xl border border-white/15 bg-black/40 py-2.5 pr-4 pl-10 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                  />
                </div>
              </div>

              {/* E-mail */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                  E-mail de Acesso
                </label>
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-white/40">
                    <Mail size={16} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu.email@exemplo.com"
                    className="w-full rounded-xl border border-white/15 bg-black/40 py-2.5 pr-4 pl-10 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                  />
                </div>
              </div>

              {/* Telefone / WhatsApp */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                  Telefone / WhatsApp
                </label>
                <div className="relative mt-2">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-white/40">
                    <Phone size={16} />
                  </div>
                  <input
                    type="text"
                    value={telefone}
                    onChange={e => setTelefone(formatPhone(cleanDigits(e.target.value)))}
                    placeholder="(11) 98765-4321"
                    maxLength={15}
                    className="w-full rounded-xl border border-white/15 bg-black/40 py-2.5 pr-4 pl-10 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                  />
                </div>
              </div>

              {/* CPF ou Documento Fixo */}
              {isConsultante ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                    {d.documentoTipo === 'cnpj' ? 'CNPJ do Titular' : 'CPF do Titular'}
                  </label>
                  <div className="relative mt-2">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-white/40">
                      <Lock size={16} />
                    </div>
                    <input
                      type="text"
                      disabled
                      value={formatDocumento(d.documento) || '—'}
                      className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 py-2.5 pr-4 pl-10 text-sm text-white/60 outline-none"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-white/40">Documento vinculado exclusivamente ao seu plano de consulta avulsa.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                    CPF
                  </label>
                  <div className="relative mt-2">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-white/40">
                      <CreditCard size={16} />
                    </div>
                    <input
                      type="text"
                      value={cpf}
                      onChange={e => setCpf(formatCpf(cleanDigits(e.target.value)))}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="w-full rounded-xl border border-white/15 bg-black/40 py-2.5 pr-4 pl-10 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                    />
                  </div>
                </div>
              )}

              {/* Registro Profissional / OAB */}
              {!isConsultante && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                    Registro OAB / Profissional
                  </label>
                  <div className="relative mt-2">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-white/40">
                      <FileBadge size={16} />
                    </div>
                    <input
                      type="text"
                      value={oab}
                      onChange={e => setOab(e.target.value)}
                      placeholder="Ex: 123456/SP"
                      className="w-full rounded-xl border border-white/15 bg-black/40 py-2.5 pr-4 pl-10 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* BOTÃO SALVAR DADOS */}
            <div className="mt-8 flex items-center justify-end border-t border-white/10 pt-5">
              <button
                type="submit"
                disabled={salvandoDados}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 shadow-md transition-all hover:bg-neutral-100 hover:shadow-lg disabled:opacity-50"
              >
                {salvandoDados ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Salvando dados...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Salvar Alterações
                  </>
                )}
              </button>
            </div>
          </form>

          {/* SEGURANÇA E SENHA */}
          <form onSubmit={handleSalvarSenha} className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl sm:p-8">
            <div className="flex items-center justify-between border-b border-white/10 pb-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
                  <KeyRound size={20} strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-base font-semibold text-white">Segurança & Senha</h2>
                  <p className="text-xs text-white/50">Atualize sua senha de autenticação na plataforma</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMostrarSenhas(prev => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                {mostrarSenhas ? <EyeOff size={14} /> : <Eye size={14} />}
                {mostrarSenhas ? 'Ocultar' : 'Exibir'}
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Senha Atual */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                  Senha Atual
                </label>
                <div className="relative mt-2">
                  <input
                    type={mostrarSenhas ? 'text' : 'password'}
                    value={senhaAtual}
                    onChange={e => setSenhaAtual(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                  />
                </div>
              </div>

              {/* Nova Senha */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                  Nova Senha
                </label>
                <div className="relative mt-2">
                  <input
                    type={mostrarSenhas ? 'text' : 'password'}
                    value={senhaNova}
                    onChange={e => setSenhaNova(e.target.value)}
                    placeholder="Mínimo 6 dígitos"
                    className="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                  />
                </div>
              </div>

              {/* Confirmar Nova Senha */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                  Confirmar Nova Senha
                </label>
                <div className="relative mt-2">
                  <input
                    type={mostrarSenhas ? 'text' : 'password'}
                    value={senhaConfirma}
                    onChange={e => setSenhaConfirma(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-all focus:border-white/40 focus:ring-1 focus:ring-white/30"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-5">
              <span className="text-xs text-white/40">
                A senha deve conter ao menos 6 caracteres para garantir a segurança.
              </span>
              <button
                type="submit"
                disabled={salvandoSenha || !senhaNova || !senhaAtual}
                className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-white/25 disabled:opacity-40"
              >
                {salvandoSenha ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Atualizando...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    Atualizar Senha
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* COLUNA DIREITA: RESUMO E ESTATÍSTICAS DA CONTA */}
        <div className="space-y-6">
          {/* Card de Estatísticas */}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60">Atividade da Conta</h3>

            <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
                  <Gavel size={18} />
                </span>
                <div>
                  <p className="text-xs text-white/50">Processos Salvos</p>
                  <p className="text-xl font-bold text-white">{d.total}</p>
                </div>
              </div>

              <Link
                href="/processos"
                className="flex items-center gap-1 text-xs font-medium text-white/70 hover:text-white"
              >
                Ver lista
                <ArrowRight size={13} />
              </Link>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">Nível de Acesso</span>
                <span className="text-xs font-semibold text-white">{getRoleLabel(d.role)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-white/50">Simulação de Pagante</span>
                <span className="text-xs font-semibold text-emerald-400">Ativa no Navegador</span>
              </div>
            </div>

            <Link
              href="/consulta"
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110"
            >
              <Sparkles size={16} />
              Realizar Nova Consulta
            </Link>
          </div>

          {/* Card de Informações de Segurança */}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur-xl">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/60">
              <ShieldCheck size={15} className="text-emerald-400" />
              Privacidade & Segurança
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-white/50">
              Seus dados de consulta são protegidos com criptografia de ponta a ponta. As consultas processuais respeitam a LGPD e as normas do CNJ.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

