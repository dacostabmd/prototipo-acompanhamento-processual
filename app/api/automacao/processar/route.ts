import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { listarDeals, buscarDealPorNumeroProcesso } from '@/lib/bitrix';
import { processarDeal } from '@/lib/automacaoProcessarDeal';

export const maxDuration = 60;

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!db || !userId) return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 });

  let regraId: string;
  let numeroProcessoBusca: string | undefined;
  try {
    const body = await request.json();
    regraId = body.regraId;
    numeroProcessoBusca = body.numeroProcesso?.trim() || undefined;
    if (!regraId) throw new Error('regraId ausente');
  } catch {
    return NextResponse.json({ error: 'regraId é obrigatório.' }, { status: 400 });
  }

  const { data: regra } = await db.from('ap_automacao_regras').select('*').eq('id', regraId).maybeSingle();
  if (!regra) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });

  const { data: perfil } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (regra.user_id !== userId && perfil?.role !== 'admin' && perfil?.role !== 'owner') {
    return NextResponse.json({ error: 'Sem permissão para processar esta regra.' }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const execucaoId = randomUUID();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      emit({ type: 'started', execucaoId });

      let processados = 0;
      let esgotado = false;
      let bitrixSimulado = false;

      try {
        if (numeroProcessoBusca) {
          // Busca pontual: 1 deal específico pelo valor exato do campo de processo.
          const { deal, simulated } = await buscarDealPorNumeroProcesso({
            categoryId: regra.categoria_id,
            campoProcesso: regra.campo_processo,
            numeroProcesso: numeroProcessoBusca
          });
          bitrixSimulado = simulated;

          if (deal) {
            emit({ type: 'progress', dealId: Number(deal.ID), dealTitulo: deal.TITLE, status: 'iniciado' });
            const { persistido, evento } = await processarDeal(db, regra, deal);
            if (persistido && evento) {
              processados += 1;
              emit({ type: 'progress', ...evento });
            }
          }
          esgotado = true;
        } else {
          let start: number | undefined = 0;
          while (processados < regra.tamanho_lote) {
            const { deals, next, simulated } = await listarDeals({
              categoryId: regra.categoria_id,
              stageId: regra.stage_id || undefined,
              campoProcesso: regra.campo_processo,
              start
            });
            bitrixSimulado = simulated;

            if (deals.length === 0) {
              esgotado = true;
              break;
            }

            for (const deal of deals) {
              if (processados >= regra.tamanho_lote) break;

              emit({ type: 'progress', dealId: Number(deal.ID), dealTitulo: deal.TITLE ?? `Deal #${deal.ID}`, status: 'iniciado' });
              const { persistido, evento } = await processarDeal(db, regra, deal);
              if (persistido && evento) {
                processados += 1;
                emit({ type: 'progress', ...evento });
              }
            }

            if (!next) {
              esgotado = true;
              break;
            }
            start = next;
          }
        }
      } catch (e) {
        console.error('[api/automacao/processar] erro no loop de processamento:', e);
        emit({ type: 'progress', error: (e as Error)?.message ?? 'Erro ao consultar Bitrix.' });
      }

      await trackEvento(request, userId, { tipo: 'automacao_bitrix', dados: { regraId, processados, execucaoId } });

      emit({ type: 'done', processados, esgotado, bitrixSimulado });
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
}
