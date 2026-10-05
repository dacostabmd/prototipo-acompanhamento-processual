import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import type { CrmTipoCampo } from '@/lib/crm';

function toCrmTipoCampo(row: any): CrmTipoCampo {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    storageKind: row.storage_kind,
    requerOpcoes: row.requer_opcoes,
    ativo: row.ativo,
    ordem: row.ordem
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ tipos: [] });

  const { data, error } = await db
    .from('ap_crm_tipos_campo')
    .select('id,slug,label,storage_kind,requer_opcoes,ativo,ordem')
    .eq('ativo', true)
    .order('ordem', { ascending: true });

  if (error) {
    console.error('[api/crm/tipos-campo] erro ao listar:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar tipos de campo.' }, { status: 500 });
  }

  return NextResponse.json({ tipos: (data ?? []).map(toCrmTipoCampo) });
}
