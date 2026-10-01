-- Adiciona suporte ao papel 'broker' (além de 'cliente', 'advogado', 'admin') em ap_perfis.
-- Broker tem acesso a busca livre e análise de carteiras de ativos/precatórios.

alter table public.ap_perfis
  drop constraint if exists ap_perfis_role_check;

alter table public.ap_perfis
  add constraint ap_perfis_role_check check (role in ('cliente', 'advogado', 'broker', 'admin'));

-- Atualiza a função de novo usuário para aceitar 'broker'
create or replace function public.ap_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ap_perfis (id, nome, email, role, documento, documento_tipo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'cliente'),
    new.raw_user_meta_data->>'documento',
    new.raw_user_meta_data->>'documento_tipo'
  )
  on conflict (id) do update set
    nome = coalesce(excluded.nome, public.ap_perfis.nome),
    role = case when public.ap_perfis.role = 'cliente' and excluded.role is not null then excluded.role else public.ap_perfis.role end;
  return new;
end $$;
