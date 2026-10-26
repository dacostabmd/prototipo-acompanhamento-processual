import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { lerTokenDescadastro } from '@/lib/descadastro';

/**
 * Desliga um canal de aviso de um processo a partir do token assinado do e-mail. Sem login: o token é
 * a autorização. Só POST — um GET que descadastrasse seria disparado pelos scanners de link dos
 * provedores de e-mail. Aceita o token na query (?t=, usado pelo List-Unsubscribe-Post de um clique,
 * RFC 8058) ou no corpo JSON { token } (botão da página /descadastro). Idempotente.
 */
export async function POST(request: Request) {
  const daQuery = new URL(request.url).searchParams.get('t');
  let token = daQuery;
  if (!token && request.headers.get('content-type')?.includes('application/json')) {
    const corpo = (await request.json().catch(() => null)) as { token?: unknown } | null;
    token = typeof corpo?.token === 'string' ? corpo.token : null;
  }

  const pedido = lerTokenDescadastro(token);
  if (!pedido) return NextResponse.json({ error: 'Link de descadastro inválido.' }, { status: 400 });

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Serviço indisponível no momento.' }, { status: 503 });

  const campo = pedido.canal === 'email' ? 'notificar_email' : 'notificar_whatsapp';
  const { error } = await db
    .from('ap_processos_monitorados')
    .update({ [campo]: false })
    .eq('user_id', pedido.userId)
    .eq('processo_id', pedido.processoId);

  if (error) {
    console.error('[api/descadastro] falha ao desligar canal:', error.message);
    return NextResponse.json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.' }, { status: 500 });
  }

  // Alertas já enfileirados para esse canal não devem sair depois do descadastro.
  await db
    .from('ap_alertas_pendentes')
    .update({ status: 'ignorado', erro: 'Usuário se descadastrou deste canal.' })
    .eq('user_id', pedido.userId)
    .eq('processo_id', pedido.processoId)
    .eq('canal', pedido.canal)
    .in('status', ['pendente', 'falhou']);

  return NextResponse.json({ ok: true, canal: pedido.canal, numeroCnj: pedido.numeroCnj });
}
