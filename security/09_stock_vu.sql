-- ============================================================================
-- 09 · Stock VU (Gestão VU + Parque VU) sobre a tabela public.retomas
-- ----------------------------------------------------------------------------
-- O stock de viaturas usadas é UMA só tabela: public.retomas (já usada pelo tab
-- Stock do Baviera Vision Pro, mesmo projeto Supabase). Esta migração:
--
--   1. estende a retomas com o que o Parque precisa (versão, ano, chassis,
--      concessão, proveniência, data da última revisão de preço, reserva);
--   2. expõe o acesso do Caetano por funções (security definer), sem mexer nas
--      políticas RLS da retomas (que continuam a ser as do Baviera: matriz de
--      permissões por tab):
--
--        função              quem                    o quê
--        sf_vu_parque()      qualquer perfil*        stock ativo SEM proveniência, observações,
--                                                    link Maxterauto nem created_by
--        sf_vu_gestao(b)     Chefe de Vendas / Adm.* tudo (b = ver arquivadas)
--        sf_vu_guardar(j)    Chefe de Vendas / Adm.* cria/edita (não toca em reserva/arquivo)
--        sf_vu_arquivar()    Chefe de Vendas / Adm.* vendida / recuperar
--        sf_vu_reservar()    Chefe de Vendas / Adm.* reserva 48h atómica / cancelar
--
--      * e só viaturas VU cuja marca está no perfil (camada Tipo x Marca, ver 07/08).
--
-- AUTÓNOMA: não depende do 06 nem do 08 (define aqui sf_perfil e sf_pode_ver,
-- idênticas às desses ficheiros — create or replace é inofensivo se já existirem).
-- Só requer as colunas utilizadores.negocio/marca (07).
--
-- LIMITE CONHECIDO: um utilizador que também esteja em app_users do Baviera com
-- acesso ao tab stock/wip/vendedores lê a retomas diretamente (políticas do Baviera)
-- e, nesse caso, vê a proveniência. Tirar isso exige alterar o RLS do Baviera.
--
-- Rollback: 09_rollback.sql
-- ============================================================================
begin;

-- ── 1. Colunas novas (todas opcionais: o Baviera continua a funcionar) ───────
alter table public.retomas
  add column if not exists versao             text,
  add column if not exists ano                integer,
  add column if not exists chassis            text,
  add column if not exists proveniencia       text,
  add column if not exists pvp_atualizado_em  timestamptz,
  add column if not exists reserva_expira     timestamptz,
  add column if not exists reserva_user       text,
  add column if not exists local              text[] not null default '{}';

alter table public.retomas drop constraint if exists retomas_ano_check;
alter table public.retomas add constraint retomas_ano_check
  check (ano is null or ano between 1950 and 2100);

-- O stock existente fica com a data de revisão do preço = última atualização da linha.
update public.retomas
   set pvp_atualizado_em = coalesce(updated_at, created_at)
 where preco is not null and pvp_atualizado_em is null;

create index if not exists retomas_reserva_idx on public.retomas (reserva_expira) where reserva_expira is not null;

-- ── 2. Identidade e camada Tipo x Marca (iguais ao 06 / 08) ──────────────────
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

-- Quem gere o stock VU.
create or replace function public.sf_vu_gere()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.sf_perfil() in ('Chefe de Vendas', 'Administrador'), false)
$$;
revoke all on function public.sf_vu_gere() from public, anon;
grant execute on function public.sf_vu_gere() to authenticated;

-- ── 3. Leitura para o Parque (todos os perfis) — colunas seguras ─────────────
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
    and public.sf_pode_ver('VU', to_jsonb(r.marca))
$$;
revoke all on function public.sf_vu_parque() from public, anon;
grant execute on function public.sf_vu_parque() to authenticated;

-- ── 4. Gestão (Chefe de Vendas / Administrador) — tudo, incl. proveniência ───
create or replace function public.sf_vu_gestao(p_arquivadas boolean default false)
returns setof public.retomas
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.*
  from public.retomas r
  where public.sf_vu_gere()
    and r.arquivada = coalesce(p_arquivadas, false)
    and public.sf_pode_ver('VU', to_jsonb(r.marca))
$$;
revoke all on function public.sf_vu_gestao(boolean) from public, anon;
grant execute on function public.sf_vu_gestao(boolean) to authenticated;

create or replace function public.sf_vu_guardar(p jsonb)
returns public.retomas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_marca  text := nullif(btrim(p ->> 'marca'), '');
  v_modelo text := nullif(btrim(p ->> 'modelo'), '');
  v_mot    text := nullif(lower(btrim(p ->> 'motorizacao')), '');
  v_prov   text := nullif(upper(btrim(p ->> 'proveniencia')), '');
  v_mat    text := nullif(upper(regexp_replace(coalesce(p ->> 'matricula', ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_preco  numeric := nullif(p ->> 'preco', '')::numeric;
  v_local  text[] := '{}';
  v_antes  public.retomas;
  v_nome   text;
  v_row    public.retomas;
begin
  if not public.sf_vu_gere() then
    raise exception 'Sem permissão para gerir o stock VU' using errcode = '42501';
  end if;
  if v_marca is null or v_modelo is null then
    raise exception 'Marca e modelo são obrigatórios' using errcode = '22023';
  end if;
  if not public.sf_pode_ver('VU', to_jsonb(v_marca)) then
    raise exception 'Sem permissão para esta marca' using errcode = '42501';
  end if;
  if v_mot is not null and v_mot not in ('ice', 'phev', 'bev') then
    raise exception 'Motorização inválida' using errcode = '22023';
  end if;
  if v_prov is not null and v_prov not in ('REMARK', 'RETOMA', 'CONSIGN', 'LEILÃO') then
    raise exception 'Proveniência inválida' using errcode = '22023';
  end if;
  if v_preco is not null and v_preco < 0 then
    raise exception 'Preço inválido' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'local') = 'array' then
    select coalesce(array_agg(btrim(x)), '{}') into v_local
    from jsonb_array_elements_text(p -> 'local') x where btrim(x) <> '';
  end if;

  -- Matrícula repetida no stock ativo = a mesma viatura digitada duas vezes.
  if v_mat is not null and exists (
    select 1 from public.retomas r
    where not r.arquivada
      and upper(regexp_replace(coalesce(r.matricula, ''), '[^A-Za-z0-9]', '', 'g')) = v_mat
      and (v_id is null or r.id <> v_id)
  ) then
    raise exception 'Já existe no stock uma viatura com esta matrícula' using errcode = '23505';
  end if;

  select u.nome into v_nome from public.utilizadores u
   where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1;

  if v_id is not null then
    select * into v_antes from public.retomas where id = v_id for update;
    if not found then raise exception 'Viatura não encontrada' using errcode = 'P0002'; end if;
    if not public.sf_pode_ver('VU', to_jsonb(v_antes.marca)) then
      raise exception 'Sem permissão para esta viatura' using errcode = '42501';
    end if;
    update public.retomas set
      marca = v_marca, modelo = v_modelo,
      versao = nullif(btrim(p ->> 'versao'), ''),
      motorizacao = v_mot,
      matricula = nullif(btrim(p ->> 'matricula'), ''),
      chassis = nullif(upper(btrim(p ->> 'chassis')), ''),
      ano = nullif(p ->> 'ano', '')::integer,
      data_matricula = nullif(p ->> 'data_matricula', '')::date,
      quilometragem = nullif(p ->> 'quilometragem', '')::integer,
      importado = coalesce((p ->> 'importado')::boolean, false),
      link_caetano = nullif(btrim(p ->> 'link_caetano'), ''),
      link_maxterauto = nullif(btrim(p ->> 'link_maxterauto'), ''),
      link_fotos = nullif(btrim(p ->> 'link_fotos'), ''),
      data_entrada_stock = coalesce(nullif(p ->> 'data_entrada_stock', '')::date, v_antes.data_entrada_stock),
      preco = v_preco,
      pvp_atualizado_em = case when v_preco is distinct from v_antes.preco then now() else v_antes.pvp_atualizado_em end,
      proveniencia = v_prov,
      observacoes = nullif(btrim(p ->> 'observacoes'), ''),
      local = v_local,
      updated_at = now()
    where id = v_id
    returning * into v_row;
  else
    insert into public.retomas (
      marca, modelo, versao, motorizacao, matricula, chassis, ano, data_matricula, quilometragem, importado,
      link_caetano, link_maxterauto, link_fotos, data_entrada_stock, preco, pvp_atualizado_em,
      proveniencia, observacoes, local, created_by
    ) values (
      v_marca, v_modelo, nullif(btrim(p ->> 'versao'), ''), v_mot,
      nullif(btrim(p ->> 'matricula'), ''), nullif(upper(btrim(p ->> 'chassis')), ''),
      nullif(p ->> 'ano', '')::integer, nullif(p ->> 'data_matricula', '')::date,
      nullif(p ->> 'quilometragem', '')::integer, coalesce((p ->> 'importado')::boolean, false),
      nullif(btrim(p ->> 'link_caetano'), ''), nullif(btrim(p ->> 'link_maxterauto'), ''),
      nullif(btrim(p ->> 'link_fotos'), ''),
      coalesce(nullif(p ->> 'data_entrada_stock', '')::date, current_date),
      v_preco, case when v_preco is not null then now() end,
      v_prov, nullif(btrim(p ->> 'observacoes'), ''), v_local, coalesce(v_nome, auth.jwt() ->> 'email')
    )
    returning * into v_row;
  end if;
  return v_row;
end
$$;
revoke all on function public.sf_vu_guardar(jsonb) from public, anon;
grant execute on function public.sf_vu_guardar(jsonb) to authenticated;

-- Vendida (arquivar) / recuperar. Ao arquivar limpa a reserva.
create or replace function public.sf_vu_arquivar(p_id uuid, p_arquivar boolean default true)
returns public.retomas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.retomas;
begin
  if not public.sf_vu_gere() then
    raise exception 'Sem permissão para gerir o stock VU' using errcode = '42501';
  end if;
  update public.retomas set
    arquivada = coalesce(p_arquivar, true),
    arquivada_at = case when coalesce(p_arquivar, true) then now() end,
    reserva_expira = case when coalesce(p_arquivar, true) then null else reserva_expira end,
    reserva_user   = case when coalesce(p_arquivar, true) then null else reserva_user end,
    updated_at = now()
  where id = p_id and public.sf_pode_ver('VU', to_jsonb(marca))
  returning * into v_row;
  if not found then raise exception 'Viatura não encontrada' using errcode = 'P0002'; end if;
  return v_row;
end
$$;
revoke all on function public.sf_vu_arquivar(uuid, boolean) from public, anon;
grant execute on function public.sf_vu_arquivar(uuid, boolean) to authenticated;

-- Reserva de 48h (atómica: duas pessoas não reservam a mesma viatura) / cancelar.
create or replace function public.sf_vu_reservar(p_id uuid, p_cancelar boolean default false)
returns public.retomas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.retomas; v_nome text;
begin
  if not public.sf_vu_gere() then
    raise exception 'Só o Chefe de Vendas pode reservar' using errcode = '42501';
  end if;
  select u.nome into v_nome from public.utilizadores u
   where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1;

  if coalesce(p_cancelar, false) then
    update public.retomas set reserva_expira = null, reserva_user = null, updated_at = now()
    where id = p_id and not arquivada and public.sf_pode_ver('VU', to_jsonb(marca))
    returning * into v_row;
  else
    update public.retomas set reserva_expira = now() + interval '48 hours', reserva_user = v_nome, updated_at = now()
    where id = p_id and not arquivada and public.sf_pode_ver('VU', to_jsonb(marca))
      and (reserva_expira is null or reserva_expira <= now())
    returning * into v_row;
    if not found then
      if exists (select 1 from public.retomas where id = p_id and not arquivada and reserva_expira > now()) then
        raise exception 'Viatura já reservada' using errcode = '55P03';
      end if;
    end if;
  end if;
  if not found then raise exception 'Viatura não encontrada' using errcode = 'P0002'; end if;
  return v_row;
end
$$;
revoke all on function public.sf_vu_reservar(uuid, boolean) from public, anon;
grant execute on function public.sf_vu_reservar(uuid, boolean) to authenticated;

commit;
