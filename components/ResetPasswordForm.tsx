'use client';

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';

const TEXT = '#060F28';
const MUTED = '#4A5878';
const MIN_SENHA = 8;

const label: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', margin: '0 0 8px' };
const toggleBtn: CSSProperties = {
  position: 'absolute',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  padding: 6,
  cursor: 'pointer',
  color: '#4A5878',
  display: 'flex'
};

type Estado = 'verificando' | 'pronto' | 'invalido' | 'concluido';

export default function ResetPasswordForm() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>('verificando');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // O link do e-mail traz o token no hash da URL; o supabase-js o troca por uma sessão de recuperação
  // e emite PASSWORD_RECOVERY. Link expirado/já usado chega como error_code no hash.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setEstado('invalido');
      return;
    }

    const hash = window.location.hash;
    if (/error(_code|_description)?=/.test(hash)) {
      setEstado('invalido');
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setEstado('pronto');
    });

    // Sem token na URL (acesso direto à página): não há o que redefinir.
    const timer = window.setTimeout(() => {
      setEstado(atual => (atual === 'verificando' ? 'invalido' : atual));
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (senha.length < MIN_SENHA) return setError(`A senha deve ter ao menos ${MIN_SENHA} caracteres.`);
    if (senha !== confirmacao) return setError('As senhas não conferem.');

    const supabase = getSupabase();
    if (!supabase) return;

    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: senha });
      if (err) {
        if (err.code === 'same_password') return setError('A nova senha deve ser diferente da atual.');
        if (err.code === 'weak_password') return setError('Senha muito fraca. Use letras, números e símbolos.');
        return setError('Não foi possível redefinir a senha. Solicite um novo link.');
      }
      setEstado('concluido');
      window.setTimeout(() => router.replace('/painel'), 1800);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="bf-auth-right" style={{ minHeight: '100dvh' }}>
      <div className="bf-auth-card">
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.6, color: TEXT, margin: '0 0 8px' }}>Nova senha</h1>

        {estado === 'verificando' && <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Validando o link de redefinição…</p>}

        {estado === 'invalido' && (
          <>
            <div role="alert" style={{ background: '#fef2f2', color: '#b42318', padding: '12px 14px', borderRadius: 12, fontSize: 14, margin: '8px 0 20px' }}>
              Este link é inválido, expirou ou já foi utilizado. Solicite um novo link na tela de login.
            </div>
            <button type="button" className="bf-btn-primary" onClick={() => router.replace('/')}>
              Voltar para o login
            </button>
          </>
        )}

        {estado === 'concluido' && (
          <div style={{ background: '#ecfdf3', color: '#067647', padding: '12px 14px', borderRadius: 12, fontSize: 14, marginTop: 8 }}>
            Senha redefinida com sucesso. Redirecionando…
          </div>
        )}

        {estado === 'pronto' && (
          <>
            <p style={{ fontSize: 15, color: MUTED, margin: '0 0 24px' }}>Escolha uma nova senha para acessar sua conta.</p>
            <form onSubmit={handleSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
              <div>
                <label style={label} htmlFor="bf-new-pass">
                  Nova senha
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="bf-new-pass"
                    type={mostrar ? 'text' : 'password'}
                    className="bf-input"
                    placeholder={`Mínimo de ${MIN_SENHA} caracteres`}
                    value={senha}
                    onChange={e => setSenha(e.target.value)}
                    autoComplete="new-password"
                    style={{ paddingRight: 48 }}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrar(v => !v)}
                    aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
                    style={toggleBtn}
                  >
                    {mostrar ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={label} htmlFor="bf-confirm-pass">
                  Confirmar nova senha
                </label>
                <input
                  id="bf-confirm-pass"
                  type={mostrar ? 'text' : 'password'}
                  className="bf-input"
                  value={confirmacao}
                  onChange={e => setConfirmacao(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error && (
                <div role="alert" style={{ background: '#fef2f2', color: '#b42318', padding: '12px 14px', borderRadius: 12, fontSize: 14 }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading} className="bf-btn-primary">
                {loading ? 'Aguarde…' : 'Redefinir senha'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
