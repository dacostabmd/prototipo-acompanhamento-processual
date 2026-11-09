import { NextResponse } from 'next/server';
import { autorizarAgenda } from '@/lib/agendaApi';
import { buscarSugestoesDoUsuario } from '@/lib/prazos';

/**
 * Roda o extrator de prazos nas movimentações recentes (últimos 60 dias) dos processos que o usuário acompanha e
 * PROPÕE os prazos (ainda não vencidos e ainda não criados). Não grava nada: a tela mostra a lista e, ao confirmar,
 * envia os itens escolhidos para POST /api/agenda.
 */
export async function GET(request: Request) {
  const auth = await autorizarAgenda(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const sugestoes = await buscarSugestoesDoUsuario(auth.db, auth.userId);
    return NextResponse.json({ sugestoes });
  } catch (e) {
    console.error('[api/agenda/sugestoes] erro:', e);
    return NextResponse.json({ error: 'Não foi possível varrer as movimentações agora.' }, { status: 500 });
  }
}
