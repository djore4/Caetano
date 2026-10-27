-- ============================================================================
-- 10 · Ver é por marca; o tipo (VD/VU) do perfil só limita a ESCRITA
-- ----------------------------------------------------------------------------
-- Requer: 06, 08 (e 09 para o Parque VU) já aplicados.
-- Antes (08/09): sf_pode_ver exigia tipo E marca, também para LER — um Chefe de Vendas
-- só-VU deixava de ver as VD no Parque. Agora:
--   • ler (viaturas, viaturas_vendidas, Parque VU): só a marca tem de estar no perfil;
--   • escrever (insert/update/delete, Gestão VU): tipo E marca (sf_pode_ver, inalterada).
-- Rollback: 10_rollback.sql
-- ============================================================================
begin;

create or replace function public.sf_pode_ver_marca(marcas jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when u.perfil = 'Administrador' then true
      else exists (
        select 1
        from jsonb_array_elements_text(
          case jsonb_typeof(coalesce(marcas, 'null'::jsonb))
            when 'array'  then case when jsonb_array_length(marcas) = 0 then '["BMW"]'::jsonb else marcas end
            when 'string' then jsonb_build_array(marcas #>> '{}')
            else '["BMW"]'::jsonb
          end) m(v)
        where to_jsonb(u.marca) ? 'Todas' or to_jsonb(u.marca) ? m.v
      )
    end
    from public.utilizadores u
    where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1
  ), false)
$$;
revoke all on function public.sf_pode_ver_marca(jsonb) from public, anon;
grant execute on function public.sf_pode_ver_marca(jsonb) to authenticated;

drop policy if exists sf_viaturas_select on public.viaturas;
create policy sf_viaturas_select on public.viaturas for select to authenticated
  using (public.sf_pode_ver_marca(to_jsonb(marca)));

-- viaturas_vendidas: leitura por marca para Chefe de Vendas/Administrador; escrita com tipo.
drop policy if exists sf_vendidas_all on public.viaturas_vendidas;
create policy sf_vendidas_select on public.viaturas_vendidas for select to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver_marca(to_jsonb(marca)));
create policy sf_vendidas_insert on public.viaturas_vendidas for insert to authenticated
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));
create policy sf_vendidas_update on public.viaturas_vendidas for update to authenticated
  using      ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));
create policy sf_vendidas_delete on public.viaturas_vendidas for delete to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));

-- Parque VU: todos os perfis veem o stock VU das suas marcas (a gestão continua a exigir tipo VU).
create or replace function public.sf_vu_parque()
returns table (
  id uuid, marca text, modelo text, versao text, motorizacao text, matricula text, chassis text,
  ano integer, data_matricula date, quilometragem integer, importado boolean,
  link_caetano text, link_fotos text, data_entrada_stock date, preco numeric,
  pvp_atualizado_em timestamptz, local text[], reserva_expira timestamptz, reserva_user text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.marca, r.modelo, r.versao, r.motorizacao, r.matricula, r.chassis,
         r.ano, r.data_matricula, r.quilometragem, r.importado,
         r.link_caetano, r.link_fotos, r.data_entrada_stock, r.preco,
         r.pvp_atualizado_em, r.local, r.reserva_expira, r.reserva_user
  from public.retomas r
  where not r.arquivada
    and public.sf_pode_ver_marca(to_jsonb(r.marca))
$$;
revoke all on function public.sf_vu_parque() from public, anon;
grant execute on function public.sf_vu_parque() to authenticated;

commit;
