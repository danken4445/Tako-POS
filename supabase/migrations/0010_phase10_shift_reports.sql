-- TakoPOS Phase 10
-- Shift reports (Z-reading) and payment methods.

alter table if exists public.sales
  add column if not exists payment_method text not null default 'cash';

create table if not exists public.shift_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cashier_profile_id uuid references public.user_profiles(id) on delete set null,
  starting_cash_cents integer not null default 0,
  total_cash_sales_cents integer not null default 0,
  cash_refunds_cents integer not null default 0,
  pay_ins_cents integer not null default 0,
  payouts_cents integer not null default 0,
  expected_cash_cents integer not null default 0,
  actual_cash_cents integer not null default 0,
  variance_cents integer not null default 0,
  denomination_breakdown jsonb not null default '{}'::jsonb,
  payments_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_reports_tenant_created
  on public.shift_reports (tenant_id, created_at desc);

alter table public.shift_reports enable row level security;

drop policy if exists shift_reports_rw_tenant on public.shift_reports;
create policy shift_reports_rw_tenant
on public.shift_reports
for all
using (public.is_super_admin() or tenant_id = public.current_tenant_id())
with check (public.is_super_admin() or tenant_id = public.current_tenant_id());

create or replace function public.clear_tenant_data(target_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.is_super_admin()
    or (
      public.current_role() = 'StoreOwner'
      and public.current_tenant_id() = target_tenant_id
    )
  ) then
    raise exception 'insufficient privileges to clear tenant data';
  end if;

  delete from public.shift_reports where tenant_id = target_tenant_id;
  delete from public.sale_items where tenant_id = target_tenant_id;
  delete from public.sales where tenant_id = target_tenant_id;
  delete from public.product_inventory_links where tenant_id = target_tenant_id;
  delete from public.products where tenant_id = target_tenant_id;
  delete from public.inventory_items where tenant_id = target_tenant_id;
  delete from public.categories where tenant_id = target_tenant_id;
  delete from public.staff_members where tenant_id = target_tenant_id;
end;
$$;

revoke all on function public.clear_tenant_data(uuid) from public;
grant execute on function public.clear_tenant_data(uuid) to authenticated;
