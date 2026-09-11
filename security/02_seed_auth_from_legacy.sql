-- ============================================================================
-- 02 · Criar contas Supabase Auth a partir dos utilizadores legacy,
--      reutilizando a password atual para uma transição INVISÍVEL.
-- ----------------------------------------------------------------------------
-- Cada utilizador de public.utilizadores que ainda não tenha conta no
-- Supabase Auth passa a ter uma, com a MESMA password (agora encriptada em
-- bcrypt). Quem já tem conta Auth (ex.: joao.guedesduarte) é ignorado — não
-- lhe tocamos, para não partir o login que já usa.
--
-- Colunas de token (confirmation_token, ...) são definidas como '' e não NULL,
-- para evitar o bug de login do GoTrue ("converting NULL to string").
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;

begin;

with novos as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_sso_user, is_anonymous
  )
  select
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    lower(u.email),
    extensions.crypt(u.password, extensions.gen_salt('bf')),
    now(),
    '', '', '', '',
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false, false
  from public.utilizadores u
  where u.email is not null
    and u.password is not null
    and not exists (select 1 from auth.users a where lower(a.email) = lower(u.email))
  returning id, email
)
insert into auth.identities (
  provider_id, user_id, identity_data, provider, email,
  last_sign_in_at, created_at, updated_at
)
select
  n.id::text,
  n.id,
  jsonb_build_object('sub', n.id::text, 'email', n.email, 'email_verified', true),
  'email',
  n.email,
  now(), now(), now()
from novos n;

commit;
