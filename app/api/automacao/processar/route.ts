import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { listarDeals } from '@/lib/bitrix';
import { buscarProcessoDiretoDataJud } from '@/lib/datajud';
import { parseCnj, formatProcessNumber } from '@/lib/cnj';
import { cleanDigits } from '@/lib/format';

export const maxDuration = 60;

/** Infere a esfera (estadual/federal) a partir do ramo de justiça do CNJ. Municipal fica a cargo de campo_esfera configurado na regra. */
function inferirEsfera(ramoJustica: string): 'estadual' | 'federal' | null {
  if (ramoJustica === '8') return 'estadual';
  if (ramoJustica === '4') return 'federal';
  return null;
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
  try {
    const body = await request.json();
    regraId = body.regraId;
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
      let start: number | undefined = 0;
      let esgotado = false;
      let bitrixSimulado = false;

      try {
        while (processados < regra.tamanho_lote) {
          const { deals, next, simulated } = await listarDeals({
            categoryId: regra.categoria_id,
            stageId: regra.stage_id,
            campoProcesso: regra.campo_processo,
            start
          });
          bitrixSimulado = simulated;

          if (deals.length === 0) {
            esgotado = true;
            break;
          }

          const dealIds = deals.map(d => Number(d.ID));
          const { data: jaProcessados } = await db
            .from('ap_automacao_deals')
            .select('deal_id')
            .eq('regra_id', regraId)
            .in('deal_id', dealIds);
          const idsExistentes = new Set((jaProcessados ?? []).map(r => r.deal_id as number));

          for (const deal of deals) {
            if (processados >= regra.tamanho_lote) break;

            const dealId = Number(deal.ID);
            if (idsExistentes.has(dealId)) continue;

            const valorDeal = deal.OPPORTUNITY ? Number(deal.OPPORTUNITY) : null;
            if (regra.filtro_valor_min !== null && (valorDeal ?? 0) < Number(regra.filtro_valor_min)) continue;
            if (regra.filtro_valor_max !== null && (valorDeal ?? 0) > Number(regra.filtro_valor_max)) continue;

            const rawNumero = (deal[regra.campo_processo] as string | undefined) ?? '';
            const numeroDigits = cleanDigits(rawNumero);
            const cnjInfo = numeroDigits.length === 20 ? parseCnj(numeroDigits) : null;

            let esfera: 'estadual' | 'federal' | 'municipal' | null = null;
            const esferaManual = regra.campo_esfera ? (deal[regra.campo_esfera] as string | undefined) : undefined;
            if (esferaManual === 'municipal') esfera = 'municipal';
            else if (cnjInfo) esfera = inferirEsfera(cnjInfo.ramoJustica);

            if (regra.filtro_esfera && esfera !== regra.filtro_esfera) continue;

            let status: 'enriquecido' | 'sem_processo' | 'erro' = 'sem_processo';
            let erroMensagem: string | null = null;
            let dadosEnriquecidos: Record<string, unknown> = {};

            if (!cnjInfo || !cnjInfo.valido) {
              status = 'sem_processo';
            } else {
              try {
                const processo = await buscarProcessoDiretoDataJud(numeroDigits);
                if (processo) {
                  status = 'enriquecido';
                  dadosEnriquecidos = {
                    movimentos: processo.movimentos,
                    classe: processo.tipo,
                    assuntos: processo.assuntosDataJud ?? [],
                    orgaoJulgador: processo.orgaoJulgadorDataJud,
                    grau: processo.grauDataJud,
                    dataAjuizamento: processo.distribuicao,
                    valorCausa: processo.valorCausa,
                    parteContraria: processo.parteContraria,
                    fonte: 'datajud'
                  };
                } else {
                  status = 'enriquecido';
                  dadosEnriquecidos = { fonte: null };
                }
              } catch (e) {
                status = 'erro';
                erroMensagem = (e as Error)?.message ?? 'Falha ao consultar DataJud.';
              }
            }

            const { error: insertError } = await db.from('ap_automacao_deals').insert({
              regra_id: regraId,
              deal_id: dealId,
              deal_titulo: deal.TITLE ?? null,
              numero_cnj: cnjInfo?.numeroLimpo ?? (numeroDigits || null),
              numero_cnj_formatado: cnjInfo ? cnjInfo.numeroFormatado : numeroDigits ? formatProcessNumber(numeroDigits) : null,
              tribunal_label: cnjInfo?.tribunalLabel ?? null,
              esfera,
              valor_deal: valorDeal,
              status,
              erro_mensagem: erroMensagem,
              dados_enriquecidos: dadosEnriquecidos,
              processado_em: new Date().toISOString()
            });

            if (insertError) {
              console.error('[api/automacao/processar] falha ao gravar deal', dealId, insertError.message);
              continue;
            }

            processados += 1;
            emit({ type: 'progress', dealId, numeroCnj: cnjInfo?.numeroFormatado ?? null, status, tribunalLabel: cnjInfo?.tribunalLabel ?? null });
          }

          if (!next) {
            esgotado = true;
            break;
          }
          start = next;
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
