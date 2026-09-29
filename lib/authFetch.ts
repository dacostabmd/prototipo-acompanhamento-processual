import { getSupabase } from './supabase';

/** fetch que anexa o token da sessão Supabase às chamadas de /api. */
export async function authFetch(input: string, init: RequestInit = {}) {
  const session = (await getSupabase()?.auth.getSession())?.data.session;
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}
