import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import type { CrmDepartamento, CrmEtapa, CrmPipeline } from '@/lib/crm';

const TABELA_PIPELINES = 'ap_crm_pipelines_v2';
const TABELA_ETAPAS = 'ap_crm_etapas_v2';

function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

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

  const { data: membros } = await db.from('ap_departamento_membros').select('departamento_id,papel').eq('user_id', userId);
  const departamentosDoUsuario = new Set((membros ?? []).map(m => m.departamento_id as string));
  const departamentosLideradosPeloUsuario = new Set((membros ?? []).filter(m => m.papel === 'lider').map(m => m.departamento_id as string));

  const [{ data: departamentosRaw }, { data: pipelinesRaw }, { data: etapasRaw }] = await Promise.all([
    db.from('ap_departamentos').select('id,nome,ordem').order('ordem'),
    db.from(TABELA_PIPELINES).select('id,nome,departamento_id,ordem,ativo').eq('ativo', true).order('ordem'),
    db.from(TABELA_ETAPAS).select('id,pipeline_id,nome,ordem,cor,eh_final').order('ordem')
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

  // Departamentos onde o usuário pode criar/editar pipeline (líder ou admin/owner) — usado pelo
  // frontend para decidir se mostra a ação "+ Novo funil".
  const departamentosGerenciaveis = ehAdmin
    ? departamentos.map(d => d.id)
    : departamentos.filter(d => departamentosLideradosPeloUsuario.has(d.id)).map(d => d.id);

  return NextResponse.json({ departamentos, pipelines, etapas, departamentosGerenciaveis });
}

/** Cria um novo pipeline (funil) customizado com suas etapas. Restrito a líder do departamento ou admin/owner (RLS ap_crm_pipelines_v2_insert). */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  const userId = await getUserId(request);
  if (!db || !userId) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = await request.json();
  const { nome, departamentoId, etapas } = body ?? {};

  if (!nome?.trim() || !departamentoId || !Array.isArray(etapas) || etapas.length === 0) {
    return NextResponse.json({ error: 'nome, departamentoId e ao menos uma etapa são obrigatórios.' }, { status: 400 });
  }

  // Checagem explícita (além da RLS) para devolver uma mensagem clara em vez de um erro genérico de permissão.
  const { data: perfil } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  const ehAdmin = perfil?.role === 'admin' || perfil?.role === 'owner';
  if (!ehAdmin) {
    const { data: membro } = await db
      .from('ap_departamento_membros')
      .select('papel')
      .eq('user_id', userId)
      .eq('departamento_id', departamentoId)
      .maybeSingle();
    if (membro?.papel !== 'lider') {
      return NextResponse.json({ error: 'Apenas o líder do departamento ou um administrador pode criar funis.' }, { status: 403 });
    }
  }

  const base = slugify(nome) || 'funil';
  const sufixo = Math.random().toString(36).slice(2, 7);
  const pipelineId = `${base}_${sufixo}`;

  const { data: maxOrdem } = await db.from(TABELA_PIPELINES).select('ordem').order('ordem', { ascending: false }).limit(1).maybeSingle();
  const proximaOrdem = ((maxOrdem?.ordem as number | undefined) ?? 0) + 1;

  const { error: erroPipeline } = await db.from(TABELA_PIPELINES).insert({
    id: pipelineId,
    nome: nome.trim(),
    departamento_id: departamentoId,
    ordem: proximaOrdem,
    ativo: true
  });
  if (erroPipeline) {
    console.error('[api/crm/pipelines] erro ao criar pipeline:', erroPipeline.message);
    return NextResponse.json({ error: 'Não foi possível criar o funil (verifique permissão).' }, { status: 403 });
  }

  const etapasParaInserir = (etapas as { nome: string; cor?: string | null; ehFinal?: boolean }[]).map((etapa, index) => ({
    id: `${pipelineId}_${index + 1}`,
    pipeline_id: pipelineId,
    nome: etapa.nome,
    ordem: index + 1,
    cor: etapa.cor ?? null,
    eh_final: etapa.ehFinal ?? false
  }));

  const { error: erroEtapas } = await db.from(TABELA_ETAPAS).insert(etapasParaInserir);
  if (erroEtapas) {
    console.error('[api/crm/pipelines] erro ao criar etapas, revertendo pipeline:', erroEtapas.message);
    await db.from(TABELA_PIPELINES).delete().eq('id', pipelineId);
    return NextResponse.json({ error: 'Não foi possível criar as etapas do funil.' }, { status: 500 });
  }

  return NextResponse.json(
    {
      pipeline: { id: pipelineId, nome: nome.trim(), departamentoId, ordem: proximaOrdem, ativo: true } satisfies CrmPipeline,
      etapas: etapasParaInserir.map(e => ({
        id: e.id,
        pipelineId: e.pipeline_id,
        nome: e.nome,
        ordem: e.ordem,
        cor: e.cor,
        ehFinal: e.eh_final
      })) satisfies CrmEtapa[]
    },
    { status: 201 }
  );
}
