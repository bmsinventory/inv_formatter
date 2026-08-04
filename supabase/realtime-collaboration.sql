-- Enable live updates for concurrent inventory users.
-- Safe to run more than once in the Supabase SQL Editor.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations','departments','items','item_packages','department_items',
    'opening_stock_counts','opening_stock_entries','member_access_rules','platform_admins'
  ] loop
    if to_regclass('public.' || table_name) is not null
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = table_name
       ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
