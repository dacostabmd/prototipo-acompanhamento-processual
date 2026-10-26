import type { ResumoAndamento } from '@/lib/resumoAndamento';
import type { Movement } from '@/lib/mockProcesses';

/**
 * WhatsApp Cloud API (oficial da Meta). Mensagem iniciada pela empresa fora da janela de 24h só pode
 * ser um TEMPLATE aprovado; o de andamento (WHATSAPP_TEMPLATE_ANDAMENTO, categoria Utilidade, pt_BR)
 * deve ter exatamente 4 variáveis no corpo, nesta ordem:
 *
 *   Seu processo {{1}} ({{2}}) teve uma movimentação.
 *   Em resumo: {{3}}
 *   Próximo passo: {{4}}
 *   Para alterar seus avisos, acesse sua conta na TechTie.
 *
 * Sem WHATSAPP_CLOUD_TOKEN/WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_TEMPLATE_ANDAMENTO é no-op (mesmo padrão
 * de lib/email.ts). Não usa Baileys: o não oficial fica restrito ao WhatsApp interno do CRM.
 */

const TIMEOUT_MS = 15_000;
// Variável de template não aceita quebra de linha, tab nem mais de 4 espaços seguidos, e o corpo
// inteiro tem teto de 1024 caracteres.
const LIMITE_PARAMETRO = 380;

export interface ResultadoEnvioWhatsApp {
  enviado: boolean;
  erro?: string;
  /** Canal sem credenciais no servidor: não é falha do envio, quem chama não deve contar tentativa. */
  naoConfigurado?: boolean;
  /** Erro que não melhora com nova tentativa (número inválido, template recusado, sem opt-in...). */
  definitivo?: boolean;
  mensagemId?: string;
}

/** Converte o telefone cadastrado para o formato da Cloud API (só dígitos, com DDI 55). null se inválido. */
export function normalizarTelefoneBr(bruto: string | null | undefined): string | null {
  let digitos = (bruto ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  if (!digitos.startsWith('55') || (digitos.length !== 12 && digitos.length !== 13)) return null;
  return digitos;
}

function parametro(texto: string): { type: 'text'; text: string } {
  const limpo = texto.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';
  return { type: 'text', text: limpo.length > LIMITE_PARAMETRO ? `${limpo.slice(0, LIMITE_PARAMETRO - 1).trimEnd()}…` : limpo };
}

export async function enviarAlertaWhatsApp(
  telefone: string,
  processo: { numeroCnj: string; tribunal?: string | null },
  resumo: Pick<ResumoAndamento, 'resumo' | 'proximoPasso'> | null,
  movimentosNovos: Pick<Movement, 'titulo'>[]
): Promise<ResultadoEnvioWhatsApp> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE_ANDAMENTO;
  if (!token || !phoneNumberId || !template) {
    console.log('[whatsapp] WHATSAPP_CLOUD_TOKEN/WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_TEMPLATE_ANDAMENTO não configuradas — no-op:', processo.numeroCnj);
    return { enviado: false, naoConfigurado: true, erro: 'WhatsApp Cloud API não configurada' };
  }

  const destino = normalizarTelefoneBr(telefone);
  if (!destino) return { enviado: false, definitivo: true, erro: 'Telefone inválido para WhatsApp' };

  // Sem resumo de IA (sem chave ou falha), o aviso sai com os títulos das movimentações.
  const textoResumo = resumo?.resumo || movimentosNovos.map(m => m.titulo).filter(Boolean).slice(0, 3).join('; ') || 'Nova movimentação registrada.';
  const textoProximoPasso = resumo?.proximoPasso || 'Acesse sua conta para ver os detalhes.';

  const versao = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://graph.facebook.com/${versao}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destino,
        type: 'template',
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_IDIOMA || 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: [
                parametro(processo.numeroCnj),
                parametro(processo.tribunal || 'Tribunal'),
                parametro(textoResumo),
                parametro(textoProximoPasso)
              ]
            }
          ]
        }
      }),
      signal: controller.signal
    });

    const corpo = (await res.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string; code?: number; error_subcode?: number } }
      | null;

    if (res.ok && corpo?.messages?.[0]?.id) return { enviado: true, mensagemId: corpo.messages[0].id };

    const erro = corpo?.error;
    const mensagem = `${erro?.message || `HTTP ${res.status}`}${erro?.code ? ` (código ${erro.code})` : ''}`;
    // 5xx, 429 e limite de taxa (130429/131048/131056/80007) melhoram com nova tentativa; o resto
    // (parâmetro/template inválido, número sem WhatsApp, token sem permissão) não.
    const transitorio = res.status >= 500 || res.status === 429 || [130429, 131048, 131056, 80007, 131000].includes(erro?.code ?? 0);
    console.error('[whatsapp] falha ao enviar alerta:', processo.numeroCnj, mensagem);
    return { enviado: false, erro: mensagem, definitivo: !transitorio };
  } catch (e) {
    const abortado = e instanceof Error && e.name === 'AbortError';
    const mensagem = abortado ? `Tempo limite de ${TIMEOUT_MS / 1000}s esgotado` : e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[whatsapp] exceção ao enviar alerta:', processo.numeroCnj, mensagem);
    return { enviado: false, erro: mensagem };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envia uma mensagem de texto simples pelo WhatsApp dentro da janela de 24h
 * (ou em resposta direta à mensagem do usuário).
 */
export async function enviarTextoWhatsApp(
  telefone: string,
  texto: string
): Promise<ResultadoEnvioWhatsApp> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.log('[whatsapp] WHATSAPP_CLOUD_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados — no-op envio de texto.');
    return { enviado: false, naoConfigurado: true, erro: 'WhatsApp Cloud API não configurada' };
  }

  const destino = normalizarTelefoneBr(telefone);
  if (!destino) return { enviado: false, definitivo: true, erro: 'Telefone inválido para WhatsApp' };

  const versao = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://graph.facebook.com/${versao}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destino,
        type: 'text',
        text: { preview_url: false, body: texto }
      }),
      signal: controller.signal
    });

    const corpo = (await res.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string; code?: number } }
      | null;

    if (res.ok && corpo?.messages?.[0]?.id) {
      return { enviado: true, mensagemId: corpo.messages[0].id };
    }

    const erro = corpo?.error;
    const mensagem = `${erro?.message || `HTTP ${res.status}`}${erro?.code ? ` (código ${erro.code})` : ''}`;
    console.error('[whatsapp] falha ao enviar texto livre:', destino, mensagem);
    return { enviado: false, erro: mensagem };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[whatsapp] exceção ao enviar texto livre:', destino, mensagem);
    return { enviado: false, erro: mensagem };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Envia uma mensagem com botões interativos de resposta rápida no WhatsApp.
 * A Meta aceita no máximo 3 botões e títulos de até 20 caracteres por botão.
 */
export async function enviarInterativoWhatsApp(
  telefone: string,
  textoCorpo: string,
  botoes: { id: string; title: string }[]
): Promise<ResultadoEnvioWhatsApp> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    return { enviado: false, naoConfigurado: true, erro: 'WhatsApp Cloud API não configurada' };
  }

  const destino = normalizarTelefoneBr(telefone);
  if (!destino) return { enviado: false, definitivo: true, erro: 'Telefone inválido para WhatsApp' };

  const versao = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const botoesFormatados = botoes.slice(0, 3).map((b, idx) => ({
      type: 'reply',
      reply: {
        id: b.id || `btn_${idx}`,
        title: b.title.slice(0, 20)
      }
    }));

    const res = await fetch(`https://graph.facebook.com/${versao}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destino,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: textoCorpo },
          action: { buttons: botoesFormatados }
        }
      }),
      signal: controller.signal
    });

    const corpo = (await res.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string; code?: number } }
      | null;

    if (res.ok && corpo?.messages?.[0]?.id) {
      return { enviado: true, mensagemId: corpo.messages[0].id };
    }

    const erro = corpo?.error;
    const mensagem = `${erro?.message || `HTTP ${res.status}`}${erro?.code ? ` (código ${erro.code})` : ''}`;
    console.error('[whatsapp] falha ao enviar mensagem interativa:', destino, mensagem);
    return { enviado: false, erro: mensagem };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[whatsapp] exceção ao enviar mensagem interativa:', destino, mensagem);
    return { enviado: false, erro: mensagem };
  } finally {
    clearTimeout(timer);
  }
}

