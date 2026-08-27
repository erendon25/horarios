-- Sales are net amounts. Credit notes and returns may make one channel/hour
-- negative even when the operating day's total remains non-negative.
create or replace function private.sales_hour_map_is_valid(
  p_value jsonb,
  p_integer_values boolean default false
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  v_hour_key text;
  v_channels jsonb;
  v_hour smallint;
  v_seen_hours smallint[] := '{}'::smallint[];
  v_channel text;
  v_raw_value jsonb;
  v_number numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'object' then
    return false;
  end if;

  for v_hour_key, v_channels in
    select entry.key, entry.value
    from pg_catalog.jsonb_each(p_value) entry
  loop
    v_hour := private.sales_hour_from_key(v_hour_key);
    if v_hour is null or v_hour = any(v_seen_hours) then
      return false;
    end if;
    v_seen_hours := pg_catalog.array_append(v_seen_hours, v_hour);

    if pg_catalog.jsonb_typeof(v_channels) <> 'object' then
      return false;
    end if;

    for v_channel, v_raw_value in
      select channel.key, channel.value
      from pg_catalog.jsonb_each(v_channels) channel
    loop
      if v_channel <> pg_catalog.btrim(v_channel)
        or pg_catalog.char_length(v_channel) not between 1 and 80
        or pg_catalog.jsonb_typeof(v_raw_value) <> 'number'
      then
        return false;
      end if;

      v_number := (v_raw_value #>> '{}')::numeric;
      if p_integer_values then
        if v_number < 0
          or pg_catalog.trunc(v_number) <> v_number
          or v_number > 2147483647
        then
          return false;
        end if;
      elsif pg_catalog.abs(v_number) > 999999999999.99 then
        return false;
      end if;
    end loop;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$function$;

revoke all on function private.sales_hour_map_is_valid(jsonb, boolean)
  from public, anon;
grant execute on function private.sales_hour_map_is_valid(jsonb, boolean)
  to authenticated;

alter table public.sales_hourly_history
  drop constraint if exists sales_hourly_history_sales_amount_nonnegative_check,
  drop constraint if exists sales_hourly_history_participation_range_check;

alter table public.sales_hourly_history
  alter column participation_percentage type numeric(22,5)
  using participation_percentage::numeric(22,5);

create or replace function private.sync_sales_hourly_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hours smallint[] := '{}'::smallint[];
  v_hour smallint;
  v_sales_channels jsonb;
  v_transaction_channels jsonb;
  v_hour_sales numeric(14,2);
  v_hour_transactions integer;
  v_participation numeric(22,5);
begin
  select coalesce(
    pg_catalog.array_agg(normalized.hour_value order by normalized.hour_value),
    '{}'::smallint[]
  )
  into v_hours
  from (
    select distinct private.sales_hour_from_key(hour_keys.hour_key) as hour_value
    from (
      select sales_key.key as hour_key
      from pg_catalog.jsonb_object_keys(new.hourly_data) sales_key(key)
      union
      select transaction_key.key as hour_key
      from pg_catalog.jsonb_object_keys(new.hourly_transactions) transaction_key(key)
    ) hour_keys
  ) normalized;

  foreach v_hour in array v_hours
  loop
    v_sales_channels := private.sales_channels_for_hour(new.hourly_data, v_hour);
    v_transaction_channels := private.sales_channels_for_hour(new.hourly_transactions, v_hour);
    v_hour_sales := pg_catalog.round(
      private.sales_channel_map_total(v_sales_channels), 2
    )::numeric(14,2);
    v_hour_transactions := private.sales_channel_map_total(v_transaction_channels)::integer;
    v_participation := case
      when new.sales_amount <> 0
        then pg_catalog.round((v_hour_sales * 100 / new.sales_amount)::numeric, 5)::numeric(22,5)
      else null
    end;

    insert into public.sales_hourly_history (
      sales_daily_id,
      store_id,
      sales_date,
      sales_hour,
      sales_amount,
      transactions,
      participation_percentage,
      source_data
    ) values (
      new.id,
      new.store_id,
      new.sales_date,
      pg_catalog.make_time(v_hour, 0, 0),
      v_hour_sales,
      v_hour_transactions,
      v_participation,
      pg_catalog.jsonb_build_object(
        'hourlyData', v_sales_channels,
        'hourlyTxs', v_transaction_channels
      )
    )
    on conflict (store_id, sales_date, sales_hour) do update
    set sales_daily_id = excluded.sales_daily_id,
        sales_amount = excluded.sales_amount,
        transactions = excluded.transactions,
        participation_percentage = excluded.participation_percentage,
        source_data = excluded.source_data;
  end loop;

  delete from public.sales_hourly_history hourly
  where hourly.sales_daily_id = new.id
    and (
      hourly.store_id is distinct from new.store_id
      or hourly.sales_date is distinct from new.sales_date
      or extract(minute from hourly.sales_hour) <> 0
      or extract(second from hourly.sales_hour) <> 0
      or not (extract(hour from hourly.sales_hour)::smallint = any(v_hours))
    );

  return new;
end;
$function$;

revoke all on function private.sync_sales_hourly_history()
  from public, anon, authenticated;

comment on column public.sales_daily_history.hourly_data is
  'Net sales by business hour and channel; channel/hour values may be negative for credit notes.';
comment on column public.sales_hourly_history.sales_amount is
  'Net sales for the hour; may be negative when returns exceed gross sales in that hour.';
