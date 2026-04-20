-- TakoPOS Phase 6
-- Align cloud products with the offline-first product model and add linked inventory deduction support.

alter table if exists public.products
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists selling_price_cents integer not null default 0,
  add column if not exists cost_price_cents integer not null default 0,
  add column if not exists inventory_tracking boolean not null default true,
  add column if not exists stock_count numeric not null default 0,
  add column if not exists linked_inventory_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists deduction_multiplier numeric not null default 1;

create index if not exists idx_products_tenant_updated
  on public.products (tenant_id, updated_at desc);

create index if not exists idx_products_linked_inventory_item
  on public.products (tenant_id, linked_inventory_item_id);
