import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';

export async function PATCH(request: Request, { params }: { params: Promise<{ campoId: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { campoId } = await params;
  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.nome === 'string') patch.nome = body.nome.trim();
  if (typeof body.obrigatorio === 'boolean') patch.obrigatorio = body.obrigatorio;
  if (Array.isArray(body.opcoes) || body.opcoes === null) patch.opcoes = body.opcoes;
  if (typeof body.ordem === 'number') patch.ordem = body.ordem;
  if (typeof body.ativo === 'boolean') patch.ativo = body.ativo;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data, error } = await db
    .from('ap_crm_pipeline_campos')
    .update(patch)
    .eq('id', campoId)
    .select('id,pipeline_id,tipo_campo_id,nome,slug,obrigatorio,opcoes,ordem,ativo')
    .single();

  if (error) {
    console.error('[api/crm/pipelines/:id/campos/:campoId] erro ao editar:', error.message);
    return NextResponse.json({ error: 'Falha ao editar campo.' }, { status: 500 });
  }

  return NextResponse.json({ campo: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ campoId: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { campoId } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  // Soft-delete: desativa em vez de apagar, para não perder o histórico de valores já
  // salvos no jsonb dos itens (a definição continua existindo para renderizar o valor).
  const { error } = await db.from('ap_crm_pipeline_campos').update({ ativo: false }).eq('id', campoId);
  if (error) {
    console.error('[api/crm/pipelines/:id/campos/:campoId] erro ao desativar:', error.message);
    return NextResponse.json({ error: 'Falha ao excluir campo.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
