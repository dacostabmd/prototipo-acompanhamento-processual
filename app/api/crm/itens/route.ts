import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import { calcularDiasSemMovimentacao, type CrmItem } from '@/lib/crm';

const TABELA_ITENS = 'ap_crm_itens_v2';
const TABELA_HISTORICO = 'ap_crm_itens_historico';

const PAGE_SIZE_PADRAO = 25;
const PAGE_SIZE_MAXIMO = 100;

// Nomes de coluna conferidos contra o schema real do Supabase remoto (ap_processos não tem
// parte_ativa/parte_passiva como colunas próprias — ficam dentro de metadados jsonb, ainda sem
// formato padronizado; omitidas aqui até esse formato existir de fato).
const COLUNAS =
  'id,pipeline_id,etapa_id,processo_id,titulo,cliente_nome,cliente_documento,advogado_responsavel_id,uf,valor_causa,situacao_financeira,campos_extra,criado_por,created_at,updated_at,' +
  'ap_processos(numero_cnj,tribunal,uf,classe_processual,assunto_principal,status,valor_causa,ultima_movimentacao_em)';

interface ProcessoJoin {
  numero_cnj: string | null;
  tribunal: string | null;
  uf: string | null;
  classe_processual: string | null;
  assunto_principal: string | null;
  status: string | null;
  valor_causa: number | string | null;
  ultima_movimentacao_em: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function linhaParaCrmItem(rowRaw: any): CrmItem {
  const row = rowRaw as Record<string, unknown>;
  const processoRaw = row.ap_processos as ProcessoJoin | ProcessoJoin[] | null;
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
    diasSemMovimentacao: calcularDiasSemMovimentacao(processo?.ultima_movimentacao_em ?? null),
    numeroCnj: processo?.numero_cnj ?? null,
    tribunal: processo?.tribunal ?? null,
    classe: processo?.classe_processual ?? null,
    assunto: processo?.assunto_principal ?? null,
    statusProcesso: processo?.status ?? null
  };
}

/**
 * Lista itens do CRM paginados (?page=, ?pageSize=, default 25/cap 100), com filtros opcionais
 * ?pipelineId=, ?uf=, ?situacaoFinanceira=, ?responsavelId= e busca textual ?busca= (título,
 * cliente ou documento). RLS (ap_crm_itens_v2_select) garante visibilidade por pipeline.
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  const userId = await getUserId(request);
  if (!db || !userId) return NextResponse.json({ itens: [], total: 0, page: 1, pageSize: PAGE_SIZE_PADRAO });

  const { searchParams } = new URL(request.url);
  const pipelineId = searchParams.get('pipelineId');
  const uf = searchParams.get('uf');
  const situacaoFinanceira = searchParams.get('situacaoFinanceira');
  const responsavelId = searchParams.get('responsavelId');
  const busca = searchParams.get('busca')?.trim();

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAXIMO, Math.max(1, Number(searchParams.get('pageSize')) || PAGE_SIZE_PADRAO));

  let query = db.from(TABELA_ITENS).select(COLUNAS, { count: 'exact' }).order('created_at', { ascending: false });
  if (pipelineId) query = query.eq('pipeline_id', pipelineId);
  if (uf) query = query.eq('uf', uf);
  if (situacaoFinanceira) query = query.eq('situacao_financeira', situacaoFinanceira);
  if (responsavelId) query = query.eq('advogado_responsavel_id', responsavelId);
  if (busca) {
    const buscaEscapada = busca.replace(/[%_]/g, c => `\\${c}`);
    query = query.or(`titulo.ilike.%${buscaEscapada}%,cliente_nome.ilike.%${buscaEscapada}%,cliente_documento.ilike.%${buscaEscapada}%`);
  }

  const inicio = (page - 1) * pageSize;
  const { data, error, count } = await query.range(inicio, inicio + pageSize - 1);
  if (error) {
    console.error('[api/crm/itens] erro ao listar:', error.message);
    return NextResponse.json({ itens: [], total: 0, page, pageSize, erro: 'Não foi possível carregar os itens.' });
  }

  return NextResponse.json({ itens: (data ?? []).map(linhaParaCrmItem), total: count ?? 0, page, pageSize });
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
    .from(TABELA_ITENS)
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

  await db.from(TABELA_HISTORICO).insert({
    item_id: novoItem.id as string,
    etapa_anterior_id: null,
    etapa_nova_id: etapaId,
    movido_por: userId
  });

  return NextResponse.json({ item: linhaParaCrmItem(novoItem) }, { status: 201 });
}
