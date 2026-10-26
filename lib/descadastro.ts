import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Link de descadastro dos alertas ("não quero mais receber avisos deste processo por e-mail"). O token
 * é o próprio pedido assinado (HMAC-SHA256), então funciona sem login e não expira — link de
 * descadastro precisa continuar valendo meses depois. Chave: DESCADASTRO_SECRET, com fallback para a
 * service role (nunca sai do servidor; o HMAC não a revela).
 */

export type CanalDescadastro = 'email' | 'whatsapp';

export interface PedidoDescadastro {
  userId: string;
  processoId: string;
  canal: CanalDescadastro;
  /** Só para exibir na página de confirmação; vai assinado junto, não dá para trocar. */
  numeroCnj: string;
}

const CONTEXTO = 'prosec:descadastro:v1:';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

function segredo(): string | null {
  return process.env.DESCADASTRO_SECRET || process.env.SUPABASE_SECRET_KEY || null;
}

function assinar(payload: string, chave: string): string {
  return createHmac('sha256', chave).update(CONTEXTO + payload).digest('base64url');
}

/** null quando não há chave no servidor (o e-mail sai sem o link em vez de sair com um link quebrado). */
export function gerarTokenDescadastro(pedido: PedidoDescadastro): string | null {
  const chave = segredo();
  if (!chave) return null;
  const payload = Buffer.from(JSON.stringify({ u: pedido.userId, p: pedido.processoId, c: pedido.canal, n: pedido.numeroCnj })).toString('base64url');
  return `${payload}.${assinar(payload, chave)}`;
}

export function lerTokenDescadastro(token: string | null | undefined): PedidoDescadastro | null {
  const chave = segredo();
  if (!chave || !token) return null;
  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return null;

  const esperada = Buffer.from(assinar(payload, chave));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const canal = dados.c === 'email' || dados.c === 'whatsapp' ? dados.c : null;
    if (typeof dados.u !== 'string' || typeof dados.p !== 'string' || !canal) return null;
    return { userId: dados.u, processoId: dados.p, canal, numeroCnj: typeof dados.n === 'string' ? dados.n : '' };
  } catch {
    return null;
  }
}

/** Página de confirmação (link no corpo do e-mail: abrir não descadastra, só o botão). */
export function urlPaginaDescadastro(token: string): string {
  return `${SITE_URL}/descadastro?t=${encodeURIComponent(token)}`;
}

/** Endpoint de um clique do cabeçalho List-Unsubscribe (RFC 8058: o provedor de e-mail faz POST nele). */
export function urlUmCliqueDescadastro(token: string): string {
  return `${SITE_URL}/api/descadastro?t=${encodeURIComponent(token)}`;
}
