-- Permission-scoped dashboard for counters, organization admins and Super Admins.
-- Run in Supabase SQL Editor after the stock-count and super-admin migrations.
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
    select d.id
    from public.departments d
    where public.is_super_admin()
       or public.is_organization_admin(d.organization_id)
       or exists (
         select 1 from public.department_members dm
         where dm.department_id=d.id and dm.user_id=auth.uid() and dm.status='active'
       )
  ), entry_totals as (
    select e.count_id,
      coalesce(sum(e.base_quantity),0)::numeric as total_quantity,
      count(*)::bigint as lot_count,
      jsonb_agg(jsonb_build_object('lot',e.lot,'exp',e.exp,'quantity',e.base_quantity) order by e.created_at) as lots
    from public.opening_stock_entries e group by e.count_id
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
