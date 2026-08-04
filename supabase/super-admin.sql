-- Global Super Admin role and cross-organization master-data permissions.
begin;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.platform_admins where user_id=auth.uid());
$$;

drop policy if exists "super admins read role" on public.platform_admins;
create policy "super admins read role" on public.platform_admins for select to authenticated using(user_id=auth.uid() or public.is_super_admin());

drop policy if exists "super admins read profiles" on public.profiles;
create policy "super admins read profiles" on public.profiles for select to authenticated using(id=auth.uid() or public.is_super_admin());

drop policy if exists "super admins manage organizations" on public.organizations;
drop policy if exists "super admins manage departments" on public.departments;
drop policy if exists "super admins manage items" on public.items;
drop policy if exists "super admins manage packages" on public.item_packages;
drop policy if exists "super admins manage department items" on public.department_items;
drop policy if exists "super admins manage access rules" on public.member_access_rules;
drop policy if exists "super admins manage organization members" on public.organization_members;
drop policy if exists "super admins manage department members" on public.department_members;

create policy "super admins manage organizations" on public.organizations for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "super admins manage departments" on public.departments for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "super admins manage items" on public.items for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "super admins manage packages" on public.item_packages for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "super admins manage department items" on public.department_items for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "super admins manage access rules" on public.member_access_rules for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "super admins manage organization members" on public.organization_members for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());
create policy "super admins manage department members" on public.department_members for all to authenticated using(public.is_super_admin()) with check(public.is_super_admin());

grant select,insert,update,delete on public.organizations,public.departments,public.items,public.item_packages,public.department_items,public.member_access_rules,public.organization_members,public.department_members to authenticated;
grant select on public.platform_admins to authenticated;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.clear_organization_inventory(target_organization_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare deleted_count integer;
begin
  if not public.is_super_admin() and not public.is_organization_admin(target_organization_id) then raise exception 'Admin access required'; end if;
  delete from public.items where organization_id=target_organization_id;
  get diagnostics deleted_count=row_count;
  return deleted_count;
end; $$;

grant execute on function public.clear_organization_inventory(uuid) to authenticated;

-- On first installation, promote the earliest active organization admin.
insert into public.platform_admins(user_id)
select user_id from public.organization_members where role='admin' and status='active' order by joined_at limit 1
on conflict(user_id) do nothing;

commit;
notify pgrst,'reload schema';
