-- Monitoramento do Diário (DJEN / Comunica PJe) por OAB, nome ou termo.
-- O usuário cadastra buscas; um cron varre o DJEN a cada ~6h, grava as publicações novas e avisa por WhatsApp/e-mail.
-- Aditiva e idempotente: pode ser reaplicada sem erro.

create table if not exists public.ap_monitoramento_diario (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('oab', 'nome', 'termo')),
  -- oab: só dígitos (sem zeros à esquerda); nome: normalizado (maiúsculas, sem acento); termo: texto como digitado
  valor text not null,
  -- UF da OAB; '' para nome e termo (não nulo para o unique funcionar)
  uf_oab text not null default '',
  rotulo text not null,
  ativo boolean not null default true,
  notificar_whatsapp boolean not null default true,
  notificar_email boolean not null default true,
  ultima_varredura_em timestamptz, -- nulo = ainda não houve a 1ª varredura (importa 7 dias sem alertar)
  proxima_varredura_em timestamptz default now(),
  ultimo_erro text,
  created_at timestamptz not null default now(),
  unique (user_id, tipo, valor, uf_oab)
);

create index if not exists ap_monit_diario_proxima_varredura_idx
  on public.ap_monitoramento_diario (proxima_varredura_em)
  where ativo;

create index if not exists ap_monit_diario_user_idx
  on public.ap_monitoramento_diario (user_id, created_at desc);

create table if not exists public.ap_publicacoes_diario (
  id uuid primary key default gen_random_uuid(),
  monitoramento_id uuid not null references public.ap_monitoramento_diario(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comunicacao_id bigint not null, -- id da comunicação no DJEN
  numero_cnj text, -- 20 dígitos; nulo em editais sem número de processo
  tribunal text,
  orgao text,
  classe text,
  tipo_comunicacao text,
  data_disponibilizacao date,
  texto text, -- truncado em ~4000 caracteres
  tag text not null default 'informativo' check (tag in ('urgente', 'positivo', 'andamento', 'informativo')),
  lida boolean not null default false,
  created_at timestamptz not null default now(),
  unique (monitoramento_id, comunicacao_id)
);

-- listagem do feed por busca, da mais nova para a mais antiga
create index if not exists ap_publ_diario_busca_data_idx
  on public.ap_publicacoes_diario (monitoramento_id, data_disponibilizacao desc, created_at desc);

-- feed geral do usuário e contagem de não lidas
create index if not exists ap_publ_diario_user_data_idx
  on public.ap_publicacoes_diario (user_id, data_disponibilizacao desc, created_at desc);

create index if not exists ap_publ_diario_nao_lidas_idx
  on public.ap_publicacoes_diario (user_id, monitoramento_id)
  where not lida;

alter table public.ap_monitoramento_diario enable row level security;
alter table public.ap_publicacoes_diario enable row level security;

drop policy if exists ap_monit_diario_owner on public.ap_monitoramento_diario;
create policy ap_monit_diario_owner on public.ap_monitoramento_diario
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists ap_publ_diario_owner on public.ap_publicacoes_diario;
create policy ap_publ_diario_owner on public.ap_publicacoes_diario
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.ap_monitoramento_diario is
  'Buscas monitoradas no Diário de Justiça Eletrônico Nacional (DJEN) por OAB, nome (polo ativo) ou termo livre.';
comment on table public.ap_publicacoes_diario is
  'Publicações do DJEN encontradas pelas buscas de ap_monitoramento_diario (dedupe por monitoramento_id + comunicacao_id).';
