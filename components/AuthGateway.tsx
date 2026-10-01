'use client';

import { useState, useEffect, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { SegmentedControl } from '@mantine/core';
import GhostFibers from './GhostFibers';
import { getSupabase } from '@/lib/supabase';
import { cleanDigits, formatDocumento, isValidCpf, isValidCnpj } from '@/lib/format';

const BLUE = '#5f5f5f';
const TEXT = '#232323';
const MUTED = '#7a7a7a';

type Mode = 'login' | 'signup';
type Perfil = 'advogado' | 'broker' | 'cliente';

const label: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', margin: '0 0 8px' };

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

  // Carrega credenciais salvas no localStorage (Lembrar senha)
  useEffect(() => {
    try {
      const savedRemember = localStorage.getItem('bf_remember_me');
      if (savedRemember === 'true') {
        const savedEmail = localStorage.getItem('bf_saved_email') || '';
        const savedPassword = localStorage.getItem('bf_saved_password') || '';
        if (savedEmail) setEmail(savedEmail);
        if (savedPassword) setPassword(savedPassword);
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
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Informe um e-mail válido.');
    if (password.length < 6) return setError('A senha deve ter ao menos 6 caracteres.');
    if (mode === 'signup' && name.trim().length < 3) return setError('Informe seu nome completo.');
    if (mode === 'signup' && perfil === 'cliente' && !isDocumentoValido) {
      return setError('Informe um CPF ou CNPJ válido para a Consulta Avulsa.');
    }

    setLoading(true);
    try {
      // Salva ou remove credenciais do localStorage conforme checkbox "Lembrar dados"
      try {
        if (rememberMe) {
          localStorage.setItem('bf_remember_me', 'true');
          localStorage.setItem('bf_saved_email', email);
          localStorage.setItem('bf_saved_password', password);
        } else {
          localStorage.removeItem('bf_remember_me');
          localStorage.removeItem('bf_saved_email');
          localStorage.removeItem('bf_saved_password');
        }
      } catch {}

      if (!supabase) {
        try {
          localStorage.setItem('bf-demo-user', email);
          localStorage.setItem('bf-demo-role', mode === 'signup' ? perfil : 'advogado');
          if (mode === 'signup' && perfil === 'cliente') {
            localStorage.setItem('bf-demo-documento', documentoDigits);
            localStorage.setItem('bf-demo-documento-tipo', documentoDigits.length === 14 ? 'cnpj' : 'cpf');
          }
        } catch {}
        return finish();
      }

      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email,
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
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) return setError('E-mail ou senha incorretos.');
      }
      finish();
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="bf-auth">
      {/* COLUNA ESQUERDA — efeito de fundo, logo e copy */}
      <section className="bf-auth-left">
        <GhostFibers contained lineColor="#262626" glowColor="#555554" backdropColor="#0e0e0e" blueBoost={1.1} />
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 'clamp(24px, 4vw, 64px)',
            gap: 28
          }}
        >
          <img
            src="/blindagem-logo.png"
            alt="Blindagem Financeira"
            style={{
              width: 'min(285px, 52.5%)',
              height: 'auto',
              filter: 'brightness(1.1) drop-shadow(0 4px 16px rgba(0,0,0,0.6))'
            }}
          />
          <div style={{ maxWidth: 560 }}>
            <h1
              style={{
                fontSize: 'clamp(22px, 2.3vw, 32px)',
                fontWeight: 600,
                color: '#F5F3EE',
                lineHeight: 1.25,
                letterSpacing: -0.5,
                margin: '0 0 14px',
                textShadow: '0 2px 10px rgba(0,0,0,0.6)'
              }}
            >
              Acompanhamento processual com inteligência artificial, em linguagem jurídica clara.
            </h1>
            <p style={{ fontSize: 'clamp(13px, 1.1vw, 15px)', color: '#F5F3EE', lineHeight: 1.7, margin: 0, textShadow: '0 1px 8px rgba(4,11,32,0.85)' }}>
              Consulte processos por CPF ou número CNJ, receba resumos técnicos de cada andamento, entenda prazos, partes
              e riscos e acompanhe a movimentação dos seus processos judiciais em um só lugar. Uma alternativa mais
              inteligente ao JusBrasil, criada pela Blindagem Financeira para proteger o seu patrimônio.
            </p>
          </div>
        </div>
      </section>

      {/* COLUNA DIREITA — gateway de login */}
      <section className="bf-auth-right">
        <div className="bf-auth-card">
          <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.6, color: TEXT, margin: '0 0 8px' }}>
            {mode === 'login' ? 'Acesse sua conta' : 'Crie sua conta'}
          </h2>
          <p style={{ fontSize: 15, color: MUTED, margin: '0 0 24px' }}>
            {mode === 'login' ? 'Entre para consultar e acompanhar seus processos.' : 'Leva menos de um minuto.'}
          </p>

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

          <button type="button" onClick={handleGoogle} className="bf-btn-google">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.4-4.8 7.1l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.4z" />
              <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Continuar com Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '20px 0', color: '#94a3b8', fontSize: 13 }}>
            <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            ou com e-mail e senha
            <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
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
                E-mail
              </label>
              <input
                id="bf-email"
                type="email"
                className="bf-input"
                placeholder="voce@exemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
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
                placeholder="Mínimo de 6 caracteres"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer', userSelect: 'none', marginTop: -4 }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2455b8' }}
              />
              <span>Lembrar meus dados de acesso neste navegador</span>
            </label>

            {error && (
              <div role="alert" style={{ background: '#fef2f2', color: '#b42318', padding: '12px 14px', borderRadius: 12, fontSize: 14 }}>
                {error}
              </div>
            )}
            {info && (
              <div style={{ background: '#ecfdf3', color: '#067647', padding: '12px 14px', borderRadius: 12, fontSize: 14 }}>
                {info}
              </div>
            )}

            <button type="submit" disabled={loading} className="bf-btn-primary">
              {loading ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <p style={{ fontSize: 14, color: MUTED, textAlign: 'center', marginTop: 22 }}>
            {mode === 'login' ? 'Ainda não tem conta?' : 'Já possui conta?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError('');
                setInfo('');
              }}
              style={{ background: 'none', border: 'none', padding: 0, color: '#ffffff', textDecoration: 'underline', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
            >
              {mode === 'login' ? 'Criar conta' : 'Fazer login'}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
