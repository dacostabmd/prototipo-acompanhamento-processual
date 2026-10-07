import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import { enviarMensagemWhatsapp } from '@/lib/whatsappService';
import type { WhatsappMensagem } from '@/lib/crm';

/**
 * Envio manual de WhatsApp interno (usuário logado do CRM mandando mensagem para outro membro da
 * equipe, ou para um número externo). Recebe destinatarioUserId OU numero (resolve o número a partir
 * de ap_perfis.whatsapp_interno quando vier destinatarioUserId), chama o serviço Baileys e grava o
 * histórico em ap_whatsapp_mensagens.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  const remetenteId = await getUserId(request);
  if (!db || !remetenteId) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const destinatarioUserId = body?.destinatarioUserId as string | undefined;
  const numeroInformado = body?.numero as string | undefined;
  const texto = (body?.texto as string | undefined)?.trim();
  const itemId = (body?.itemId as string | undefined) ?? null;

  if (!texto) {
    return NextResponse.json({ error: 'texto é obrigatório.' }, { status: 400 });
  }
  if (!destinatarioUserId && !numeroInformado) {
    return NextResponse.json({ error: 'Informe destinatarioUserId ou numero.' }, { status: 400 });
  }

  let numero = numeroInformado ?? null;
  if (destinatarioUserId) {
    const { data: destinatario } = await db
      .from('ap_perfis')
      .select('whatsapp_interno')
      .eq('id', destinatarioUserId)
      .maybeSingle();
    numero = destinatario?.whatsapp_interno ?? null;
    if (!numero) {
      return NextResponse.json({ error: 'Destinatário não tem WhatsApp interno cadastrado.' }, { status: 400 });
    }
  }

  if (!numero) {
    return NextResponse.json({ error: 'Número de WhatsApp não resolvido.' }, { status: 400 });
  }

  const envio = await enviarMensagemWhatsapp(numero, texto);

  const { data: registro, error } = await db
    .from('ap_whatsapp_mensagens')
    .insert({
      remetente_id: remetenteId,
      destinatario_id: destinatarioUserId ?? null,
      numero_whatsapp: numero,
      item_id: itemId,
      texto,
      direcao: 'enviada',
      status: envio.enviado ? 'enviado' : 'falhou'
    })
    .select('id, remetente_id, destinatario_id, numero_whatsapp, item_id, texto, direcao, status, created_at')
    .single();

  if (error) {
    console.error('[api/whatsapp/enviar] falha ao gravar mensagem:', error.message);
    return NextResponse.json({ error: 'Falha ao gravar mensagem.' }, { status: 500 });
  }

  const mensagem: WhatsappMensagem = {
    id: registro.id as string,
    remetenteId: (registro.remetente_id as string | null) ?? null,
    destinatarioId: (registro.destinatario_id as string | null) ?? null,
    numeroWhatsapp: (registro.numero_whatsapp as string | null) ?? null,
    itemId: (registro.item_id as string | null) ?? null,
    texto: registro.texto as string,
    direcao: registro.direcao as WhatsappMensagem['direcao'],
    status: registro.status as WhatsappMensagem['status'],
    createdAt: registro.created_at as string
  };

  if (!envio.enviado) {
    return NextResponse.json({ enviado: false, erro: envio.erro, mensagem }, { status: 502 });
  }

  return NextResponse.json({ enviado: true, mensagem });
}
