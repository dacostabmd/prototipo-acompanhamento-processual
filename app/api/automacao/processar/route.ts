import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { listarDeals, buscarDealPorNumeroProcesso, type BitrixDeal } from '@/lib/bitrix';
import { buscarProcessoDiretoDataJud } from '@/lib/datajud';
import { parseCnj, formatProcessNumber } from '@/lib/cnj';
import { cleanDigits } from '@/lib/format';
import { foiTentadoRecentemente, registrarTentativa } from '@/lib/cacheTentativas';

export const maxDuration = 60;

/** Infere a esfera (estadual/federal) a partir do ramo de justiça do CNJ. Municipal fica a cargo de campo_esfera configurado na regra. */
function inferirEsfera(ramoJustica: string): 'estadual' | 'federal' | null {
  if (ramoJustica === '8') return 'estadual';
  if (ramoJustica === '4') return 'federal';
  return null;
}

interface RegraRow {
  id: string;
  user_id: string;
  categoria_id: number;
  stage_id: string;
  campo_processo: string;
  tamanho_lote: number;
  filtro_esfera: 'estadual' | 'federal' | 'municipal' | null;
  filtro_valor_min: number | null;
  filtro_valor_max: number | null;
  campo_esfera: string | null;
}

/** Processa um único deal: tentativa (cache 7 dias) -> filtros de valor/esfera -> DataJud -> persiste só se achou dado. Retorna o evento de progresso a emitir, ou null se o deal deve ser ignorado silenciosamente (sem dado, ou já tentado recentemente). */
async function processarDeal(
  db: NonNullable<ReturnType<typeof getAdminClient>>,
  regra: RegraRow,
  deal: BitrixDeal
): Promise<{ persistido: boolean; evento: Record<string, unknown> | null }> {
  const dealId = Number(deal.ID);

  if (await foiTentadoRecentemente(regra.id, dealId)) {
    return { persistido: false, evento: null };
  }

  const dealTitulo = (deal.TITLE as string) ?? `Deal #${dealId}`;
  const valorDeal = deal.OPPORTUNITY ? Number(deal.OPPORTUNITY) : null;
  if (regra.filtro_valor_min !== null && (valorDeal ?? 0) < Number(regra.filtro_valor_min)) {
    return { persistido: false, evento: null };
  }
  if (regra.filtro_valor_max !== null && (valorDeal ?? 0) > Number(regra.filtro_valor_max)) {
    return { persistido: false, evento: null };
  }

  const rawNumero = (deal[regra.campo_processo] as string | undefined) ?? '';
  const numeroDigits = cleanDigits(rawNumero);
  const cnjInfo = numeroDigits.length === 20 ? parseCnj(numeroDigits) : null;

  let esfera: 'estadual' | 'federal' | 'municipal' | null = null;
  const esferaManual = regra.campo_esfera ? (deal[regra.campo_esfera] as string | undefined) : undefined;
  if (esferaManual === 'municipal') esfera = 'municipal';
  else if (cnjInfo) esfera = inferirEsfera(cnjInfo.ramoJustica);

  if (regra.filtro_esfera && esfera !== regra.filtro_esfera) {
    return { persistido: false, evento: null };
  }

  await registrarTentativa(regra.id, dealId, cnjInfo?.numeroLimpo ?? (numeroDigits || null));

  if (!cnjInfo || !cnjInfo.valido) {
    // Sem número de processo válido: ignora silenciosamente, não entra na tabela.
    return { persistido: false, evento: null };
  }

  let processo;
  try {
    processo = await buscarProcessoDiretoDataJud(numeroDigits);
  } catch (e) {
    console.error('[api/automacao/processar] falha ao consultar DataJud para deal', dealId, e);
    return { persistido: false, evento: null };
  }

  if (!processo) {
    // Nenhum dado encontrado no InfoSimples/DataJud: ignora silenciosamente, não entra na tabela.
    return { persistido: false, evento: null };
  }

  const dadosEnriquecidos = {
    movimentos: processo.movimentos,
    classe: processo.tipo,
    assuntos: processo.assuntosDataJud ?? [],
    orgaoJulgador: processo.orgaoJulgadorDataJud,
    grau: processo.grauDataJud,
    dataAjuizamento: processo.distribuicao,
    valorCausa: processo.valorCausa,
    parteContraria: processo.parteContraria,
    fonte: 'datajud' as const
  };

  const { error: insertError } = await db.from('ap_automacao_deals').upsert(
    {
      regra_id: regra.id,
      deal_id: dealId,
      deal_titulo: dealTitulo,
      numero_cnj: cnjInfo.numeroLimpo,
      numero_cnj_formatado: cnjInfo.numeroFormatado,
      tribunal_label: cnjInfo.tribunalLabel,
      esfera,
      valor_deal: valorDeal,
      status: 'enriquecido',
      erro_mensagem: null,
      dados_enriquecidos: dadosEnriquecidos,
      processado_em: new Date().toISOString()
    },
    { onConflict: 'regra_id,deal_id' }
  );

  if (insertError) {
    console.error('[api/automacao/processar] falha ao gravar deal', dealId, insertError.message);
    return { persistido: false, evento: null };
  }

  return {
    persistido: true,
    evento: { dealId, dealTitulo, numeroCnj: cnjInfo.numeroFormatado, tribunalLabel: cnjInfo.tribunalLabel, status: 'enriquecido' }
  };
}

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
  if (regra.user_id !== userId && perfil?.role !== 'admin') {
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
