import { NextRequest, NextResponse } from 'next/server';
import { atualizarPlanoUsuario } from '@/lib/planos';
import { trackEvento } from '@/lib/track';
import { getAdminClient } from '@/lib/track';

/**
 * Webhook unificado de pagamentos para assinaturas do Plano PRO.
 * Suporta payloads de gateways brasileiros e internacionais (Asaas, Stripe, Mercado Pago).
 *
 * Ao receber confirmação de pagamento:
 * 1. Identifica o usuário (via customerId, email ou metadata.userId)
 * 2. Promove a conta para o plano 'pro' no Supabase
 * 3. Registra o evento de conversão
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Payload JSON inválido' }, { status: 400 });
    }

    const db = getAdminClient();
    let userId: string | null = null;
    let gateway = 'desconhecido';
    let evento = 'desconhecido';

    // 1. Suporte a Webhooks do Asaas (evento: PAYMENT_CONFIRMED ou PAYMENT_RECEIVED)
    if (body.event && typeof body.event === 'string' && body.payment) {
      gateway = 'asaas';
      evento = body.event;

      if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
        const payment = body.payment as Record<string, unknown>;
        const customerEmail = payment.customerEmail as string | undefined;
        const externalReference = payment.externalReference as string | undefined;

        if (externalReference) {
          userId = externalReference;
        } else if (customerEmail && db) {
          const { data: perfil } = await db
            .from('ap_perfis')
            .select('id')
            .eq('email', customerEmail)
            .maybeSingle();
          userId = perfil?.id || null;
        }
      }
    }

    // 2. Suporte a Webhooks do Stripe (evento: invoice.payment_succeeded ou checkout.session.completed)
    else if (body.type && typeof body.type === 'string' && body.data) {
      gateway = 'stripe';
      evento = body.type;

      if (body.type === 'invoice.payment_succeeded' || body.type === 'checkout.session.completed') {
        const dataObj = (body.data as Record<string, unknown>).object as Record<string, unknown> | undefined;
        const clientRef = dataObj?.client_reference_id as string | undefined;
        const metaUserId = (dataObj?.metadata as Record<string, string> | undefined)?.userId;
        const customerEmail = dataObj?.customer_email as string | undefined;

        if (clientRef) {
          userId = clientRef;
        } else if (metaUserId) {
          userId = metaUserId;
        } else if (customerEmail && db) {
          const { data: perfil } = await db
            .from('ap_perfis')
            .select('id')
            .eq('email', customerEmail)
            .maybeSingle();
          userId = perfil?.id || null;
        }
      }
    }

    // 3. Suporte a Webhooks do Mercado Pago (action: payment.created ou payment.updated)
    else if (body.action && typeof body.action === 'string' && body.data) {
      gateway = 'mercadopago';
      evento = body.action;
      const dataObj = body.data as Record<string, unknown>;
      const externalRef = dataObj?.external_reference as string | undefined;
      if (externalRef) {
        userId = externalRef;
      }
    }

    // 4. Payload genérico/manual de homologação
    else if (body.userId && typeof body.userId === 'string' && (body.status === 'pago' || body.status === 'approved')) {
      gateway = 'manual_homologacao';
      evento = 'aprovado';
      userId = body.userId;
    }

    if (!userId) {
      console.warn(`[webhook-pagamentos] Pagamento recebido (${gateway}:${evento}), mas usuário não identificado.`);
      return NextResponse.json({ status: 'ignored', motivo: 'usuario_nao_localizado' }, { status: 200 });
    }

    const ativado = await atualizarPlanoUsuario(userId, 'pro');
    if (!ativado) {
      console.error(`[webhook-pagamentos] Falha ao atualizar plano para o usuário ${userId}`);
      return NextResponse.json({ error: 'erro_ao_atualizar_plano' }, { status: 500 });
    }

    await trackEvento(request, userId, {
      tipo: 'lead',
      dados: {
        acao: 'conversao_assinatura_pro',
        gateway,
        evento,
        valor: 79.9
      }
    });

    console.log(`[webhook-pagamentos] Plano PRO ativado com sucesso para o usuário ${userId} via ${gateway}`);
    return NextResponse.json({ status: 'success', userId, plano: 'pro' }, { status: 200 });
  } catch (error) {
    console.error('[webhook-pagamentos] Erro inesperado no processamento:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
