import { getAdminClient } from '@/lib/track';
import { atualizarPlanoUsuario, REGRAS_PLANOS } from '@/lib/planos';
import {
  AsaasErro,
  STATUS_PAGOS,
  cancelarAssinatura,
  criarAssinatura,
  listarPagamentosDaAssinatura,
  obterAssinatura,
  obterOuCriarCliente,
  obterPixQrCode,
  userIdDaReferencia,
  type AsaasPagamento
} from '@/lib/asaas';

export type MetodoPagamento = 'pix' | 'cartao';
export type StatusAssinatura = 'pendente' | 'ativa' | 'inadimplente' | 'cancelada';

export interface AssinaturaRow {
  user_id: string;
  cliente_id: string | null;
  assinatura_id: string | null;
  status: StatusAssinatura;
  metodo: MetodoPagamento | null;
  ultimo_pagamento_id: string | null;
  proximo_vencimento: string | null;
}

export interface CobrancaGerada {
  pagamentoId: string;
  metodo: MetodoPagamento;
  valor: number;
  vencimento: string;
  invoiceUrl: string | null;
  pix: { imagemBase64: string; copiaECola: string; expiraEm: string | null } | null;
}

/** Data de hoje em Brasília, no formato YYYY-MM-DD que o Asaas espera. */
function hojeBrasilia(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

function somarUmMes(data: string): string {
  const [a, m, d] = data.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m, d));
  return alvo.toISOString().slice(0, 10);
}

export async function obterAssinaturaDoUsuario(userId: string): Promise<AssinaturaRow | null> {
  const db = getAdminClient();
  if (!db) return null;
  const { data } = await db.from('ap_assinaturas').select('*').eq('user_id', userId).maybeSingle();
  return (data as AssinaturaRow) ?? null;
}

async function salvar(userId: string, campos: Partial<Omit<AssinaturaRow, 'user_id'>> & { valor?: number }) {
  const db = getAdminClient();
  if (!db) throw new Error('Banco indisponível.');
  const { error } = await db
    .from('ap_assinaturas')
    .upsert({ user_id: userId, gateway: 'asaas', ...campos, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(`Falha ao salvar assinatura: ${error.message}`);
}

async function montarCobranca(pagamento: AsaasPagamento, metodo: MetodoPagamento): Promise<CobrancaGerada> {
  let pix: CobrancaGerada['pix'] = null;
  if (metodo === 'pix') {
    const qr = await obterPixQrCode(pagamento.id);
    pix = { imagemBase64: qr.encodedImage, copiaECola: qr.payload, expiraEm: qr.expirationDate ?? null };
  }
  return {
    pagamentoId: pagamento.id,
    metodo,
    valor: pagamento.value,
    vencimento: pagamento.dueDate,
    invoiceUrl: pagamento.invoiceUrl ?? null,
    pix
  };
}

/**
 * Gera (ou reaproveita) a cobrança da primeira mensalidade do Pro.
 * - Assinatura pendente com o mesmo método: devolve a cobrança em aberto (não duplica).
 * - Assinatura pendente com outro método: cancela no Asaas e cria uma nova.
 */
export async function gerarCobrancaPro(dados: {
  userId: string;
  nome: string;
  email: string | null;
  cpfCnpj: string;
  metodo: MetodoPagamento;
}): Promise<CobrancaGerada> {
  const atual = await obterAssinaturaDoUsuario(dados.userId);

  if (atual?.assinatura_id && atual.status === 'pendente') {
    if (atual.metodo === dados.metodo) {
      const pendente = (await listarPagamentosDaAssinatura(atual.assinatura_id)).find(p => p.status === 'PENDING');
      if (pendente) return montarCobranca(pendente, dados.metodo);
    }
    await cancelarAssinatura(atual.assinatura_id).catch(e => console.warn('[assinaturas] Falha ao cancelar pendente:', e.message));
  }

  const clienteId = atual?.cliente_id || (await obterOuCriarCliente(dados));
  const valor = REGRAS_PLANOS.pro.valorMensalReais;
  const assinatura = await criarAssinatura({
    clienteId,
    userId: dados.userId,
    metodo: dados.metodo,
    valor,
    vencimento: hojeBrasilia(),
    descricao: 'JusConsulta Pro - assinatura mensal'
  });

  const primeiro = (await listarPagamentosDaAssinatura(assinatura.id)).find(p => p.status === 'PENDING');
  if (!primeiro) throw new AsaasErro('O Asaas criou a assinatura, mas não gerou a primeira cobrança.', 502);

  await salvar(dados.userId, {
    cliente_id: clienteId,
    assinatura_id: assinatura.id,
    status: 'pendente',
    metodo: dados.metodo,
    valor,
    ultimo_pagamento_id: primeiro.id,
    proximo_vencimento: primeiro.dueDate
  });

  return montarCobranca(primeiro, dados.metodo);
}

/** Pagamento confirmado: ativa o Pro e registra o próximo vencimento. Idempotente. */
export async function confirmarPagamento(userId: string, pagamento: AsaasPagamento): Promise<boolean> {
  let proximo = somarUmMes(pagamento.dueDate);
  if (pagamento.subscription) {
    try {
      proximo = (await obterAssinatura(pagamento.subscription)).nextDueDate || proximo;
    } catch {}
  }
  await salvar(userId, { status: 'ativa', ultimo_pagamento_id: pagamento.id, proximo_vencimento: proximo });
  return atualizarPlanoUsuario(userId, 'pro');
}

/** Inadimplência, estorno ou cancelamento: volta para o Gratuito. */
export async function encerrarAssinatura(userId: string, status: Exclude<StatusAssinatura, 'ativa' | 'pendente'>) {
  await salvar(userId, { status });
  return atualizarPlanoUsuario(userId, 'free');
}

/** Cancela a assinatura no Asaas (se houver) e volta o usuário para o Gratuito. */
export async function cancelarAssinaturaDoUsuario(userId: string) {
  const atual = await obterAssinaturaDoUsuario(userId);
  if (atual?.assinatura_id && atual.status !== 'cancelada') {
    await cancelarAssinatura(atual.assinatura_id);
    await salvar(userId, { status: 'cancelada' });
  }
  return atualizarPlanoUsuario(userId, 'free');
}

/**
 * Descobre de qual usuário é um evento do Asaas. A conta é compartilhada com outros negócios, então só vale
 * o que bate com uma linha de ap_assinaturas (por assinatura, cliente ou externalReference "jusconsulta:").
 */
export async function localizarUsuarioDoEvento(ids: {
  assinaturaId?: string | null;
  clienteId?: string | null;
  externalReference?: string | null;
}): Promise<string | null> {
  const db = getAdminClient();
  if (!db) return null;

  if (ids.assinaturaId) {
    const { data } = await db.from('ap_assinaturas').select('user_id').eq('assinatura_id', ids.assinaturaId).maybeSingle();
    if (data?.user_id) return data.user_id;
  }
  if (ids.clienteId) {
    const { data } = await db.from('ap_assinaturas').select('user_id').eq('cliente_id', ids.clienteId).limit(1).maybeSingle();
    if (data?.user_id) return data.user_id;
  }
  const doRef = userIdDaReferencia(ids.externalReference);
  if (doRef) {
    const { data } = await db.from('ap_assinaturas').select('user_id').eq('user_id', doRef).maybeSingle();
    if (data?.user_id) return data.user_id;
  }
  return null;
}

export { STATUS_PAGOS };
