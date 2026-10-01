import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from './track';

/** Garante que o usuário autenticado tem role 'advogado' ou 'admin'. Retorna 403/401 ou null. */
export async function requireAdvogadoOuAdmin(request: Request): Promise<NextResponse | null> {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const db = getAdminClient();
  if (!db) return null; // modo demo sem Supabase: não bloqueia (mesmo padrão de requireUser)

  const { data } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (data?.role !== 'advogado' && data?.role !== 'broker' && data?.role !== 'admin' && data?.role !== 'owner') {
    return NextResponse.json({ error: 'Acesso restrito à equipe operacional.' }, { status: 403 });
  }
  return null;
}

/** Garante que o usuário autenticado tem role 'admin' ou 'owner'. Retorna 403/401 ou null. */
export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const db = getAdminClient();
  if (!db) return null; // modo demo sem Supabase: não bloqueia (mesmo padrão de requireUser)

  const { data } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (data?.role !== 'admin' && data?.role !== 'owner') {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }
  return null;
}

/** Garante que o usuário autenticado tem role 'owner' (reservado ao dono do produto). Retorna 403/401 ou null. */
export async function requireOwner(request: Request): Promise<NextResponse | null> {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const db = getAdminClient();
  if (!db) return null; // modo demo sem Supabase: não bloqueia (mesmo padrão de requireUser)

  const { data } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (data?.role !== 'owner') {
    return NextResponse.json({ error: 'Acesso restrito ao proprietário do produto.' }, { status: 403 });
  }
  return null;
}
