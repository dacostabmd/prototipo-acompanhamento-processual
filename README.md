# Prosec — Acompanhamento Processual Inteligente

Sistema completo de consulta, tradução e inteligência sobre processos judiciais brasileiros (Next.js 15, React 19, TypeScript, Supabase, Redis Upstash e integrações com IA / DataJud / Infosimples / Bitrix24).

---

## 📌 Visão Geral

O **Prosec** resolve o problema da dispersão de dados processuais no Brasil. Em vez de consultar dezenas de sites de tribunais manualmente (cada um com layout, login e captcha distintos), o sistema:

1. **Busca por Número CNJ (Direta e Gratuita)**: Identifica automaticamente a Justiça e Tribunal (27 TJs, TRFs 1–6, TRTs 1–24, STJ, STF, TST, TSE) via [`lib/cnj.ts`](file:///d:/projetos/Andamento%20Processual/Prosec/lib/cnj.ts) e consulta diretamente a API pública do **DataJud (CNJ)** sem custo por chamada.
2. **Varredura Multi-Tribunal por CPF**: Consulta 14 bases judiciais em paralelo via **Infosimples** com streaming em tempo real (NDJSON) e cancelamento sob demanda.
3. **Enriquecimento Oficial (DataJud CNJ)**: Complementa processos encontrados com assuntos da Tabela Processual Unificada (TPU), órgão julgador, grau e histórico de movimentações.
4. **Classificação Automática de Riscos**: Categoriza cada evento em `urgente` (penhora, bloqueio Sisbajud, leilão, execução), `positivo` (deferimento, procedência, arquivamento), `andamento` ou `informativo`.
5. **Resumo Executivo por IA**: Gera síntese clara em português acessível via OpenAI (com fallback para Anthropic Claude).
6. **Chat Jurídico Especializado**: Assistente de triagem contextualizado nos processos retornados.
7. **Perfis de Acesso**: Separação clara entre perfil **Advogado** (busca livre e gestão de múltiplos processos) e **Consultante** (travado no próprio CPF/CNPJ de cadastro).
8. **Captura de Lead (Bitrix24)**: Envio de leads comerciais ao CRM Bitrix24 via webhook.

---

## 🚀 Como Executar

### Pré-requisitos
* Node.js 18+ ou 20+
* Variáveis de ambiente configuradas em `.env.local`

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env.local

# 3. Iniciar o servidor de desenvolvimento
npm run dev
```

Acesse em `http://localhost:3000`.

---

## 🔐 Variáveis de Ambiente (`.env.local`)

| Variável | Descrição |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anônima do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço (backend) do Supabase |
| `DATAJUD_API_KEY` | Chave pública da API do DataJud (CNJ) |
| `INFOSIMPLES_API_TOKEN` | Token da API da Infosimples (consultas por CPF) |
| `OPENAI_API_KEY` | Chave OpenAI para resumos e chat (gpt-4o-mini) |
| `ANTHROPIC_API_KEY` | Chave Anthropic Claude (fallback de IA) |
| `UPSTASH_REDIS_REST_URL` | URL REST do Upstash Redis (cache de leitura) |
| `UPSTASH_REDIS_REST_TOKEN` | Token do Upstash Redis |
| `BITRIX24_WEBHOOK_URL` | Webhook de integração do Bitrix24 |

---

## 🏗️ Estrutura do Repositório

```
app/
  (app)/                     Rotas autenticadas dentro do shell
    consulta/                Tela principal de consulta e acompanhamento
    processos/               Tabela 'Meus processos' com cache Redis e filtros
    perfil/                  Dados do usuário e documento travado
  api/
    processos/route.ts       Varredura multi-tribunal (NDJSON) + Busca CNJ DataJud
    processos/cancelar/      Cancelamento em tempo real de tribunal na varredura
    processos/listar/        Listagem com cache Redis (Upstash)
    ai/summary/route.ts      Resumo executivo por IA (OpenAI / Claude)
    ai/chat/route.ts         Chat contextualizado nos processos
components/
  AppShellLayout.tsx         Shell autenticado dark/glass com sidebar retrátil
  ProcessTracker.tsx         Stepper de busca em 4 passos e tela de scanning
  ProcessResultView.tsx      Tela de resultados (cards, resumo IA, timeline, chat)
  GhostFibers.tsx            Fundo animado WebGL/Shader persistente
lib/
  cnj.ts                     Parser CNJ de 20 dígitos (identificação de Justiça/Tribunal)
  datajud.ts                 Cliente HTTP da API pública do DataJud (CNJ)
  infosimplesPricing.ts      Cálculo do custo real por tribunal da Infosimples
  redis.ts                   Cliente Upstash Redis com TTL e invalidação
  classify.ts                Classificação de movimentações por risco (tags)
  format.ts                  Máscaras e validações (CPF, CNPJ, CNJ, telefone)
  track.ts                   Auditoria e tracking de eventos de negócio
supabase/
  migrations/                Migrations SQL versionadas do Supabase
```

---

## 📊 Roadmap e Checklist de Features

Consulte sempre [`roadmap.json`](file:///d:/projetos/Andamento%20Processual/Prosec/roadmap.json) e [`para_entender_o_projeto.json`](file:///d:/projetos/Andamento%20Processual/Prosec/para_entender_o_projeto.json) na raiz do projeto para o checklist atualizado de funcionalidades implementadas e pendentes.
