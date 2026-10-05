import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.nome === 'string') patch.nome = body.nome.trim();
  if (typeof body.descricao === 'string' || body.descricao === null) patch.descricao = body.descricao?.trim() || null;
  if (typeof body.ordem === 'number') patch.ordem = body.ordem;
  if (typeof body.ativo === 'boolean') patch.ativo = body.ativo;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data, error } = await db
    .from('ap_crm_pipelines')
    .update(patch)
    .eq('id', id)
    .select('id,nome,descricao,ordem,ativo')
    .single();

  if (error) {
    console.error('[api/crm/pipelines/:id] erro ao editar:', error.message);
    return NextResponse.json({ error: 'Falha ao editar pipeline.' }, { status: 500 });
  }

  return NextResponse.json({ pipeline: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { error } = await db.from('ap_crm_pipelines').delete().eq('id', id);
  if (error) {
    console.error('[api/crm/pipelines/:id] erro ao excluir:', error.message);
    return NextResponse.json({ error: 'Falha ao excluir pipeline.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
