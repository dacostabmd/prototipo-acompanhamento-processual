import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import { calcularDiasSemMovimentacao, type CrmItem } from '@/lib/crm';

const COLUNAS =
  'id,pipeline_id,etapa_id,processo_id,titulo,cliente_nome,cliente_documento,advogado_responsavel_id,uf,valor_causa,situacao_financeira,campos_extra,criado_por,created_at,updated_at,' +
  'ap_processos(ultima_movimentacao_em)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function linhaParaCrmItem(rowRaw: any): CrmItem {
  const row = rowRaw as Record<string, unknown>;
  const processoRaw = row.ap_processos as { ultima_movimentacao_em: string | null } | { ultima_movimentacao_em: string | null }[] | null;
  const processo = Array.isArray(processoRaw) ? (processoRaw[0] ?? null) : processoRaw;
  return {
    id: row.id as string,
    pipelineId: row.pipeline_id as CrmItem['pipelineId'],
    etapaId: row.etapa_id as string,
    processoId: (row.processo_id as string | null) ?? null,
    titulo: row.titulo as string,
    clienteNome: (row.cliente_nome as string | null) ?? null,
    clienteDocumento: (row.cliente_documento as string | null) ?? null,
    advogadoResponsavelId: (row.advogado_responsavel_id as string | null) ?? null,
    uf: (row.uf as string | null) ?? null,
    valorCausa: row.valor_causa != null ? Number(row.valor_causa) : null,
    situacaoFinanceira: (row.situacao_financeira as CrmItem['situacaoFinanceira']) ?? null,
    camposExtra: (row.campos_extra as Record<string, unknown>) ?? {},
    criadoPor: (row.criado_por as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ultimaMovimentacaoEm: processo?.ultima_movimentacao_em ?? null,
    diasSemMovimentacao: calcularDiasSemMovimentacao(processo?.ultima_movimentacao_em ?? null)
  };
}

/** Lista itens do CRM, opcionalmente filtrados por pipeline (?pipelineId=). RLS garante visibilidade. */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  const userId = await getUserId(request);
  if (!db || !userId) return NextResponse.json({ itens: [] });

  const { searchParams } = new URL(request.url);
  const pipelineId = searchParams.get('pipelineId');

  let query = db.from('ap_crm_itens').select(COLUNAS).order('created_at', { ascending: false });
  if (pipelineId) query = query.eq('pipeline_id', pipelineId);

  const { data, error } = await query;
  if (error) {
    console.error('[api/crm/itens] erro ao listar:', error.message);
    return NextResponse.json({ itens: [], erro: 'Não foi possível carregar os itens.' });
  }

  return NextResponse.json({ itens: (data ?? []).map(linhaParaCrmItem) });
}

/** Cria um novo item (card) manualmente em um pipeline, na primeira etapa dele. */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  const userId = await getUserId(request);
  if (!db || !userId) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = await request.json();
  const { pipelineId, etapaId, titulo, clienteNome, clienteDocumento, advogadoResponsavelId, uf, valorCausa, situacaoFinanceira, camposExtra, processoId } = body ?? {};

  if (!pipelineId || !etapaId || !titulo) {
    return NextResponse.json({ error: 'pipelineId, etapaId e titulo são obrigatórios.' }, { status: 400 });
  }

  const { data, error } = await db
    .from('ap_crm_itens')
    .insert({
      pipeline_id: pipelineId,
      etapa_id: etapaId,
      processo_id: processoId ?? null,
      titulo,
      cliente_nome: clienteNome ?? null,
      cliente_documento: clienteDocumento ?? null,
      advogado_responsavel_id: advogadoResponsavelId ?? null,
      uf: uf ?? null,
      valor_causa: valorCausa ?? null,
      situacao_financeira: situacaoFinanceira ?? null,
      campos_extra: camposExtra ?? {},
      criado_por: userId
    })
    .select(COLUNAS)
    .single();

  if (error || !data) {
    console.error('[api/crm/itens] erro ao criar:', error?.message);
    return NextResponse.json({ error: 'Não foi possível criar o item.' }, { status: 500 });
  }
  const novoItem = data as unknown as Record<string, unknown>;

  await db.from('ap_crm_itens_historico').insert({
    item_id: novoItem.id as string,
    etapa_anterior_id: null,
    etapa_nova_id: etapaId,
    movido_por: userId
  });

  return NextResponse.json({ item: linhaParaCrmItem(novoItem) }, { status: 201 });
}
