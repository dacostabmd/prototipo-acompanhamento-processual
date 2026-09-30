import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { getProcessosCache, setProcessosCache } from '@/lib/redis';

export interface ProcessoPesquisado {
  id: string;
  numero_cnj: string;
  tribunal: string | null;
  classe: string | null;
  parte_passiva: string | null;
  ultima_movimentacao_em: string | null;
  created_at: string;
}

const COLUNAS = 'id,numero_cnj,tribunal,classe,parte_passiva,ultima_movimentacao_em,created_at';

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ processos: [] });

  const cached = await getProcessosCache<ProcessoPesquisado>(userId);
  if (cached) {
    return NextResponse.json({ processos: cached, fromCache: true });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ processos: [] });

  const { data, error } = await db
    .from('ap_processos_pesquisados')
    .select(COLUNAS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[api/processos/listar] erro ao consultar Postgres:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar processos.' }, { status: 500 });
  }

  const processos = (data as ProcessoPesquisado[]) ?? [];
  await setProcessosCache(userId, processos);
  return NextResponse.json({ processos, fromCache: false });
}
