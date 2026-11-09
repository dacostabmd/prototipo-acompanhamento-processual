import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { aceitarConvite, obterUsuarioAutenticado } from '@/lib/equipe';
import { respostaErroEquipe } from '../../_resposta';

/** Aceita um convite: `{ token }`. O e-mail da conta logada precisa ser o do convite. */
export async function POST(request: Request) {
  const naoAutorizado = await requireUser(request);
  if (naoAutorizado) return naoAutorizado;

  const usuario = await obterUsuarioAutenticado(request);
  if (!usuario) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const resultado = await aceitarConvite(usuario, body?.token);
  if (!resultado.sucesso || !resultado.dados) return respostaErroEquipe(resultado);
  return NextResponse.json({ sucesso: true, ...resultado.dados });
}
