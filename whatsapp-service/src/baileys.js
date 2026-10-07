// Núcleo da conexão Baileys (WhatsApp Web). Mantém um socket de longa duração — por isso este
// serviço roda como processo Node separado no VPS do escritório, fora da Vercel (serverless não
// sustenta WebSocket de longa duração nem disco persistente entre invocações).
//
// Decisão: JavaScript puro (ESM), sem TypeScript/build step neste serviço. É um projeto pequeno e
// isolado, implantado diretamente no VPS via `npm install && npm start` — adicionar um passo de
// compilação (tsc/ts-node) só pra isso seria complexidade desnecessária no ambiente de produção do
// escritório, que não tem a mesma esteira de CI/CD da Vercel usada pelo Next.js.
//
// Pacote: `baileys` (não `@whiskeysockets/baileys`) — o pacote sob o escopo @whiskeysockets foi
// descontinuado/renomeado pelos mantenedores; o pacote `baileys` no npm é o fork ativo mantido pela
// mesma organização WhiskeySockets. Confirmar a versão mais recente em npmjs.com/package/baileys
// antes de implantar, já que a lib muda rápido (engenharia reversa do WhatsApp Web).

import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH || './sessao-whatsapp';

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'warn' });

let socketAtual = null;
let conectado = false;
let numeroConectado = null;

/** Callback injetado pelo server.js para repassar mensagens recebidas ao webhook do Next.js. */
let onMensagemRecebida = () => {};

export function setOnMensagemRecebida(callback) {
  onMensagemRecebida = callback;
}

export function getStatusConexao() {
  return { conectado, numeroConectado };
}

/**
 * Inicializa (ou reinicializa, em caso de queda) a conexão Baileys. useMultiFileAuthState é o
 * padrão oficial da lib para persistir credenciais de sessão em disco — assim o pareamento via QR
 * code só precisa ser feito uma vez; reinícios do processo reaproveitam a sessão salva em
 * WHATSAPP_SESSION_PATH.
 */
export async function iniciarConexaoWhatsapp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // QR tratado manualmente abaixo (qrcode-terminal), evita warning de depreciação
    browser: ['Prosec CRM', 'Chrome', '1.0.0']
  });

  socketAtual = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[whatsapp] Escaneie o QR code abaixo com o WhatsApp que vai representar a comunicação interna do escritório:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      conectado = true;
      numeroConectado = sock.user?.id?.split(':')[0] ?? null;
      console.log(`[whatsapp] Conectado com sucesso. Número: ${numeroConectado ?? 'desconhecido'}`);
    }

    if (connection === 'close') {
      conectado = false;
      numeroConectado = null;
      const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : undefined;
      const deslogado = statusCode === DisconnectReason.loggedOut;

      // Reconexão automática: Baileys cai periodicamente (idle do WhatsApp Web, rede, etc.) — isso é
      // esperado e documentado pela própria lib. Só NÃO tenta reconectar se o motivo foi logout
      // explícito (sessão invalidada), caso em que é preciso escanear o QR code de novo.
      if (deslogado) {
        console.error('[whatsapp] Sessão desconectada (logout). Apague a pasta de sessão e reinicie o serviço para parear novamente.');
      } else {
        console.warn('[whatsapp] Conexão perdida, reconectando em 3s...', statusCode ?? '');
        setTimeout(() => {
          iniciarConexaoWhatsapp().catch(e => console.error('[whatsapp] falha ao reconectar:', e));
        }, 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue; // só repassa mensagens recebidas, não ecoa as que o próprio serviço envia
      const numero = msg.key.remoteJid?.split('@')[0];
      const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        null;
      if (!numero || !texto) continue; // ignora mídia sem legenda, reações, etc. (fora de escopo desta fase)

      try {
        await onMensagemRecebida({ numero, mensagem: texto, timestamp: (msg.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000 });
      } catch (e) {
        console.error('[whatsapp] falha ao repassar mensagem recebida ao webhook:', e);
      }
    }
  });

  return sock;
}

/** Envia uma mensagem de texto simples para um número (formato internacional, só dígitos, ex: 5511999998888). */
export async function enviarMensagem(numero, mensagem) {
  if (!socketAtual || !conectado) {
    return { enviado: false, erro: 'WhatsApp não conectado.' };
  }
  try {
    const jid = `${numero.replace(/\D/g, '')}@s.whatsapp.net`;
    await socketAtual.sendMessage(jid, { text: mensagem });
    return { enviado: true };
  } catch (e) {
    return { enviado: false, erro: e instanceof Error ? e.message : 'erro desconhecido ao enviar' };
  }
}
