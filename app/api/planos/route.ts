import { NextResponse } from 'next/server';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { cancelarAssinaturaDoUsuario } from '@/lib/assinaturas';
import { requireUser } from '@/lib/requireUser';
import { obterStatusPlanoUsuario, obterConsumoCiclo, atualizarPlanoUsuario, REGRAS_PLANOS, type PlanoTipo } from '@/lib/planos';

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
  }

  const status = await obterStatusPlanoUsuario(userId);
  const consumo = await obterConsumoCiclo(userId, status.plano);
  return NextResponse.json({
    ...status,
    consumo,
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

  // O Pro só é ativado por pagamento confirmado (webhook/consulta do Asaas). Aqui, só admin/owner liberam
  // manualmente; antes, qualquer usuário logado se promovia a Pro sem pagar.
  if (planoDesejado === 'pro') {
    const db = getAdminClient();
    const { data: perfil } = db ? await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle() : { data: null };
    if (perfil?.role !== 'admin' && perfil?.role !== 'owner') {
      return NextResponse.json({ error: 'O Plano Pro é ativado após a confirmação do pagamento.' }, { status: 403 });
    }
  }

  let atualizado: boolean;
  try {
    atualizado =
      planoDesejado === 'free' ? await cancelarAssinaturaDoUsuario(userId) : await atualizarPlanoUsuario(userId, 'pro');
  } catch (e) {
    console.error('[planos] Falha ao cancelar assinatura no Asaas:', e);
    return NextResponse.json({ error: 'Não foi possível cancelar a assinatura agora. Tente novamente.' }, { status: 502 });
  }
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
