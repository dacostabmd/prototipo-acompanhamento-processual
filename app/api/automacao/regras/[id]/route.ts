import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';

const COLUNAS =
  'id,user_id,nome,categoria_id,categoria_nome,stage_id,stage_nome,campo_processo,tamanho_lote,filtro_esfera,filtro_valor_min,filtro_valor_max,campo_valor,campo_esfera,ordem,ativo';

async function carregarDono(db: ReturnType<typeof getAdminClient>, id: string) {
  if (!db) return null;
  const { data } = await db.from('ap_automacao_regras').select('user_id').eq('id', id).maybeSingle();
  return data?.user_id ?? null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const { id } = await params;
  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!db || !userId) return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 });

  const dono = await carregarDono(db, id);
  if (!dono) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });

  const { data: perfil } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (dono !== userId && perfil?.role !== 'admin' && perfil?.role !== 'owner') {
    return NextResponse.json({ error: 'Sem permissão para editar esta regra.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.nome === 'string') patch.nome = body.nome.trim();
    if (typeof body.categoriaId === 'number') patch.categoria_id = body.categoriaId;
    if (body.categoriaNome !== undefined) patch.categoria_nome = body.categoriaNome;
    if (typeof body.stageId === 'string') patch.stage_id = body.stageId;
    if (body.stageNome !== undefined) patch.stage_nome = body.stageNome;
    if (typeof body.campoProcesso === 'string') patch.campo_processo = body.campoProcesso.trim();
    if (typeof body.tamanhoLote === 'number') patch.tamanho_lote = Math.min(Math.max(body.tamanhoLote, 1), 50);
    if (body.filtroEsfera !== undefined) patch.filtro_esfera = body.filtroEsfera;
    if (body.filtroValorMin !== undefined) patch.filtro_valor_min = body.filtroValorMin;
    if (body.filtroValorMax !== undefined) patch.filtro_valor_max = body.filtroValorMax;
    if (typeof body.campoValor === 'string') patch.campo_valor = body.campoValor.trim();
    if (body.campoEsfera !== undefined) patch.campo_esfera = body.campoEsfera;
    if (typeof body.ativo === 'boolean') patch.ativo = body.ativo;
    if (typeof body.ordem === 'number') patch.ordem = body.ordem;

    const { data, error } = await db.from('ap_automacao_regras').update(patch).eq('id', id).select(COLUNAS).single();
    if (error || !data) {
      console.error('[api/automacao/regras/[id]] erro ao editar:', error?.message);
      return NextResponse.json({ error: 'Falha ao editar regra.' }, { status: 500 });
    }

    return NextResponse.json({
      regra: {
        id: data.id,
        userId: data.user_id,
        nome: data.nome,
        categoriaId: data.categoria_id,
        categoriaNome: data.categoria_nome,
        stageId: data.stage_id,
        stageNome: data.stage_nome,
        campoProcesso: data.campo_processo,
        tamanhoLote: data.tamanho_lote,
        filtroEsfera: data.filtro_esfera,
        filtroValorMin: data.filtro_valor_min !== null ? Number(data.filtro_valor_min) : null,
        filtroValorMax: data.filtro_valor_max !== null ? Number(data.filtro_valor_max) : null,
        campoValor: data.campo_valor,
        campoEsfera: data.campo_esfera,
        ordem: data.ordem,
        ativo: data.ativo
      }
    });
  } catch (e) {
    console.error('[api/automacao/regras/[id]] exceção:', e);
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const { id } = await params;
  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!db || !userId) return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 });

  const dono = await carregarDono(db, id);
  if (!dono) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });

  const { data: perfil } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (dono !== userId && perfil?.role !== 'admin' && perfil?.role !== 'owner') {
    return NextResponse.json({ error: 'Sem permissão para excluir esta regra.' }, { status: 403 });
  }

  const { error } = await db.from('ap_automacao_regras').delete().eq('id', id);
  if (error) {
    console.error('[api/automacao/regras/[id]] erro ao excluir:', error.message);
    return NextResponse.json({ error: 'Falha ao excluir regra.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
