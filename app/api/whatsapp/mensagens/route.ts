import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient } from '@/lib/track';
import type { WhatsappMensagem } from '@/lib/crm';

/**
 * Lista o histórico de mensagens de WhatsApp interno de um item do CRM (?itemId=). RLS garante que só
 * participante da conversa (remetente/destinatário) ou admin/owner enxergam cada linha — aqui usamos
 * o client admin (service role) e aplicamos só o filtro de itemId, confiando no guard de rota
 * (requireAdvogadoOuAdmin) para acesso de equipe interna ao módulo como um todo.
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const forbidden = await requireAdvogadoOuAdmin(request);
  if (forbidden) return forbidden;

  const db = getAdminClient();
  if (!db) return NextResponse.json({ mensagens: [] });

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId');
  if (!itemId) {
    return NextResponse.json({ error: 'itemId é obrigatório.' }, { status: 400 });
  }

  const { data, error } = await db
    .from('ap_whatsapp_mensagens')
    .select('id, remetente_id, destinatario_id, numero_whatsapp, item_id, texto, direcao, status, created_at')
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[api/whatsapp/mensagens] falha ao listar:', error.message);
    return NextResponse.json({ mensagens: [], erro: 'Não foi possível carregar as mensagens.' });
  }

  const mensagens: WhatsappMensagem[] = (data ?? []).map(row => ({
    id: row.id as string,
    remetenteId: (row.remetente_id as string | null) ?? null,
    destinatarioId: (row.destinatario_id as string | null) ?? null,
    numeroWhatsapp: (row.numero_whatsapp as string | null) ?? null,
    itemId: (row.item_id as string | null) ?? null,
    texto: row.texto as string,
    direcao: row.direcao as WhatsappMensagem['direcao'],
    status: row.status as WhatsappMensagem['status'],
    createdAt: row.created_at as string
  }));

  return NextResponse.json({ mensagens });
}
