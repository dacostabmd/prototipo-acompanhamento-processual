/**
 * Cliente HTTP mínimo da API v3 do Asaas (https://docs.asaas.com).
 *
 * A chave fica em ASAAS_API_KEY (no .env.local, o "$" inicial precisa ser escapado como "\$"; na Vercel vai sem
 * escape). O ambiente sai da própria chave: "_hmlg_" é sandbox; o resto vai para produção, salvo ASAAS_API_URL.
 *
 * A conta Asaas é compartilhada com outros negócios: todo cliente criado aqui leva externalReference
 * "jusconsulta:<userId>" e notificações desligadas (senão o Asaas manda e-mail/SMS com a marca da conta).
 */

export const PREFIXO_REFERENCIA = 'jusconsulta:';

export interface AsaasPagamento {
  id: string;
  customer: string;
  subscription?: string | null;
  status: string;
  value: number;
  dueDate: string;
  billingType: string;
  invoiceUrl?: string;
  externalReference?: string | null;
}

export interface AsaasAssinatura {
  id: string;
  customer: string;
  status: string;
  value: number;
  nextDueDate: string;
  billingType: string;
  externalReference?: string | null;
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate?: string;
}

export class AsaasErro extends Error {
  constructor(message: string, public status: number, public codigo?: string) {
    super(message);
  }
}

/** Status de cobrança que contam como pagas. */
export const STATUS_PAGOS = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

function configuracao() {
  // Leitores de .env que não desfazem o escape (ex.: node --env-file) entregam "\$aact_...".
  const chave = process.env.ASAAS_API_KEY?.trim().replace(/^\\\$/, '$');
  if (!chave) throw new AsaasErro('Pagamentos indisponíveis: ASAAS_API_KEY não configurada no servidor.', 503, 'nao_configurado');
  const base =
    process.env.ASAAS_API_URL?.trim().replace(/\/$/, '') ||
    (chave.includes('_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3');
  return { chave, base };
}

export function asaasConfigurado(): boolean {
  return Boolean(process.env.ASAAS_API_KEY?.trim());
}

async function chamar<T>(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
  const { chave, base } = configuracao();
  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      access_token: chave,
      'Content-Type': 'application/json',
      'User-Agent': 'JusConsulta/1.0'
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000)
  });

  const texto = await res.text();
  let dados: any = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!res.ok) {
    const erro = dados?.errors?.[0];
    throw new AsaasErro(erro?.description || `Asaas respondeu ${res.status}.`, res.status, erro?.code);
  }
  return dados as T;
}

const referencia = (userId: string) => `${PREFIXO_REFERENCIA}${userId}`;

/** Extrai o userId de uma externalReference criada por este sistema (ou null se for de outro negócio da conta). */
export function userIdDaReferencia(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith(PREFIXO_REFERENCIA)) return null;
  const id = ref.slice(PREFIXO_REFERENCIA.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** Reaproveita o cliente do usuário (pela externalReference) ou cria um novo. */
export async function obterOuCriarCliente(dados: { userId: string; nome: string; email?: string | null; cpfCnpj: string }): Promise<string> {
  const ref = referencia(dados.userId);
  const lista = await chamar<{ data: { id: string }[] }>('GET', `/customers?externalReference=${encodeURIComponent(ref)}&limit=1`);
  if (lista.data?.[0]?.id) return lista.data[0].id;

  const cliente = await chamar<{ id: string }>('POST', '/customers', {
    name: dados.nome,
    cpfCnpj: dados.cpfCnpj,
    email: dados.email || undefined,
    externalReference: ref,
    notificationDisabled: true
  });
  return cliente.id;
}

export function criarAssinatura(dados: {
  clienteId: string;
  userId: string;
  metodo: 'pix' | 'cartao';
  valor: number;
  vencimento: string;
  descricao: string;
}) {
  return chamar<AsaasAssinatura>('POST', '/subscriptions', {
    customer: dados.clienteId,
    billingType: dados.metodo === 'pix' ? 'PIX' : 'CREDIT_CARD',
    value: dados.valor,
    nextDueDate: dados.vencimento,
    cycle: 'MONTHLY',
    description: dados.descricao,
    externalReference: referencia(dados.userId)
  });
}

export function obterAssinatura(id: string) {
  return chamar<AsaasAssinatura>('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

export function cancelarAssinatura(id: string) {
  return chamar<{ deleted: boolean }>('DELETE', `/subscriptions/${encodeURIComponent(id)}`);
}

export async function listarPagamentosDaAssinatura(id: string): Promise<AsaasPagamento[]> {
  const lista = await chamar<{ data: AsaasPagamento[] }>('GET', `/subscriptions/${encodeURIComponent(id)}/payments`);
  return lista.data ?? [];
}

export function obterPagamento(id: string) {
  return chamar<AsaasPagamento>('GET', `/payments/${encodeURIComponent(id)}`);
}

export function obterPixQrCode(pagamentoId: string) {
  return chamar<AsaasPixQrCode>('GET', `/payments/${encodeURIComponent(pagamentoId)}/pixQrCode`);
}
