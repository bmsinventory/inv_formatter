-- Add source-system item identifiers without replacing the internal UUID keys.
begin;

alter table public.items add column if not exists item_id text;
alter table public.items add column if not exists unit_price numeric not null default 0;
update public.items set item_id=code where item_id is null or btrim(item_id)='';
alter table public.items alter column item_id set not null;
create unique index if not exists items_organization_item_id_key
  on public.items(organization_id,item_id);
alter table public.items drop constraint if exists items_organization_id_code_key;

alter table public.item_packages add column if not exists stock_item_unit_id text;
alter table public.department_items add column if not exists is_explicit boolean not null default true;

drop function if exists public.ensure_department_item(uuid,text);
create or replace function public.ensure_department_item(target_department_id uuid,target_source_item_id text)
returns uuid language plpgsql security definer set search_path=public as $$
declare target_item_id uuid; department_org_id uuid; link_id uuid;
begin
  if not public.has_department_access(target_department_id) then raise exception 'Department access denied'; end if;
  select organization_id into department_org_id from public.departments where id=target_department_id and is_active=true;
  select id into target_item_id from public.items where organization_id=department_org_id and item_id=target_source_item_id and is_active=true;
  if target_item_id is null then raise exception 'Item not found'; end if;
  insert into public.department_items(department_id,item_id,status,is_explicit)
  values(target_department_id,target_item_id,'pending',false)
  on conflict(department_id,item_id) do update set updated_at=now()
  returning id into link_id;
  return link_id;
end; $$;

grant execute on function public.ensure_department_item(uuid,text) to authenticated;

create or replace function public.bootstrap_stock_workspace(org_code text,org_name text,dept_code text,dept_name text)
returns table(organization_id uuid,department_id uuid,role text)
language plpgsql security definer set search_path=public,auth as $$
declare new_org_id uuid; new_department_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.organizations) then raise exception 'Workspace already initialized'; end if;
  if btrim(coalesce(org_code,''))='' or btrim(coalesce(org_name,''))='' or btrim(coalesce(dept_code,''))='' or btrim(coalesce(dept_name,''))='' then raise exception 'Organization and department data are required'; end if;
  insert into public.organizations(code,name) values(btrim(org_code),btrim(org_name)) returning id into new_org_id;
  insert into public.departments(organization_id,code,name) values(new_org_id,btrim(dept_code),btrim(dept_name)) returning id into new_department_id;
  insert into public.profiles(id,email,full_name,avatar_url,last_login_at)
  select id,coalesce(email,''),coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name',email,''),coalesce(raw_user_meta_data->>'avatar_url',raw_user_meta_data->>'picture'),now() from auth.users where id=auth.uid()
  on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,avatar_url=excluded.avatar_url,last_login_at=now(),updated_at=now();
  insert into public.organization_members(organization_id,user_id,role,status) values(new_org_id,auth.uid(),'admin','active');
  insert into public.department_members(department_id,user_id,role,status) values(new_department_id,auth.uid(),'admin','active');
  if to_regclass('public.platform_admins') is not null then
    execute 'insert into public.platform_admins(user_id) values($1) on conflict(user_id) do nothing' using auth.uid();
  end if;
  return query select new_org_id,new_department_id,'admin'::text;
end; $$;

grant execute on function public.bootstrap_stock_workspace(text,text,text,text) to authenticated;

create or replace function public.clear_organization_inventory(target_organization_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare deleted_count integer; platform_allowed boolean:=false;
begin
  if to_regprocedure('public.is_super_admin()') is not null then execute 'select public.is_super_admin()' into platform_allowed; end if;
  if not platform_allowed and not public.is_organization_admin(target_organization_id) then raise exception 'Admin access required'; end if;
  delete from public.items where organization_id=target_organization_id;
  get diagnostics deleted_count=row_count;
  return deleted_count;
end; $$;

grant execute on function public.clear_organization_inventory(uuid) to authenticated;

commit;

notify pgrst,'reload schema';
