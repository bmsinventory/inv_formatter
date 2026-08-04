create table if not exists public.stock_count_states (
  device_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.stock_count_states enable row level security;

drop policy if exists "stock count anon select" on public.stock_count_states;
drop policy if exists "stock count anon insert" on public.stock_count_states;
drop policy if exists "stock count anon update" on public.stock_count_states;

create policy "stock count anon select" on public.stock_count_states
  for select to anon using (true);
create policy "stock count anon insert" on public.stock_count_states
  for insert to anon with check (true);
create policy "stock count anon update" on public.stock_count_states
  for update to anon using (true) with check (true);

grant select, insert, update on public.stock_count_states to anon;
