import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient } from '@/lib/track';
import type { CrmResponsavel } from '@/lib/crm';

/** Lista advogados do departamento dono do pipeline (?departamentoId=), para popular o Select de Responsável. */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ responsaveis: [] });

  const { searchParams } = new URL(request.url);
  const departamentoId = searchParams.get('departamentoId');
  if (!departamentoId) return NextResponse.json({ responsaveis: [] });

  const { data: membros, error: erroMembros } = await db
    .from('ap_departamento_membros')
    .select('user_id')
    .eq('departamento_id', departamentoId);

  if (erroMembros || !membros?.length) {
    if (erroMembros) console.error('[api/crm/responsaveis] erro ao listar membros:', erroMembros.message);
    return NextResponse.json({ responsaveis: [] });
  }

  const { data: perfis, error: erroPerfis } = await db
    .from('ap_perfis')
    .select('id,nome')
    .in('id', membros.map(m => m.user_id as string));

  if (erroPerfis) {
    console.error('[api/crm/responsaveis] erro ao listar perfis:', erroPerfis.message);
    return NextResponse.json({ responsaveis: [] });
  }

  const responsaveis: CrmResponsavel[] = (perfis ?? [])
    .map(p => ({ id: p.id as string, nome: p.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return NextResponse.json({ responsaveis });
}
