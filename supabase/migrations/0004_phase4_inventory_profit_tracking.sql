-- TakoPOS Phase 4
-- Unit-level inventory tracking, cost/selling price, and transaction profit logging.

alter table if exists public.products
  add column if not exists selling_price_cents integer not null default 0,
  add column if not exists cost_price_cents integer not null default 0,
  add column if not exists inventory_tracking boolean not null default true,
  add column if not exists stock_count numeric not null default 0;

update public.products
set selling_price_cents = price_cents
where selling_price_cents = 0;

alter table if exists public.sales
  add column if not exists gross_profit_cents integer not null default 0,
  add column if not exists expenses_cents integer not null default 0,
  add column if not exists net_profit_cents integer not null default 0;

alter table if exists public.sale_items
  add column if not exists cost_price_cents integer not null default 0,
  add column if not exists selling_price_cents integer not null default 0,
  add column if not exists gross_margin_cents integer not null default 0;
