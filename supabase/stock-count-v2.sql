-- BMS Mobile Stock Count v2: roles + master data + collaborative access
begin;

alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.department_members drop constraint if exists department_members_role_check;
update public.organization_members set role=case when role in ('organization_admin','department_admin') then 'admin' when role in ('reviewer') then 'staff' else 'user' end;
update public.department_members set role=case when role in ('department_admin') then 'admin' when role in ('reviewer') then 'staff' else 'user' end;
alter table public.organization_members alter column role set default 'user';
alter table public.department_members alter column role set default 'user';
alter table public.organization_members add constraint organization_members_role_check check(role in ('admin','staff','user'));
alter table public.department_members add constraint department_members_role_check check(role in ('admin','staff','user'));

with first_members as (
  select distinct on (organization_id) organization_id,user_id from public.organization_members order by organization_id,joined_at
)
update public.organization_members m set role='admin' from first_members f
where m.organization_id=f.organization_id and m.user_id=f.user_id
  and not exists(select 1 from public.organization_members x where x.organization_id=m.organization_id and x.role='admin');
update public.department_members d set role='admin'
where exists(select 1 from public.organization_members o join public.departments p on p.organization_id=o.organization_id where o.user_id=d.user_id and o.role='admin' and p.id=d.department_id);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null, name text not null, base_unit text not null default 'หน่วย', barcode text, category text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,code)
);
create table if not exists public.item_packages (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references public.items(id) on delete cascade,
  name text not null, size numeric not null check(size>0), barcode text, created_at timestamptz not null default now(),
  unique(item_id,name,size)
);
create table if not exists public.department_items (
  id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade, location text,
  status text not null default 'pending' check(status in ('pending','counting','completed','review','missing','locked')),
  assigned_to uuid references auth.users(id), locked_by uuid references auth.users(id), lock_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(department_id,item_id)
);
create table if not exists public.member_access_rules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade, email text not null,
  role text not null default 'user' check(role in ('admin','staff','user')), created_at timestamptz not null default now(),
  unique(department_id,email)
);
create table if not exists public.opening_stock_counts (
  id uuid primary key default gen_random_uuid(), department_item_id uuid not null unique references public.department_items(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','done','review','missing','locked')),
  note text not null default '', counted_by uuid references auth.users(id), counter_name text not null default '',
  version integer not null default 1, completed_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.opening_stock_entries (
  id uuid primary key default gen_random_uuid(), count_id uuid not null references public.opening_stock_counts(id) on delete cascade,
  lot text not null default '', exp text not null default '', qty jsonb not null default '{}'::jsonb,
  base_quantity numeric not null default 0, created_at timestamptz not null default now()
);

create or replace function public.is_organization_admin(target_org uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members where organization_id=target_org and user_id=auth.uid() and role='admin' and status='active');
$$;
create or replace function public.has_department_access(target_department uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.department_members where department_id=target_department and user_id=auth.uid() and status='active');
$$;
create or replace function public.join_stock_department(target_department_id uuid) returns text
language plpgsql security definer set search_path=public,auth as $$
declare target_org uuid; selected_role text; current_email text;
begin
  select organization_id into target_org from public.departments where id=target_department_id and is_active=true;
  if target_org is null then raise exception 'Department not found'; end if;
  select lower(email) into current_email from auth.users where id=auth.uid();
  select role into selected_role from public.member_access_rules where department_id=target_department_id and lower(email)=current_email;
  if selected_role is null then
    if not exists(select 1 from public.organization_members where organization_id=target_org) then selected_role='admin'; else selected_role='user'; end if;
  end if;
  insert into public.profiles(id,email,full_name,avatar_url,last_login_at)
  select id,coalesce(email,''),coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name',email,''),coalesce(raw_user_meta_data->>'avatar_url',raw_user_meta_data->>'picture'),now()
  from auth.users where id=auth.uid()
  on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,avatar_url=excluded.avatar_url,last_login_at=now(),updated_at=now();
  insert into public.organization_members(organization_id,user_id,role,status) values(target_org,auth.uid(),selected_role,'active')
  on conflict(organization_id,user_id) do update set role=excluded.role,status='active';
  insert into public.department_members(department_id,user_id,role,status) values(target_department_id,auth.uid(),selected_role,'active')
  on conflict(department_id,user_id) do update set role=excluded.role,status='active';
  return selected_role;
end; $$;

alter table public.items enable row level security;
alter table public.item_packages enable row level security;
alter table public.department_items enable row level security;
alter table public.member_access_rules enable row level security;
alter table public.opening_stock_counts enable row level security;
alter table public.opening_stock_entries enable row level security;

drop policy if exists "members read items" on public.items;
drop policy if exists "admins manage items" on public.items;
drop policy if exists "members read packages" on public.item_packages;
drop policy if exists "admins manage packages" on public.item_packages;
drop policy if exists "members read department items" on public.department_items;
drop policy if exists "admins manage department items" on public.department_items;
drop policy if exists "admins manage access rules" on public.member_access_rules;
drop policy if exists "members manage counts" on public.opening_stock_counts;
drop policy if exists "members manage count entries" on public.opening_stock_entries;
create policy "members read items" on public.items for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=items.organization_id and m.user_id=auth.uid() and m.status='active'));
create policy "admins manage items" on public.items for all to authenticated using(public.is_organization_admin(organization_id)) with check(public.is_organization_admin(organization_id));
create policy "members read packages" on public.item_packages for select to authenticated using(exists(select 1 from public.items i join public.organization_members m on m.organization_id=i.organization_id where i.id=item_packages.item_id and m.user_id=auth.uid() and m.status='active'));
create policy "admins manage packages" on public.item_packages for all to authenticated using(exists(select 1 from public.items i where i.id=item_packages.item_id and public.is_organization_admin(i.organization_id))) with check(exists(select 1 from public.items i where i.id=item_packages.item_id and public.is_organization_admin(i.organization_id)));
create policy "members read department items" on public.department_items for select to authenticated using(public.has_department_access(department_id));
create policy "admins manage department items" on public.department_items for all to authenticated using(exists(select 1 from public.departments d where d.id=department_items.department_id and public.is_organization_admin(d.organization_id))) with check(exists(select 1 from public.departments d where d.id=department_items.department_id and public.is_organization_admin(d.organization_id)));
create policy "admins manage access rules" on public.member_access_rules for all to authenticated using(public.is_organization_admin(organization_id)) with check(public.is_organization_admin(organization_id));
create policy "members manage counts" on public.opening_stock_counts for all to authenticated
using(exists(select 1 from public.department_items di where di.id=opening_stock_counts.department_item_id and public.has_department_access(di.department_id)))
with check(exists(select 1 from public.department_items di where di.id=opening_stock_counts.department_item_id and public.has_department_access(di.department_id)));
create policy "members manage count entries" on public.opening_stock_entries for all to authenticated
using(exists(select 1 from public.opening_stock_counts c join public.department_items di on di.id=c.department_item_id where c.id=opening_stock_entries.count_id and public.has_department_access(di.department_id)))
with check(exists(select 1 from public.opening_stock_counts c join public.department_items di on di.id=c.department_item_id where c.id=opening_stock_entries.count_id and public.has_department_access(di.department_id)));

grant execute on function public.join_stock_department(uuid) to authenticated;
grant select,insert,update on public.items,public.item_packages,public.department_items,public.member_access_rules to authenticated;
grant select,insert,update,delete on public.opening_stock_counts,public.opening_stock_entries to authenticated;
commit;
