import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import type { CrmDepartamento, CrmEtapa, CrmPipeline } from '@/lib/crm';

/**
 * Lista departamentos, pipelines e etapas visíveis ao usuário autenticado (RLS de
 * ap_crm_pipelines/ap_crm_etapas já filtra por pertencimento a departamento ou admin/owner —
 * aqui só traduzimos para o formato usado pela UI do Kanban).
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  const userId = await getUserId(request);
  if (!db || !userId) {
    return NextResponse.json({ departamentos: [], pipelines: [], etapas: [] });
  }

  // getAdminClient() usa service role (ignora RLS) — a filtragem por departamento do usuário
  // é feita aqui explicitamente, no mesmo espírito das policies ap_crm_pode_acessar_pipeline.
  const { data: perfil } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  const ehAdmin = perfil?.role === 'admin' || perfil?.role === 'owner';

  const { data: membros } = await db.from('ap_departamento_membros').select('departamento_id').eq('user_id', userId);
  const departamentosDoUsuario = new Set((membros ?? []).map(m => m.departamento_id as string));

  const [{ data: departamentosRaw }, { data: pipelinesRaw }, { data: etapasRaw }] = await Promise.all([
    db.from('ap_departamentos').select('id,nome,ordem').order('ordem'),
    db.from('ap_crm_pipelines').select('id,nome,departamento_id,ordem,ativo').eq('ativo', true).order('ordem'),
    db.from('ap_crm_etapas').select('id,pipeline_id,nome,ordem,cor,eh_final').order('ordem')
  ]);

  const pipelinesVisiveis = (pipelinesRaw ?? []).filter(
    p => ehAdmin || departamentosDoUsuario.has(p.departamento_id as string)
  );
  const idsPipelinesVisiveis = new Set(pipelinesVisiveis.map(p => p.id as string));

  const departamentos: CrmDepartamento[] = (departamentosRaw ?? []).map(d => ({
    id: d.id as CrmDepartamento['id'],
    nome: d.nome as string,
    ordem: d.ordem as number
  }));

  const pipelines: CrmPipeline[] = pipelinesVisiveis.map(p => ({
    id: p.id as CrmPipeline['id'],
    nome: p.nome as string,
    departamentoId: p.departamento_id as CrmPipeline['departamentoId'],
    ordem: p.ordem as number,
    ativo: p.ativo as boolean
  }));

  const etapas: CrmEtapa[] = (etapasRaw ?? [])
    .filter(e => idsPipelinesVisiveis.has(e.pipeline_id as string))
    .map(e => ({
      id: e.id as string,
      pipelineId: e.pipeline_id as CrmEtapa['pipelineId'],
      nome: e.nome as string,
      ordem: e.ordem as number,
      cor: (e.cor as string | null) ?? null,
      ehFinal: e.eh_final as boolean
    }));

  return NextResponse.json({ departamentos, pipelines, etapas });
}
