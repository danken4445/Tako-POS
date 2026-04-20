-- TakoPOS Phase 5
-- Admin dashboard management tables for products, categories, and staff.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_categories_tenant_name
  on public.categories (tenant_id, name asc);

alter table if exists public.products
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  role text not null,
  phone text,
  pin_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_staff_members_tenant_name
  on public.staff_members (tenant_id, name asc);

alter table public.categories enable row level security;
alter table public.staff_members enable row level security;

drop policy if exists categories_tenant_read on public.categories;
drop policy if exists categories_tenant_write on public.categories;
drop policy if exists staff_tenant_read on public.staff_members;
drop policy if exists staff_tenant_write on public.staff_members;

create policy categories_tenant_read on public.categories
for select using (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy categories_tenant_write on public.categories
for all using (
  public.is_super_admin() or tenant_id = public.current_tenant_id()
)
with check (
  public.is_super_admin() or tenant_id = public.current_tenant_id()
);

create policy staff_tenant_read on public.staff_members
for select using (public.is_super_admin() or tenant_id = public.current_tenant_id());

create policy staff_tenant_write on public.staff_members
for all using (
  public.is_super_admin() or tenant_id = public.current_tenant_id()
)
with check (
  public.is_super_admin() or tenant_id = public.current_tenant_id()
);
