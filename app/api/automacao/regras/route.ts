import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import type { AutomacaoRegra } from '@/lib/automacao';

const COLUNAS =
  'id,user_id,nome,categoria_id,categoria_nome,stage_id,stage_nome,campo_processo,tamanho_lote,filtro_esfera,filtro_valor_min,filtro_valor_max,campo_valor,campo_esfera,ordem,ativo';

function mapRegra(row: Record<string, unknown>): AutomacaoRegra {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    nome: row.nome as string,
    categoriaId: row.categoria_id as number,
    categoriaNome: (row.categoria_nome as string) ?? null,
    stageId: row.stage_id as string,
    stageNome: (row.stage_nome as string) ?? null,
    campoProcesso: row.campo_processo as string,
    tamanhoLote: row.tamanho_lote as number,
    filtroEsfera: (row.filtro_esfera as AutomacaoRegra['filtroEsfera']) ?? null,
    filtroValorMin: row.filtro_valor_min !== null ? Number(row.filtro_valor_min) : null,
    filtroValorMax: row.filtro_valor_max !== null ? Number(row.filtro_valor_max) : null,
    campoValor: row.campo_valor as string,
    campoEsfera: (row.campo_esfera as string) ?? null,
    ordem: row.ordem as number,
    ativo: row.ativo as boolean
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!db || !userId) return NextResponse.json({ regras: [] });

  const { data, error } = await db.from('ap_automacao_regras').select(COLUNAS).eq('user_id', userId).order('ordem', { ascending: true });
  if (error) {
    console.error('[api/automacao/regras] erro ao listar:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar regras.' }, { status: 500 });
  }

  return NextResponse.json({ regras: (data ?? []).map(mapRegra) });
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!db || !userId) return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 });

  try {
    const body = await request.json();
    const {
      nome,
      categoriaId,
      categoriaNome,
      stageId,
      stageNome,
      campoProcesso,
      tamanhoLote,
      filtroEsfera,
      filtroValorMin,
      filtroValorMax,
      campoValor,
      campoEsfera
    } = body;

    if (!nome?.trim() || typeof categoriaId !== 'number' || !stageId?.trim()) {
      return NextResponse.json({ error: 'nome, categoriaId e stageId são obrigatórios.' }, { status: 400 });
    }

    const { count } = await db.from('ap_automacao_regras').select('id', { count: 'exact', head: true }).eq('user_id', userId);

    const { data, error } = await db
      .from('ap_automacao_regras')
      .insert({
        user_id: userId,
        nome: nome.trim(),
        categoria_id: categoriaId,
        categoria_nome: categoriaNome ?? null,
        stage_id: stageId,
        stage_nome: stageNome ?? null,
        campo_processo: campoProcesso?.trim() || 'UF_CRM_1740590606',
        tamanho_lote: tamanhoLote && tamanhoLote > 0 ? Math.min(tamanhoLote, 50) : 10,
        filtro_esfera: filtroEsfera ?? null,
        filtro_valor_min: filtroValorMin ?? null,
        filtro_valor_max: filtroValorMax ?? null,
        campo_valor: campoValor?.trim() || 'OPPORTUNITY',
        campo_esfera: campoEsfera?.trim() || null,
        ordem: count ?? 0
      })
      .select(COLUNAS)
      .single();

    if (error || !data) {
      console.error('[api/automacao/regras] erro ao criar:', error?.message);
      return NextResponse.json({ error: 'Falha ao criar regra.' }, { status: 500 });
    }

    return NextResponse.json({ regra: mapRegra(data) }, { status: 201 });
  } catch (e) {
    console.error('[api/automacao/regras] exceção:', e);
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }
}
