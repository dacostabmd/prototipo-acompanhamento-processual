import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';

export interface Notificacao {
  id: string;
  processoId: string;
  numeroCnj: string | null;
  titulo: string;
  mensagem: string;
  lida: boolean;
  criadaEm: string;
}

const LIMITE = 30;

/** Notificações do app (gravadas pelo worker de alertas a cada movimentação nova), mais recentes primeiro. */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ notificacoes: [], naoLidas: 0 });

  const [lista, naoLidas] = await Promise.all([
    db
      .from('ap_notificacoes')
      .select('id, processo_id, titulo, mensagem, lida, created_at, ap_processos(numero_cnj)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIMITE),
    db.from('ap_notificacoes').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('lida', false)
  ]);

  if (lista.error) {
    console.error('[api/notificacoes] erro ao listar:', lista.error.message);
    return NextResponse.json({ error: 'Falha ao carregar os alertas.' }, { status: 500 });
  }

  const notificacoes: Notificacao[] = (lista.data ?? []).map(n => {
    const processo = n.ap_processos as unknown as { numero_cnj: string } | null;
    return {
      id: n.id as string,
      processoId: n.processo_id as string,
      numeroCnj: processo?.numero_cnj ?? null,
      titulo: n.titulo as string,
      mensagem: n.mensagem as string,
      lida: n.lida as boolean,
      criadaEm: n.created_at as string
    };
  });

  return NextResponse.json({ notificacoes, naoLidas: naoLidas.count ?? 0 });
}

/** Marca como lidas: { ids: string[] } ou { todas: true }. */
export async function PATCH(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ atualizadas: 0 });

  const body = (await request.json().catch(() => null)) as { ids?: unknown; todas?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((i): i is string => typeof i === 'string').slice(0, 100) : [];
  if (body?.todas !== true && ids.length === 0) {
    return NextResponse.json({ error: 'Informe as notificações a marcar.' }, { status: 400 });
  }

  let query = db.from('ap_notificacoes').update({ lida: true }).eq('user_id', userId).eq('lida', false);
  if (body?.todas !== true) query = query.in('id', ids);
  const { data, error } = await query.select('id');

  if (error) {
    console.error('[api/notificacoes] erro ao marcar como lidas:', error.message);
    return NextResponse.json({ error: 'Não foi possível atualizar os alertas.' }, { status: 500 });
  }
  return NextResponse.json({ atualizadas: data?.length ?? 0 });
}
