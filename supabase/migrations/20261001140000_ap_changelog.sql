-- Changelog de novidades do produto: entradas criadas por admin, visíveis a todos os usuários
-- autenticados. O "já visto" é controlado no cliente (localStorage), não no banco — não há
-- necessidade de rastrear por usuário quem já leu cada entrada.

create table public.ap_changelog (
  id          uuid primary key default gen_random_uuid(),
  versao      text not null,
  titulo      text not null,
  corpo       text not null,
  publicado   boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index ap_changelog_publicado_idx on public.ap_changelog (publicado, created_at desc);

alter table public.ap_changelog enable row level security;

-- Leitura: qualquer usuário autenticado vê as entradas publicadas.
create policy ap_changelog_read on public.ap_changelog
  for select to authenticated using (publicado = true or public.ap_is_admin());

-- Escrita: somente admin.
create policy ap_changelog_admin_write on public.ap_changelog
  for all to authenticated using (public.ap_is_admin()) with check (public.ap_is_admin());
