import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import type { CrmPipelineCampo } from '@/lib/crm';

function slugify(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toCrmCampo(row: any): CrmPipelineCampo {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    tipoCampoId: row.tipo_campo_id,
    nome: row.nome,
    slug: row.slug,
    obrigatorio: row.obrigatorio,
    opcoes: row.opcoes,
    ordem: row.ordem,
    ativo: row.ativo
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const db = getAdminClient();
  if (!db) return NextResponse.json({ campos: [] });

  const { data, error } = await db
    .from('ap_crm_pipeline_campos')
    .select('id,pipeline_id,tipo_campo_id,nome,slug,obrigatorio,opcoes,ordem,ativo')
    .eq('pipeline_id', id)
    .order('ordem', { ascending: true });

  if (error) {
    console.error('[api/crm/pipelines/:id/campos] erro ao listar:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar campos.' }, { status: 500 });
  }

  return NextResponse.json({ campos: (data ?? []).map(toCrmCampo) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { id } = await params;
  const { nome, tipoCampoId, obrigatorio, opcoes } = await request.json();
  if (!nome?.trim() || !tipoCampoId) {
    return NextResponse.json({ error: 'Informe o nome e o tipo do campo.' }, { status: 400 });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const { data: tipo } = await db.from('ap_crm_tipos_campo').select('requer_opcoes').eq('id', tipoCampoId).maybeSingle();
  if (tipo?.requer_opcoes && (!Array.isArray(opcoes) || opcoes.length === 0)) {
    return NextResponse.json({ error: 'Este tipo de campo exige ao menos uma opção.' }, { status: 400 });
  }

  const { data: existentes } = await db
    .from('ap_crm_pipeline_campos')
    .select('ordem')
    .eq('pipeline_id', id)
    .order('ordem', { ascending: false })
    .limit(1);
  const proximaOrdem = (existentes?.[0]?.ordem ?? -1) + 1;

  const { data, error } = await db
    .from('ap_crm_pipeline_campos')
    .insert({
      pipeline_id: id,
      tipo_campo_id: tipoCampoId,
      nome: nome.trim(),
      slug: slugify(nome),
      obrigatorio: !!obrigatorio,
      opcoes: tipo?.requer_opcoes ? opcoes : null,
      ordem: proximaOrdem
    })
    .select('id,pipeline_id,tipo_campo_id,nome,slug,obrigatorio,opcoes,ordem,ativo')
    .single();

  if (error) {
    console.error('[api/crm/pipelines/:id/campos] erro ao criar:', error.message);
    return NextResponse.json({ error: 'Falha ao criar campo (verifique se já existe um campo com nome equivalente).' }, { status: 500 });
  }

  return NextResponse.json({ campo: toCrmCampo(data) });
}
