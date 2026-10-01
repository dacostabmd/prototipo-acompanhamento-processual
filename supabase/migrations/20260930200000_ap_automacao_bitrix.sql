-- Automação de etapas em funis (Bitrix24) + enriquecimento DataJud/Infosimples.
-- Também corrige um gap pré-existente: ap_eventos/ap_auditoria/ap_is_admin()/ap_touch_updated_at()
-- nunca foram aplicadas no banco remoto (só existiam no arquivo local ap_schema_inicial.sql),
-- então todo tracking/auditoria do app já era no-op silencioso em produção. Criadas aqui
-- (create or replace / if not exists) para destravar isso junto da nova feature.

-- ── Funções de apoio (idempotentes) ─────────────────────────────────────────
create or replace function public.ap_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.ap_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ap_perfis where id = (select auth.uid()) and role = 'admin');
$$;

-- ── Tracking de eventos de negócio (gap pré-existente, nunca aplicado) ──────
create table if not exists public.ap_eventos (
  id              uuid primary key default gen_random_uuid(),
  schema_version  smallint not null default 1,
  user_id         uuid references auth.users(id) on delete set null,
  tipo            text not null check (tipo in ('login', 'logout', 'signup', 'consulta', 'resumo_ia', 'chat_ia', 'lead', 'page_view', 'automacao_bitrix')),
  processo_id     uuid references public.ap_processos(id) on delete set null,
  numero_cnj      text,
  assunto         text,
  classe          text,
  tribunal        text,
  dados           jsonb not null default '{}'::jsonb,
  ip_hash         text,
  user_agent      text,
  ocorrido_em     timestamptz not null default now(),
  dia             date generated always as ((ocorrido_em at time zone 'America/Sao_Paulo')::date) stored,
  hora            smallint generated always as (extract(hour from ocorrido_em at time zone 'America/Sao_Paulo')::smallint) stored
);
create index if not exists ap_eventos_tempo_idx on public.ap_eventos (ocorrido_em desc);
create index if not exists ap_eventos_user_idx  on public.ap_eventos (user_id, ocorrido_em desc);
create index if not exists ap_eventos_tipo_idx  on public.ap_eventos (tipo, dia);

create table if not exists public.ap_auditoria (
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
create index if not exists ap_auditoria_tempo_idx on public.ap_auditoria (ocorrido_em desc);
create index if not exists ap_auditoria_user_idx  on public.ap_auditoria (user_id, ocorrido_em desc);

alter table public.ap_eventos   enable row level security;
alter table public.ap_auditoria enable row level security;

drop policy if exists ap_eventos_read on public.ap_eventos;
create policy ap_eventos_read on public.ap_eventos
  for select to authenticated using (user_id = (select auth.uid()) or public.ap_is_admin());

drop policy if exists ap_auditoria_read on public.ap_auditoria;
create policy ap_auditoria_read on public.ap_auditoria
  for select to authenticated using (public.ap_is_admin());

create or replace view public.ap_dashboard_v1 with (security_invoker = true) as
select dia, hora, tipo, assunto, count(*) as total, count(distinct user_id) as usuarios
from public.ap_eventos
group by dia, hora, tipo, assunto;

-- ── Regras de automação (abas configuráveis: funil + etapa + campo de processo) ──
create table public.ap_automacao_regras (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  nome                  text not null,
  categoria_id          integer not null,
  categoria_nome        text,
  stage_id              text not null,
  stage_nome            text,
  campo_processo        text not null default 'UF_CRM_1740590606',
  tamanho_lote          integer not null default 10 check (tamanho_lote between 1 and 50),
  filtro_esfera         text check (filtro_esfera is null or filtro_esfera in ('estadual', 'federal', 'municipal')),
  filtro_valor_min      numeric(16,2),
  filtro_valor_max      numeric(16,2),
  campo_valor           text not null default 'OPPORTUNITY',
  campo_esfera          text,
  ordem                 integer not null default 0,
  ativo                 boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index ap_automacao_regras_user_idx on public.ap_automacao_regras (user_id, ordem);

alter table public.ap_automacao_regras enable row level security;

create policy ap_automacao_regras_owner on public.ap_automacao_regras
  for all to authenticated
  using (user_id = (select auth.uid()) or public.ap_is_admin())
  with check (user_id = (select auth.uid()) or public.ap_is_admin());

create trigger ap_automacao_regras_touch before update on public.ap_automacao_regras
  for each row execute function public.ap_touch_updated_at();

-- ── Deals processados/enriquecidos (fonte da tabela paginada) ───────────────
create table public.ap_automacao_deals (
  id                    uuid primary key default gen_random_uuid(),
  regra_id              uuid not null references public.ap_automacao_regras(id) on delete cascade,
  deal_id               integer not null,
  deal_titulo           text,
  numero_cnj            text,
  numero_cnj_formatado  text,
  tribunal_label        text,
  esfera                text check (esfera is null or esfera in ('estadual', 'federal', 'municipal')),
  valor_deal            numeric(16,2),
  status                text not null default 'pendente'
                        check (status in ('pendente', 'processando', 'enriquecido', 'sem_processo', 'erro')),
  erro_mensagem         text,
  dados_enriquecidos    jsonb not null default '{}'::jsonb,
  processado_em         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (regra_id, deal_id)
);
create index ap_automacao_deals_regra_idx  on public.ap_automacao_deals (regra_id, created_at desc);
create index ap_automacao_deals_status_idx on public.ap_automacao_deals (regra_id, status);

alter table public.ap_automacao_deals enable row level security;

create policy ap_automacao_deals_read on public.ap_automacao_deals
  for select to authenticated
  using (
    exists (select 1 from public.ap_automacao_regras r where r.id = regra_id and (r.user_id = (select auth.uid()) or public.ap_is_admin()))
  );

create trigger ap_automacao_deals_touch before update on public.ap_automacao_deals
  for each row execute function public.ap_touch_updated_at();
