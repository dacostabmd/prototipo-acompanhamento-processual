import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminClient } from '@/lib/track';

/**
 * Recebe mensagens de WhatsApp recebidas, encaminhadas pelo serviço Baileys (whatsapp-service/,
 * processo Node separado no VPS do escritório — ver whatsapp-service/src/server.js). Autenticado por
 * WHATSAPP_WEBHOOK_SECRET, comparação em tempo constante (mesmo padrão de app/api/cron/reconsulta).
 */
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const esperado = process.env.WHATSAPP_WEBHOOK_SECRET;
  const esperadoHeader = esperado ? `Bearer ${esperado}` : '';
  const autorizado =
    Boolean(esperado) &&
    auth.length === esperadoHeader.length &&
    timingSafeEqual(Buffer.from(auth), Buffer.from(esperadoHeader));
  if (!autorizado) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) {
    console.error('[api/whatsapp/webhook] Supabase (service role) não configurado — mensagem recebida descartada.');
    return NextResponse.json({ error: 'Supabase não configurado.' }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const numero = body?.numero as string | undefined;
  const mensagem = body?.mensagem as string | undefined;

  if (!numero || !mensagem) {
    return NextResponse.json({ error: 'numero e mensagem são obrigatórios.' }, { status: 400 });
  }

  // Tenta identificar o remetente interno pelo número cadastrado (ap_perfis.whatsapp_interno).
  // Mensagem recebida de um número que não é de nenhum membro da equipe fica com remetente_id nulo
  // (ex: cliente/contato externo respondendo uma mensagem enviada antes).
  const { data: perfil } = await db
    .from('ap_perfis')
    .select('id')
    .eq('whatsapp_interno', numero)
    .maybeSingle();

  const { error } = await db.from('ap_whatsapp_mensagens').insert({
    remetente_id: perfil?.id ?? null,
    destinatario_id: null,
    numero_whatsapp: numero,
    texto: mensagem,
    direcao: 'recebida',
    status: 'recebido'
  });

  if (error) {
    console.error('[api/whatsapp/webhook] falha ao gravar mensagem recebida:', error.message);
    return NextResponse.json({ error: 'Falha ao gravar mensagem.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
