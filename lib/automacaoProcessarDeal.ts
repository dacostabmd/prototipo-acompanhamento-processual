import { getAdminClient } from './track';
import type { BitrixDeal } from './bitrix';
import { buscarProcessoDiretoDataJud } from './datajud';
import { parseCnj } from './cnj';
import { cleanDigits } from './format';
import { foiTentadoRecentemente, registrarTentativa } from './cacheTentativas';

/** Infere a esfera (estadual/federal) a partir do ramo de justiça do CNJ. Municipal fica a cargo de campo_esfera configurado na regra. */
function inferirEsfera(ramoJustica: string): 'estadual' | 'federal' | null {
  if (ramoJustica === '8') return 'estadual';
  if (ramoJustica === '4') return 'federal';
  return null;
}

export interface RegraRow {
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

/**
 * Processa um único deal: tentativa (cache 7 dias) -> filtros de valor/esfera -> DataJud -> persiste
 * só se achou dado. Compartilhado pelo lote manual (app/api/automacao/processar) e pelo webhook de
 * evento do Bitrix (app/api/automacao/bitrix/webhook). Retorna o evento de progresso a emitir, ou
 * null se o deal deve ser ignorado silenciosamente (sem dado, ou já tentado recentemente).
 */
export async function processarDeal(
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
    console.error('[automacaoProcessarDeal] falha ao consultar DataJud para deal', dealId, e);
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
    console.error('[automacaoProcessarDeal] falha ao gravar deal', dealId, insertError.message);
    return { persistido: false, evento: null };
  }

  return {
    persistido: true,
    evento: { dealId, dealTitulo, numeroCnj: cnjInfo.numeroFormatado, tribunalLabel: cnjInfo.tribunalLabel, status: 'enriquecido' }
  };
}
