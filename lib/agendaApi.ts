import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { verificarRecursoPlano } from '@/lib/planos';

/**
 * Autenticação e acesso por plano compartilhados pelas rotas /api/agenda*. Retorna o usuário e o cliente admin,
 * ou a resposta de erro pronta (401 sem login, 403 `recurso_pro` fora do plano, 503 sem banco).
 */
export async function autorizarAgenda(request: Request): Promise<{ userId: string; db: SupabaseClient } | NextResponse> {
  const naoAutorizado = await requireUser(request);
  if (naoAutorizado) return naoAutorizado;

  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 });

  const acesso = await verificarRecursoPlano(userId, 'agendaPrazos');
  if (!acesso.permitido) {
    return NextResponse.json(
      { error: 'A agenda de prazos e tarefas com lembretes é exclusiva do Plano Pro.', codigo: 'recurso_pro' },
      { status: 403 }
    );
  }
  return { userId, db };
}

export interface LinhaPrazo {
  id: string;
  processo_id: string | null;
  numero_cnj: string | null;
  titulo: string;
  descricao: string | null;
  tipo: 'prazo' | 'tarefa' | 'audiencia';
  data_vencimento: string;
  concluido: boolean;
  concluido_em: string | null;
  origem: 'manual' | 'auto_movimentacao' | 'auto_diario';
  created_at: string;
}

export const COLUNAS_PRAZO = 'id, processo_id, numero_cnj, titulo, descricao, tipo, data_vencimento, concluido, concluido_em, origem, created_at';

export function paraDto(l: LinhaPrazo) {
  return {
    id: l.id,
    processoId: l.processo_id,
    numeroCnj: l.numero_cnj,
    titulo: l.titulo,
    descricao: l.descricao,
    tipo: l.tipo,
    dataVencimento: l.data_vencimento,
    concluido: l.concluido,
    concluidoEm: l.concluido_em,
    origem: l.origem,
    criadoEm: l.created_at
  };
}
