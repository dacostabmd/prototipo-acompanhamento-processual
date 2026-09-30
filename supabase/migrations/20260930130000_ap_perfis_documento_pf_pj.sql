-- Separação de perfis Advogado x Consultante.
-- Consultante (role = 'cliente') só consulta o próprio CPF/CNPJ, fixado no cadastro.
-- documento/documento_tipo ficam null para advogado (busca livre por qualquer CPF/CNJ).
alter table public.ap_perfis
  add column documento      text,
  add column documento_tipo text check (documento_tipo is null or documento_tipo in ('cpf', 'cnpj'));

alter table public.ap_perfis
  add constraint ap_perfis_documento_formato check (
    documento is null
    or (documento_tipo = 'cpf'  and documento ~ '^\d{11}$')
    or (documento_tipo = 'cnpj' and documento ~ '^\d{14}$')
  );

-- Grava role/documento já no cadastro, a partir do metadata enviado pelo signUp (AuthGateway).
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
  on conflict (id) do nothing;
  return new;
end $$;

-- Imutabilidade: uma vez fixado, documento/documento_tipo não podem mais ser alterados
-- (nem pelo próprio usuário, nem por engano) — decisão do consultante ter documento travado.
create or replace function public.ap_perfis_bloquear_troca_documento() returns trigger
language plpgsql as $$
begin
  if old.documento is not null and (new.documento is distinct from old.documento or new.documento_tipo is distinct from old.documento_tipo) then
    raise exception 'documento do perfil não pode ser alterado após definido';
  end if;
  return new;
end $$;

create trigger ap_perfis_documento_imutavel
  before update on public.ap_perfis
  for each row execute function public.ap_perfis_bloquear_troca_documento();
