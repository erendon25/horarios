-- Keep a monthly sales configuration and an imported history batch in the
-- same PostgreSQL transaction. A rejected history row must not leave a newer
-- configuration pointing at data that was never stored.
create or replace function public.save_sales_configuration(
  p_store_id uuid,
  p_month_start date,
  p_monthly_data jsonb,
  p_daily_hourly_parts jsonb,
  p_real_sales_data jsonb,
  p_days jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_processed integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_store_id is null or not private.can_manage_sales(p_store_id) then
    raise exception 'Only an active admin can save sales for this store'
      using errcode = '42501';
  end if;

  if p_month_start is null
     or p_month_start <> pg_catalog.date_trunc('month', p_month_start)::date
     or p_month_start < date '2000-01-01'
     or p_month_start > (pg_catalog.date_trunc('month', current_date) + interval '1 year')::date then
    raise exception 'month_start must be the first day of an accepted month'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_monthly_data) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_daily_hourly_parts) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_real_sales_data) is distinct from 'object' then
    raise exception 'Sales configuration fields must be JSON objects'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_days) is distinct from 'array' then
    raise exception 'p_days must be a JSON array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_days) as item(day)
    where pg_catalog.jsonb_typeof(item.day -> 'date') is distinct from 'string'
       or pg_catalog.left(item.day ->> 'date', 7) <> pg_catalog.to_char(p_month_start, 'YYYY-MM')
  ) then
    raise exception 'Every imported sales day must belong to month_start'
      using errcode = '22023';
  end if;

  insert into public.sales_month_configs (
    store_id,
    month_start,
    monthly_data,
    daily_hourly_parts,
    real_sales_data,
    updated_at
  ) values (
    p_store_id,
    p_month_start,
    p_monthly_data,
    p_daily_hourly_parts,
    p_real_sales_data,
    pg_catalog.clock_timestamp()
  )
  on conflict (store_id, month_start) do update
  set monthly_data = excluded.monthly_data,
      daily_hourly_parts = excluded.daily_hourly_parts,
      real_sales_data = excluded.real_sales_data,
      updated_at = excluded.updated_at;

  if pg_catalog.jsonb_array_length(p_days) > 0 then
    v_processed := public.save_sales_history_batch(p_store_id, p_days);
  end if;

  return v_processed;
end;
$function$;

revoke all on function public.save_sales_configuration(
  uuid, date, jsonb, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.save_sales_configuration(
  uuid, date, jsonb, jsonb, jsonb, jsonb
) to authenticated;
