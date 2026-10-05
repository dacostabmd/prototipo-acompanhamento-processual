import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { parseCnj } from '@/lib/cnj';
import { cleanDigits } from '@/lib/format';
import type { CrmItem } from '@/lib/crm';

function toCrmItem(row: any): CrmItem {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    etapaId: row.etapa_id,
    titulo: row.titulo,
    numeroCnj: row.numero_cnj,
    numeroCnjFormatado: row.numero_cnj_formatado,
    tribunalLabel: row.tribunal_label,
    esfera: row.esfera,
    camposCustomizados: row.campos_customizados ?? {},
    statusEnriquecimento: row.status_enriquecimento,
    erroMensagem: row.erro_mensagem,
    dadosEnriquecidos: row.dados_enriquecidos ?? {},
    enriquecidoEm: row.enriquecido_em,
    responsavelId: row.responsavel_id,
    createdAt: row.created_at
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ itens: [], total: 0, page: 1, pageSize: 20 });

  const url = new URL(request.url);
  const pipelineId = url.searchParams.get('pipelineId');
  if (!pipelineId) return NextResponse.json({ error: 'pipelineId é obrigatório.' }, { status: 400 });

  const page = Math.max(Number(url.searchParams.get('page') ?? '1'), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? '20'), 1), 100);
  const etapaId = url.searchParams.get('etapaId');
  const busca = url.searchParams.get('busca')?.trim();

  // Diferente do antigo ap_automacao_deals (só mostrava deals enriquecidos), aqui o item
  // criado manualmente sempre aparece, independente do status de enriquecimento.
  let query = db
    .from('ap_crm_itens')
    .select(
      'id,pipeline_id,etapa_id,titulo,numero_cnj,numero_cnj_formatado,tribunal_label,esfera,campos_customizados,status_enriquecimento,erro_mensagem,dados_enriquecidos,enriquecido_em,responsavel_id,created_at',
      { count: 'exact' }
    )
    .eq('pipeline_id', pipelineId)
    .order('created_at', { ascending: false });

  if (etapaId) query = query.eq('etapa_id', etapaId);
  if (busca) query = query.or(`titulo.ilike.%${busca}%,numero_cnj_formatado.ilike.%${busca}%`);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error('[api/crm/itens] erro ao listar:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar itens.' }, { status: 500 });
  }

  return NextResponse.json({ itens: (data ?? []).map(toCrmItem), total: count ?? 0, page, pageSize });
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const { pipelineId, etapaId, titulo, numeroCnj, camposCustomizados } = await request.json();
  if (!pipelineId || !etapaId || !titulo?.trim()) {
    return NextResponse.json({ error: 'Informe pipeline, etapa e título do item.' }, { status: 400 });
  }

  const cnjDigits = numeroCnj ? cleanDigits(numeroCnj) : '';
  const cnjInfo = cnjDigits.length === 20 ? parseCnj(cnjDigits) : null;
  const esfera = cnjInfo ? (cnjInfo.ramoJustica === '8' ? 'estadual' : cnjInfo.ramoJustica === '4' ? 'federal' : null) : null;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco não configurado.' }, { status: 500 });

  const userId = await getUserId(request);

  const { data, error } = await db
    .from('ap_crm_itens')
    .insert({
      pipeline_id: pipelineId,
      etapa_id: etapaId,
      titulo: titulo.trim(),
      numero_cnj: cnjInfo?.numeroLimpo ?? null,
      numero_cnj_formatado: cnjInfo?.numeroFormatado ?? null,
      tribunal_label: cnjInfo?.tribunalLabel ?? null,
      esfera,
      campos_customizados: camposCustomizados ?? {},
      criado_por: userId,
      responsavel_id: userId
    })
    .select(
      'id,pipeline_id,etapa_id,titulo,numero_cnj,numero_cnj_formatado,tribunal_label,esfera,campos_customizados,status_enriquecimento,erro_mensagem,dados_enriquecidos,enriquecido_em,responsavel_id,created_at'
    )
    .single();

  if (error) {
    console.error('[api/crm/itens] erro ao criar:', error.message);
    return NextResponse.json({ error: 'Falha ao criar item.' }, { status: 500 });
  }

  return NextResponse.json({ item: toCrmItem(data) });
}
