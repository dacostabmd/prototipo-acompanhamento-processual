// API HTTP mínima deste serviço. Escolhido Express (não Fastify) porque o serviço só expõe 2 rotas
// simples + 1 chamada de saída (webhook) — Express é mais onipresente, tem menos configuração de
// schema/plugins do que Fastify, e aqui não há nenhum requisito de performance que justifique a
// escolha mais especializada do Fastify.

import 'dotenv/config';
import express from 'express';
import { timingSafeEqual } from 'crypto';
import { iniciarConexaoWhatsapp, enviarMensagem, getStatusConexao, setOnMensagemRecebida } from './baileys.js';

const PORT = process.env.PORT || 3333;
const SERVICE_TOKEN = process.env.WHATSAPP_SERVICE_TOKEN || '';
const WEBHOOK_URL = process.env.WHATSAPP_WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || '';

const app = express();
app.use(express.json());

/** Comparação de tempo constante para o Bearer token (mesmo padrão usado no cron do Next.js). */
function autorizado(req) {
  const auth = req.headers['authorization'] || '';
  const esperado = SERVICE_TOKEN ? `Bearer ${SERVICE_TOKEN}` : '';
  if (!esperado) return false;
  const bufA = Buffer.from(auth);
  const bufB = Buffer.from(esperado);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

app.post('/enviar', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ enviado: false, erro: 'Não autorizado.' });

  const { numero, mensagem } = req.body || {};
  if (!numero || !mensagem) {
    return res.status(400).json({ enviado: false, erro: 'numero e mensagem são obrigatórios.' });
  }

  const resultado = await enviarMensagem(numero, mensagem);
  return res.status(resultado.enviado ? 200 : 502).json(resultado);
});

app.get('/status', (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ conectado: false, erro: 'Não autorizado.' });
  const { conectado, numeroConectado } = getStatusConexao();
  return res.json({ conectado, ...(numeroConectado ? { numeroConectado } : {}) });
});

/**
 * Repassa uma mensagem recebida do WhatsApp para o webhook do Next.js. Nunca lança — uma falha de
 * rede no Prosec não pode derrubar a conexão Baileys, só fica registrada no log deste serviço.
 */
async function encaminharParaWebhook(payload) {
  if (!WEBHOOK_URL) {
    console.warn('[server] WHATSAPP_WEBHOOK_URL não configurada — mensagem recebida não foi encaminhada:', payload.numero);
    return;
  }
  try {
    const resposta = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WEBHOOK_SECRET}`
      },
      body: JSON.stringify(payload)
    });
    if (!resposta.ok) {
      console.error(`[server] webhook do Next.js respondeu ${resposta.status} ao encaminhar mensagem recebida.`);
    }
  } catch (e) {
    console.error('[server] falha ao encaminhar mensagem recebida para o webhook do Next.js:', e);
  }
}

setOnMensagemRecebida(encaminharParaWebhook);

if (!SERVICE_TOKEN) {
  console.warn('[server] WHATSAPP_SERVICE_TOKEN não configurado — /enviar e /status vão recusar toda requisição até ele ser definido.');
}

app.listen(PORT, () => {
  console.log(`[server] Serviço WhatsApp (Baileys) ouvindo na porta ${PORT}.`);
});

iniciarConexaoWhatsapp().catch(e => {
  console.error('[server] falha fatal ao iniciar conexão Baileys:', e);
  process.exit(1);
});
