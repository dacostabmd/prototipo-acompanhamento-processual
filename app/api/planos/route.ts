import { NextResponse } from 'next/server';
import { getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { obterStatusPlanoUsuario, atualizarPlanoUsuario, REGRAS_PLANOS, type PlanoTipo } from '@/lib/planos';

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
  }

  const status = await obterStatusPlanoUsuario(userId);
  return NextResponse.json({
    ...status,
    todosPlanos: REGRAS_PLANOS
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const planoDesejado: PlanoTipo = body?.plano === 'pro' ? 'pro' : 'free';

  const atualizado = await atualizarPlanoUsuario(userId, planoDesejado);
  if (!atualizado) {
    return NextResponse.json({ error: 'Não foi possível alterar o plano no momento.' }, { status: 500 });
  }

  await trackEvento(request, userId, {
    tipo: 'lead',
    dados: {
      acao: 'alteracao_plano',
      novoPlano: planoDesejado
    }
  });

  const novoStatus = await obterStatusPlanoUsuario(userId);
  return NextResponse.json({
    sucesso: true,
    ...novoStatus
  });
}
