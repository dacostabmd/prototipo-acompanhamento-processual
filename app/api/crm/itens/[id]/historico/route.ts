import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient } from '@/lib/track';
import type { CrmItemHistoricoEntrada } from '@/lib/crm';

const TABELA_HISTORICO = 'ap_crm_itens_historico';

/** Histórico cronológico de mudança de etapa de um item (ap_crm_itens_historico). RLS restringe a quem pode acessar o item. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ historico: [] });

  const { data, error } = await db
    .from(TABELA_HISTORICO)
    .select('id,item_id,etapa_anterior_id,etapa_nova_id,movido_por,movido_em')
    .eq('item_id', id)
    .order('movido_em', { ascending: false });

  if (error) {
    console.error('[api/crm/itens/:id/historico] erro ao listar:', error.message);
    return NextResponse.json({ historico: [], erro: 'Não foi possível carregar o histórico.' });
  }

  const historico: CrmItemHistoricoEntrada[] = (data ?? []).map(row => ({
    id: row.id as string,
    itemId: row.item_id as string,
    etapaAnteriorId: (row.etapa_anterior_id as string | null) ?? null,
    etapaNovaId: row.etapa_nova_id as string,
    movidoPor: (row.movido_por as string | null) ?? null,
    movidoEm: row.movido_em as string
  }));

  return NextResponse.json({ historico });
}
