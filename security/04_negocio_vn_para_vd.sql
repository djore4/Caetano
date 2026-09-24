-- Converte o tipo de negócio legado 'VN' para 'VD' (viaturas de demonstração).
-- Aplicado em produção a 2026-09-24.
begin;
update viaturas set estado_negocio = 'VD' where estado_negocio = 'VN' or estado_negocio is null;
update viaturas_vendidas set estado_negocio = 'VD' where estado_negocio = 'VN' or estado_negocio is null;
update utilizadores u set negocio = (
  select coalesce(jsonb_agg(distinct case when e = 'VN' then 'VD' else e end), '[]'::jsonb)
  from jsonb_array_elements_text(u.negocio) e)
where u.negocio ? 'VN';
commit;
