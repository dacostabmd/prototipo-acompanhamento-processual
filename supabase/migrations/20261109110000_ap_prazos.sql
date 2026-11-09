-- Agenda de prazos e tarefas com lembretes (recurso Pro: agendaPrazos).
-- Aditiva e idempotente: pode ser reaplicada sem efeito colateral.
--
-- origem: 'manual' (digitado pelo usuário), 'auto_movimentacao' (extraído de movimentação urgente pelo
-- cron de reconsulta ou pelo botão "Buscar prazos nas minhas movimentações") e 'auto_diario' (reservado
-- para prazos criados a partir de publicações do Diário).
-- origem_hash: dedupe dos prazos automáticos. Índice único (user_id, origem_hash); como NULL é distinto de
-- NULL no Postgres, prazos manuais (sem hash) não colidem e o upsert (onConflict user_id,origem_hash) funciona.
-- lembretes_enviados: [{ "marco": "d-3" | "d-1" | "d0" | "atrasado", "canais": ["whatsapp","email"], "em": "ISO" }]

create table if not exists public.ap_prazos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  processo_id uuid references public.ap_processos(id) on delete set null,
  numero_cnj text,
  titulo text not null check (char_length(titulo) between 1 and 300),
  descricao text,
  tipo text not null default 'prazo' check (tipo in ('prazo', 'tarefa', 'audiencia')),
  data_vencimento date not null,
  concluido boolean not null default false,
  concluido_em timestamptz,
  origem text not null default 'manual' check (origem in ('manual', 'auto_movimentacao', 'auto_diario')),
  origem_hash text,
  lembretes_enviados jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ap_prazos_user_vencimento_idx
  on public.ap_prazos (user_id, data_vencimento);

-- Cron de lembretes: só prazos pendentes, por data de vencimento.
create index if not exists ap_prazos_cron_idx
  on public.ap_prazos (data_vencimento)
  where concluido = false;

create unique index if not exists ap_prazos_user_origem_hash_uidx
  on public.ap_prazos (user_id, origem_hash);

alter table public.ap_prazos enable row level security;

drop policy if exists ap_prazos_owner on public.ap_prazos;
create policy ap_prazos_owner on public.ap_prazos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.ap_prazos is
  'Agenda de prazos, tarefas e audiências do usuário, com lembretes por WhatsApp/e-mail (cron lembretes-prazos).';
