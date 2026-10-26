'use client';

import { useState, useEffect, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { SegmentedControl } from '@mantine/core';
import TechTieHero from './TechTieHero';
import { getSupabase } from '@/lib/supabase';
import { cleanDigits, formatDocumento, isValidCpf, isValidCnpj } from '@/lib/format';

// Cartão de vidro sobre o fundo escuro do login: texto claro e destaques no dourado da marca.
const BLUE = '#1E7CF2';
const TEXT = 'var(--tt-text)';
const MUTED = 'rgb(var(--bf-fg) / 0.65)';

type Mode = 'login' | 'signup' | 'forgot';
type Perfil = 'advogado' | 'broker' | 'cliente';

// Cadastro e redefinição exigem mais que o login: contas antigas com 6 caracteres continuam entrando.
const MIN_SENHA_CADASTRO = 8;

const linkButton: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#1E7CF2',
  textDecoration: 'underline',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 13
};

const label: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: 'rgb(var(--bf-fg) / 0.88)', margin: '0 0 8px' };

export default function AuthGateway() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [perfil, setPerfil] = useState<Perfil>('advogado');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [documento, setDocumento] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const supabase = getSupabase();
  const documentoDigits = cleanDigits(documento);
  const isDocumentoValido =
    documentoDigits.length === 11 ? isValidCpf(documentoDigits) : documentoDigits.length === 14 ? isValidCnpj(documentoDigits) : false;

  const finish = () => {
    router.replace('/painel');
    router.refresh();
  };

  // Lembra apenas o e-mail. A senha nunca fica no navegador; versões antigas a gravavam em texto puro, então apaga.
  useEffect(() => {
    try {
      localStorage.removeItem('bf_saved_password');
      const savedRemember = localStorage.getItem('bf_remember_me');
      if (savedRemember === 'true') {
        const savedEmail = localStorage.getItem('bf_saved_email') || '';
        if (savedEmail) setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch {}
  }, []);

  // Redireciona automaticamente se já estiver autenticado
  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (data?.session) {
          router.replace('/painel');
        }
      });
    }
  }, [supabase, router]);

  const handleGoogle = async () => {
    setError('');

    // Se estiver em modo cadastro, salva o perfil/documento escolhido para sincronizar no retorno do OAuth
    try {
      if (mode === 'signup') {
        localStorage.setItem('bf_pending_role', perfil);
        if (perfil === 'cliente' && documentoDigits) {
          localStorage.setItem('bf_pending_documento', documentoDigits);
          localStorage.setItem('bf_pending_documento_tipo', documentoDigits.length === 14 ? 'cnpj' : 'cpf');
        }
      }
    } catch {}

    if (!supabase) {
      // Modo demonstração enquanto o Supabase não está configurado
      try {
        localStorage.setItem('bf-demo-user', 'google');
        localStorage.setItem('bf-demo-role', perfil);
        if (perfil === 'cliente' && documentoDigits) {
          localStorage.setItem('bf-demo-documento', documentoDigits);
          localStorage.setItem('bf-demo-documento-tipo', documentoDigits.length === 14 ? 'cnpj' : 'cpf');
        }
      } catch {}
      return finish();
    }

    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/painel`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });
    if (err) setError('Não foi possível entrar com o Google. Tente novamente.');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    const trimmedInput = email.trim().toLowerCase();
    const normalizedEmail = trimmedInput === 'admin' ? 'admin@dap.com.br' : trimmedInput;

    if (trimmedInput !== 'admin' && !/^\S+@\S+\.\S+$/.test(trimmedInput)) {
      return setError('Informe um e-mail válido.');
    }
    if (password.length < (mode === 'signup' ? MIN_SENHA_CADASTRO : 6)) {
      return setError(`A senha deve ter ao menos ${mode === 'signup' ? MIN_SENHA_CADASTRO : 6} caracteres.`);
    }
    if (mode === 'signup' && name.trim().length < 3) return setError('Informe seu nome completo.');
    if (mode === 'signup' && perfil === 'cliente' && !isDocumentoValido) {
      return setError('Informe um CPF ou CNPJ válido para a Consulta Avulsa.');
    }

    setLoading(true);
    try {
      // Salva ou remove o e-mail do localStorage conforme o checkbox "Lembrar meu e-mail"
      try {
        if (rememberMe) {
          localStorage.setItem('bf_remember_me', 'true');
          localStorage.setItem('bf_saved_email', email);
        } else {
          localStorage.removeItem('bf_remember_me');
          localStorage.removeItem('bf_saved_email');
        }
      } catch {}

      if (!supabase) {
        try {
          localStorage.setItem('bf-demo-user', normalizedEmail);
          localStorage.setItem('bf-demo-role', mode === 'signup' ? perfil : 'admin');
          if (mode === 'signup' && perfil === 'cliente') {
            localStorage.setItem('bf-demo-documento', documentoDigits);
            localStorage.setItem('bf-demo-documento-tipo', documentoDigits.length === 14 ? 'cnpj' : 'cpf');
          }
        } catch {}
        return finish();
      }

      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              full_name: name.trim(),
              role: perfil,
              ...(perfil === 'cliente'
                ? { documento: documentoDigits, documento_tipo: documentoDigits.length === 14 ? 'cnpj' : 'cpf' }
                : {})
            },
            emailRedirectTo: `${window.location.origin}/painel`
          }
        });
        if (err) return setError(err.message);
        if (!data.session) return setInfo('Conta criada! Confirme seu e-mail para acessar.');
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (err) return setError('E-mail/usuário ou senha incorretos.');
      }
      finish();
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    const trimmedInput = email.trim().toLowerCase();
    const normalizedEmail = trimmedInput === 'admin' ? 'admin@dap.com.br' : trimmedInput;
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return setError('Informe um e-mail válido.');
    if (!supabase) return setInfo('Modo demonstração: a recuperação de senha não está disponível.');

    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/redefinir-senha`
      });
      // Resposta neutra para não revelar se o e-mail está cadastrado; só erros de envio (ex.: limite) aparecem.
      if (err) return setError('Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.');
      setInfo('Se o e-mail estiver cadastrado, você receberá em instantes um link para redefinir a senha.');
    } finally {
      setLoading(false);
    }
  };

  const trocarModo = (novo: Mode) => {
    setMode(novo);
    setError('');
    setInfo('');
  };


  return (
    <main className="bf-auth">
      {/* T da TechTie animado e copy (o fundo dele cobre a tela inteira) */}
      <section className="bf-auth-left">
        <TechTieHero />
      </section>

      {/* Gateway de login em cartão de vidro */}
      <section className="bf-auth-right">
        <div className="bf-auth-card">
          <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.6, color: TEXT, margin: '0 0 8px' }}>
            {mode === 'login' ? 'Acesse sua conta' : mode === 'signup' ? 'Crie sua conta' : 'Recuperar senha'}
          </h2>
          <p style={{ fontSize: 15, color: MUTED, margin: '0 0 24px' }}>
            {mode === 'login'
              ? 'Entre para consultar e acompanhar seus processos.'
              : mode === 'signup'
                ? 'Leva menos de um minuto.'
                : 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'}
          </p>

          {mode === 'forgot' && (
            <form onSubmit={handleForgot} noValidate style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={label} htmlFor="bf-forgot-email">
                  E-mail
                </label>
                <input
                  id="bf-forgot-email"
                  type="email"
                  className="bf-input"
                  placeholder="voce@exemplo.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              {error && (
                <div role="alert" style={{ background: 'rgba(180,82,95,0.18)', color: '#f3b4bd', border: '1px solid rgba(180,82,95,0.4)', padding: '12px 14px', borderRadius: 12, fontSize: 14 }}>
                  {error}
                </div>
              )}
              {info && (
                <div style={{ background: 'rgba(143,185,154,0.15)', color: '#b9dcc3', border: '1px solid rgba(143,185,154,0.4)', padding: '12px 14px', borderRadius: 12, fontSize: 14 }}>
                  {info}
                </div>
              )}
              <button type="submit" disabled={loading} className="bf-btn-primary bf-btn-ouro">
                {loading ? 'Aguarde…' : 'Enviar link de redefinição'}
              </button>
            </form>
          )}

          {mode === 'signup' && (
            <div style={{ margin: '0 0 20px' }}>
              <label style={label}>Qual é o seu perfil de acesso?</label>
              <SegmentedControl
                fullWidth
                value={perfil}
                onChange={v => setPerfil(v as Perfil)}
                data={[
                  { label: 'Advogado', value: 'advogado' },
                  { label: 'Broker', value: 'broker' },
                  { label: 'Consulta Avulsa', value: 'cliente' }
                ]}
                mb={6}
              />
              <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 0', lineHeight: 1.4 }}>
                {perfil === 'advogado' && 'Acesso a consultas livres por qualquer CPF ou CNJ, gestão de carteiras e automações.'}
                {perfil === 'broker' && 'Acesso a consultas livres, análise de precatórios/ativos judiciais e automação de funil.'}
                {perfil === 'cliente' && 'Acesso restrito ao próprio CPF/CNPJ cadastrado, ideal para acompanhamento pessoal.'}
              </p>
            </div>
          )}

          {mode !== 'forgot' && (
          <>
          <button type="button" onClick={handleGoogle} className="bf-btn-google">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.4-4.8 7.1l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.4z" />
              <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Continuar com Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '20px 0', color: MUTED, fontSize: 13 }}>
            <span style={{ flex: 1, height: 1, background: 'rgb(var(--bf-fg) / 0.14)' }} />
            ou com e-mail e senha
            <span style={{ flex: 1, height: 1, background: 'rgb(var(--bf-fg) / 0.14)' }} />
          </div>

          <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
            {mode === 'signup' && (
              <div>
                <label style={label} htmlFor="bf-name">
                  Nome completo
                </label>
                <input id="bf-name" className="bf-input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
              </div>
            )}
            {mode === 'signup' && perfil === 'cliente' && (
              <div>
                <label style={label} htmlFor="bf-documento">
                  CPF ou CNPJ do titular
                </label>
                <input
                  id="bf-documento"
                  className="bf-input"
                  placeholder="000.000.000-00"
                  value={documento}
                  maxLength={18}
                  onChange={e => setDocumento(formatDocumento(e.target.value))}
                  autoComplete="off"
                />
                <p style={{ fontSize: 12, color: MUTED, margin: '6px 0 0' }}>
                  Você consultará os processos ligados a este documento fixo.
                </p>
              </div>
            )}
            <div>
              <label style={label} htmlFor="bf-email">
                E-mail ou Usuário
              </label>
              <input
                id="bf-email"
                type="text"
                className="bf-input"
                placeholder={mode === 'signup' ? 'voce@exemplo.com' : 'admin ou voce@exemplo.com'}
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label style={label} htmlFor="bf-pass">
                Senha
              </label>
              <input
                id="bf-pass"
                type="password"
                className="bf-input"
                placeholder={mode === 'signup' ? `Mínimo de ${MIN_SENHA_CADASTRO} caracteres` : 'Sua senha'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: -4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: MUTED, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: BLUE }}
                />
                <span>Lembrar meu e-mail neste navegador</span>
              </label>
              {mode === 'login' && (
                <button type="button" onClick={() => trocarModo('forgot')} style={linkButton}>
                  Esqueci minha senha
                </button>
              )}
            </div>

            {error && (
              <div role="alert" style={{ background: 'rgba(180,82,95,0.18)', color: '#f3b4bd', border: '1px solid rgba(180,82,95,0.4)', padding: '12px 14px', borderRadius: 12, fontSize: 14 }}>
                {error}
              </div>
            )}
            {info && (
              <div style={{ background: 'rgba(143,185,154,0.15)', color: '#b9dcc3', border: '1px solid rgba(143,185,154,0.4)', padding: '12px 14px', borderRadius: 12, fontSize: 14 }}>
                {info}
              </div>
            )}

            <button type="submit" disabled={loading} className="bf-btn-primary bf-btn-ouro">
              {loading ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
          </>
          )}

          <p style={{ fontSize: 14, color: MUTED, textAlign: 'center', marginTop: 22 }}>
            {mode === 'login' ? 'Ainda não tem conta?' : mode === 'signup' ? 'Já possui conta?' : 'Lembrou a senha?'}{' '}
            <button
              type="button"
              onClick={() => trocarModo(mode === 'login' ? 'signup' : 'login')}
              style={{ background: 'none', border: 'none', padding: 0, color: TEXT, textDecoration: 'underline', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
            >
              {mode === 'login' ? 'Criar conta' : mode === 'signup' ? 'Fazer login' : 'Voltar para o login'}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
