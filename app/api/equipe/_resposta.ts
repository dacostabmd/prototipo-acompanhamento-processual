import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { getUserId } from '@/lib/track';
import { STATUS_POR_CODIGO_EQUIPE, type ResultadoEquipe } from '@/lib/equipe';

/** Erro padronizado das rotas de equipe: `{ error, codigo }` com o status do código (recurso_pro = 403). */
export function respostaErroEquipe(resultado: ResultadoEquipe<unknown>) {
  const codigo = resultado.codigo ?? 'erro';
  return NextResponse.json(
    { error: resultado.erro || 'Falha ao processar a solicitação.', codigo },
    { status: STATUS_POR_CODIGO_EQUIPE[codigo] }
  );
}

export async function autenticarEquipe(request: Request): Promise<{ userId: string } | { resposta: NextResponse }> {
  const naoAutorizado = await requireUser(request);
  if (naoAutorizado) return { resposta: naoAutorizado };
  const userId = await getUserId(request);
  if (!userId) return { resposta: NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 }) };
  return { userId };
}
