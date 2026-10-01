import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import { listarFunisIA } from '@/lib/bitrix';
import type { AutomacaoRegra } from '@/lib/automacao';

const CAMPO_PROCESSO_DEFAULT = 'UF_CRM_1740590606';

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

/**
 * Descobre os funis "IA*" no Bitrix (com o campo de processo configurado) e garante uma regra/aba
 * por funil para o usuário atual — cria as que faltam, nunca duplica (unique por user_id+nome
 * aplicado via busca prévia) e nunca apaga regras existentes (o usuário pode ter ajustado etapa/
 * filtros manualmente no modal de configuração).
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!db || !userId) return NextResponse.json({ regras: [] });

  const body = await request.json().catch(() => ({}));
  const campoProcesso = (body?.campoProcesso as string)?.trim() || CAMPO_PROCESSO_DEFAULT;

  let pipelines: Awaited<ReturnType<typeof listarFunisIA>>['pipelines'] = [];
  let simulated = false;
  try {
    const r = await listarFunisIA(campoProcesso);
    pipelines = r.pipelines;
    simulated = r.simulated;
  } catch (e) {
    console.error('[api/automacao/regras/sincronizar] erro ao listar funis:', e);
    return NextResponse.json({ error: 'Falha ao consultar funis no Bitrix.' }, { status: 502 });
  }

  const { data: existentes } = await db.from('ap_automacao_regras').select(COLUNAS).eq('user_id', userId).order('ordem', { ascending: true });
  const regrasExistentes = existentes ?? [];
  const categoriasExistentes = new Set(regrasExistentes.map(r => r.categoria_id));

  const faltantes = pipelines.filter(p => !categoriasExistentes.has(p.ID));
  let proximaOrdem = regrasExistentes.length;
  const novas: Record<string, unknown>[] = faltantes.map(p => ({
    user_id: userId,
    nome: p.NAME,
    categoria_id: p.ID,
    categoria_nome: p.NAME,
    stage_id: '',
    stage_nome: null,
    campo_processo: campoProcesso,
    tamanho_lote: 10,
    campo_valor: 'OPPORTUNITY',
    ordem: proximaOrdem++
  }));

  if (novas.length > 0) {
    const { error } = await db.from('ap_automacao_regras').insert(novas);
    if (error) console.error('[api/automacao/regras/sincronizar] erro ao criar regras:', error.message);
  }

  const { data: todas } = await db.from('ap_automacao_regras').select(COLUNAS).eq('user_id', userId).order('ordem', { ascending: true });
  return NextResponse.json({ regras: (todas ?? []).map(mapRegra), simulated, criadas: novas.length });
}
