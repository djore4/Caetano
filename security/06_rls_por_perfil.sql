-- ============================================================================
-- 06 · RLS por perfil — fecha a escalada de privilégios SEM mudar o que a app permite
-- ----------------------------------------------------------------------------
-- Problema (01_enable_rls.sql): `for all to authenticated using (true)` deixava
-- QUALQUER sessão autenticada (inclui contas do CRM / Trading Lab do mesmo projeto)
-- ler e escrever tudo, incluindo promover-se a Administrador em public.utilizadores.
--
-- Esta migração faz o servidor aplicar EXATAMENTE as regras que a interface já aplica:
--
--   tabela             Vendedor        Chefe de Vendas   Administrador   sem perfil / anon
--   viaturas           ler             ler + escrever    ler + escrever  nada
--   viaturas_vendidas  nada (aba oculta) ler + escrever  ler + escrever  nada
--   utilizadores       ler a própria   ler a própria     tudo            nada
--   historico          só inserir      só inserir        ler + inserir   nada
--   locais/precos_inp. ler             ler + escrever    ler + escrever  nada
--   assistente_uso     (só service_role — Edge Function)
--
-- NÃO muda: preços, cálculos, nem a lógica de concessões (que continua no cliente:
-- um Chefe de Vendas escreve em qualquer viatura; restringir por concessão no servidor
-- é a Fase 2 e exige alterar a regra de edição). Aqui só se tira acesso a quem a
-- interface já não dava acesso.
--
-- PRÉ-REQUISITO (correr antes e confirmar que devolve 0 linhas):
--   select u.email from auth.users u
--   where not exists (select 1 from public.utilizadores p where lower(p.email)=lower(u.email));
--   → cada pessoa que deve ter acesso TEM de ter linha em public.utilizadores
--     (contas de outras apps no mesmo projeto passam a ficar sem acesso — é o objetivo).
--
-- Rollback: 06_rollback.sql
-- ============================================================================
begin;

-- Perfil do utilizador da sessão (null se não pertence à plataforma). security definer
-- para ler utilizadores sem passar pelo RLS (evita recursão e não expõe a tabela).
create or replace function public.sf_perfil()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.perfil
  from public.utilizadores u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;
revoke all on function public.sf_perfil() from public, anon;
grant execute on function public.sf_perfil() to authenticated;

-- Quota do assistente (usada pela Edge Function sf-assistente com service_role)
create table if not exists public.assistente_uso (
  id bigint generated always as identity primary key,
  email text not null,
  criado_em timestamptz not null default now()
);
create index if not exists assistente_uso_email_ts on public.assistente_uso (email, criado_em desc);
alter table public.assistente_uso enable row level security;   -- sem políticas: só service_role

-- Garantir RLS em todas as tabelas (inclui viaturas_vendidas, que o 01 não cobria)
alter table public.viaturas          enable row level security;
alter table public.viaturas_vendidas enable row level security;
alter table public.historico         enable row level security;
alter table public.locais            enable row level security;
alter table public.precos_inputs     enable row level security;
alter table public.utilizadores      enable row level security;

-- Remover as políticas permissivas antigas
drop policy if exists "auth_rw_viaturas"      on public.viaturas;
drop policy if exists "auth_rw_historico"     on public.historico;
drop policy if exists "auth_rw_locais"        on public.locais;
drop policy if exists "auth_rw_precos_inputs" on public.precos_inputs;
drop policy if exists "auth_rw_utilizadores"  on public.utilizadores;
drop policy if exists "auth_rw_viaturas_vendidas" on public.viaturas_vendidas;

-- anon nunca toca nestas tabelas (defesa em profundidade; o RLS já o nega)
revoke all on public.viaturas, public.viaturas_vendidas, public.historico, public.locais,
              public.precos_inputs, public.utilizadores, public.assistente_uso from anon;
revoke all on public.assistente_uso from authenticated;

-- viaturas: todos os perfis leem; só Chefe de Vendas e Administrador escrevem
create policy sf_viaturas_select on public.viaturas for select to authenticated
  using ((select public.sf_perfil()) is not null);
create policy sf_viaturas_insert on public.viaturas for insert to authenticated
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));
create policy sf_viaturas_update on public.viaturas for update to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));
create policy sf_viaturas_delete on public.viaturas for delete to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));

-- viaturas_vendidas: aba só para Chefe de Vendas e Administrador
create policy sf_vendidas_all on public.viaturas_vendidas for all to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));

-- utilizadores: cada um lê a sua linha (a app resolve o perfil por email); só Administrador gere
create policy sf_utilizadores_select on public.utilizadores for select to authenticated
  using ((select public.sf_perfil()) = 'Administrador'
         or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy sf_utilizadores_insert on public.utilizadores for insert to authenticated
  with check ((select public.sf_perfil()) = 'Administrador');
create policy sf_utilizadores_update on public.utilizadores for update to authenticated
  using ((select public.sf_perfil()) = 'Administrador')
  with check ((select public.sf_perfil()) = 'Administrador');
create policy sf_utilizadores_delete on public.utilizadores for delete to authenticated
  using ((select public.sf_perfil()) = 'Administrador');

-- historico: qualquer perfil regista (LOGIN, reservas…); só Administrador lê; ninguém edita/apaga
create policy sf_historico_insert on public.historico for insert to authenticated
  with check ((select public.sf_perfil()) is not null);
create policy sf_historico_select on public.historico for select to authenticated
  using ((select public.sf_perfil()) = 'Administrador');

-- locais / precos_inputs (não usadas pela app atual; mantêm-se acessíveis a quem pertence à plataforma)
create policy sf_locais_select on public.locais for select to authenticated
  using ((select public.sf_perfil()) is not null);
create policy sf_locais_write on public.locais for all to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));
create policy sf_precos_inputs_select on public.precos_inputs for select to authenticated
  using ((select public.sf_perfil()) is not null);
create policy sf_precos_inputs_write on public.precos_inputs for all to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));

commit;
