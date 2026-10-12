-- Repõe as políticas do 06 (sem camada tipo/marca).
begin;
drop policy if exists sf_viaturas_select on public.viaturas;
drop policy if exists sf_viaturas_insert on public.viaturas;
drop policy if exists sf_viaturas_update on public.viaturas;
drop policy if exists sf_viaturas_delete on public.viaturas;
drop policy if exists sf_vendidas_all    on public.viaturas_vendidas;
create policy sf_viaturas_select on public.viaturas for select to authenticated using ((select public.sf_perfil()) is not null);
create policy sf_viaturas_insert on public.viaturas for insert to authenticated with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));
create policy sf_viaturas_update on public.viaturas for update to authenticated using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador')) with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));
create policy sf_viaturas_delete on public.viaturas for delete to authenticated using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));
create policy sf_vendidas_all on public.viaturas_vendidas for all to authenticated using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador')) with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador'));
drop function if exists public.sf_pode_ver(text, jsonb);
commit;
