-- CRM próprio (Fase 1): pipelines configuráveis, etapas, campos customizados por pipeline
-- e itens. Substitui o modelo anterior (ap_automacao_regras/ap_automacao_deals, acoplado
-- ao Bitrix), que será removido na Fase 2 após o corte do legado.
--
-- Acesso de topo ao módulo inteiro é feito via requireAdvogadoOuAdmin (mesmo guard de
-- /automacao hoje); o RBAC granular por perfil (ap_crm_tem_permissao) chega na Fase 3 —
-- até lá, RLS aqui segue o padrão simples já usado no projeto (authenticated + ap_is_admin()).

create table public.ap_crm_pipelines (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  ordem       integer not null default 0,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.ap_crm_pipeline_etapas (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references public.ap_crm_pipelines(id) on delete cascade,
  nome         text not null,
  cor          text,
  ordem        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (pipeline_id, ordem)
);
create index ap_crm_pipeline_etapas_pipeline_idx on public.ap_crm_pipeline_etapas (pipeline_id, ordem);

-- Catálogo administrável de tipos de campo customizado. storage_kind diz como o valor é
-- validado/serializado dentro do jsonb do item (campos_customizados); novos tipos com um
-- storage_kind já suportado podem ser adicionados sem deploy de código.
create table public.ap_crm_tipos_campo (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  label          text not null,
  storage_kind   text not null check (storage_kind in ('text', 'number', 'date', 'boolean')),
  requer_opcoes  boolean not null default false,
  ativo          boolean not null default true,
  ordem          integer not null default 0
);

insert into public.ap_crm_tipos_campo (slug, label, storage_kind, requer_opcoes, ordem) values
  ('texto', 'Texto', 'text', false, 1),
  ('numero', 'Número', 'number', false, 2),
  ('data', 'Data', 'date', false, 3),
  ('select', 'Lista de opções', 'text', true, 4),
  ('booleano', 'Sim/Não', 'boolean', false, 5);

create table public.ap_crm_pipeline_campos (
  id             uuid primary key default gen_random_uuid(),
  pipeline_id    uuid not null references public.ap_crm_pipelines(id) on delete cascade,
  tipo_campo_id  uuid not null references public.ap_crm_tipos_campo(id),
  nome           text not null,
  slug           text not null,
  obrigatorio    boolean not null default false,
  opcoes         jsonb,
  ordem          integer not null default 0,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (pipeline_id, slug)
);
create index ap_crm_pipeline_campos_pipeline_idx on public.ap_crm_pipeline_campos (pipeline_id, ordem);

create table public.ap_crm_itens (
  id                     uuid primary key default gen_random_uuid(),
  pipeline_id            uuid not null references public.ap_crm_pipelines(id) on delete cascade,
  etapa_id               uuid not null references public.ap_crm_pipeline_etapas(id) on delete restrict,
  titulo                 text not null,
  numero_cnj             text,
  numero_cnj_formatado   text,
  tribunal_label         text,
  esfera                 text check (esfera is null or esfera in ('estadual', 'federal', 'municipal')),
  campos_customizados    jsonb not null default '{}'::jsonb,
  status_enriquecimento  text not null default 'pendente'
                         check (status_enriquecimento in ('pendente', 'processando', 'enriquecido', 'sem_dado', 'erro')),
  erro_mensagem          text,
  dados_enriquecidos     jsonb not null default '{}'::jsonb,
  enriquecido_em         timestamptz,
  criado_por             uuid references auth.users(id) on delete set null,
  responsavel_id         uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index ap_crm_itens_pipeline_etapa_idx  on public.ap_crm_itens (pipeline_id, etapa_id, created_at desc);
create index ap_crm_itens_pipeline_status_idx on public.ap_crm_itens (pipeline_id, status_enriquecimento);
create index ap_crm_itens_campos_gin_idx      on public.ap_crm_itens using gin (campos_customizados);

-- Cache de deduplicação de tentativas de enriquecimento (renomeia o conceito de
-- ap_automacao_tentativas: deal_id/regra_id → item_id/pipeline_id).
create table public.ap_crm_tentativas (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references public.ap_crm_pipelines(id) on delete cascade,
  item_id      uuid not null references public.ap_crm_itens(id) on delete cascade,
  tentado_em   timestamptz not null default now(),
  unique (pipeline_id, item_id)
);

alter table public.ap_crm_pipelines        enable row level security;
alter table public.ap_crm_pipeline_etapas  enable row level security;
alter table public.ap_crm_tipos_campo      enable row level security;
alter table public.ap_crm_pipeline_campos  enable row level security;
alter table public.ap_crm_itens            enable row level security;
alter table public.ap_crm_tentativas       enable row level security;

-- RLS simples nesta fase: qualquer usuário autenticado com role advogado/broker/admin/owner
-- (checado também no backend via requireAdvogadoOuAdmin) acessa o CRM por completo. A
-- granularidade por perfil RBAC chega na Fase 3 (ap_crm_tem_permissao substituirá esta
-- checagem ad-hoc).
create or replace function public.ap_crm_pode_acessar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ap_perfis
    where id = (select auth.uid()) and role in ('advogado', 'broker', 'admin', 'owner')
  );
$$;

create policy ap_crm_pipelines_access on public.ap_crm_pipelines
  for all to authenticated using (public.ap_crm_pode_acessar()) with check (public.ap_crm_pode_acessar());

create policy ap_crm_pipeline_etapas_access on public.ap_crm_pipeline_etapas
  for all to authenticated using (public.ap_crm_pode_acessar()) with check (public.ap_crm_pode_acessar());

create policy ap_crm_tipos_campo_read on public.ap_crm_tipos_campo
  for select to authenticated using (public.ap_crm_pode_acessar());

create policy ap_crm_pipeline_campos_access on public.ap_crm_pipeline_campos
  for all to authenticated using (public.ap_crm_pode_acessar()) with check (public.ap_crm_pode_acessar());

create policy ap_crm_itens_access on public.ap_crm_itens
  for all to authenticated using (public.ap_crm_pode_acessar()) with check (public.ap_crm_pode_acessar());

-- Tentativas: só o service role lê/escreve (mesmo padrão de ap_automacao_tentativas).
create policy ap_crm_tentativas_none on public.ap_crm_tentativas
  for select to authenticated using (false);

create trigger ap_crm_pipelines_touch before update on public.ap_crm_pipelines
  for each row execute function public.ap_touch_updated_at();
create trigger ap_crm_pipeline_etapas_touch before update on public.ap_crm_pipeline_etapas
  for each row execute function public.ap_touch_updated_at();
create trigger ap_crm_pipeline_campos_touch before update on public.ap_crm_pipeline_campos
  for each row execute function public.ap_touch_updated_at();
create trigger ap_crm_itens_touch before update on public.ap_crm_itens
  for each row execute function public.ap_touch_updated_at();
