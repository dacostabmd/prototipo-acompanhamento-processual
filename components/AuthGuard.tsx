'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { authFetch } from '@/lib/authFetch';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();

    let mounted = true;

    // Sem Supabase configurado: aceita a sessão de demonstração
    if (!supabase) {
      let demo = false;
      try {
        demo = Boolean(localStorage.getItem('bf-demo-user'));
      } catch {}
      if (demo) setReady(true);
      else router.replace('/');
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace('/');
      } else {
        setReady(true);
        // Tracking de login: uma vez por sessão do navegador
        try {
          if (!sessionStorage.getItem('bf-login-tracked')) {
            sessionStorage.setItem('bf-login-tracked', '1');
            authFetch('/api/eventos', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tipo: 'login', dados: { provider: data.session.user.app_metadata?.provider } })
            }).catch(() => {});
          }
        } catch {}
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || (event === 'USER_UPDATED' && !session)) {
        setReady(false);
        router.replace('/');
      } else if (session) {
        setReady(true);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (!ready) return <div style={{ minHeight: '100vh', background: '#f1f3f7' }} />;
  return <>{children}</>;
}
