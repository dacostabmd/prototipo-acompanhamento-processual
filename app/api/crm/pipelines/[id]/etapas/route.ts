import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import type { CrmEtapa } from '@/lib/crm';

function toCrmEtapa(row: any): CrmEtapa {
  return { id: row.id, pipelineId: row.pipeline_id, nome: row.nome, cor: row.cor, ordem: row.ordem };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ etapas: [] });

  const { data, error } = await db
    .from('ap_crm_pipeline_etapas')
    .select('id,pipeline_id,nome,cor,ordem')
    .eq('pipeline_id', id)
    .order('ordem', { ascending: true });

  if (error) {
    console.error('[api/crm/pipelines/:id/etapas] erro ao listar:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar etapas.' }, { status: 500 });
  }

  return NextResponse.json({ etapas: (data ?? []).map(toCrmEtapa) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const { nome, cor } = await request.json();
  if (!nome?.trim()) {
    return NextResponse.json({ error: 'Informe o nome da etapa.' }, { status: 400 });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data: existentes } = await db
    .from('ap_crm_pipeline_etapas')
    .select('ordem')
    .eq('pipeline_id', id)
    .order('ordem', { ascending: false })
    .limit(1);
  const proximaOrdem = (existentes?.[0]?.ordem ?? -1) + 1;

  const { data, error } = await db
    .from('ap_crm_pipeline_etapas')
    .insert({ pipeline_id: id, nome: nome.trim(), cor: cor || null, ordem: proximaOrdem })
    .select('id,pipeline_id,nome,cor,ordem')
    .single();

  if (error) {
    console.error('[api/crm/pipelines/:id/etapas] erro ao criar:', error.message);
    return NextResponse.json({ error: 'Falha ao criar etapa.' }, { status: 500 });
  }

  return NextResponse.json({ etapa: toCrmEtapa(data) });
}
