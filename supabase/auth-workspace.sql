-- รันไฟล์นี้หนึ่งครั้งใน Supabase SQL Editor
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  avatar_url text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  initialization_status text not null default 'not_started' check(initialization_status in ('not_started','counting','review','completed','locked')),
  created_at timestamptz not null default now(),
  unique(organization_id,code)
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'counter' check(role in ('organization_admin','department_admin','counter','reviewer','viewer')),
  status text not null default 'active' check(status in ('active','suspended')),
  joined_at timestamptz not null default now(),
  primary key(organization_id,user_id)
);

create table if not exists public.department_members (
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'counter' check(role in ('department_admin','counter','reviewer','viewer')),
  status text not null default 'active' check(status in ('active','suspended')),
  joined_at timestamptz not null default now(),
  primary key(department_id,user_id)
);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.departments enable row level security;
alter table public.organization_members enable row level security;
alter table public.department_members enable row level security;

drop policy if exists "authenticated read organizations" on public.organizations;
drop policy if exists "authenticated read departments" on public.departments;
drop policy if exists "user manages own profile" on public.profiles;
drop policy if exists "user reads own profile" on public.profiles;
drop policy if exists "user updates own profile" on public.profiles;
drop policy if exists "user joins organization" on public.organization_members;
drop policy if exists "user reads own organizations" on public.organization_members;
drop policy if exists "user refreshes own organization" on public.organization_members;
drop policy if exists "user joins department" on public.department_members;
drop policy if exists "user reads own departments" on public.department_members;
drop policy if exists "user refreshes own department" on public.department_members;

create policy "authenticated read organizations" on public.organizations for select to authenticated using(is_active);
create policy "authenticated read departments" on public.departments for select to authenticated using(is_active);
create policy "user reads own profile" on public.profiles for select to authenticated using(id=auth.uid());
create policy "user manages own profile" on public.profiles for insert to authenticated with check(id=auth.uid());
create policy "user updates own profile" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "user reads own organizations" on public.organization_members for select to authenticated using(user_id=auth.uid());
create policy "user joins organization" on public.organization_members for insert to authenticated with check(user_id=auth.uid() and role='counter' and status='active');
create policy "user refreshes own organization" on public.organization_members for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and role='counter' and status='active');
create policy "user reads own departments" on public.department_members for select to authenticated using(user_id=auth.uid());
create policy "user joins department" on public.department_members for insert to authenticated with check(user_id=auth.uid() and role='counter' and status='active');
create policy "user refreshes own department" on public.department_members for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and role='counter' and status='active');

grant select on public.organizations,public.departments to authenticated;
grant select,insert,update on public.profiles,public.organization_members,public.department_members to authenticated;

insert into public.organizations(code,name) values
  ('HOSP-A','โรงพยาบาล A'),
  ('HOSP-B','โรงพยาบาล B')
on conflict(code) do update set name=excluded.name;

insert into public.departments(organization_id,code,name)
select id,'DISPENSARY','ห้องจ่ายยา' from public.organizations where code='HOSP-A'
on conflict(organization_id,code) do update set name=excluded.name;
insert into public.departments(organization_id,code,name)
select id,'MED-SUPPLY','คลังเวชภัณฑ์' from public.organizations where code='HOSP-A'
on conflict(organization_id,code) do update set name=excluded.name;
insert into public.departments(organization_id,code,name)
select id,'OPD-PHARMACY','ห้องยา OPD' from public.organizations where code='HOSP-B'
on conflict(organization_id,code) do update set name=excluded.name;
insert into public.departments(organization_id,code,name)
select id,'CENTRAL-WH','คลังกลาง' from public.organizations where code='HOSP-B'
on conflict(organization_id,code) do update set name=excluded.name;
