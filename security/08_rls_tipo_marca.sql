-- ============================================================================
-- 08 · RLS por tipo (VD/VU) e marca — o servidor aplica a camada de permissões
-- ----------------------------------------------------------------------------
-- Requer: 06_rls_por_perfil.sql e 07_perfis_tipo_marca.sql já aplicados.
--
-- Regra (igual à da interface):
--   • Administrador vê/gere tudo.
--   • Os restantes só acedem a viaturas cujo TIPO (VD/VU) E MARCA estão no seu perfil
--     ('Todas' também é aceite). Tipo vazio conta como VD; marca vazia conta como BMW.
--   • Perfil sem tipos ou sem marcas = sem acesso a viaturas.
--   • Escrita continua limitada a Chefe de Vendas e Administrador (política do 06); o WITH CHECK
--     impede também mover uma viatura para um tipo/marca fora do perfil.
-- Aplica-se a public.viaturas e public.viaturas_vendidas.
-- Rollback: 08_rollback.sql
-- ============================================================================
begin;

create or replace function public.sf_pode_ver(neg text, marcas jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case
      when u.perfil = 'Administrador' then true
      else
        (to_jsonb(u.negocio) ? 'Todas' or to_jsonb(u.negocio) ? (case when neg = 'VU' then 'VU' else 'VD' end))
        and exists (
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
revoke all on function public.sf_pode_ver(text, jsonb) from public, anon;
grant execute on function public.sf_pode_ver(text, jsonb) to authenticated;

drop policy if exists sf_viaturas_select on public.viaturas;
drop policy if exists sf_viaturas_insert on public.viaturas;
drop policy if exists sf_viaturas_update on public.viaturas;
drop policy if exists sf_viaturas_delete on public.viaturas;
drop policy if exists sf_vendidas_all    on public.viaturas_vendidas;

create policy sf_viaturas_select on public.viaturas for select to authenticated
  using (public.sf_pode_ver(estado_negocio, to_jsonb(marca)));
create policy sf_viaturas_insert on public.viaturas for insert to authenticated
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));
create policy sf_viaturas_update on public.viaturas for update to authenticated
  using      ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));
create policy sf_viaturas_delete on public.viaturas for delete to authenticated
  using ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));

create policy sf_vendidas_all on public.viaturas_vendidas for all to authenticated
  using      ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)))
  with check ((select public.sf_perfil()) in ('Chefe de Vendas','Administrador') and public.sf_pode_ver(estado_negocio, to_jsonb(marca)));

commit;
