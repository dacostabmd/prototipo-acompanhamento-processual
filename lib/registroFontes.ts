import { getAdminClient } from './track';
import type { SinaisUf } from './planoVarredura';

/** Uma chamada a uma fonte durante a busca (ver supabase/migrations/20261022120000_ap_consulta_fontes.sql). */
export interface RegistroFonte {
  fonte: 'infosimples' | 'datajud' | 'lemit';
  servico?: string;
  tribunal?: string;
  onda?: 1 | 2;
  achou: boolean;
  qtdProcessos?: number;
  custo: number;
  duracaoMs?: number;
  codigo?: number;
  erroOrigem?: string;
  erroCategoria?: string;
}

/** Grava as chamadas de uma busca em ap_consulta_fontes. Nunca lança erro. */
export async function registrarFontesConsulta(
  consultaId: string,
  userId: string | null,
  tipoBusca: 'cpf' | 'cnpj' | 'nome' | 'numero',
  sinais: SinaisUf | null,
  prioridadeOrigem: string | null,
  registros: RegistroFonte[]
) {
  if (registros.length === 0) return;
  try {
    const db = getAdminClient();
    if (!db) return;
    const { error } = await db.from('ap_consulta_fontes').insert(
      registros.map(r => ({
        consulta_id: consultaId,
        user_id: userId,
        tipo_busca: tipoBusca,
        fonte: r.fonte,
        servico: r.servico ?? null,
        tribunal: r.tribunal ?? null,
        onda: r.onda ?? null,
        achou: r.achou,
        qtd_processos: r.qtdProcessos ?? 0,
        custo: Number(r.custo.toFixed(2)),
        duracao_ms: r.duracaoMs != null ? Math.round(r.duracaoMs) : null,
        codigo: r.codigo ?? null,
        erro_origem: r.erroOrigem ?? null,
        erro_categoria: r.erroCategoria ?? null,
        sinais: sinais ?? {},
        prioridade_origem: prioridadeOrigem
      }))
    );
    if (error) console.error('[registroFontes] falha ao registrar fontes da consulta:', error.message);
  } catch (e) {
    console.error('[registroFontes] falha ao registrar fontes da consulta', e);
  }
}
