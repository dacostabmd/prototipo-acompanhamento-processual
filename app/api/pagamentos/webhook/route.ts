import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { trackEvento } from '@/lib/track';
import { type AsaasPagamento } from '@/lib/asaas';
import {
  STATUS_PAGOS,
  confirmarPagamento,
  encerrarAssinatura,
  localizarUsuarioDoEvento,
  obterAssinaturaDoUsuario
} from '@/lib/assinaturas';

/**
 * Webhook do Asaas para as assinaturas do Plano Pro.
 *
 * Segurança: o Asaas manda no header "asaas-access-token" o token cadastrado na configuração do webhook;
 * ele precisa bater com ASAAS_WEBHOOK_TOKEN. Sem isso, qualquer um ativaria o Pro com um POST.
 *
 * A conta Asaas é compartilhada com outros negócios: chegam eventos de clientes que não são nossos. Só há
 * ação quando o evento é da assinatura registrada em ap_assinaturas; o resto responde 200 "ignored" (erro
 * faria o Asaas reenviar e, após falhas seguidas, pausar a fila).
 */

const EVENTOS_PAGO = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const EVENTOS_ESTORNO = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED']);
const EVENTOS_ASSINATURA_ENCERRADA = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

function tokenValido(recebido: string | null): boolean {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ignorar = (motivo: string, evento: string) => {
  return NextResponse.json({ status: 'ignored', motivo, evento }, { status: 200 });
};

export async function POST(request: NextRequest) {
  if (!tokenValido(request.headers.get('asaas-access-token'))) {
    return NextResponse.json({ error: 'Token do webhook inválido.' }, { status: 401 });
  }

  let body: Record<string, any>;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'Payload JSON inválido' }, { status: 400 });
  }

  const evento = typeof body?.event === 'string' ? body.event : 'desconhecido';
  const pagamento = body?.payment as AsaasPagamento | undefined;
  const assinaturaEvento = body?.subscription as { id?: string; customer?: string; externalReference?: string } | undefined;

  const assinaturaId = pagamento?.subscription ?? assinaturaEvento?.id ?? null;
  const userId = await localizarUsuarioDoEvento({
    assinaturaId,
    clienteId: pagamento?.customer ?? assinaturaEvento?.customer,
    externalReference: pagamento?.externalReference ?? assinaturaEvento?.externalReference
  });

  if (!userId) {
    // Conta compartilhada: o normal é ser cobrança de outro negócio. Só registra se parecer nossa.
    if (String(pagamento?.externalReference ?? assinaturaEvento?.externalReference ?? '').startsWith('jusconsulta:')) {
      console.warn(`[webhook-asaas] ${evento} com referência JusConsulta sem assinatura local. Chaves:`, Object.keys(body));
    }
    return ignorar('usuario_nao_localizado', evento);
  }

  // Só a assinatura vigente muda o plano (eventos de uma pendente trocada por outro método são ignorados).
  const atual = await obterAssinaturaDoUsuario(userId);
  if (!atual?.assinatura_id || atual.assinatura_id !== assinaturaId) {
    return ignorar('assinatura_antiga', evento);
  }

  try {
    if (EVENTOS_PAGO.has(evento) && pagamento && STATUS_PAGOS.has(pagamento.status)) {
      if (!(await confirmarPagamento(userId, pagamento))) throw new Error('falha ao ativar plano');
      await trackEvento(request, userId, {
        tipo: 'lead',
        dados: { acao: 'conversao_assinatura_pro', gateway: 'asaas', evento, valor: pagamento.value }
      });
      return NextResponse.json({ status: 'success', plano: 'pro' });
    }

    if (evento === 'PAYMENT_OVERDUE' && atual.status === 'ativa') {
      await encerrarAssinatura(userId, 'inadimplente');
      return NextResponse.json({ status: 'success', plano: 'free', motivo: 'inadimplente' });
    }

    // Pendente nunca foi paga (o plano já é Gratuito); ignorar evita corrida com a troca de método no modal.
    if ((EVENTOS_ESTORNO.has(evento) || EVENTOS_ASSINATURA_ENCERRADA.has(evento)) && atual.status !== 'pendente') {
      await encerrarAssinatura(userId, 'cancelada');
      return NextResponse.json({ status: 'success', plano: 'free', motivo: 'cancelada' });
    }

    return ignorar('evento_sem_acao', evento);
  } catch (error) {
    console.error(`[webhook-asaas] Erro ao processar ${evento} do usuário ${userId}:`, error);
    return NextResponse.json({ error: 'erro_ao_processar' }, { status: 500 });
  }
}
