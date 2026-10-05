import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';

export async function PATCH(request: Request, { params }: { params: Promise<{ etapaId: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { etapaId } = await params;
  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.nome === 'string') patch.nome = body.nome.trim();
  if (typeof body.cor === 'string' || body.cor === null) patch.cor = body.cor || null;
  if (typeof body.ordem === 'number') patch.ordem = body.ordem;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data, error } = await db
    .from('ap_crm_pipeline_etapas')
    .update(patch)
    .eq('id', etapaId)
    .select('id,pipeline_id,nome,cor,ordem')
    .single();

  if (error) {
    console.error('[api/crm/pipelines/:id/etapas/:etapaId] erro ao editar:', error.message);
    return NextResponse.json({ error: 'Falha ao editar etapa.' }, { status: 500 });
  }

  return NextResponse.json({ etapa: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ etapaId: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { etapaId } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { count } = await db.from('ap_crm_itens').select('id', { count: 'exact', head: true }).eq('etapa_id', etapaId);
  if (count && count > 0) {
    return NextResponse.json({ error: 'Mova ou exclua os itens desta etapa antes de excluí-la.' }, { status: 409 });
  }

  const { error } = await db.from('ap_crm_pipeline_etapas').delete().eq('id', etapaId);
  if (error) {
    console.error('[api/crm/pipelines/:id/etapas/:etapaId] erro ao excluir:', error.message);
    return NextResponse.json({ error: 'Falha ao excluir etapa.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
