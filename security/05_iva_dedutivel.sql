-- Flag "IVA dedutível" por viatura (Gestão VD + filtro no Parque).
-- Aplicado em produção a 2026-09-24.
alter table public.viaturas add column if not exists iva_dedutivel boolean not null default false;
alter table public.viaturas_vendidas add column if not exists iva_dedutivel boolean not null default false;
