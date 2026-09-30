\set ON_ERROR_STOP on

select current_database() as database_name, now() as verified_at;

select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select 'stores' as entity, count(*) as rows from public.stores
union all select 'user_profiles', count(*) from public.user_profiles
union all select 'staff_profiles', count(*) from public.staff_profiles
union all select 'schedule_weeks', count(*) from public.schedule_weeks
union all select 'schedule_shifts', count(*) from public.schedule_shifts
union all select 'training_evaluations', count(*) from public.training_evaluations
union all select 'sales_daily_history', count(*) from public.sales_daily_history
order by entity;

do $$
begin
  if exists (
    select 1 from public.staff_profiles
    where store_id is null or first_name is null or last_name is null
  ) then raise exception 'invalid staff profile found'; end if;

  if exists (
    select 1 from public.schedule_shifts shift
    left join public.schedule_weeks week on week.id = shift.schedule_week_id
    where week.id is null
  ) then raise exception 'orphan schedule shift found'; end if;
end;
$$;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select bucket_id, count(*) as object_count
from storage.objects
group by bucket_id
order by bucket_id;
