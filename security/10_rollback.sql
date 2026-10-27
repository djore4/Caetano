-- Volta ao 08/09: ver exige tipo E marca.
begin;
drop policy if exists sf_viaturas_select on public.viaturas;
create policy sf_viaturas_select on public.viaturas for select to authenticated
  using (public.sf_pode_ver(estado_negocio, to_jsonb(marca)));
drop policy if exists sf_vendidas_select on public.viaturas_vendidas;
drop policy if exists sf_vendidas_insert on public.viaturas_vendidas;
drop policy if exists sf_vendidas_update on public.viaturas_vendidas;
drop policy if exists sf_vendidas_delete on public.viaturas_vendidas;
create policy sf_vendidas_all on public.viaturas_vendidas for all to authenticated
  using      ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));
create or replace function public.sf_vu_parque()
returns table (
  id uuid, marca text, modelo text, versao text, motorizacao text, matricula text, chassis text,
  ano integer, data_matricula date, quilometragem integer, importado boolean,
  link_caetano text, link_fotos text, data_entrada_stock date, preco numeric,
  pvp_atualizado_em timestamptz, local text[], reserva_expira timestamptz, reserva_user text
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.id, r.marca, r.modelo, r.versao, r.motorizacao, r.matricula, r.chassis,
         r.ano, r.data_matricula, r.quilometragem, r.importado,
         r.link_caetano, r.link_fotos, r.data_entrada_stock, r.preco,
         r.pvp_atualizado_em, r.local, r.reserva_expira, r.reserva_user
  from public.retomas r
  where not r.arquivada and public.sf_pode_ver('VU', to_jsonb(r.marca))
$$;
revoke all on function public.sf_vu_parque() from public, anon;
grant execute on function public.sf_vu_parque() to authenticated;
drop function if exists public.sf_pode_ver_marca(jsonb);
commit;
