-- Acompanhamento Processual — modelagem inicial.
-- Prefixo ap_ para não colidir com as tabelas de outros sistemas que já usam este projeto Supabase.
-- Tudo isolado por usuário via RLS (auth.uid()).

create extension if not exists citext;

-- ── Perfis (1:1 com auth.users) ─────────────────────────────────────────────
create table public.ap_perfis (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  email       citext,
  cpf         text check (cpf is null or cpf ~ '^\d{11}$'),
  telefone    text,
  role        text not null default 'cliente' check (role in ('cliente', 'advogado', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.ap_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ap_perfis (id, nome, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger ap_on_auth_user_created
  after insert on auth.users
  for each row execute function public.ap_handle_new_user();

-- ── Processos monitorados ───────────────────────────────────────────────────
create table public.ap_processos (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  numero_cnj               text not null check (numero_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'),
  tribunal                 text,
  uf                       char(2),
  classe                   text,
  assunto                  text,
  valor_causa              numeric(16,2),
  parte_ativa              text,
  parte_passiva            text,
  status                   text not null default 'ativo' check (status in ('ativo', 'suspenso', 'arquivado', 'baixado')),
  ultima_movimentacao_em   timestamptz,
  dados_brutos             jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, numero_cnj)
);
create index ap_processos_user_idx on public.ap_processos (user_id, ultima_movimentacao_em desc);

-- ── Movimentações (andamentos) ──────────────────────────────────────────────
create table public.ap_movimentacoes (
  id           uuid primary key default gen_random_uuid(),
  processo_id  uuid not null references public.ap_processos(id) on delete cascade,
  data         timestamptz not null,
  tipo         text,
  descricao    text not null,
  hash         text not null,            -- dedupe na sincronização
  dados_brutos jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (processo_id, hash)
);
create index ap_movimentacoes_proc_idx on public.ap_movimentacoes (processo_id, data desc);

-- ── Resumos gerados por IA ──────────────────────────────────────────────────
create table public.ap_resumos_ia (
  id                  uuid primary key default gen_random_uuid(),
  processo_id         uuid not null references public.ap_processos(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  modelo              text not null,
  conteudo            text not null,
  movimentacoes_ate   timestamptz,        -- até qual andamento o resumo cobre
  created_at          timestamptz not null default now()
);
create index ap_resumos_proc_idx on public.ap_resumos_ia (processo_id, created_at desc);

-- ── Histórico de consultas (auditoria / controle de cota) ───────────────────
create table public.ap_consultas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  tipo        text not null check (tipo in ('cpf', 'cnj')),
  termo_hash  text not null,              -- hash do CPF/CNJ, nunca o valor em claro
  total       integer not null default 0,
  created_at  timestamptz not null default now()
);
create index ap_consultas_user_idx on public.ap_consultas (user_id, created_at desc);

-- ── updated_at automático ───────────────────────────────────────────────────
create or replace function public.ap_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger ap_perfis_touch    before update on public.ap_perfis    for each row execute function public.ap_touch_updated_at();
create trigger ap_processos_touch before update on public.ap_processos for each row execute function public.ap_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.ap_perfis        enable row level security;
alter table public.ap_processos     enable row level security;
alter table public.ap_movimentacoes enable row level security;
alter table public.ap_resumos_ia    enable row level security;
alter table public.ap_consultas     enable row level security;

create policy ap_perfis_self on public.ap_perfis
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy ap_processos_owner on public.ap_processos
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy ap_movimentacoes_owner on public.ap_movimentacoes
  for all to authenticated
  using (exists (select 1 from public.ap_processos p where p.id = processo_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.ap_processos p where p.id = processo_id and p.user_id = (select auth.uid())));

create policy ap_resumos_owner on public.ap_resumos_ia
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy ap_consultas_owner on public.ap_consultas
  for select to authenticated using (user_id = (select auth.uid()));
-- inserts em ap_consultas só pelo servidor (service role).

-- ── Tracking de eventos de negócio (alimenta o painel admin) ────────────────
-- schema_version permite evoluir o formato de `dados` sem quebrar o dashboard.
create table public.ap_eventos (
  id              uuid primary key default gen_random_uuid(),
  schema_version  smallint not null default 1,
  user_id         uuid references auth.users(id) on delete set null,
  tipo            text not null check (tipo in ('login', 'logout', 'signup', 'consulta', 'resumo_ia', 'chat_ia', 'lead', 'page_view')),
  processo_id     uuid references public.ap_processos(id) on delete set null,
  numero_cnj      text,
  assunto         text,                   -- sobre o que era o processo
  classe          text,
  tribunal        text,
  dados           jsonb not null default '{}'::jsonb,
  ip_hash         text,
  user_agent      text,
  ocorrido_em     timestamptz not null default now(),
  dia             date generated always as ((ocorrido_em at time zone 'America/Sao_Paulo')::date) stored,
  hora            smallint generated always as (extract(hour from ocorrido_em at time zone 'America/Sao_Paulo')::smallint) stored
);
create index ap_eventos_tempo_idx on public.ap_eventos (ocorrido_em desc);
create index ap_eventos_user_idx  on public.ap_eventos (user_id, ocorrido_em desc);
create index ap_eventos_tipo_idx  on public.ap_eventos (tipo, dia);

-- ── Auditoria de requisições à API ──────────────────────────────────────────
create table public.ap_auditoria (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  metodo       text not null,
  rota         text not null,
  status       integer,
  duracao_ms   integer,
  ip_hash      text,
  user_agent   text,
  detalhes     jsonb not null default '{}'::jsonb,
  ocorrido_em  timestamptz not null default now()
);
create index ap_auditoria_tempo_idx on public.ap_auditoria (ocorrido_em desc);
create index ap_auditoria_user_idx  on public.ap_auditoria (user_id, ocorrido_em desc);

alter table public.ap_eventos   enable row level security;
alter table public.ap_auditoria enable row level security;

create or replace function public.ap_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ap_perfis where id = (select auth.uid()) and role = 'admin');
$$;

-- Escrita somente pelo servidor (service role, ignora RLS). Leitura: admin vê tudo, usuário vê os próprios eventos.
create policy ap_eventos_read on public.ap_eventos
  for select to authenticated using (user_id = (select auth.uid()) or public.ap_is_admin());
create policy ap_auditoria_read on public.ap_auditoria
  for select to authenticated using (public.ap_is_admin());

-- Admin também lê perfis, processos e consultas de todos (painel).
create policy ap_perfis_admin_read    on public.ap_perfis    for select to authenticated using (public.ap_is_admin());
create policy ap_processos_admin_read on public.ap_processos for select to authenticated using (public.ap_is_admin());
create policy ap_consultas_admin_read on public.ap_consultas for select to authenticated using (public.ap_is_admin());

-- Visão agregada para o dashboard (v1).
create or replace view public.ap_dashboard_v1 with (security_invoker = true) as
select dia, hora, tipo, assunto, count(*) as total, count(distinct user_id) as usuarios
from public.ap_eventos
group by dia, hora, tipo, assunto;
