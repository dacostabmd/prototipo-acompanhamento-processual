-- Endurecimento da autenticação (sem nenhum DROP).
--
-- 1) ap_perfis: a policy "dono" libera UPDATE/INSERT da linha inteira, então qualquer usuário logado
--    conseguia se promover a admin/owner ou trocar o próprio plano. Um trigger passa a travar esses campos
--    para chamadas feitas com JWT de usuário. service_role/SQL (sem auth.uid()) continuam liberados.
-- 2) ap_handle_new_user: valida role/documento vindos do metadata do signUp (que é controlado pelo cliente).
-- 3) Cria o trigger em auth.users que nunca existiu (perfis só nasciam por inserção manual).
-- 4) Backfill dos perfis faltantes (contas anteriores ao trigger) como 'advogado', que é o papel que o
--    frontend já assumia por padrão para quem não tinha perfil (lib/useProfile.ts).

create or replace function public.ap_perfis_proteger_campos() returns trigger
language plpgsql set search_path = public as $$
begin
  -- service_role, postgres e API admin não têm auth.uid(): liberados.
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role not in ('cliente', 'advogado', 'broker') then
      raise exception 'role não permitido no cadastro';
    end if;
    if new.plano is distinct from 'free' then
      raise exception 'plano só pode ser definido por um administrador';
    end if;
    return new;
  end if;

  if new.plano is distinct from old.plano then
    raise exception 'plano só pode ser alterado por um administrador';
  end if;

  -- Única transição permitida ao próprio usuário: consultante sem documento fixado escolhe
  -- advogado/broker (fluxo de cadastro com Google, ver lib/useProfile.ts).
  if new.role is distinct from old.role
     and not (old.role = 'cliente' and new.role in ('advogado', 'broker') and old.documento is null) then
    raise exception 'role só pode ser alterado por um administrador';
  end if;

  return new;
end $$;

create or replace function public.ap_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := new.raw_user_meta_data->>'role';
  v_doc  text := new.raw_user_meta_data->>'documento';
  v_tipo text := new.raw_user_meta_data->>'documento_tipo';
begin
  if v_role is null or v_role not in ('cliente', 'advogado', 'broker') then
    v_role := 'cliente';
  end if;

  if not ((v_tipo = 'cpf' and v_doc ~ '^\d{11}$') or (v_tipo = 'cnpj' and v_doc ~ '^\d{14}$')) then
    v_doc := null;
    v_tipo := null;
  end if;

  insert into public.ap_perfis (id, nome, email, role, documento, documento_tipo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    v_role,
    v_doc,
    v_tipo
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Função de trigger: não precisa ser chamável via /rest/v1/rpc.
revoke execute on function public.ap_handle_new_user() from public, anon, authenticated;

-- Backfill antes de ligar o trigger de proteção.
insert into public.ap_perfis (id, nome, email, role)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)), u.email, 'advogado'
from auth.users u
where not exists (select 1 from public.ap_perfis p where p.id = u.id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ap_perfis_proteger_campos' and tgrelid = 'public.ap_perfis'::regclass) then
    create trigger ap_perfis_proteger_campos
      before insert or update on public.ap_perfis
      for each row execute function public.ap_perfis_proteger_campos();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'ap_on_auth_user_created' and tgrelid = 'auth.users'::regclass) then
    create trigger ap_on_auth_user_created
      after insert on auth.users
      for each row execute function public.ap_handle_new_user();
  end if;
end $$;
