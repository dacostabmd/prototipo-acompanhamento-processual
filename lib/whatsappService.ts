// Cliente HTTP fino para o serviço Baileys (whatsapp-service/, processo Node separado rodando fora
// da Vercel, no VPS do escritório). Sem WHATSAPP_SERVICE_URL configurada, todo chamador cai em no-op
// silencioso — mesmo padrão de lib/email.ts (sem RESEND_API_KEY) e lib/redis.ts (sem UPSTASH_*).

let avisoNoOpEmitido = false;

function getConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.WHATSAPP_SERVICE_URL;
  const token = process.env.WHATSAPP_SERVICE_TOKEN;
  if (!baseUrl || !token) {
    if (!avisoNoOpEmitido) {
      console.log('[whatsappService] WHATSAPP_SERVICE_URL/WHATSAPP_SERVICE_TOKEN não configuradas — no-op (WhatsApp interno desativado).');
      avisoNoOpEmitido = true;
    }
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

/**
 * Envia uma mensagem de WhatsApp interno via serviço Baileys. Sem o serviço configurado, retorna
 * { enviado: false } sem lançar erro — nunca deve derrubar quem chama.
 */
export async function enviarMensagemWhatsapp(numero: string, mensagem: string): Promise<{ enviado: boolean; erro?: string }> {
  const config = getConfig();
  if (!config) return { enviado: false, erro: 'Serviço de WhatsApp não configurado.' };

  try {
    const resposta = await fetch(`${config.baseUrl}/enviar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`
      },
      body: JSON.stringify({ numero, mensagem })
    });

    const data = await resposta.json().catch(() => null);
    if (!resposta.ok || !data?.enviado) {
      const erro = data?.erro ?? `Serviço respondeu ${resposta.status}`;
      console.error('[whatsappService] falha ao enviar mensagem:', erro);
      return { enviado: false, erro };
    }
    return { enviado: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[whatsappService] exceção ao enviar mensagem:', msg);
    return { enviado: false, erro: msg };
  }
}

/** Consulta o status da conexão Baileys (conectado/número). Sem o serviço configurado, retorna conectado:false. */
export async function consultarStatusWhatsapp(): Promise<{ conectado: boolean; numeroConectado?: string; erro?: string }> {
  const config = getConfig();
  if (!config) return { conectado: false, erro: 'Serviço de WhatsApp não configurado.' };

  try {
    const resposta = await fetch(`${config.baseUrl}/status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}` }
    });
    const data = await resposta.json().catch(() => null);
    if (!resposta.ok || !data) {
      return { conectado: false, erro: `Serviço respondeu ${resposta.status}` };
    }
    return { conectado: Boolean(data.conectado), numeroConectado: data.numeroConectado };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[whatsappService] exceção ao consultar status:', msg);
    return { conectado: false, erro: msg };
  }
}
