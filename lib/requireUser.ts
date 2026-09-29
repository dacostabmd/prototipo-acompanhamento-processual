import { NextResponse } from 'next/server';
import { auditRequest, getUserId } from './track';

/**
 * Valida o token Bearer no Supabase Auth e audita a requisição.
 * Retorna uma resposta 401 quando inválido/ausente, ou null quando autenticado.
 */
export async function requireUser(request: Request): Promise<NextResponse | null> {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  // Supabase não configurado (modo demonstração): não bloqueia
  if (!configured) return null;

  const userId = await getUserId(request);
  await auditRequest(request, userId, userId ? null : 401);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  return null;
}
