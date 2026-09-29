-- Processos pesquisados por usuário, com hash identificador (sha256 de user_id:numero_cnj).
-- Escrita só pelo servidor (service role); leitura pelo próprio usuário.
create table public.ap_processos_pesquisados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hash text not null unique,
  numero_cnj text not null,
  tribunal text,
  classe text,
  assunto text,
  parte_passiva text,
  ultima_movimentacao_em timestamptz,
  dados_brutos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, numero_cnj)
);
create index ap_proc_pesq_user_idx on public.ap_processos_pesquisados (user_id, created_at desc);
alter table public.ap_processos_pesquisados enable row level security;
create policy ap_proc_pesq_owner on public.ap_processos_pesquisados
  for select to authenticated using (user_id = (select auth.uid()));
