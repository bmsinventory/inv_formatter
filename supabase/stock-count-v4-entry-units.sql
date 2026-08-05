-- Clean entry model: one row per LOT x stock item unit.
-- Safe to rerun when existing rows already contain all V4 unit dimensions.
begin;

do $$
begin
  if exists(select 1 from public.item_packages where stock_item_unit_id is null or btrim(stock_item_unit_id)='') then
    raise exception 'Every item package must have stock_item_unit_id before applying stock-count-v4-entry-units.sql';
  end if;
  if exists(
    select 1 from public.item_packages
    group by item_id,stock_item_unit_id having count(*)>1
  ) then raise exception 'Duplicate stock_item_unit_id found within an item'; end if;
  if exists(
    select 1 from public.item_packages
    group by item_id,size having count(*)>1
  ) then raise exception 'Duplicate package_size found within an item'; end if;
  if exists(
    select 1 from public.items i
    where i.is_active=true and not exists(
      select 1 from public.item_packages p where p.item_id=i.id and p.size=1
    )
  ) then raise exception 'Every active item must have a base package with package_size = 1'; end if;
end $$;

alter table public.item_packages alter column stock_item_unit_id set not null;
alter table public.item_packages drop constraint if exists item_packages_stock_item_unit_id_check;
alter table public.item_packages add constraint item_packages_stock_item_unit_id_check check(btrim(stock_item_unit_id)<>'');
alter table public.item_packages drop constraint if exists item_packages_item_id_stock_item_unit_id_key;
alter table public.item_packages drop constraint if exists item_packages_item_id_size_key;
create unique index if not exists item_packages_item_stock_unit_key on public.item_packages(item_id,stock_item_unit_id);
create unique index if not exists item_packages_item_size_key on public.item_packages(item_id,size);

alter table public.opening_stock_entries add column if not exists stock_item_unit_id text;
alter table public.opening_stock_entries add column if not exists unit_qty numeric;
alter table public.opening_stock_entries add column if not exists package_size numeric;
alter table public.opening_stock_entries add column if not exists entry_group integer;

do $$
declare incomplete_rows bigint;
begin
  select count(*) into incomplete_rows from public.opening_stock_entries
  where stock_item_unit_id is null or btrim(stock_item_unit_id)=''
     or unit_qty is null or package_size is null or entry_group is null;
  if incomplete_rows>0 then
    raise exception 'Found % legacy opening_stock_entries rows without V4 unit dimensions. No data was changed. Backfill stock_item_unit_id, unit_qty, package_size and entry_group before rerunning this migration.',incomplete_rows;
  end if;
end $$;

drop function if exists public.stock_count_dashboard();
alter table public.opening_stock_entries drop column if exists qty;
alter table public.opening_stock_entries drop column if exists base_quantity;
alter table public.opening_stock_entries add column base_quantity numeric generated always as (unit_qty*package_size) stored;

alter table public.opening_stock_entries alter column stock_item_unit_id set not null;
alter table public.opening_stock_entries alter column unit_qty set not null;
alter table public.opening_stock_entries alter column package_size set not null;
alter table public.opening_stock_entries alter column entry_group set not null;

alter table public.opening_stock_entries drop constraint if exists opening_stock_entries_unit_qty_check;
alter table public.opening_stock_entries add constraint opening_stock_entries_unit_qty_check check(unit_qty>=0);
alter table public.opening_stock_entries drop constraint if exists opening_stock_entries_package_size_check;
alter table public.opening_stock_entries add constraint opening_stock_entries_package_size_check check(package_size>0);
alter table public.opening_stock_entries drop constraint if exists opening_stock_entries_entry_group_check;
alter table public.opening_stock_entries add constraint opening_stock_entries_entry_group_check check(entry_group>0);
alter table public.opening_stock_entries drop constraint if exists opening_stock_entries_count_id_entry_group_stock_item_unit_id_key;
alter table public.opening_stock_entries drop constraint if exists opening_stock_entries_count_group_unit_key;
alter table public.opening_stock_entries add constraint opening_stock_entries_count_group_unit_key unique(count_id,entry_group,stock_item_unit_id);

create or replace function public.validate_opening_stock_entry_unit()
returns trigger language plpgsql set search_path=public as $$
declare expected_item_id uuid;
begin
  select di.item_id into expected_item_id
  from public.opening_stock_counts c
  join public.department_items di on di.id=c.department_item_id
  where c.id=new.count_id;
  if expected_item_id is null then raise exception 'Count context not found'; end if;
  if not exists(
    select 1 from public.item_packages p
    where p.item_id=expected_item_id and p.stock_item_unit_id=new.stock_item_unit_id
  ) then raise exception 'stock_item_unit_id does not belong to counted item'; end if;
  return new;
end; $$;

drop trigger if exists validate_opening_stock_entry_dimensions on public.opening_stock_entries;
drop trigger if exists validate_opening_stock_entry_unit on public.opening_stock_entries;
create trigger validate_opening_stock_entry_unit
before insert or update on public.opening_stock_entries
for each row execute function public.validate_opening_stock_entry_unit();
drop function if exists public.validate_opening_stock_entry_dimensions();

create index if not exists opening_stock_entries_unit_idx on public.opening_stock_entries(stock_item_unit_id);
create index if not exists opening_stock_entries_export_idx on public.opening_stock_entries(count_id,entry_group,stock_item_unit_id);

create or replace function public.stock_count_dashboard()
returns table(
  count_id uuid, organization_id uuid, organization_name text,
  department_id uuid, department_name text, item_system_id uuid,
  item_id text, item_code text, item_name text, base_unit text,
  unit_price numeric, status text, note text, counter_name text,
  completed_at timestamptz, updated_at timestamptz,
  total_quantity numeric, total_value numeric, lot_count bigint, lots jsonb
)
language sql stable security definer set search_path=public as $$
  with accessible_departments as (
    select d.id from public.departments d
    where public.is_super_admin()
       or public.is_organization_admin(d.organization_id)
       or exists (
         select 1 from public.department_members dm
         where dm.department_id=d.id and dm.user_id=auth.uid() and dm.status='active'
       )
  ), entry_lots as (
    select e.count_id,e.entry_group,e.lot,e.exp,min(e.created_at) as created_at,
      coalesce(sum(e.base_quantity),0)::numeric as quantity
    from public.opening_stock_entries e
    group by e.count_id,e.entry_group,e.lot,e.exp
  ), entry_totals as (
    select e.count_id,coalesce(sum(e.quantity),0)::numeric as total_quantity,
      count(*)::bigint as lot_count,
      jsonb_agg(jsonb_build_object('lot',e.lot,'exp',e.exp,'quantity',e.quantity) order by e.created_at) as lots
    from entry_lots e group by e.count_id
  )
  select c.id,o.id,o.name,d.id,d.name,i.id,i.item_id,i.code,i.name,i.base_unit,
    coalesce(i.unit_price,0),c.status,c.note,c.counter_name,c.completed_at,c.updated_at,
    coalesce(et.total_quantity,0),coalesce(et.total_quantity,0)*coalesce(i.unit_price,0),
    coalesce(et.lot_count,0),coalesce(et.lots,'[]'::jsonb)
  from accessible_departments ad
  join public.departments d on d.id=ad.id
  join public.organizations o on o.id=d.organization_id
  join public.department_items di on di.department_id=d.id
  join public.items i on i.id=di.item_id
  join public.opening_stock_counts c on c.department_item_id=di.id
  left join entry_totals et on et.count_id=c.id
  order by o.name,d.name,c.updated_at desc;
$$;

revoke all on function public.stock_count_dashboard() from public;
grant execute on function public.stock_count_dashboard() to authenticated;

commit;
notify pgrst,'reload schema';
