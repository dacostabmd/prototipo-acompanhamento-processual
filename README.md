# Blindagem Financeira — Acompanhamento de Processos (Next.js)

Exportação fiel do protótipo em Next.js 15 (App Router, React 19, TypeScript). Os estilos foram
mantidos **inline**, com os mesmos valores do protótipo, para fidelidade visual 1:1. Só o que não
pode ser inline (reset, `@keyframes`, fonte) está em `app/globals.css` / `app/layout.tsx`.

## Rodando

```bash
npm install
cp .env.example .env.local   # preencha ANTHROPIC_API_KEY
npm run dev
```

Abre em `http://localhost:3000`.

## Estrutura

```
app/
  layout.tsx              fonte Poppins (next/font) + metadata
  globals.css             reset, ::placeholder, links, @keyframes das animações
  page.tsx                monta <ProcessTracker />
  api/processos/route.ts  consulta real de processos (Infosimples)
  api/ai/summary/route.ts resumo do andamento processual (OpenAI / Anthropic)
  api/ai/chat/route.ts    chat de triagem jurídica (OpenAI / Anthropic)
components/
  ProcessTracker.tsx      tela única: busca, timeline, resumo IA, WhatsApp, modais
  GhostFibers.tsx         fundo animado WebGL (shader, via ogl)
lib/
  format.ts               máscaras CPF/telefone, validação de CPF (mod 11), normalização de nome
  mockProcesses.ts        dados mockados + montagem da timeline + TAG_META
public/
  blindagem-logo.png      logo em PNG com fundo transparente
```

## Design tokens

| Token | Valor | Uso |
| --- | --- | --- |
| Azul da marca | `#2455b8` | cabeçalho, faixa do cliente, botões primários, bordas de destaque |
| Azul claro | `#a9c3ef` | rótulos sobre azul |
| Azul hover/link | `#17347a` | `a:hover` |
| Quase preto | `#0b0b0d` | fundo base da página (atrás do shader) |
| Papel | `#ffffff` | cards e "papel" dos resultados |
| Creme | `#f5f2ea` / `#f5efe1` | fundo do chat / texto sobre azul |
| Borda | `#e3ddd0` | bordas de cards e divisores |
| Input | borda `#d7d0c0`, fundo `#fbf9f4` | campos de formulário |
| Texto | `#1b2733` (corpo), `#000000` (títulos/rótulos), `#5b6b78` (secundário) | |
| Erro | `#8a3a3a` | mensagens de validação |
| WhatsApp | `#25603f` | botão de envio por WhatsApp |
| Status | urgente `#8a3a3a`, andamento `#3a6b8a`, informativo `#4a5a6a`, favorável `#4a7a5c` | pontos e etiquetas da timeline |

Tipografia: **Poppins** (300/400/500/600/700) em todo o sistema.
Escalas fluidas: `clamp(20px,5vw,25px)` no H1, `clamp(10px,2.4vw,12px)` no subtítulo do header,
paddings `clamp(...)` no header, cards e main (responsivo sem media queries).

## Animações (`app/globals.css`)

| Nome | Uso |
| --- | --- |
| `bf-spin` | spinner (anel incompleto) abaixo do botão de consulta |
| `bf-fadein` | entrada do painel de resultados (0.7s ease) |
| `bf-letter-fade` | letras do texto de carregamento sumindo em fade-out (1.9s, delay `i * 0.035s`) |
| `bf-wave-sweep` | onda azul translúcida (`mix-blend-mode: multiply`) varrendo as letras |
| `bf-blink` | indicador "Digitando..." no chat |

Transições inline: expansão dos nós da timeline (`max-height 0.35s ease`, 0 → 600px), modais
(`opacity 0.3s` + `transform scale(0.94 → 1)`).

## Fluxo e comportamento

1. **Busca** — nome completo (normalizado no blur, com `de/da/do/das/dos/e` minúsculos), CPF com
   máscara e validação real (dígitos verificadores mod 11) e telefone com máscara BR. Validações
   exibem mensagem única abaixo do botão. Delay simulado de 900ms com spinner.
2. **Resultado (mock)** — o protótipo **sempre** retorna os 3 processos de `lib/mockProcesses.ts`.
   O ramo "nenhum processo localizado" existe no componente (`notFound`) e é o caminho a ligar
   quando a API real responder vazio.
3. **Timeline** — movimentos de todos os processos achatados e ordenados por data (mais recente
   primeiro). Clique no card expande os detalhes com transição suave.
4. **Resumo por IA** — `POST /api/ai/summary`; o loading fica no ar por **no mínimo 3 segundos**
   (requisito de prototipação) para a animação de ondas + letras ser vista.
5. **Envio por WhatsApp** — hoje é mock de 900ms; ponto de integração marcado com `TODO(dev)`.
6. **Auxílio jurídico** — o botão abre primeiro um **modal informativo** e, no "Continuar", o
   **modal do chat** (525px, 80vh) com o assistente de triagem (`POST /api/ai/chat`), anexo de
   arquivos (apenas nomes, sem upload) e "Finalizar e enviar dossiê ao advogado", que encerra a
   conversa com a mensagem de confirmação.

## O que ainda é mock (pontos de integração)

- **Infosimples**: integrado via `app/api/processos/route.ts` (token seguro no servidor, busca real por CPF via endpoint `tribunal/tjsp/primeiro-grau`).
- **WhatsApp**: `sendWhatsapp()` em `ProcessTracker.tsx` → WhatsApp Cloud API com template aprovado.
- **Upload de documentos**: o input de arquivos guarda só os nomes; falta storage (S3/UploadThing)
  e anexar os arquivos ao dossiê.
- **Dossiê ao advogado**: `finalizeChat()` apenas confirma na conversa; falta persistir o caso
  (cliente, CPF, telefone, processos, resumo de IA, transcrição do chat, arquivos) e notificar o
  advogado parceiro.
- **Persistência / auth**: não há banco nem sessão; todo o estado é local ao componente.

## Props do componente

`<ProcessTracker aiModel="claude-haiku-4-5" chatTone="Acolhedor" />`

- `aiModel`: `claude-haiku-4-5` | `claude-sonnet-4-5`
- `chatTone`: `Acolhedor` | `Formal` (ajusta o system prompt da triagem)

## Observações

- `GhostFibers.tsx` é o componente que você enviou, sem alterações além de `'use client'` e do
  `position:absolute; inset:0` no container. Requer `ogl` e WebGL2; respeita
  `prefers-reduced-motion` e pausa fora da viewport.
- A logo em `public/blindagem-logo.png` foi gerada a partir do arquivo enviado, com o fundo azul
  removido (chroma key) para uso sobre qualquer cor.
