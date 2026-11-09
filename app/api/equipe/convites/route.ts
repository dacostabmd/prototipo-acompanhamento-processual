import { NextResponse } from 'next/server';
import { convidarMembro, revogarConvite } from '@/lib/equipe';
import { autenticarEquipe, respostaErroEquipe } from '../_resposta';

/** Convida por e-mail: `{ email }`. Só o dono; valida o limite de membros pelo plano do dono. */
export async function POST(request: Request) {
  const auth = await autenticarEquipe(request);
  if ('resposta' in auth) return auth.resposta;

  const body = await request.json().catch(() => null);
  const resultado = await convidarMembro(auth.userId, body?.email);
  if (!resultado.sucesso || !resultado.dados) return respostaErroEquipe(resultado);
  return NextResponse.json({ sucesso: true, ...resultado.dados }, { status: 201 });
}

/** Revoga um convite pendente: `?id=ID`. */
export async function DELETE(request: Request) {
  const auth = await autenticarEquipe(request);
  if ('resposta' in auth) return auth.resposta;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID do convite obrigatório.', codigo: 'invalido' }, { status: 400 });

  const resultado = await revogarConvite(auth.userId, id);
  if (!resultado.sucesso) return respostaErroEquipe(resultado);
  return NextResponse.json({ sucesso: true });
}
