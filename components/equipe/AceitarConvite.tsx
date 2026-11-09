'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleAlert, CircleCheck, Clock, LoaderCircle, LogIn, MailX, UserPlus, Users } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { authFetch } from '@/lib/authFetch';

type Estado =
  | { fase: 'verificando' }
  | { fase: 'sem_login' }
  | { fase: 'pronto' }
  | { fase: 'enviando' }
  | { fase: 'sucesso'; escritorio: string }
  | { fase: 'erro'; codigo: string; mensagem: string };

const CHAVE_PENDENTE = 'ap_convite_pendente';

/**
 * Aceite do convite vindo do e-mail. Abrir a página não muda nada (scanners de link abrem tudo); só o botão aceita.
 * Sem sessão, guarda o token no sessionStorage e leva ao login; depois de entrar, abra o link do e-mail de novo.
 */
export function AceitarConvite({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'verificando' });

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setEstado({ fase: 'sem_login' });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setEstado({ fase: 'pronto' });
      else {
        try {
          sessionStorage.setItem(CHAVE_PENDENTE, token);
        } catch {}
        setEstado({ fase: 'sem_login' });
      }
    });
  }, [token]);

  async function aceitar() {
    setEstado({ fase: 'enviando' });
    try {
      const res = await authFetch('/api/equipe/convites/aceitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEstado({ fase: 'erro', codigo: corpo.codigo ?? 'erro', mensagem: corpo.error ?? 'Não foi possível aceitar o convite agora.' });
        return;
      }
      try {
        sessionStorage.removeItem(CHAVE_PENDENTE);
      } catch {}
      setEstado({ fase: 'sucesso', escritorio: corpo.escritorioNome ?? 'o escritório' });
    } catch {
      setEstado({ fase: 'erro', codigo: 'rede', mensagem: 'Sem conexão. Tente de novo.' });
    }
  }

  const btn =
    'bf-btn-ouro mt-6 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#1E7CF2] px-5 py-3 text-sm font-semibold text-[#FFFFFF] disabled:cursor-wait disabled:opacity-70';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[color:var(--tt-ink)] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-sm backdrop-blur-md sm:p-8">
        {estado.fase === 'verificando' && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-white/60">
            <LoaderCircle size={16} className="animate-spin" /> Verificando convite...
          </div>
        )}

        {estado.fase === 'sem_login' && (
          <>
            <Users size={40} strokeWidth={1.6} className="mx-auto text-[#1E7CF2]" />
            <h1 className="mt-4 text-xl font-semibold text-white">Você foi convidado para um escritório</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Entre ou crie sua conta com o <strong className="text-white/80">mesmo e-mail que recebeu o convite</strong>. Depois de entrar, abra este link do
              e-mail novamente para aceitar.
            </p>
            <Link href="/login?modo=login" className={btn}>
              <LogIn size={16} /> Entrar
            </Link>
            <Link
              href="/login?modo=signup"
              className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white/80 transition hover:text-white"
            >
              <UserPlus size={16} /> Criar conta
            </Link>
          </>
        )}

        {(estado.fase === 'pronto' || estado.fase === 'enviando') && (
          <>
            <Users size={40} strokeWidth={1.6} className="mx-auto text-[#1E7CF2]" />
            <h1 className="mt-4 text-xl font-semibold text-white">Entrar no escritório?</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Você passará a ver, em modo leitura, os processos e as buscas do Diário dos colegas. O que você cadastrar continua sendo só seu para alterar.
            </p>
            <button type="button" onClick={aceitar} disabled={estado.fase === 'enviando'} className={btn}>
              {estado.fase === 'enviando' && <LoaderCircle size={16} className="animate-spin" />}
              Aceitar convite
            </button>
          </>
        )}

        {estado.fase === 'sucesso' && (
          <>
            <CircleCheck size={40} strokeWidth={1.6} className="mx-auto text-[#1E7CF2]" />
            <h1 className="mt-4 text-xl font-semibold text-white">Convite aceito</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Você agora faz parte de <strong className="text-white/80">{estado.escritorio}</strong>.
            </p>
            <Link href="/equipe" className={btn}>
              Ver a equipe
            </Link>
          </>
        )}

        {estado.fase === 'erro' && (
          <>
            {estado.codigo === 'convite_expirado' ? (
              <Clock size={40} strokeWidth={1.6} className="mx-auto text-amber-300" />
            ) : estado.codigo === 'email_diferente' ? (
              <MailX size={40} strokeWidth={1.6} className="mx-auto text-amber-300" />
            ) : (
              <CircleAlert size={40} strokeWidth={1.6} className="mx-auto text-red-300" />
            )}
            <h1 className="mt-4 text-xl font-semibold text-white">
              {estado.codigo === 'convite_expirado'
                ? 'Convite expirado'
                : estado.codigo === 'convite_invalido' || estado.codigo === 'convite_usado'
                ? 'Convite inválido'
                : estado.codigo === 'email_diferente'
                ? 'Conta diferente da convidada'
                : estado.codigo === 'limite_membros'
                ? 'Escritório sem vagas'
                : 'Não foi possível aceitar'}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{estado.mensagem}</p>
            {estado.codigo === 'email_diferente' && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    sessionStorage.setItem(CHAVE_PENDENTE, token);
                  } catch {}
                  await getSupabase()?.auth.signOut();
                  window.location.href = '/login?modo=login';
                }}
                className={btn}
              >
                <LogIn size={16} /> Trocar de conta
              </button>
            )}
            {estado.codigo === 'ja_em_escritorio' && (
              <Link href="/equipe" className={btn}>
                Ir para a equipe
              </Link>
            )}
          </>
        )}

        <Link href="/" className="mt-6 inline-block cursor-pointer text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline">
          Ir para a TechTie
        </Link>
      </div>
    </main>
  );
}
