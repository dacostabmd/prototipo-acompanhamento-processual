-- Escritório com vários usuários (Frente F, MVP). Aditiva e idempotente: não altera tabelas, colunas nem
-- políticas RLS existentes.
--
-- Por que tabelas novas e não ap_departamentos/ap_departamento_membros: aquelas pertencem ao CRM interno
-- (migration 20261007110000). ap_departamentos tem chave texto e 5 linhas fixas (juridico, financeiro, comercial,
-- negociacao, atendimento) que espelham os times da operação, e só admin/owner escreve. Não modelam "um escritório
-- de cada cliente", não têm dono, convite nem limite por plano.
--
-- Compartilhamento: feito no servidor (as rotas usam o cliente admin com filtro explícito por user_id e agora
-- ampliam esse filtro para os colegas do escritório). As RLS abaixo protegem o acesso direto pelo cliente
-- (anon key + JWT) a estas três tabelas.
--
-- Criação de escritório, entrada de membro (aceite de convite) e conferência de limite do plano passam SEMPRE
-- pelo servidor com a service role: por isso não há política de INSERT em organizacoes/membros.

-- ── Organizações ────────────────────────────────────────────────────────────
create table if not exists public.ap_organizacoes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (char_length(btrim(nome)) between 2 and 80),
  dono_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Um usuário é dono de no máximo um escritório.
create unique index if not exists ap_organizacoes_dono_uidx on public.ap_organizacoes (dono_id);

-- ── Membros (um usuário só pode estar em UMA organização no MVP) ────────────
create table if not exists public.ap_organizacao_membros (
  organizacao_id  uuid not null references public.ap_organizacoes(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  papel           text not null default 'membro' check (papel in ('dono', 'membro')),
  created_at      timestamptz not null default now(),
  primary key (organizacao_id, user_id)
);

create unique index if not exists ap_organizacao_membros_user_uidx on public.ap_organizacao_membros (user_id);
create index if not exists ap_organizacao_membros_org_idx on public.ap_organizacao_membros (organizacao_id);

-- ── Convites ────────────────────────────────────────────────────────────────
create table if not exists public.ap_organizacao_convites (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.ap_organizacoes(id) on delete cascade,
  email           text not null check (email = lower(btrim(email)) and char_length(email) between 5 and 254),
  token           text not null unique check (char_length(token) >= 32),
  papel           text not null default 'membro' check (papel = 'membro'),
  expira_em       timestamptz not null default (now() + interval '7 days'),
  aceito_em       timestamptz,
  criado_por      uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index if not exists ap_organizacao_convites_org_idx on public.ap_organizacao_convites (organizacao_id);
-- Um convite pendente por e-mail em cada escritório (reconvidar substitui o anterior, feito no servidor).
create unique index if not exists ap_organizacao_convites_pendente_uidx
  on public.ap_organizacao_convites (organizacao_id, email) where aceito_em is null;

-- ── Funções de pertencimento ────────────────────────────────────────────────
-- security definer + search_path fixo: leem as tabelas sem passar pela RLS delas, o que evita a recursão infinita
-- (a política de membros consultaria a própria tabela de membros).
create or replace function public.ap_eq_pertence(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ap_organizacao_membros m
    where m.organizacao_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.ap_eq_eh_dono(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ap_organizacoes o
    where o.id = p_org and o.dono_id = (select auth.uid())
  );
$$;

revoke all on function public.ap_eq_pertence(uuid) from public, anon;
revoke all on function public.ap_eq_eh_dono(uuid) from public, anon;
grant execute on function public.ap_eq_pertence(uuid) to authenticated, service_role;
grant execute on function public.ap_eq_eh_dono(uuid) to authenticated, service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.ap_organizacoes        enable row level security;
alter table public.ap_organizacao_membros enable row level security;
alter table public.ap_organizacao_convites enable row level security;

revoke all on public.ap_organizacoes, public.ap_organizacao_membros, public.ap_organizacao_convites from anon;

-- Organizações: membro lê a sua; só o dono renomeia ou encerra. Sem INSERT direto (criação passa pelo servidor).
drop policy if exists ap_organizacoes_select on public.ap_organizacoes;
create policy ap_organizacoes_select on public.ap_organizacoes
  for select to authenticated using (dono_id = (select auth.uid()) or public.ap_eq_pertence(id));

drop policy if exists ap_organizacoes_update on public.ap_organizacoes;
create policy ap_organizacoes_update on public.ap_organizacoes
  for update to authenticated
  using (dono_id = (select auth.uid())) with check (dono_id = (select auth.uid()));

drop policy if exists ap_organizacoes_delete on public.ap_organizacoes;
create policy ap_organizacoes_delete on public.ap_organizacoes
  for delete to authenticated using (dono_id = (select auth.uid()));

-- Membros: quem pertence à organização enxerga todos os membros dela. O dono remove os outros; o membro sai
-- sozinho (o dono não sai: encerra o escritório). Sem INSERT/UPDATE direto (entrada só pelo aceite no servidor).
drop policy if exists ap_organizacao_membros_select on public.ap_organizacao_membros;
create policy ap_organizacao_membros_select on public.ap_organizacao_membros
  for select to authenticated using (public.ap_eq_pertence(organizacao_id));

drop policy if exists ap_organizacao_membros_delete on public.ap_organizacao_membros;
create policy ap_organizacao_membros_delete on public.ap_organizacao_membros
  for delete to authenticated
  using (
    (public.ap_eq_eh_dono(organizacao_id) and user_id <> (select auth.uid()))
    or (user_id = (select auth.uid()) and papel <> 'dono')
  );

-- Convites: só o dono lê e gerencia (o token é um segredo). O aceite lê o convite pelo servidor com a service role.
drop policy if exists ap_organizacao_convites_dono_select on public.ap_organizacao_convites;
create policy ap_organizacao_convites_dono_select on public.ap_organizacao_convites
  for select to authenticated using (public.ap_eq_eh_dono(organizacao_id));

drop policy if exists ap_organizacao_convites_dono_insert on public.ap_organizacao_convites;
create policy ap_organizacao_convites_dono_insert on public.ap_organizacao_convites
  for insert to authenticated
  with check (public.ap_eq_eh_dono(organizacao_id) and criado_por = (select auth.uid()));

drop policy if exists ap_organizacao_convites_dono_update on public.ap_organizacao_convites;
create policy ap_organizacao_convites_dono_update on public.ap_organizacao_convites
  for update to authenticated
  using (public.ap_eq_eh_dono(organizacao_id)) with check (public.ap_eq_eh_dono(organizacao_id));

drop policy if exists ap_organizacao_convites_dono_delete on public.ap_organizacao_convites;
create policy ap_organizacao_convites_dono_delete on public.ap_organizacao_convites
  for delete to authenticated using (public.ap_eq_eh_dono(organizacao_id));

comment on table public.ap_organizacoes is 'Escritório (equipe) de usuários do JusConsulta; compartilha o acompanhamento em modo leitura.';
comment on table public.ap_organizacao_membros is 'Membros do escritório. Um usuário só pertence a um escritório (MVP).';
comment on table public.ap_organizacao_convites is 'Convites por e-mail com token imprevisível, válidos por 7 dias. Legíveis só pelo dono.';
