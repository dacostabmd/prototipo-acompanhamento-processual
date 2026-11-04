import { NextResponse } from 'next/server';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { AsaasErro, asaasConfigurado, obterPagamento } from '@/lib/asaas';
import {
  STATUS_PAGOS,
  confirmarPagamento,
  gerarCobrancaPro,
  obterAssinaturaDoUsuario,
  type MetodoPagamento
} from '@/lib/assinaturas';

const soDigitos = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '');

function respostaDeErro(e: unknown) {
  if (e instanceof AsaasErro) {
    console.error('[pagamentos/assinatura] Asaas:', e.status, e.codigo, e.message);
    const status = e.status === 503 ? 503 : e.status >= 500 ? 502 : 400;
    return NextResponse.json({ error: e.message, codigo: e.codigo ?? null }, { status });
  }
  console.error('[pagamentos/assinatura] Erro inesperado:', e);
  return NextResponse.json({ error: 'Não foi possível processar o pagamento agora.' }, { status: 500 });
}

/** Gera a cobrança da primeira mensalidade do Pro (Pix com QR Code ou link do cartão). */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

  if (!asaasConfigurado()) {
    return NextResponse.json({ error: 'Pagamentos ainda não estão disponíveis.', codigo: 'nao_configurado' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const metodo: MetodoPagamento = body?.metodo === 'cartao' ? 'cartao' : 'pix';

  const db = getAdminClient();
  const { data: perfil } = db
    ? await db.from('ap_perfis').select('nome,email,documento,plano').eq('id', userId).maybeSingle()
    : { data: null };

  if (perfil?.plano === 'pro') {
    return NextResponse.json({ error: 'Sua conta já está no Plano Pro.', codigo: 'ja_pro' }, { status: 409 });
  }

  const cpfCnpj = soDigitos(body?.cpfCnpj) || soDigitos(perfil?.documento);
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return NextResponse.json(
      { error: 'Informe um CPF ou CNPJ válido para emitir a cobrança.', codigo: 'documento_obrigatorio' },
      { status: 400 }
    );
  }

  try {
    const cobranca = await gerarCobrancaPro({
      userId,
      nome: perfil?.nome?.trim() || perfil?.email?.split('@')[0] || 'Cliente JusConsulta',
      email: perfil?.email ?? null,
      cpfCnpj,
      metodo
    });

    await trackEvento(request, userId, {
      tipo: 'lead',
      dados: { acao: 'cobranca_pro_gerada', gateway: 'asaas', metodo, valor: cobranca.valor }
    });

    return NextResponse.json(cobranca);
  } catch (e) {
    return respostaDeErro(e);
  }
}

/**
 * Consulta se a cobrança foi paga (o modal chama a cada poucos segundos). Se o Asaas já confirmou e o
 * webhook ainda não chegou (ou não existe, como no localhost), ativa o Pro aqui mesmo.
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

  const assinatura = await obterAssinaturaDoUsuario(userId);
  if (!assinatura) return NextResponse.json({ status: 'sem_assinatura' });
  if (assinatura.status === 'ativa') return NextResponse.json({ status: 'pago', assinatura });

  const pagamentoId = new URL(request.url).searchParams.get('pagamento') || assinatura.ultimo_pagamento_id;
  if (!pagamentoId) return NextResponse.json({ status: assinatura.status, assinatura });

  try {
    const pagamento = await obterPagamento(pagamentoId);
    // Só aceita cobrança da assinatura deste usuário (o id vem da query string).
    if (!pagamento.subscription || pagamento.subscription !== assinatura.assinatura_id) {
      return NextResponse.json({ error: 'Cobrança não pertence a esta conta.' }, { status: 403 });
    }
    if (STATUS_PAGOS.has(pagamento.status)) {
      await confirmarPagamento(userId, pagamento);
      return NextResponse.json({ status: 'pago' });
    }
    return NextResponse.json({ status: pagamento.status === 'OVERDUE' ? 'vencido' : 'aguardando' });
  } catch (e) {
    return respostaDeErro(e);
  }
}
