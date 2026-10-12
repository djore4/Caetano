-- ============================================================================
-- 07 · Perfis com tipo de viatura (VD/VU) e marca (BMW / BMW Motorrad)  — PASSO DE DADOS
-- ----------------------------------------------------------------------------
-- Cada utilizador passa a ter, além da concessão, os TIPOS (VD/VU) e as MARCAS a que acede.
-- Até aqui as colunas `negocio` e `marca` existiam mas eram preenchidas com valores fixos
-- (['VD'] / ['BMW']) e nunca eram aplicadas — todos viam tudo.
--
-- Para NÃO alterar o que cada pessoa vê hoje, este passo dá a TODOS os utilizadores
-- existentes acesso completo (VD+VU, BMW+BMW Motorrad). Depois, a Administração restringe
-- por pessoa em Utilizadores. É inofensivo para a versão antiga da app (que ignora estes campos).
--
-- ORDEM: aplicar ANTES de publicar o index.html novo e ANTES do 08.
-- Funciona quer as colunas sejam jsonb quer text[].
-- ============================================================================
do $$
declare t_neg text; t_marca text;
begin
  select data_type into t_neg   from information_schema.columns where table_schema='public' and table_name='utilizadores' and column_name='negocio';
  select data_type into t_marca from information_schema.columns where table_schema='public' and table_name='utilizadores' and column_name='marca';
  if t_neg is null or t_marca is null then raise exception 'public.utilizadores sem colunas negocio/marca'; end if;

  if t_neg = 'jsonb' then update public.utilizadores set negocio = '["VD","VU"]'::jsonb;
  elsif t_neg = 'ARRAY' then update public.utilizadores set negocio = array['VD','VU'];
  else raise exception 'tipo inesperado para utilizadores.negocio: %', t_neg; end if;

  if t_marca = 'jsonb' then update public.utilizadores set marca = '["BMW","BMW Motorrad"]'::jsonb;
  elsif t_marca = 'ARRAY' then update public.utilizadores set marca = array['BMW','BMW Motorrad'];
  else raise exception 'tipo inesperado para utilizadores.marca: %', t_marca; end if;
end $$;
