-- ============================================================================
-- 02 · (OPCIONAL / SENSÍVEL) Criar contas Supabase Auth a partir dos utilizadores
--      legacy, reutilizando a password atual para uma transição INVISÍVEL.
-- ----------------------------------------------------------------------------
-- Porquê: hoje as passwords vivem em texto simples em public.utilizadores.
-- Este script cria a conta equivalente no Supabase Auth com a mesma password,
-- para que ninguém tenha de mudar credenciais no dia da migração.
--
-- ⚠️  RISCO: escrever diretamente em auth.users/auth.identities é frágil e
--     depende da versão do GoTrue. RECOMENDAÇÃO mais segura: criar a ÚNICA
--     conta de acesso partilhado no dashboard (Authentication > Users >
--     Add user, com "Auto Confirm User"). Se optares por este script,
--     TESTA primeiro com um só email (adiciona `and u.email = '...'`).
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  lower(u.email),
  extensions.crypt(u.password, extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false, false
from public.utilizadores u
where u.email is not null
  and u.password is not null
  and not exists (select 1 from auth.users a where lower(a.email) = lower(u.email));

-- O GoTrue moderno exige uma identidade 'email' associada para permitir login.
insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  a.id::text,
  a.id,
  jsonb_build_object('sub', a.id::text, 'email', a.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users a
where not exists (
  select 1 from auth.identities i where i.user_id = a.id and i.provider = 'email'
);
