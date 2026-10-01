import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from './track';

/** Garante que o usuário autenticado tem role 'advogado' ou 'admin'. Retorna 403/401 ou null. */
export async function requireAdvogadoOuAdmin(request: Request): Promise<NextResponse | null> {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const db = getAdminClient();
  if (!db) return null; // modo demo sem Supabase: não bloqueia (mesmo padrão de requireUser)

  const { data } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (data?.role !== 'advogado' && data?.role !== 'broker' && data?.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso restrito à equipe operacional.' }, { status: 403 });
  }
  return null;
}
