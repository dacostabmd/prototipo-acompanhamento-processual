-- Adiciona o papel 'owner': acima de 'admin', reservado ao dono do produto. Tem todos os privilégios
-- de admin (ap_is_admin() passa a aceitar também 'owner') e exclusividade sobre ações reservadas ao
-- dono, como publicar changelog (ap_is_owner(), checado em lib/requireRole.ts).

alter table public.ap_perfis
  drop constraint if exists ap_perfis_role_check;

alter table public.ap_perfis
  add constraint ap_perfis_role_check check (role in ('cliente', 'advogado', 'broker', 'admin', 'owner'));

create or replace function public.ap_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ap_perfis where id = (select auth.uid()) and role in ('admin', 'owner'));
$$;

create or replace function public.ap_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ap_perfis where id = (select auth.uid()) and role = 'owner');
$$;

-- Changelog: só owner publica (admin comum não deve ter essa exclusividade).
drop policy if exists ap_changelog_admin_write on public.ap_changelog;
create policy ap_changelog_owner_write on public.ap_changelog
  for all to authenticated using (public.ap_is_owner()) with check (public.ap_is_owner());
