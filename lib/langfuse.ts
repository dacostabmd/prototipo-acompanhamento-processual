import { Langfuse } from 'langfuse';
import { CallbackHandler } from 'langfuse-langchain';

/**
 * Cliente de observabilidade e tracing Langfuse para o Prosec.
 * Monitora custos de tokens, latência de agentes LangChain e qualidade de respostas.
 *
 * Se as variáveis de ambiente LANGFUSE_PUBLIC_KEY ou LANGFUSE_SECRET_KEY não estiverem presentes,
 * opera de forma graciosa como no-op sem quebrar o fluxo da aplicação.
 */

let langfuseInstance: Langfuse | null = null;
let avisouChavesAusentes = false;

export function isLangfuseConfigurado(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

export function getLangfuseClient(): Langfuse | null {
  if (!isLangfuseConfigurado()) {
    if (!avisouChavesAusentes && process.env.NODE_ENV !== 'production') {
      console.log('[langfuse] LANGFUSE_PUBLIC_KEY ou LANGFUSE_SECRET_KEY não configuradas — observabilidade desativada.');
      avisouChavesAusentes = true;
    }
    return null;
  }

  if (!langfuseInstance) {
    langfuseInstance = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
      flushAt: 1, // Envia imediatamente em ambientes serverless Next.js
      flushInterval: 1000
    });
  }

  return langfuseInstance;
}

export interface LangfuseHandlerOptions {
  userId?: string;
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  release?: string;
}

/**
 * Cria um CallbackHandler do Langfuse para ser passado aos agentes e chains do LangChain.
 * Retorna null quando as chaves não estão configuradas no ambiente.
 */
export function getLangfuseCallbackHandler(options: LangfuseHandlerOptions = {}): CallbackHandler | null {
  if (!isLangfuseConfigurado()) return null;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';

  try {
    const handler = new CallbackHandler({
      publicKey,
      secretKey,
      baseUrl,
      userId: options.userId,
      sessionId: options.sessionId,
      tags: options.tags || ['prosec-v2', 'acompanhamento-ia'],
      metadata: options.metadata,
      release: options.release || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'v2.0.0'
    });
    return handler;
  } catch (err) {
    console.error('[langfuse] Erro ao instanciar CallbackHandler:', err);
    return null;
  }
}

/**
 * Registra uma pontuação (score) para um trace específico (ex.: feedback do usuário no WhatsApp).
 */
export async function registrarScoreLangfuse(params: {
  traceId: string;
  name: string;
  value: number; // Ex.: 1 para positivo, 0 para negativo, ou escala 0 a 10
  comment?: string;
}): Promise<boolean> {
  const client = getLangfuseClient();
  if (!client) return false;

  try {
    await client.score({
      traceId: params.traceId,
      name: params.name,
      value: params.value,
      comment: params.comment
    });
    await client.flushAsync();
    return true;
  } catch (err) {
    console.error('[langfuse] Falha ao registrar score:', err);
    return false;
  }
}

/**
 * Força o envio dos eventos pendentes antes de encerrar funções serverless.
 */
export async function flushLangfuse(): Promise<void> {
  if (langfuseInstance) {
    try {
      await langfuseInstance.flushAsync();
    } catch (err) {
      console.warn('[langfuse] Aviso no flushAsync:', err);
    }
  }
}
