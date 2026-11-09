import { NextResponse } from 'next/server';
import { criarEscritorio, encerrarEscritorio, obterEscritorio, sairDoEscritorio } from '@/lib/equipe';
import { autenticarEquipe, respostaErroEquipe } from './_resposta';

/** Escritório do usuário (membros e, para o dono, convites pendentes) e se ele pode criar um. */
export async function GET(request: Request) {
  const auth = await autenticarEquipe(request);
  if ('resposta' in auth) return auth.resposta;

  const resultado = await obterEscritorio(auth.userId);
  if (!resultado.sucesso || !resultado.dados) return respostaErroEquipe(resultado);
  return NextResponse.json(resultado.dados);
}

/** Cria o escritório: `{ nome }`. Exige plano com mais de 1 usuário (Free recebe 403 `recurso_pro`). */
export async function POST(request: Request) {
  const auth = await autenticarEquipe(request);
  if ('resposta' in auth) return auth.resposta;

  const body = await request.json().catch(() => null);
  const resultado = await criarEscritorio(auth.userId, body?.nome);
  if (!resultado.sucesso || !resultado.dados) return respostaErroEquipe(resultado);
  return NextResponse.json({ sucesso: true, id: resultado.dados.id }, { status: 201 });
}

/** Dono encerra o escritório; membro sai dele. */
export async function DELETE(request: Request) {
  const auth = await autenticarEquipe(request);
  if ('resposta' in auth) return auth.resposta;

  const atual = await obterEscritorio(auth.userId);
  if (!atual.sucesso || !atual.dados) return respostaErroEquipe(atual);
  const escritorio = atual.dados.escritorio;
  if (!escritorio) {
    return NextResponse.json({ error: 'Você não faz parte de nenhum escritório.', codigo: 'sem_escritorio' }, { status: 404 });
  }

  const resultado = escritorio.donoId === auth.userId ? await encerrarEscritorio(auth.userId) : await sairDoEscritorio(auth.userId);
  if (!resultado.sucesso) return respostaErroEquipe(resultado);
  return NextResponse.json({ sucesso: true, acao: escritorio.donoId === auth.userId ? 'encerrado' : 'saiu' });
}
