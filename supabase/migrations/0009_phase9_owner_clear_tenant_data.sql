-- TakoPOS Phase 9
-- Atomic tenant operational data reset for owner/admin maintenance.

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