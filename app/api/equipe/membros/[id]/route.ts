import { NextResponse } from 'next/server';
import { removerMembro } from '@/lib/equipe';
import { autenticarEquipe, respostaErroEquipe } from '../../_resposta';

/** Dono remove um membro do escritório (`id` = user_id do membro). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autenticarEquipe(request);
  if ('resposta' in auth) return auth.resposta;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'ID de membro inválido.', codigo: 'invalido' }, { status: 400 });

  const resultado = await removerMembro(auth.userId, id);
  if (!resultado.sucesso) return respostaErroEquipe(resultado);
  return NextResponse.json({ sucesso: true });
}
