/**
 * Tokens de consulta: unidade exibida ao usuário, derivada do gasto real em APIs pagas (Infosimples/Lemit).
 * 1 token = REAIS_POR_TOKEN de custo de API (padrão R$ 0,01). O DataJud é gratuito: 0 token.
 * Ajustável por NEXT_PUBLIC_REAIS_POR_TOKEN sem mudar código (ex.: para embutir margem sobre o custo).
 */
const valorEnv = Number(process.env.NEXT_PUBLIC_REAIS_POR_TOKEN);
export const REAIS_POR_TOKEN = Number.isFinite(valorEnv) && valorEnv > 0 ? valorEnv : 0.01;

/** Converte um custo em reais para tokens (arredonda para cima: nunca promete menos do que vai custar). */
export function reaisParaTokens(reais: number): number {
  if (!Number.isFinite(reais) || reais <= 0) return 0;
  return Math.ceil(reais / REAIS_POR_TOKEN - 1e-9);
}

/** "1 token" / "26 tokens". */
export function formatarTokens(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? 'token' : 'tokens'}`;
}
