-- TakoPOS Phase 2
-- Add sync-friendly timestamps so local pull can use last-write-wins cursors.

alter table if exists public.products
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();
