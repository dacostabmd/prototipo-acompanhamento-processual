import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { buscarDealPorId } from '@/lib/bitrix';
import { processarDeal, type RegraRow } from '@/lib/automacaoProcessarDeal';

export const maxDuration = 60;

/**
 * Recebe o evento de saída do Bitrix24 (ONCRMDEALADD / ONCRMDEALUPDATE), cadastrado em
 * Bitrix > Automações > Webhooks > De saída, apontando para
 * .../api/automacao/bitrix/webhook?secret=BITRIX_WEBHOOK_SECRET. Casa o deal com a regra salva
 * (mesmo categoria_id + stage_id) e roda o mesmo processarDeal() do clique manual, sem precisar
 * esperar o usuário clicar em "buscar lote".
 *
 * O Bitrix envia application/x-www-form-urlencoded, não JSON: event, data[FIELDS][ID],
 * data[FIELDS][CATEGORY_ID]? (nem sempre vem; por isso ID é a única informação confiável e o
 * resto do deal é buscado via crm.deal.get).
 */
export async function POST(request: Request) {
  const secretEsperado = process.env.BITRIX_WEBHOOK_SECRET;
  if (!secretEsperado) {
    console.error('[api/automacao/bitrix/webhook] BITRIX_WEBHOOK_SECRET não configurado no servidor.');
    return NextResponse.json({ error: 'Webhook não configurado.' }, { status: 500 });
  }

  const url = new URL(request.url);
  const secretRecebido = url.searchParams.get('secret');
  if (secretRecebido !== secretEsperado) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 });

  const contentType = request.headers.get('content-type') ?? '';
  let dealIdRaw: string | null = null;
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      dealIdRaw = body?.data?.FIELDS?.ID ?? body?.FIELDS?.ID ?? null;
    } else {
      const form = await request.formData();
      dealIdRaw = (form.get('data[FIELDS][ID]') as string | null) ?? null;
    }
  } catch (e) {
    console.error('[api/automacao/bitrix/webhook] falha ao ler corpo da requisição:', e);
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const dealId = Number(dealIdRaw);
  if (!dealId || Number.isNaN(dealId)) {
    // Bitrix exige 200 mesmo para eventos que não processamos, senão re-tenta/desativa o handler.
    return NextResponse.json({ ignorado: true, motivo: 'Evento sem ID de deal.' });
  }

  const { data: regras } = await db
    .from('ap_automacao_regras')
    .select('*')
    .eq('ativo', true)
    .returns<RegraRow[]>();

  if (!regras || regras.length === 0) {
    return NextResponse.json({ ignorado: true, motivo: 'Nenhuma regra ativa cadastrada.' });
  }

  const { deal, simulated } = await buscarDealPorId(dealId).catch(e => {
    console.error('[api/automacao/bitrix/webhook] falha ao buscar deal no Bitrix:', e);
    return { deal: null, simulated: false };
  });

  if (!deal) {
    return NextResponse.json({ ignorado: true, motivo: 'Deal não encontrado no Bitrix.' });
  }

  const categoriaId = Number(deal.CATEGORY_ID);
  const stageId = deal.STAGE_ID as string;

  const regraCorrespondente = regras.find(r => r.categoria_id === categoriaId && r.stage_id === stageId);
  if (!regraCorrespondente) {
    return NextResponse.json({ ignorado: true, motivo: 'Nenhuma regra ativa casa com categoria/etapa deste deal.' });
  }

  const { persistido, evento } = await processarDeal(db, regraCorrespondente, deal);

  return NextResponse.json({ persistido, evento, bitrixSimulado: simulated });
}
