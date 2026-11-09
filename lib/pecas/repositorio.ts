import { getAdminClient } from '@/lib/track';
import type { EntradaPeca, PecaCompleta, PecaResumo } from './tipos';

/**
 * Histórico de peças (tabela ap_pecas). Tolera a tabela ausente (migration ainda não aplicada): devolve
 * `indisponivel` em vez de lançar, para a geração continuar funcionando sem salvar.
 */

export const MSG_HISTORICO_INDISPONIVEL =
  'O histórico de peças ainda não está disponível neste ambiente (a migration 20261109140000_ap_pecas.sql não foi aplicada). A minuta foi gerada, mas não foi salva.';

const COLUNAS_RESUMO = 'id, tipo, titulo, processo_numero, modelo, tokens_entrada, tokens_saida, created_at, updated_at';

function tabelaAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /ap_pecas/.test(error.message ?? '') && /(does not exist|schema cache|not find)/i.test(error.message ?? '');
}

const resumoDe = (r: any): PecaResumo => ({
  id: r.id,
  tipo: r.tipo,
  titulo: r.titulo,
  processoNumero: r.processo_numero ?? null,
  modelo: r.modelo ?? null,
  tokensEntrada: r.tokens_entrada ?? 0,
  tokensSaida: r.tokens_saida ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at ?? null
});

const completaDe = (r: any): PecaCompleta => ({ ...resumoDe(r), entrada: (r.entrada ?? { campos: {} }) as EntradaPeca, conteudo: r.conteudo ?? '' });

export type ResultadoRepositorio<T> = { ok: true; dados: T } | { ok: false; indisponivel: boolean; erro: string };

function falha(error: { code?: string; message?: string }, contexto: string): { ok: false; indisponivel: boolean; erro: string } {
  if (tabelaAusente(error)) return { ok: false, indisponivel: true, erro: MSG_HISTORICO_INDISPONIVEL };
  console.error(`[pecas/repositorio] ${contexto}:`, error.message);
  return { ok: false, indisponivel: false, erro: 'Não foi possível acessar o histórico de peças agora.' };
}

export async function listarPecas(userId: string): Promise<ResultadoRepositorio<PecaResumo[]>> {
  const db = getAdminClient();
  if (!db) return { ok: false, indisponivel: true, erro: 'Serviço indisponível.' };
  const { data, error } = await db.from('ap_pecas').select(COLUNAS_RESUMO).eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
  if (error) return falha(error, 'listar');
  return { ok: true, dados: (data ?? []).map(resumoDe) };
}

export async function obterPeca(userId: string, id: string): Promise<ResultadoRepositorio<PecaCompleta | null>> {
  const db = getAdminClient();
  if (!db) return { ok: false, indisponivel: true, erro: 'Serviço indisponível.' };
  const { data, error } = await db.from('ap_pecas').select(`${COLUNAS_RESUMO}, entrada, conteudo`).eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) return falha(error, 'obter');
  return { ok: true, dados: data ? completaDe(data) : null };
}

export interface NovaPeca {
  tipo: string;
  titulo: string;
  processoNumero: string | null;
  entrada: EntradaPeca;
  conteudo: string;
  modelo: string | null;
  tokensEntrada: number;
  tokensSaida: number;
}

export async function salvarPeca(userId: string, p: NovaPeca): Promise<ResultadoRepositorio<PecaCompleta>> {
  const db = getAdminClient();
  if (!db) return { ok: false, indisponivel: true, erro: 'Serviço indisponível.' };
  const { data, error } = await db
    .from('ap_pecas')
    .insert({
      user_id: userId,
      tipo: p.tipo,
      titulo: p.titulo.slice(0, 200),
      processo_numero: p.processoNumero,
      entrada: p.entrada,
      conteudo: p.conteudo,
      modelo: p.modelo,
      tokens_entrada: p.tokensEntrada,
      tokens_saida: p.tokensSaida
    })
    .select(`${COLUNAS_RESUMO}, entrada, conteudo`)
    .single();
  if (error) return falha(error, 'salvar');
  return { ok: true, dados: completaDe(data) };
}

export async function atualizarPeca(userId: string, id: string, campos: { titulo?: string; conteudo?: string }): Promise<ResultadoRepositorio<PecaCompleta | null>> {
  const db = getAdminClient();
  if (!db) return { ok: false, indisponivel: true, erro: 'Serviço indisponível.' };
  const mudancas: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (campos.titulo !== undefined) mudancas.titulo = campos.titulo.slice(0, 200);
  if (campos.conteudo !== undefined) mudancas.conteudo = campos.conteudo;
  const { data, error } = await db
    .from('ap_pecas')
    .update(mudancas)
    .eq('user_id', userId)
    .eq('id', id)
    .select(`${COLUNAS_RESUMO}, entrada, conteudo`)
    .maybeSingle();
  if (error) return falha(error, 'atualizar');
  return { ok: true, dados: data ? completaDe(data) : null };
}

export async function excluirPeca(userId: string, id: string): Promise<ResultadoRepositorio<boolean>> {
  const db = getAdminClient();
  if (!db) return { ok: false, indisponivel: true, erro: 'Serviço indisponível.' };
  const { data, error } = await db.from('ap_pecas').delete().eq('user_id', userId).eq('id', id).select('id');
  if (error) return falha(error, 'excluir');
  return { ok: true, dados: (data ?? []).length > 0 };
}

export async function duplicarPeca(userId: string, id: string): Promise<ResultadoRepositorio<PecaCompleta | null>> {
  const original = await obterPeca(userId, id);
  if (!original.ok || !original.dados) return original;
  const o = original.dados;
  return salvarPeca(userId, {
    tipo: o.tipo,
    titulo: `${o.titulo} (cópia)`,
    processoNumero: o.processoNumero,
    entrada: o.entrada,
    conteudo: o.conteudo,
    modelo: o.modelo,
    tokensEntrada: 0,
    tokensSaida: 0
  });
}
