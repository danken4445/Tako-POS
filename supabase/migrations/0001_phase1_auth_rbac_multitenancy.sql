-- TakoPOS Phase 1
-- Multi-tenant schema, roles, and strict RLS isolation.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'app_role' and n.nspname = 'public'
  ) then
    create type public.app_role as enum ('SuperAdmin', 'StoreOwner', 'Cashier');
  end if;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  role public.app_role not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_preferences (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  color_palette jsonb,
  logo_path text,
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text,
  name text not null,
  quantity numeric not null default 0,
  unit text,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cashier_profile_id uuid references public.user_profiles(id) on delete set null,
  total_cents integer not null check (total_cents >= 0),
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quantity numeric not null default 1,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns public.app_role
language sql
stable
as $$
  select up.role
  from public.user_profiles up
  where up.user_id = auth.uid();
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select up.tenant_id
  from public.user_profiles up
  where up.user_id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_role() = 'SuperAdmin', false);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_tenant_preferences_updated_at on public.tenant_preferences;
create trigger trg_tenant_preferences_updated_at
before update on public.tenant_preferences
for each row execute function public.set_updated_at();

drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

alter table public.tenants enable row level security;
alter table public.user_profiles enable row level security;
alter table public.tenant_preferences enable row level security;
alter table public.products enable row level security;
alter table public.inventory_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

drop policy if exists tenant_read_own on public.tenants;
create policy tenant_read_own
on public.tenants
for select
using (
  public.is_super_admin() or id = public.current_tenant_id()
);

drop policy if exists user_profiles_read_tenant on public.user_profiles;
create policy user_profiles_read_tenant
on public.user_profiles
for select
using (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
);

drop policy if exists user_profiles_owner_manage on public.user_profiles;
create policy user_profiles_owner_manage
on public.user_profiles
for all
using (
  public.is_super_admin()
  or (
    tenant_id = public.current_tenant_id()
    and public.current_role() = 'StoreOwner'
  )
)
with check (
  public.is_super_admin()
  or (
    tenant_id = public.current_tenant_id()
    and public.current_role() = 'StoreOwner'
  )
);

drop policy if exists tenant_preferences_read_tenant on public.tenant_preferences;
create policy tenant_preferences_read_tenant
on public.tenant_preferences
for select
using (
  public.is_super_admin() or tenant_id = public.current_tenant_id()
);

drop policy if exists tenant_preferences_owner_manage on public.tenant_preferences;
create policy tenant_preferences_owner_manage
on public.tenant_preferences
for all
using (
  public.is_super_admin()
  or (
    tenant_id = public.current_tenant_id()
    and public.current_role() = 'StoreOwner'
  )
)
with check (
  public.is_super_admin()
  or (
    tenant_id = public.current_tenant_id()
    and public.current_role() = 'StoreOwner'
  )
);

drop policy if exists products_rw_tenant on public.products;
create policy products_rw_tenant
on public.products
for all
using (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
)
with check (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
);

drop policy if exists inventory_rw_tenant on public.inventory_items;
create policy inventory_rw_tenant
on public.inventory_items
for all
using (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
)
with check (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
);

drop policy if exists sales_rw_tenant on public.sales;
create policy sales_rw_tenant
on public.sales
for all
using (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
)
with check (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
);

drop policy if exists sale_items_rw_tenant on public.sale_items;
create policy sale_items_rw_tenant
on public.sale_items
for all
using (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
)
with check (
  public.is_super_admin()
  or tenant_id = public.current_tenant_id()
);

insert into storage.buckets (id, name, public)
values ('tenant-assets', 'tenant-assets', false)
on conflict (id) do nothing;

drop policy if exists tenant_logo_read on storage.objects;
create policy tenant_logo_read
on storage.objects
for select
using (
  bucket_id = 'tenant-assets'
  and (
    public.is_super_admin()
    or split_part(name, '/', 1)::uuid = public.current_tenant_id()
  )
);

drop policy if exists tenant_logo_owner_write on storage.objects;
create policy tenant_logo_owner_write
on storage.objects
for all
using (
  bucket_id = 'tenant-assets'
  and (
    public.is_super_admin()
    or (
      public.current_role() = 'StoreOwner'
      and split_part(name, '/', 1)::uuid = public.current_tenant_id()
    )
  )
)
with check (
  bucket_id = 'tenant-assets'
  and (
    public.is_super_admin()
    or (
      public.current_role() = 'StoreOwner'
      and split_part(name, '/', 1)::uuid = public.current_tenant_id()
    )
  )
);