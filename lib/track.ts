import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

export type TipoEvento = 'login' | 'logout' | 'signup' | 'consulta' | 'resumo_ia' | 'chat_ia' | 'lead' | 'page_view';

export interface EventoInput {
  tipo: TipoEvento;
  numeroCnj?: string;
  assunto?: string;
  classe?: string;
  tribunal?: string;
  dados?: Record<string, unknown>;
}

let admin: SupabaseClient | null = null;

/** Cliente com service role — uso exclusivo do servidor (ignora RLS). */
export function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  if (!admin) admin = createClient(url, key, { auth: { persistSession: false } });
  return admin;
}

/** Resolve o usuário a partir do Bearer token. */
export async function getUserId(request: Request): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!url || !anon || !token) return null;
  const { data, error } = await createClient(url, anon).auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

function clientInfo(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const salt = process.env.SUPABASE_SECRET_KEY ?? '';
  return {
    ip_hash: ip ? createHash('sha256').update(ip + salt).digest('hex').slice(0, 32) : null,
    user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null
  };
}

/** Registra um evento de negócio (login, consulta, ...). Nunca lança erro. */
export async function trackEvento(request: Request, userId: string | null, evento: EventoInput) {
  try {
    const db = getAdminClient();
    if (!db) return;
    await db.from('ap_eventos').insert({
      user_id: userId,
      tipo: evento.tipo,
      numero_cnj: evento.numeroCnj ?? null,
      assunto: evento.assunto ?? null,
      classe: evento.classe ?? null,
      tribunal: evento.tribunal ?? null,
      dados: evento.dados ?? {},
      ...clientInfo(request)
    });
  } catch (e) {
    console.error('[track] falha ao registrar evento', e);
  }
}

/** Registra a auditoria de uma requisição à API. Nunca lança erro. */
export async function auditRequest(request: Request, userId: string | null, status: number | null = null) {
  try {
    const db = getAdminClient();
    if (!db) return;
    await db.from('ap_auditoria').insert({
      user_id: userId,
      metodo: request.method,
      rota: new URL(request.url).pathname,
      status,
      ...clientInfo(request)
    });
  } catch (e) {
    console.error('[audit] falha ao registrar auditoria', e);
  }
}
