-- Contas de teste MOCKADAS (temporário) — uma advogado, uma consultante.
-- Rode no SQL Editor DEPOIS das migrações. Trocar as senhas antes de qualquer uso real.
create extension if not exists pgcrypto;

do $$
declare uid_advogado   uuid := gen_random_uuid();
declare uid_consultante uuid := gen_random_uuid();
begin
  if not exists (select 1 from auth.users where email = 'advogado.teste@prosec.dev') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_advogado, 'authenticated', 'authenticated',
      'advogado.teste@prosec.dev', crypt('Prosec#Teste1', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Advogado Teste","role":"advogado"}', now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid_advogado, uid_advogado::text,
            jsonb_build_object('sub', uid_advogado::text, 'email', 'advogado.teste@prosec.dev', 'email_verified', true),
            'email', now(), now(), now());
  else
    raise notice 'advogado.teste@prosec.dev já existe';
  end if;

  if not exists (select 1 from auth.users where email = 'consultante.teste@prosec.dev') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_consultante, 'authenticated', 'authenticated',
      'consultante.teste@prosec.dev', crypt('Prosec#Teste1', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Consultante Teste","role":"cliente","documento":"12345678901","documento_tipo":"cpf"}', now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid_consultante, uid_consultante::text,
            jsonb_build_object('sub', uid_consultante::text, 'email', 'consultante.teste@prosec.dev', 'email_verified', true),
            'email', now(), now(), now());
  else
    raise notice 'consultante.teste@prosec.dev já existe';
  end if;
end $$;
