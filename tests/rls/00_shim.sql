-- Emula o essencial do Supabase para testar RLS num Postgres puro:
-- roles anon/authenticated/service_role, auth.jwt()/auth.uid() lidos de request.jwt.claims,
-- e o esquema (mínimo) das tabelas da plataforma.
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; create schema auth;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);

create table public.utilizadores (id bigint primary key, nome text, email text unique, perfil text, local jsonb, negocio jsonb, marca jsonb, password text);
create table public.viaturas (chassis text primary key, matricula text, modelo text, versao text, local jsonb, estado_negocio text, marca jsonb, inputs jsonb, stats jsonb, reserva_expira timestamptz, reserva_user text, iva_dedutivel boolean not null default false);
create table public.viaturas_vendidas (id bigint generated always as identity primary key, chassis text, modelo text, preco_final numeric, local jsonb, estado_negocio text, marca jsonb, inputs jsonb);
create table public.historico (id bigint generated always as identity primary key, tabela text, acao text, registo_id text, detalhes jsonb, data_hora timestamptz default now());
-- retomas: esquema do Baviera Vision Pro (a 09 acrescenta-lhe as colunas do Caetano). RLS ligado e SEM
-- políticas para o Caetano: o acesso passa pelas funções sf_vu_* (no Baviera lê-se pela matriz de tabs).
create table public.retomas (
  id uuid primary key default gen_random_uuid(), marca text not null, modelo text not null, motorizacao text,
  matricula text, data_matricula date, quilometragem integer, importado boolean not null default false,
  link_caetano text, link_maxterauto text, link_fotos text, arquivada boolean not null default false,
  arquivada_at timestamptz, created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), data_entrada_stock date not null default current_date,
  preco numeric(10,2), observacoes text,
  constraint retomas_motorizacao_check check (motorizacao = any (array['ice','phev','bev'])),
  constraint retomas_preco_check check (preco is null or preco >= 0),
  constraint retomas_quilometragem_check check (quilometragem is null or quilometragem >= 0)
);
alter table public.retomas enable row level security;
create table public.locais (id bigint generated always as identity primary key, nome text);
create table public.precos_inputs (id bigint generated always as identity primary key, dados jsonb);
-- Supabase concede tudo por omissão; o RLS é que filtra
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
