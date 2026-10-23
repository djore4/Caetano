-- Rollback do 09: remove as funções do stock VU.
-- NÃO remove sf_perfil / sf_pode_ver (são partilhadas com o 06 / 08) nem as colunas novas
-- da retomas (apagá-las perderia dados: versão, ano, concessão, proveniência, reservas).
-- Se mesmo assim quiseres as colunas fora, descomenta o último bloco.
begin;
drop function if exists public.sf_vu_reservar(uuid, boolean);
drop function if exists public.sf_vu_arquivar(uuid, boolean);
drop function if exists public.sf_vu_guardar(jsonb);
drop function if exists public.sf_vu_gestao(boolean);
drop function if exists public.sf_vu_parque();
drop function if exists public.sf_vu_gere();
commit;

-- begin;
-- alter table public.retomas
--   drop column if exists versao, drop column if exists ano, drop column if exists chassis,
--   drop column if exists proveniencia, drop column if exists pvp_atualizado_em,
--   drop column if exists reserva_expira, drop column if exists reserva_user, drop column if exists local;
-- commit;
