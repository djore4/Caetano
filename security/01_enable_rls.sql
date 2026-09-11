-- ============================================================================
-- 01 · Ativar Row Level Security nas tabelas da plataforma de vendas
-- ----------------------------------------------------------------------------
-- Efeito: o acesso anónimo (chave anon, pública no HTML) deixa de conseguir ler
-- ou escrever nestas tabelas. Só sessões autenticadas via Supabase Auth passam.
--
-- Modelo ATUAL: login partilhado. Por isso as políticas distinguem apenas
-- anon (negado, por ausência de política) de authenticated (permitido).
-- Na Fase 2 (contas individuais) estas políticas ganham condições por
-- perfil/local, usando o utilizador da sessão (auth.jwt() ->> 'email').
--
-- ⚠️  ORDEM DE DEPLOY: aplicar SÓ depois de o novo index.html (login via
--     signInWithPassword) estar em produção e de existir a conta de acesso.
--     Ver security/README.md.
-- ============================================================================
begin;

alter table public.viaturas       enable row level security;
alter table public.historico      enable row level security;
alter table public.locais         enable row level security;
alter table public.precos_inputs  enable row level security;
alter table public.utilizadores   enable row level security;

create policy "auth_rw_viaturas"      on public.viaturas      for all to authenticated using (true) with check (true);
create policy "auth_rw_historico"     on public.historico     for all to authenticated using (true) with check (true);
create policy "auth_rw_locais"        on public.locais        for all to authenticated using (true) with check (true);
create policy "auth_rw_precos_inputs" on public.precos_inputs for all to authenticated using (true) with check (true);
create policy "auth_rw_utilizadores"  on public.utilizadores  for all to authenticated using (true) with check (true);

commit;
