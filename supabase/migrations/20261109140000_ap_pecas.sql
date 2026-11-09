-- Modelos de peças jurídicas com IA (Plano Pro): histórico das minutas geradas, com a entrada usada e o custo em tokens.
-- Aditiva e idempotente: pode ser aplicada mais de uma vez. O código tolera a tabela ausente (gera sem salvar).

create table if not exists public.ap_pecas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,                       -- id do modelo (contestacao, replica, apelacao, ...), definido em lib/pecas/modelos.ts
  titulo text not null,
  processo_numero text,                     -- CNJ do processo da conta usado como contexto (opcional)
  entrada jsonb not null default '{}'::jsonb, -- campos preenchidos, processo, tema e julgados entregues ao modelo
  conteudo text not null,                   -- minuta: aviso fixo + seções "## Título"
  modelo text,                              -- modelo de IA que respondeu (gpt-4o ou fallback Claude)
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ap_pecas_user_idx on public.ap_pecas (user_id, created_at desc);

alter table public.ap_pecas enable row level security;

drop policy if exists ap_pecas_owner on public.ap_pecas;
create policy ap_pecas_owner on public.ap_pecas
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.ap_pecas is
  'Histórico de minutas de peças geradas por IA (Plano Pro). Escrita pelo servidor; leitura e edição restritas ao dono.';
