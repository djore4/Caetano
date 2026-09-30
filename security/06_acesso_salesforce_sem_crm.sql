-- ============================================================================
-- 06 · Acesso à plataforma Sales Force sem dar acesso ao CRM (Baviera Vision Pro)
-- ----------------------------------------------------------------------------
-- PROBLEMA: as políticas de viaturas / utilizadores / historico passaram a exigir
-- is_platform_user(), que só aceita emails em app_users (CRM) ou platform_admins.
-- Utilizadores da plataforma que não estão no CRM (ex.: daniel.silva, rodrigo.silva,
-- jose.tavares) fazem login com sucesso mas o RLS devolve 0 linhas, sem erro.
--
-- CORREÇÃO: função própria, que valida contra public.utilizadores, aplicada apenas
-- às 3 tabelas da plataforma. is_platform_user() NÃO é alterada, porque protege
-- também as tabelas do CRM (prospec_*, crm_*, retomas, ...).
-- Aditivo: quem já tinha acesso continua a ter.
-- ============================================================================
create or replace function public.is_salesforce_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1 from public.utilizadores u
      where lower(u.email) = lower(auth.jwt() ->> 'email')
    ),
    false
  );
$$;

revoke all on function public.is_salesforce_user() from public, anon;
grant execute on function public.is_salesforce_user() to authenticated;

drop policy if exists salesforce_users on public.viaturas;
create policy salesforce_users on public.viaturas
  for all to authenticated
  using (public.is_salesforce_user()) with check (public.is_salesforce_user());

drop policy if exists salesforce_users on public.historico;
create policy salesforce_users on public.historico
  for all to authenticated
  using (public.is_salesforce_user()) with check (public.is_salesforce_user());

-- utilizadores: só leitura (a escrita passa pela Edge Function sf-gestao-utilizadores)
drop policy if exists salesforce_users_read on public.utilizadores;
create policy salesforce_users_read on public.utilizadores
  for select to authenticated
  using (public.is_salesforce_user());
