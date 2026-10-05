import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { parseCnj } from '@/lib/cnj';
import { cleanDigits } from '@/lib/format';

const COLUNAS =
  'id,pipeline_id,etapa_id,titulo,numero_cnj,numero_cnj_formatado,tribunal_label,esfera,campos_customizados,status_enriquecimento,erro_mensagem,dados_enriquecidos,enriquecido_em,responsavel_id,created_at';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data, error } = await db.from('ap_crm_itens').select(COLUNAS).eq('id', id).maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 });

  return NextResponse.json({ item: data });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.titulo === 'string') patch.titulo = body.titulo.trim();
  if (typeof body.etapaId === 'string') patch.etapa_id = body.etapaId;
  if (body.camposCustomizados && typeof body.camposCustomizados === 'object') patch.campos_customizados = body.camposCustomizados;
  if (typeof body.responsavelId === 'string' || body.responsavelId === null) patch.responsavel_id = body.responsavelId;

  if (typeof body.numeroCnj === 'string') {
    const cnjDigits = cleanDigits(body.numeroCnj);
    const cnjInfo = cnjDigits.length === 20 ? parseCnj(cnjDigits) : null;
    patch.numero_cnj = cnjInfo?.numeroLimpo ?? null;
    patch.numero_cnj_formatado = cnjInfo?.numeroFormatado ?? null;
    patch.tribunal_label = cnjInfo?.tribunalLabel ?? null;
    patch.esfera = cnjInfo ? (cnjInfo.ramoJustica === '8' ? 'estadual' : cnjInfo.ramoJustica === '4' ? 'federal' : null) : null;
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data, error } = await db.from('ap_crm_itens').update(patch).eq('id', id).select(COLUNAS).single();

  if (error) {
    console.error('[api/crm/itens/:id] erro ao editar:', error.message);
    return NextResponse.json({ error: 'Falha ao editar item.' }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { error } = await db.from('ap_crm_itens').delete().eq('id', id);
  if (error) {
    console.error('[api/crm/itens/:id] erro ao excluir:', error.message);
    return NextResponse.json({ error: 'Falha ao excluir item.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
