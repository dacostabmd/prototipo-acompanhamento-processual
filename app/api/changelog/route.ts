import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireOwner } from '@/lib/requireRole';

export interface ChangelogEntry {
  id: string;
  versao: string;
  titulo: string;
  corpo: string;
  created_at: string;
}

const COLUNAS = 'id,versao,titulo,corpo,created_at';

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ entradas: [] });

  const { data, error } = await db
    .from('ap_changelog')
    .select(COLUNAS)
    .eq('publicado', true)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[api/changelog] erro ao consultar Postgres:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar changelog.' }, { status: 500 });
  }

  return NextResponse.json({ entradas: (data as ChangelogEntry[]) ?? [] });
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireOwner(request);
  if (forbidden) return forbidden;

  const { versao, titulo, corpo } = await request.json();
  if (!versao?.trim() || !titulo?.trim() || !corpo?.trim()) {
    return NextResponse.json({ error: 'Informe versão, título e corpo da entrada.' }, { status: 400 });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const userId = await getUserId(request);

  const { data, error } = await db
    .from('ap_changelog')
    .insert({ versao: versao.trim(), titulo: titulo.trim(), corpo: corpo.trim(), created_by: userId })
    .select(COLUNAS)
    .single();

  if (error) {
    console.error('[api/changelog] erro ao criar entrada:', error.message);
    return NextResponse.json({ error: 'Falha ao salvar entrada do changelog.' }, { status: 500 });
  }

  return NextResponse.json({ entrada: data as ChangelogEntry });
}
