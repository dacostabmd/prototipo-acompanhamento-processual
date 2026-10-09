import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';

const TABELA_ITENS = 'ap_crm_itens_v2';
const TABELA_HISTORICO = 'ap_crm_itens_historico';

const CAMPOS_EDITAVEIS = [
  'etapaId',
  'titulo',
  'clienteNome',
  'clienteDocumento',
  'advogadoResponsavelId',
  'uf',
  'valorCausa',
  'situacaoFinanceira',
  'camposExtra',
  'processoId'
] as const;

const MAPA_COLUNA: Record<(typeof CAMPOS_EDITAVEIS)[number], string> = {
  etapaId: 'etapa_id',
  titulo: 'titulo',
  clienteNome: 'cliente_nome',
  clienteDocumento: 'cliente_documento',
  advogadoResponsavelId: 'advogado_responsavel_id',
  uf: 'uf',
  valorCausa: 'valor_causa',
  situacaoFinanceira: 'situacao_financeira',
  camposExtra: 'campos_extra',
  processoId: 'processo_id'
};

/** Atualiza um item do CRM (edição de campos e/ou mudança de etapa). RLS restringe a quem pode acessar o item. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  const userId = await getUserId(request);
  if (!db || !userId) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (campo in body) updates[MAPA_COLUNA[campo]] = body[campo];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo válido para atualizar.' }, { status: 400 });
  }

  let etapaAnteriorId: string | null = null;
  if ('etapaId' in body) {
    const { data: atual } = await db.from(TABELA_ITENS).select('etapa_id').eq('id', id).maybeSingle();
    etapaAnteriorId = (atual?.etapa_id as string | null) ?? null;
  }

  const { data, error } = await db.from(TABELA_ITENS).update(updates).eq('id', id).select().maybeSingle();
  if (error || !data) {
    console.error('[api/crm/itens/:id] erro ao atualizar:', error?.message);
    return NextResponse.json({ error: 'Não foi possível atualizar o item (verifique permissão).' }, { status: 403 });
  }

  if ('etapaId' in body && etapaAnteriorId !== body.etapaId) {
    await db.from(TABELA_HISTORICO).insert({
      item_id: id,
      etapa_anterior_id: etapaAnteriorId,
      etapa_nova_id: body.etapaId,
      movido_por: userId
    });
  }

  return NextResponse.json({ ok: true });
}

/** Remove um item do CRM. Restrito a admin/owner pela policy ap_crm_itens_delete. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const { error } = await db.from(TABELA_ITENS).delete().eq('id', id);
  if (error) {
    console.error('[api/crm/itens/:id] erro ao excluir:', error.message);
    return NextResponse.json({ error: 'Não foi possível excluir (verifique permissão).' }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
