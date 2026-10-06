import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import type { ConsultaHistorico } from '@/lib/historicoConsultas';

const COLUNAS =
  'id,user_id,usuario_nome,usuario_email,tipo_busca,termo,nome_parte,tribunais,total_processos,custo_estimado,custo_cobrado,created_at';
const LIMITE = 300;

/**
 * Histórico de consultas (quem consultou, o quê e quanto custou), mais recentes primeiro.
 * admin/owner veem as consultas de todos; advogado/broker, só as próprias; cliente não tem histórico
 * (ele só acompanha os processos do próprio CPF/CNPJ e não paga as consultas).
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ consultas: [], escopo: 'proprio' });

  const { data: perfil } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  const role = perfil?.role as string | undefined;
  if (role === 'cliente') return NextResponse.json({ consultas: [], escopo: 'indisponivel' });

  const escopo = role === 'admin' || role === 'owner' ? 'todos' : 'proprio';
  let consulta = db.from('ap_historico_consultas').select(COLUNAS).order('created_at', { ascending: false }).limit(LIMITE);
  if (escopo === 'proprio') consulta = consulta.eq('user_id', userId);

  const { data, error } = await consulta;
  if (error) {
    // Tabela ausente (migration 20261006120000_ap_historico_consultas.sql ainda não aplicada) cai aqui.
    console.error('[api/processos/historico] erro ao consultar Postgres:', error.message);
    return NextResponse.json({ consultas: [], escopo, erro: 'Histórico indisponível no momento.' });
  }

  const consultas = ((data as ConsultaHistorico[]) ?? []).map(c => ({
    ...c,
    // numeric chega como string em alguns drivers: o cliente soma, então garante número.
    custo_estimado: Number(c.custo_estimado),
    custo_cobrado: Number(c.custo_cobrado)
  }));
  return NextResponse.json({ consultas, escopo });
}
