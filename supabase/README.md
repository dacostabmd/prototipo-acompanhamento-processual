# Supabase — Acompanhamento Processual

Projeto: `dacmowumnuzjrvzdfeff`.

**Atenção:** este projeto já hospeda outro sistema (chat/RAG, leads, Bitrix, `usuarios`, `auditoria`…),
com dados reais. Todas as tabelas daqui usam o prefixo `ap_` e **nenhuma tabela existente é alterada**.

## Modelo

| Tabela | Função |
|---|---|
| `ap_perfis` | 1:1 com `auth.users` (nome, CPF, telefone, papel). Criado por trigger no cadastro. |
| `ap_processos` | Processos monitorados por usuário (`unique (user_id, numero_cnj)`). |
| `ap_movimentacoes` | Andamentos de cada processo; `hash` evita duplicar na sincronização. |
| `ap_resumos_ia` | Resumos gerados pela IA, com o modelo e até qual andamento cobrem. |
| `ap_consultas` | Histórico de consultas (hash do termo, nunca o CPF em claro). |

RLS ativa em todas: cada usuário só enxerga o que é dele (`auth.uid()`).

## Aplicar

```bash
supabase link --project-ref dacmowumnuzjrvzdfeff
supabase db push
```

Migrações em `supabase/migrations/`.

## Tracking e auditoria

- `ap_eventos` (versionada por `schema_version`): login, logout, consulta, resumo/chat IA… com assunto do processo, dia e hora (fuso America/Sao_Paulo). Base do painel admin (view `ap_dashboard_v1`).
- `ap_auditoria`: uma linha por requisição autenticada às rotas `/api/*`.
- Escrita só pelo servidor (`SUPABASE_SECRET_KEY`); leitura: admin vê tudo, usuário vê os próprios eventos.

## Admin mockado

`seed_admin.sql` (fora do Git) cria `admin@blindagemfinanceira.com.br` com papel `admin`. Rode após a migração e troque a senha.
