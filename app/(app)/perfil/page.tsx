'use client';

import { useEffect, useState } from 'react';
import { User, Mail, CreditCard, Phone, Gavel, Lock, Pencil, Check, X, Loader2, KeyRound } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { formatDocumento, isValidCpf } from '@/lib/format';

interface Dados {
  nome: string;
  email: string;
  cpf: string;
  telefone: string;
  total: number;
  role: string;
  documento: string;
  documentoTipo: string;
}

const fmtCpf = (v: string) => (v.length === 11 ? v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v);
const fmtTel = (v: string) =>
  v.length === 11 ? v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : v.length === 10 ? v.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3') : v;

export default function Perfil() {
  const [d, setD] = useState<Dados>({ nome: '', email: '', cpf: '', telefone: '', total: 0, role: 'advogado', documento: '', documentoTipo: '' });
  const [userId, setUserId] = useState<string | null>(null);

  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeInput, setNomeInput] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);

  const [editandoTelefone, setEditandoTelefone] = useState(false);
  const [telefoneInput, setTelefoneInput] = useState('');
  const [salvandoTelefone, setSalvandoTelefone] = useState(false);

  const [editandoEmail, setEditandoEmail] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [salvandoEmail, setSalvandoEmail] = useState(false);

  const [editandoCpf, setEditandoCpf] = useState(false);
  const [cpfInput, setCpfInput] = useState('');
  const [salvandoCpf, setSalvandoCpf] = useState(false);

  const [editandoSenha, setEditandoSenha] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [senhaConfirma, setSenhaConfirma] = useState('');
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) return;
    const [perfil, procs] = await Promise.all([
      supabase.from('ap_perfis').select('nome,cpf,telefone,role,documento,documento_tipo').eq('id', u.id).maybeSingle(),
      supabase.from('ap_processos_pesquisados').select('id', { count: 'exact', head: true })
    ]);
    setUserId(u.id);
    setD({
      nome: perfil.data?.nome ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? '',
      email: u.email ?? '',
      cpf: perfil.data?.cpf ?? '',
      telefone: perfil.data?.telefone ?? '',
      total: procs.count ?? 0,
      role: perfil.data?.role ?? 'advogado',
      documento: perfil.data?.documento ?? '',
      documentoTipo: perfil.data?.documento_tipo ?? ''
    });
  };

  useEffect(() => {
    void carregar();
  }, []);

  useEffect(() => {
    if (!mensagem) return;
    const t = setTimeout(() => setMensagem(null), 4000);
    return () => clearTimeout(t);
  }, [mensagem]);

  const isConsultante = d.role === 'cliente';

  const salvarNome = async () => {
    const supabase = getSupabase();
    if (!supabase || !userId) return;
    const nome = nomeInput.trim();
    if (!nome) return;
    setSalvandoNome(true);
    try {
      const { error } = await supabase.from('ap_perfis').update({ nome }).eq('id', userId);
      if (error) throw error;
      setD(prev => ({ ...prev, nome }));
      setEditandoNome(false);
      setMensagem({ tipo: 'ok', texto: 'Nome atualizado.' });
    } catch (e: any) {
      setMensagem({ tipo: 'erro', texto: e?.message || 'Não foi possível atualizar o nome.' });
    } finally {
      setSalvandoNome(false);
    }
  };

  const salvarTelefone = async () => {
    const supabase = getSupabase();
    if (!supabase || !userId) return;
    const telefone = telefoneInput.replace(/\D/g, '');
    setSalvandoTelefone(true);
    try {
      const { error } = await supabase.from('ap_perfis').update({ telefone }).eq('id', userId);
      if (error) throw error;
      setD(prev => ({ ...prev, telefone }));
      setEditandoTelefone(false);
      setMensagem({ tipo: 'ok', texto: 'Telefone atualizado.' });
    } catch (e: any) {
      setMensagem({ tipo: 'erro', texto: e?.message || 'Não foi possível atualizar o telefone.' });
    } finally {
      setSalvandoTelefone(false);
    }
  };

  const salvarCpf = async () => {
    const supabase = getSupabase();
    if (!supabase || !userId) return;
    const cpf = cpfInput.replace(/\D/g, '');
    if (!isValidCpf(cpf)) {
      setMensagem({ tipo: 'erro', texto: 'CPF inválido. Verifique os números.' });
      return;
    }
    setSalvandoCpf(true);
    try {
      const { error } = await supabase.from('ap_perfis').update({ cpf }).eq('id', userId);
      if (error) throw error;
      setD(prev => ({ ...prev, cpf }));
      setEditandoCpf(false);
      setMensagem({ tipo: 'ok', texto: 'CPF atualizado.' });
    } catch (e: any) {
      setMensagem({ tipo: 'erro', texto: e?.message || 'Não foi possível atualizar o CPF.' });
    } finally {
      setSalvandoCpf(false);
    }
  };

  const salvarEmail = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const email = emailInput.trim();
    if (!email) return;
    setSalvandoEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      setEditandoEmail(false);
      setMensagem({ tipo: 'ok', texto: 'Verifique sua caixa de entrada para confirmar o novo e-mail.' });
    } catch (e: any) {
      setMensagem({ tipo: 'erro', texto: e?.message || 'Não foi possível atualizar o e-mail.' });
    } finally {
      setSalvandoEmail(false);
    }
  };

  const salvarSenha = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    if (senhaNova.length < 6) {
      setMensagem({ tipo: 'erro', texto: 'A nova senha deve ter ao menos 6 caracteres.' });
      return;
    }
    if (senhaNova !== senhaConfirma) {
      setMensagem({ tipo: 'erro', texto: 'A confirmação não corresponde à nova senha.' });
      return;
    }
    setSalvandoSenha(true);
    try {
      if (d.email) {
        const { error: errLogin } = await supabase.auth.signInWithPassword({ email: d.email, password: senhaAtual });
        if (errLogin) throw new Error('Senha atual incorreta.');
      }
      const { error } = await supabase.auth.updateUser({ password: senhaNova });
      if (error) throw error;
      setSenhaAtual('');
      setSenhaNova('');
      setSenhaConfirma('');
      setEditandoSenha(false);
      setMensagem({ tipo: 'ok', texto: 'Senha atualizada.' });
    } catch (e: any) {
      setMensagem({ tipo: 'erro', texto: e?.message || 'Não foi possível atualizar a senha.' });
    } finally {
      setSalvandoSenha(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-white">Meu perfil</h1>
      <p className="mt-2 text-white/60">
        {d.role === 'broker'
          ? 'Conta Broker (Ativos & Precatórios)'
          : isConsultante
          ? 'Conta Consulta Avulsa'
          : d.role === 'admin'
          ? 'Conta Administrador'
          : 'Conta Advogado'}
      </p>

      {mensagem && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            mensagem.tipo === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {mensagem.texto}
        </div>
      )}

      <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-sm backdrop-blur-md">
        <dl className="grid gap-5 text-sm">
          {/* Nome */}
          <div className="flex items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
              <User size={20} strokeWidth={1.8} />
            </span>
            <div className="flex-1">
              <dt className="text-white/60">Nome</dt>
              {editandoNome ? (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    autoFocus
                    value={nomeInput}
                    onChange={e => setNomeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && salvarNome()}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-white outline-none focus:border-white/40"
                  />
                  <button onClick={salvarNome} disabled={salvandoNome} className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">
                    {salvandoNome ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  </button>
                  <button onClick={() => setEditandoNome(false)} className="rounded-lg bg-white/10 p-1.5 text-white/70 hover:bg-white/20">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <dd className="mt-0.5 flex items-center gap-2 font-medium text-white">
                  {d.nome || '—'}
                  <button
                    onClick={() => { setNomeInput(d.nome); setEditandoNome(true); }}
                    className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
                    aria-label="Editar nome"
                  >
                    <Pencil size={14} />
                  </button>
                </dd>
              )}
            </div>
          </div>

          {/* E-mail */}
          <div className="flex items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
              <Mail size={20} strokeWidth={1.8} />
            </span>
            <div className="flex-1">
              <dt className="text-white/60">E-mail</dt>
              {editandoEmail ? (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    autoFocus
                    type="email"
                    value={emailInput}
                    onChange={e => setEmailInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && salvarEmail()}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-white outline-none focus:border-white/40"
                  />
                  <button onClick={salvarEmail} disabled={salvandoEmail} className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">
                    {salvandoEmail ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  </button>
                  <button onClick={() => setEditandoEmail(false)} className="rounded-lg bg-white/10 p-1.5 text-white/70 hover:bg-white/20">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <dd className="mt-0.5 flex items-center gap-2 font-medium text-white">
                  {d.email || '—'}
                  <button
                    onClick={() => { setEmailInput(d.email); setEditandoEmail(true); }}
                    className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
                    aria-label="Editar e-mail"
                  >
                    <Pencil size={14} />
                  </button>
                </dd>
              )}
              {editandoEmail && <dd className="mt-1 text-xs text-white/40">Você receberá um e-mail de confirmação no novo endereço.</dd>}
            </div>
          </div>

          {/* CPF/CNPJ */}
          {isConsultante ? (
            <div className="flex items-center gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
                <Lock size={20} strokeWidth={1.8} />
              </span>
              <div>
                <dt className="text-white/60">{d.documentoTipo === 'cnpj' ? 'CNPJ (fixo)' : 'CPF (fixo)'}</dt>
                <dd className="mt-0.5 font-medium text-white">{formatDocumento(d.documento) || '—'}</dd>
                <dd className="mt-0.5 text-xs text-white/40">Não pode ser alterado</dd>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
                <CreditCard size={20} strokeWidth={1.8} />
              </span>
              <div className="flex-1">
                <dt className="text-white/60">CPF</dt>
                {editandoCpf ? (
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      autoFocus
                      inputMode="numeric"
                      value={cpfInput}
                      onChange={e => setCpfInput(fmtCpf(e.target.value.replace(/\D/g, '').slice(0, 11)))}
                      onKeyDown={e => e.key === 'Enter' && salvarCpf()}
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-white outline-none focus:border-white/40"
                    />
                    <button onClick={salvarCpf} disabled={salvandoCpf} className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">
                      {salvandoCpf ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    </button>
                    <button onClick={() => setEditandoCpf(false)} className="rounded-lg bg-white/10 p-1.5 text-white/70 hover:bg-white/20">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <dd className="mt-0.5 flex items-center gap-2 font-medium text-white">
                    {fmtCpf(d.cpf) || '—'}
                    <button
                      onClick={() => { setCpfInput(fmtCpf(d.cpf)); setEditandoCpf(true); }}
                      className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
                      aria-label="Editar CPF"
                    >
                      <Pencil size={14} />
                    </button>
                  </dd>
                )}
              </div>
            </div>
          )}

          {/* Telefone */}
          <div className="flex items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
              <Phone size={20} strokeWidth={1.8} />
            </span>
            <div className="flex-1">
              <dt className="text-white/60">Telefone</dt>
              {editandoTelefone ? (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    autoFocus
                    value={telefoneInput}
                    onChange={e => setTelefoneInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && salvarTelefone()}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-white outline-none focus:border-white/40"
                  />
                  <button onClick={salvarTelefone} disabled={salvandoTelefone} className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50">
                    {salvandoTelefone ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  </button>
                  <button onClick={() => setEditandoTelefone(false)} className="rounded-lg bg-white/10 p-1.5 text-white/70 hover:bg-white/20">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <dd className="mt-0.5 flex items-center gap-2 font-medium text-white">
                  {fmtTel(d.telefone) || '—'}
                  <button
                    onClick={() => { setTelefoneInput(d.telefone); setEditandoTelefone(true); }}
                    className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
                    aria-label="Editar telefone"
                  >
                    <Pencil size={14} />
                  </button>
                </dd>
              )}
            </div>
          </div>

          {/* Processos (somente leitura) */}
          <div className="flex items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
              <Gavel size={20} strokeWidth={1.8} />
            </span>
            <div>
              <dt className="text-white/60">Processos</dt>
              <dd className="mt-0.5 font-medium text-white">{d.total ? String(d.total) : '0'}</dd>
            </div>
          </div>
        </dl>
      </div>

      {/* Senha */}
      <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-sm backdrop-blur-md">
        <div className="flex items-center gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
            <KeyRound size={20} strokeWidth={1.8} />
          </span>
          <div className="flex-1">
            <p className="font-medium text-white">Senha</p>
            {!editandoSenha && <p className="mt-0.5 text-sm text-white/60">••••••••</p>}
          </div>
          {!editandoSenha && (
            <button
              onClick={() => setEditandoSenha(true)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
            >
              Alterar senha
            </button>
          )}
        </div>

        {editandoSenha && (
          <div className="mt-4 grid gap-3">
            <input
              type="password"
              placeholder="Senha atual"
              value={senhaAtual}
              onChange={e => setSenhaAtual(e.target.value)}
              className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
            <input
              type="password"
              placeholder="Nova senha"
              value={senhaNova}
              onChange={e => setSenhaNova(e.target.value)}
              className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
            <input
              type="password"
              placeholder="Confirmar nova senha"
              value={senhaConfirma}
              onChange={e => setSenhaConfirma(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && salvarSenha()}
              className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={salvarSenha}
                disabled={salvandoSenha}
                className="flex items-center gap-2 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {salvandoSenha && <Loader2 size={14} className="animate-spin" />}
                Salvar senha
              </button>
              <button
                onClick={() => { setEditandoSenha(false); setSenhaAtual(''); setSenhaNova(''); setSenhaConfirma(''); }}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/20"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
