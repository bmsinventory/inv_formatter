begin;

alter table public.departments drop column if exists require_lot_edit_approval;

-- Existing installations created before stock-count-v2 may not have lock columns.
alter table public.department_items add column if not exists locked_by uuid references auth.users(id);
alter table public.department_items add column if not exists lock_expires_at timestamptz;
alter table public.department_items add column if not exists is_explicit boolean not null default true;
create index if not exists department_items_active_lock_idx on public.department_items(department_id,lock_expires_at) where locked_by is not null;

create table if not exists public.stock_user_presence(
  user_id uuid primary key references auth.users(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  display_name text not null default '',
  last_seen_at timestamptz not null default now()
);
alter table public.stock_user_presence enable row level security;
drop policy if exists "members read stock presence" on public.stock_user_presence;
create policy "members read stock presence" on public.stock_user_presence for select to authenticated using(public.has_department_access(department_id) or public.is_super_admin());
grant select on public.stock_user_presence to authenticated;

create or replace function public.touch_stock_presence(target_department_id uuid,target_display_name text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_department_access(target_department_id) and not public.is_super_admin() then raise exception 'Department access denied'; end if;
  insert into public.stock_user_presence(user_id,department_id,display_name,last_seen_at) values(auth.uid(),target_department_id,coalesce(target_display_name,''),now())
  on conflict(user_id) do update set department_id=excluded.department_id,display_name=excluded.display_name,last_seen_at=now();
end; $$;

create or replace function public.leave_stock_presence(target_department_id uuid)
returns void language sql security definer set search_path=public as $$
  delete from public.stock_user_presence where user_id=auth.uid() and department_id=target_department_id;
$$;

alter table public.opening_stock_entries add column if not exists recorded_by uuid references auth.users(id);
alter table public.opening_stock_entries add column if not exists recorded_by_name text not null default '';
alter table public.opening_stock_entries add column if not exists recorded_at timestamptz not null default now();
update public.opening_stock_entries e set recorded_by=c.counted_by,recorded_by_name=c.counter_name,recorded_at=c.updated_at
from public.opening_stock_counts c where c.id=e.count_id and e.recorded_by is null;
alter table public.opening_stock_entries alter column recorded_by set not null;

create table if not exists public.opening_stock_adjustments(
  id uuid primary key default gen_random_uuid(), count_id uuid not null references public.opening_stock_counts(id) on delete cascade,
  lot text not null, exp text not null, stock_item_unit_id text not null,
  previous_qty numeric not null default 0, new_qty numeric not null default 0, adjusted_qty numeric not null default 0,
  changed_by uuid not null references auth.users(id), changed_by_name text not null default '', change_reason text not null default '', changed_at timestamptz not null default now()
);
alter table public.opening_stock_adjustments add column if not exists change_reason text not null default '';
alter table public.opening_stock_adjustments add column if not exists entry_group integer;
alter table public.opening_stock_adjustments enable row level security;
drop policy if exists "members read stock adjustments" on public.opening_stock_adjustments;
create policy "members read stock adjustments" on public.opening_stock_adjustments for select to authenticated using(
  exists(select 1 from public.opening_stock_counts c join public.department_items di on di.id=c.department_item_id where c.id=count_id and public.has_department_access(di.department_id))
  or public.is_super_admin()
);
grant select on public.opening_stock_adjustments to authenticated;

create table if not exists public.opening_stock_edit_requests(
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  count_id uuid not null references public.opening_stock_counts(id) on delete cascade,
  entry_group integer not null,
  requester_id uuid not null references auth.users(id),
  requester_name text not null default '',
  owner_id uuid not null references auth.users(id),
  reason text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  responded_by uuid references auth.users(id), responded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists opening_stock_edit_requests_pending_uq on public.opening_stock_edit_requests(count_id,entry_group,requester_id) where status='pending';
alter table public.opening_stock_edit_requests enable row level security;
drop policy if exists "participants read stock edit requests" on public.opening_stock_edit_requests;
create policy "participants read stock edit requests" on public.opening_stock_edit_requests for select to authenticated using(requester_id=auth.uid() or owner_id=auth.uid() or public.is_super_admin());
grant select on public.opening_stock_edit_requests to authenticated;

create or replace function public.request_stock_lot_edit(target_department_id uuid,target_item_id text,target_entry_group integer,target_reason text,target_requester_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare count_uuid uuid; owner_uuid uuid; owner_online boolean; request_uuid uuid;
begin
  if btrim(coalesce(target_reason,''))='' then raise exception 'กรุณาระบุเหตุผลการแก้ไข'; end if;
  select c.id,(array_agg(e.recorded_by order by e.recorded_at))[1] into count_uuid,owner_uuid
  from public.opening_stock_counts c join public.department_items di on di.id=c.department_item_id join public.items i on i.id=di.item_id
  join public.opening_stock_entries e on e.count_id=c.id and e.entry_group=target_entry_group
  where di.department_id=target_department_id and i.item_id=target_item_id group by c.id;
  if count_uuid is null or owner_uuid is null then raise exception 'ไม่พบ LOT ที่ต้องการแก้ไข'; end if;
  if owner_uuid=auth.uid() then return jsonb_build_object('status','approved','requires_approval',false); end if;
  select exists(select 1 from public.stock_user_presence p where p.user_id=owner_uuid and p.department_id=target_department_id and p.last_seen_at>now()-interval '75 seconds') into owner_online;
  if not owner_online then update public.opening_stock_edit_requests set status='cancelled' where count_id=count_uuid and entry_group=target_entry_group and requester_id=auth.uid() and status='pending'; end if;
  insert into public.opening_stock_edit_requests(department_id,count_id,entry_group,requester_id,requester_name,owner_id,reason,status,responded_at)
  values(target_department_id,count_uuid,target_entry_group,auth.uid(),coalesce(target_requester_name,''),owner_uuid,target_reason,case when owner_online then 'pending' else 'approved' end,case when owner_online then null else now() end)
  on conflict(count_id,entry_group,requester_id) where status='pending' do update set reason=excluded.reason,requester_name=excluded.requester_name,created_at=now()
  returning id into request_uuid;
  return jsonb_build_object('id',request_uuid,'status',case when owner_online then 'pending' else 'approved' end,'requires_approval',owner_online);
end; $$;

create or replace function public.respond_stock_lot_edit_request(target_request_id uuid,target_approved boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.opening_stock_edit_requests set status=case when target_approved then 'approved' else 'rejected' end,responded_by=auth.uid(),responded_at=now()
  where id=target_request_id and owner_id=auth.uid() and status='pending';
  if not found then raise exception 'ไม่พบคำขอ หรือคุณไม่มีสิทธิ์ตอบคำขอนี้'; end if;
end; $$;

create or replace function public.acquire_stock_item_lock(target_department_id uuid,target_item_id text)
returns table(acquired boolean,locked_by uuid,locked_by_name text,lock_expires_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare target_id uuid; target_item_uuid uuid; owner_id uuid; expiry timestamptz; has_explicit_items boolean;
begin
  if not public.has_department_access(target_department_id) and not public.is_super_admin() then raise exception 'Department access denied'; end if;
  select i.id into target_item_uuid from public.items i join public.departments d on d.organization_id=i.organization_id
  where d.id=target_department_id and i.item_id=target_item_id and i.is_active=true;
  if target_item_uuid is null then raise exception 'Item not found in current organization'; end if;
  select exists(select 1 from public.department_items di where di.department_id=target_department_id and di.is_explicit=true) into has_explicit_items;
  select di.id into target_id from public.department_items di
  where di.department_id=target_department_id and di.item_id=target_item_uuid and (di.is_explicit=true or not has_explicit_items);
  if target_id is null and not has_explicit_items then
    insert into public.department_items(department_id,item_id,status,is_explicit)
    values(target_department_id,target_item_uuid,'pending',false)
    on conflict(department_id,item_id) do update set status=public.department_items.status
    returning id into target_id;
  end if;
  if target_id is null then raise exception 'Item is not assigned to this department'; end if;
  update public.department_items di set locked_by=auth.uid(),lock_expires_at=now()+interval '90 seconds'
  where di.id=target_id and (di.locked_by is null or di.lock_expires_at<now() or di.locked_by=auth.uid());
  select di.locked_by,di.lock_expires_at into owner_id,expiry from public.department_items di where di.id=target_id;
  return query select owner_id=auth.uid(),owner_id,coalesce((select coalesce(p.full_name,p.email) from public.profiles p where p.id=owner_id),'ผู้ใช้งาน'),expiry;
end; $$;

create or replace function public.release_stock_item_lock(target_department_id uuid,target_item_id text)
returns void language sql security definer set search_path=public as $$
  update public.department_items di set locked_by=null,lock_expires_at=null
  from public.items i where i.id=di.item_id and di.department_id=target_department_id and i.item_id=target_item_id and di.locked_by=auth.uid();
$$;

create or replace function public.save_stock_count_locked(target_department_id uuid,target_item_id text,target_status text,target_note text,target_counter_name text,entry_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare di_id uuid; count_uuid uuid; duplicate_lot text; old_metadata jsonb;
begin
  select di.id into di_id from public.department_items di join public.items i on i.id=di.item_id
  where di.department_id=target_department_id and i.item_id=target_item_id and di.locked_by=auth.uid() and di.lock_expires_at>now();
  if di_id is null then raise exception 'รายการนี้ถูกล็อกหรือสิทธิ์การแก้ไขหมดอายุ'; end if;
  if target_status in ('done','review') and (entry_payload is null or jsonb_array_length(entry_payload)=0) then raise exception 'กรุณาระบุจำนวนอย่างน้อย 1 หน่วยบรรจุก่อนบันทึก'; end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(entry_payload,'[]')) x(lot text,exp text,unit_qty numeric) where btrim(coalesce(lot,''))='' or btrim(coalesce(exp,''))='' or coalesce(unit_qty,0)<=0) then raise exception 'LOT, EXP และจำนวนต้องระบุให้ครบ'; end if;
  select lot into duplicate_lot from (select lower(btrim(lot)) lot,btrim(exp) exp,count(distinct entry_group) n from jsonb_to_recordset(coalesce(entry_payload,'[]')) x(entry_group int,lot text,exp text) group by 1,2 having count(distinct entry_group)>1 limit 1) d;
  if duplicate_lot is not null then raise exception 'LOT/EXP ซ้ำ: %',duplicate_lot; end if;
  insert into public.opening_stock_counts(department_item_id,status,note,counted_by,counter_name,completed_at,updated_at)
  values(di_id,target_status,coalesce(target_note,''),auth.uid(),coalesce(target_counter_name,''),case when target_status='pending' then null else now() end,now())
  on conflict(department_item_id) do update set status=excluded.status,note=excluded.note,counted_by=excluded.counted_by,counter_name=excluded.counter_name,completed_at=excluded.completed_at,updated_at=now()
  returning id into count_uuid;
  select coalesce(jsonb_agg(jsonb_build_object('entry_group',entry_group,'stock_item_unit_id',stock_item_unit_id,'recorded_by',recorded_by,'recorded_by_name',recorded_by_name,'recorded_at',recorded_at)),'[]'::jsonb) into old_metadata from public.opening_stock_entries where count_id=count_uuid;
  if exists(
    select 1 from public.opening_stock_entries o
    left join jsonb_to_recordset(coalesce(entry_payload,'[]')) n(entry_group int,lot text,exp text,stock_item_unit_id text,unit_qty numeric,edit_reason text)
      on n.entry_group=o.entry_group and n.stock_item_unit_id=o.stock_item_unit_id
    where o.count_id=count_uuid and o.recorded_by<>auth.uid()
      and (n.entry_group is null or lower(btrim(o.lot)) is distinct from lower(btrim(n.lot)) or btrim(o.exp) is distinct from btrim(n.exp) or o.unit_qty is distinct from n.unit_qty)
      and btrim(coalesce(n.edit_reason,(select max(r.edit_reason) from jsonb_to_recordset(coalesce(entry_payload,'[]')) r(entry_group int,edit_reason text) where r.entry_group=o.entry_group),''))=''
  ) then raise exception 'ต้องระบุเหตุผลเมื่อแก้ไข LOT ที่ผู้อื่นบันทึก'; end if;
  if exists(
    select 1 from public.opening_stock_entries o
    left join jsonb_to_recordset(coalesce(entry_payload,'[]')) n(entry_group int,lot text,exp text,stock_item_unit_id text,unit_qty numeric)
      on n.entry_group=o.entry_group and n.stock_item_unit_id=o.stock_item_unit_id
    where o.count_id=count_uuid and o.recorded_by<>auth.uid()
      and (n.entry_group is null or lower(btrim(o.lot)) is distinct from lower(btrim(n.lot)) or btrim(o.exp) is distinct from btrim(n.exp) or o.unit_qty is distinct from n.unit_qty)
      and exists(select 1 from public.stock_user_presence p where p.user_id=o.recorded_by and p.department_id=target_department_id and p.last_seen_at>now()-interval '75 seconds')
      and not exists(select 1 from public.opening_stock_edit_requests r where r.count_id=count_uuid and r.entry_group=o.entry_group and r.requester_id=auth.uid() and r.status='approved')
  ) then raise exception 'ผู้บันทึกเดิมยังไม่ได้อนุมัติการแก้ไข LOT นี้'; end if;
  insert into public.opening_stock_adjustments(count_id,entry_group,lot,exp,stock_item_unit_id,previous_qty,new_qty,adjusted_qty,changed_by,changed_by_name,change_reason)
  select count_uuid,coalesce(o.entry_group,n.entry_group),coalesce(o.lot,n.lot),coalesce(o.exp,n.exp),coalesce(o.stock_item_unit_id,n.stock_item_unit_id),coalesce(o.unit_qty,0),coalesce(n.unit_qty,0),coalesce(n.unit_qty,0)-coalesce(o.unit_qty,0),auth.uid(),coalesce(target_counter_name,''),coalesce(n.edit_reason,(select max(r.edit_reason) from jsonb_to_recordset(coalesce(entry_payload,'[]')) r(entry_group int,edit_reason text) where r.entry_group=coalesce(o.entry_group,n.entry_group)),'')
  from public.opening_stock_entries o full join jsonb_to_recordset(coalesce(entry_payload,'[]')) n(entry_group int,lot text,exp text,stock_item_unit_id text,unit_qty numeric,package_size numeric,edit_reason text)
  on o.count_id=count_uuid and o.entry_group=n.entry_group and o.stock_item_unit_id=n.stock_item_unit_id
  where (o.count_id=count_uuid or o.count_id is null) and coalesce(o.unit_qty,0)<>coalesce(n.unit_qty,0);
  delete from public.opening_stock_entries where count_id=count_uuid;
  insert into public.opening_stock_entries(count_id,entry_group,lot,exp,stock_item_unit_id,unit_qty,package_size,recorded_by,recorded_by_name,recorded_at)
  select count_uuid,n.entry_group,btrim(n.lot),btrim(n.exp),n.stock_item_unit_id,n.unit_qty,n.package_size,coalesce(o.recorded_by,auth.uid()),coalesce(o.recorded_by_name,target_counter_name,''),coalesce(o.recorded_at,now())
  from jsonb_to_recordset(coalesce(entry_payload,'[]')) n(entry_group int,lot text,exp text,stock_item_unit_id text,unit_qty numeric,package_size numeric,edit_reason text)
  left join jsonb_to_recordset(old_metadata) o(entry_group int,stock_item_unit_id text,recorded_by uuid,recorded_by_name text,recorded_at timestamptz) on o.entry_group=n.entry_group and o.stock_item_unit_id=n.stock_item_unit_id;
  update public.opening_stock_edit_requests set status='cancelled'
  where count_id=count_uuid and requester_id=auth.uid() and status='approved';
  update public.department_items set locked_by=null,lock_expires_at=null where id=di_id;
  return count_uuid;
end; $$;
grant execute on function public.touch_stock_presence(uuid,text),public.leave_stock_presence(uuid),public.acquire_stock_item_lock(uuid,text),public.release_stock_item_lock(uuid,text),public.save_stock_count_locked(uuid,text,text,text,text,jsonb),public.request_stock_lot_edit(uuid,text,integer,text,text),public.respond_stock_lot_edit_request(uuid,boolean) to authenticated;
commit;
notify pgrst,'reload schema';
