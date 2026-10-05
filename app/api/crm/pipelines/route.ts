import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import type { CrmPipeline } from '@/lib/crm';

function toCrmPipeline(row: any): CrmPipeline {
  return { id: row.id, nome: row.nome, descricao: row.descricao, ordem: row.ordem, ativo: row.ativo };
}

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ pipelines: [] });

  const { data, error } = await db
    .from('ap_crm_pipelines')
    .select('id,nome,descricao,ordem,ativo')
    .order('ordem', { ascending: true });

  if (error) {
    console.error('[api/crm/pipelines] erro ao listar:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar pipelines.' }, { status: 500 });
  }

  return NextResponse.json({ pipelines: (data ?? []).map(toCrmPipeline) });
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { nome, descricao } = await request.json();
  if (!nome?.trim()) {
    return NextResponse.json({ error: 'Informe o nome do pipeline.' }, { status: 400 });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data: existentes } = await db.from('ap_crm_pipelines').select('ordem').order('ordem', { ascending: false }).limit(1);
  const proximaOrdem = (existentes?.[0]?.ordem ?? -1) + 1;

  const { data, error } = await db
    .from('ap_crm_pipelines')
    .insert({ nome: nome.trim(), descricao: descricao?.trim() || null, ordem: proximaOrdem })
    .select('id,nome,descricao,ordem,ativo')
    .single();

  if (error) {
    console.error('[api/crm/pipelines] erro ao criar:', error.message);
    return NextResponse.json({ error: 'Falha ao criar pipeline.' }, { status: 500 });
  }

  // Toda pipeline nasce com uma etapa inicial, para a tabela de itens nunca ficar sem destino.
  await db.from('ap_crm_pipeline_etapas').insert({ pipeline_id: data.id, nome: 'Novo', ordem: 0 });

  return NextResponse.json({ pipeline: toCrmPipeline(data) });
}
