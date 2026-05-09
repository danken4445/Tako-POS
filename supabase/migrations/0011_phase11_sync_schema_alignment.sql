-- TakoPOS Phase 11
-- Align cloud tables with the current offline sync payloads.

alter table if exists public.products
  add column if not exists deleted_at timestamptz;

alter table if exists public.inventory_items
  add column if not exists deleted_at timestamptz;

alter table if exists public.sales
  add column if not exists cashier_profile_id uuid references public.user_profiles(id) on delete set null,
  add column if not exists gross_profit_cents integer not null default 0,
  add column if not exists expenses_cents integer not null default 0,
  add column if not exists net_profit_cents integer not null default 0,
  add column if not exists payment_method text not null default 'cash';

alter table if exists public.sale_items
  add column if not exists cost_price_cents integer not null default 0,
  add column if not exists selling_price_cents integer not null default 0,
  add column if not exists gross_margin_cents integer not null default 0;

update public.sales
set payment_method = 'cash'
where payment_method is null;
