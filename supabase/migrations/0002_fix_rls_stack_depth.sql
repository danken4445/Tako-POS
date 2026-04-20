-- Fix RLS recursion causing "stack depth limit exceeded"
-- Root cause: helper functions queried public.user_profiles while user_profiles
-- policies also called those helper functions.

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select up.role
  from public.user_profiles up
  where up.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select up.tenant_id
  from public.user_profiles up
  where up.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'SuperAdmin', false);
$$;

revoke all on function public.current_role() from public;
revoke all on function public.current_tenant_id() from public;
revoke all on function public.is_super_admin() from public;

grant execute on function public.current_role() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
