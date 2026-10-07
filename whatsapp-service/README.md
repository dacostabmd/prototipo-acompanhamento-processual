# Prosec WhatsApp Service

Serviço Node **separado** do Next.js (Prosec), implantado diretamente no VPS próprio do escritório —
**não roda na Vercel**. Mantém uma conexão WebSocket de longa duração com o WhatsApp Web via
[`baileys`](https://www.npmjs.com/package/baileys) e persiste credenciais de sessão em disco, duas
características incompatíveis com funções serverless (sem estado entre invocações, timeout curto).

Serve exclusivamente para **comunicação interna** (advogados/departamentos conversando de dentro do
CRM). O alerta ao cliente final sobre movimentação processual já existe, é feito por e-mail via
Resend (Fases 2/3) e **não usa Baileys**.

## AVISO IMPORTANTE — leia antes de usar em produção

**Baileys não é a API oficial do WhatsApp Business.** É uma biblioteca de engenharia reversa do
protocolo do WhatsApp Web (como o próprio WhatsApp Web funciona no navegador, só que automatizado).
Isso significa:

- **Risco real de banimento do número** usado por este serviço. O WhatsApp pode banir números que
  detecta como automatizados, especialmente com volume alto de mensagens, mensagens para muitos
  destinatários novos em sequência, ou padrões de envio repetitivos (spam).
- Este risco **não é hipotético**: o Bitrix24 real do escritório (mapeado durante o desenvolvimento
  deste CRM) já tem uma tela dedicada de **"controle de números de WhatsApp banidos"** — ou seja, é
  um risco operacional já conhecido e vivido pelo negócio com outras ferramentas de automação de
  WhatsApp, não uma preocupação teórica trazida por este projeto.
- Mitigação prática: use um número dedicado à comunicação interna (não o número principal de
  atendimento ao cliente), evite envio em massa/broadcast, evite mensagens idênticas para muitos
  números em curto intervalo, e trate eventuais desconexões forçadas pelo WhatsApp como esperadas
  (não é bug deste serviço).
- Não há SLA, suporte oficial ou garantia de estabilidade — a Meta pode mudar o protocolo do
  WhatsApp Web a qualquer momento e quebrar a biblioteca até que ela seja atualizada rio acima.

Use por sua conta e risco, ciente desse cenário.

## Por que o pacote `baileys` (e não `@whiskeysockets/baileys`)

O pacote historicamente publicado como `@whiskeysockets/baileys` foi descontinuado pelos mantenedores
e o desenvolvimento ativo migrou para o pacote `baileys` (mesma organização WhiskeySockets, mesmo
projeto). Antes de instalar em produção, confira a versão mais recente em
https://www.npmjs.com/package/baileys — a lib evolui rápido justamente por depender de engenharia
reversa de um protocolo que a Meta não documenta nem estabiliza publicamente.

## Por que JavaScript puro (não TypeScript) neste serviço

Este é um serviço pequeno e isolado, implantado diretamente no VPS via `npm install && npm start`,
sem a esteira de CI/CD que o Next.js tem na Vercel. Adicionar TypeScript exigiria um passo de build
(`tsc`) a mais para manter e depurar em produção num ambiente mais artesanal — não compensa para um
serviço de ~2 arquivos fonte. Se o serviço crescer, migrar para TS depois é uma tarefa pequena.

## Por que Express (não Fastify)

O serviço expõe só 2 rotas HTTP de entrada (`POST /enviar`, `GET /status`) e faz 1 chamada de saída
(webhook). Express é mais onipresente e exige menos configuração (sem schemas de validação, plugins,
etc.) do que Fastify — aqui não há volume de tráfego nem requisito de performance que justifique a
escolha mais especializada do Fastify.

## Como rodar localmente

```bash
cd whatsapp-service
cp .env.example .env
# edite o .env com os valores reais (WHATSAPP_SERVICE_TOKEN, WHATSAPP_WEBHOOK_URL, WHATSAPP_WEBHOOK_SECRET)
npm install
npm start
```

## Pareamento inicial (primeira execução)

1. Rode `npm start`.
2. Um QR code vai aparecer **no terminal** (via `qrcode-terminal`).
3. Abra o WhatsApp no celular que vai representar a "comunicação interna" do escritório → **Aparelhos
   conectados** → **Conectar um aparelho** → escaneie o QR code exibido no terminal.
4. Após parear, as credenciais de sessão ficam salvas em `WHATSAPP_SESSION_PATH` (padrão
   `./sessao-whatsapp/`). Reinícios subsequentes do processo reaproveitam essa sessão — **não** é
   necessário escanear de novo, a menos que a sessão seja deslogada (ver abaixo) ou a pasta seja
   apagada.
5. Se o log mostrar `Sessão desconectada (logout)`, apague a pasta de `WHATSAPP_SESSION_PATH` e rode
   `npm start` novamente para gerar um novo QR code.

Reconexões de rede comuns (quedas periódicas do WhatsApp Web, esperado pela própria biblioteca) são
tratadas automaticamente — o serviço tenta reconectar sozinho, sem precisar de novo QR code.

## Variáveis de ambiente

Ver `.env.example` nesta pasta para a lista completa com comentários. Resumo:

| Variável | Propósito |
|---|---|
| `PORT` | Porta HTTP deste serviço (padrão 3333). |
| `WHATSAPP_SERVICE_TOKEN` | Token Bearer que o Next.js deve enviar para chamar `/enviar` e `/status`. |
| `WHATSAPP_SESSION_PATH` | Pasta onde a sessão do Baileys é persistida em disco. |
| `WHATSAPP_WEBHOOK_URL` | URL do endpoint do Next.js que recebe mensagens recebidas (`/api/whatsapp/webhook`). |
| `WHATSAPP_WEBHOOK_SECRET` | Segredo Bearer enviado em cada chamada ao webhook acima. |
| `WHATSAPP_LOG_LEVEL` | Nível de log do Baileys/pino (padrão `warn`). |

## API HTTP

### `POST /enviar`
Header: `Authorization: Bearer <WHATSAPP_SERVICE_TOKEN>`
Body: `{ "numero": "5511999998888", "mensagem": "texto" }`
Resposta: `{ "enviado": true }` ou `{ "enviado": false, "erro": "..." }`

### `GET /status`
Header: `Authorization: Bearer <WHATSAPP_SERVICE_TOKEN>`
Resposta: `{ "conectado": true, "numeroConectado": "5511999998888" }`

### Webhook de saída (mensagens recebidas)
Este serviço faz `POST` para `WHATSAPP_WEBHOOK_URL` com header
`Authorization: Bearer <WHATSAPP_WEBHOOK_SECRET>` e body:
```json
{ "numero": "5511988887777", "mensagem": "texto recebido", "timestamp": 1735689600000 }
```

## Escopo desta tarefa

Este README e o código foram escritos sem instalar dependências (`npm install` não foi executado) e
sem parear com um WhatsApp real — não há número de teste disponível nesta etapa. A validação de que o
serviço realmente conecta, envia e recebe mensagens fica para quando o escritório disponibilizar o
VPS e um número de WhatsApp dedicado.
