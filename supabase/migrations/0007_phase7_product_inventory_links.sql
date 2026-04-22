-- TakoPOS Phase 7
-- Dedicated product-inventory link table for multi-linked deduction sync.

create table if not exists public.product_inventory_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (tenant_id, product_id, inventory_item_id)
);

create index if not exists idx_product_inventory_links_tenant_product
  on public.product_inventory_links (tenant_id, product_id);

create index if not exists idx_product_inventory_links_tenant_updated
  on public.product_inventory_links (tenant_id, updated_at desc);

create index if not exists idx_product_inventory_links_tenant_inventory
  on public.product_inventory_links (tenant_id, inventory_item_id);

insert into public.product_inventory_links (tenant_id, product_id, inventory_item_id)
select p.tenant_id, p.id, p.linked_inventory_item_id
from public.products p
where p.linked_inventory_item_id is not null
on conflict (tenant_id, product_id, inventory_item_id) do nothing;

alter table public.product_inventory_links enable row level security;

drop policy if exists product_inventory_links_tenant_read on public.product_inventory_links;
drop policy if exists product_inventory_links_tenant_write on public.product_inventory_links;

create policy product_inventory_links_tenant_read on public.product_inventory_links
for select using (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy product_inventory_links_tenant_write on public.product_inventory_links
for all using (
  public.is_super_admin() or tenant_id = public.current_tenant_id()
)
with check (
  public.is_super_admin() or tenant_id = public.current_tenant_id()
);
