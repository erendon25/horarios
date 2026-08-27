-- Canonical sales history repair.
-- Applied remotely as migration version 20260827030023.
--
-- The original Firebase transform treated the channel objects stored under
-- hourlyData/hourlyTxs as scalars. It consequently materialized zero values and
-- also skipped one-digit hour keys. The daily JSON remains the source of truth;
-- this migration validates it and makes the hourly table a read-only derivative.
-- hourlyTxs contains aggregate counts, not order ids: exact hourly/day totals are
-- preserved, but cross-channel duplicate orders cannot be detected retroactively.

create or replace function private.sales_hour_from_key(p_key text)
returns smallint
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when p_key ~ '^(0?[0-9]|1[0-9]|2[0-3])$'
      then p_key::smallint
    when p_key ~ '^(0[0-9]|1[0-9]|2[0-3]):00(:00)?$'
      then pg_catalog.split_part(p_key, ':', 1)::smallint
    else null
  end
$$;

create or replace function private.sales_hour_map_is_valid(
  p_value jsonb,
  p_integer_values boolean
)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
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
    from pg_catalog.jsonb_each(p_value) as entry
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
      from pg_catalog.jsonb_each(v_channels) as channel
    loop
      if v_channel <> pg_catalog.btrim(v_channel)
        or pg_catalog.char_length(v_channel) not between 1 and 80
        or pg_catalog.jsonb_typeof(v_raw_value) <> 'number'
      then
        return false;
      end if;

      v_number := (v_raw_value #>> '{}')::numeric;
      if v_number < 0 then
        return false;
      end if;

      if p_integer_values then
        if pg_catalog.trunc(v_number) <> v_number or v_number > 2147483647 then
          return false;
        end if;
      elsif v_number > 999999999999.99 then
        return false;
      end if;
    end loop;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

create or replace function private.sales_channel_map_total(p_value jsonb)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(pg_catalog.sum((channel.value #>> '{}')::numeric), 0::numeric)
  from pg_catalog.jsonb_each(p_value) as channel
$$;

create or replace function private.sales_hour_map_total(p_value jsonb)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(pg_catalog.sum(private.sales_channel_map_total(hour_entry.value)), 0::numeric)
  from pg_catalog.jsonb_each(p_value) as hour_entry
$$;

-- The hourly derivative stores numeric(14,2) per hour, so canonical daily sales
-- must equal the sum of those individually rounded hours, not merely a rounded
-- grand total. Keeping this rule in one helper prevents future rounding drift.
create or replace function private.sales_hour_map_rounded_total(p_value jsonb)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(
    pg_catalog.sum(pg_catalog.round(private.sales_channel_map_total(hour_entry.value), 2)),
    0::numeric
  )
  from pg_catalog.jsonb_each(p_value) as hour_entry
$$;

create or replace function private.sales_hour_keys_match(
  p_left jsonb,
  p_right jsonb
)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select not exists (
    (
      select private.sales_hour_from_key(left_key.key) as hour_value
      from pg_catalog.jsonb_object_keys(p_left) as left_key(key)
      except
      select private.sales_hour_from_key(right_key.key) as hour_value
      from pg_catalog.jsonb_object_keys(p_right) as right_key(key)
    )
    union all
    (
      select private.sales_hour_from_key(right_key.key) as hour_value
      from pg_catalog.jsonb_object_keys(p_right) as right_key(key)
      except
      select private.sales_hour_from_key(left_key.key) as hour_value
      from pg_catalog.jsonb_object_keys(p_left) as left_key(key)
    )
  )
$$;

create or replace function private.sales_channels_for_hour(
  p_value jsonb,
  p_hour smallint
)
returns jsonb
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(
    (
      select hour_entry.value
      from pg_catalog.jsonb_each(p_value) as hour_entry
      where private.sales_hour_from_key(hour_entry.key) = p_hour
      limit 1
    ),
    '{}'::jsonb
  )
$$;

-- This is a narrowly scoped RLS/RPC helper. It reads authorization only from
-- auth.uid() + user_profiles, including active status; no user metadata is used.
create or replace function private.can_manage_sales(p_store_id uuid)
returns boolean
language sql
stable
security definer
parallel safe
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles as profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'::public.record_status
      and (
        profile.role = 'superadmin'::public.app_role
        or (
          profile.role = 'admin'::public.app_role
          and profile.store_id = p_store_id
        )
      )
  )
$$;

revoke all on function private.sales_hour_from_key(text) from public, anon;
revoke all on function private.sales_hour_map_is_valid(jsonb, boolean) from public, anon;
revoke all on function private.sales_channel_map_total(jsonb) from public, anon;
revoke all on function private.sales_hour_map_total(jsonb) from public, anon;
revoke all on function private.sales_hour_map_rounded_total(jsonb) from public, anon;
revoke all on function private.sales_hour_keys_match(jsonb, jsonb) from public, anon;
revoke all on function private.sales_channels_for_hour(jsonb, smallint) from public, anon, authenticated;
revoke all on function private.can_manage_sales(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.sales_hour_from_key(text) to authenticated;
grant execute on function private.sales_hour_map_is_valid(jsonb, boolean) to authenticated;
grant execute on function private.sales_channel_map_total(jsonb) to authenticated;
grant execute on function private.sales_hour_map_total(jsonb) to authenticated;
grant execute on function private.sales_hour_map_rounded_total(jsonb) to authenticated;
grant execute on function private.sales_hour_keys_match(jsonb, jsonb) to authenticated;
grant execute on function private.can_manage_sales(uuid) to authenticated;

-- Only the first execution imports legacy hourlyTxs into the new canonical
-- column. A later re-execution must not resurrect stale source_data over an
-- intentionally empty canonical value.
do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.sales_daily_history'::regclass
      and attname = 'hourly_transactions'
      and not attisdropped
  ) then
    alter table public.sales_daily_history
      add column hourly_transactions jsonb not null default '{}'::jsonb;

    update public.sales_daily_history
    set hourly_transactions = case
      when pg_catalog.jsonb_typeof(source_data -> 'hourlyTxs') = 'object'
        then source_data -> 'hourlyTxs'
      else '{}'::jsonb
    end;
  end if;
end
$migration$;

do $migration$
declare
  v_column_type text;
begin
  select pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
  into v_column_type
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.sales_daily_history'::regclass
    and attribute.attname = 'hourly_transactions'
    and not attribute.attisdropped;

  if v_column_type is distinct from 'jsonb' then
    raise exception 'sales_daily_history.hourly_transactions must be jsonb, found %', v_column_type
      using errcode = '42804';
  end if;
end
$migration$;

update public.sales_daily_history
set hourly_transactions = case
  when pg_catalog.jsonb_typeof(source_data -> 'hourlyTxs') = 'object'
    then source_data -> 'hourlyTxs'
  else '{}'::jsonb
end
where hourly_transactions is null;

do $migration$
begin
  if exists (
    select 1
    from public.sales_daily_history
    where sales_amount is null or transactions is null
  ) then
    raise exception 'Cannot canonicalize sales history while daily totals are null'
      using errcode = '23502';
  end if;
end
$migration$;

alter table public.sales_daily_history
  alter column sales_amount set default 0,
  alter column sales_amount set not null,
  alter column transactions set default 0,
  alter column transactions set not null,
  alter column hourly_transactions set default '{}'::jsonb,
  alter column hourly_transactions set not null;

alter table public.sales_daily_history
  drop constraint if exists sales_daily_history_sales_amount_nonnegative_check,
  drop constraint if exists sales_daily_history_transactions_nonnegative_check,
  drop constraint if exists sales_daily_history_hourly_data_shape_check,
  drop constraint if exists sales_daily_history_hourly_transactions_shape_check,
  drop constraint if exists sales_daily_history_hour_keys_match_check,
  drop constraint if exists sales_daily_history_hourly_sales_total_check,
  drop constraint if exists sales_daily_history_hourly_transactions_total_check;

alter table public.sales_daily_history
  add constraint sales_daily_history_sales_amount_nonnegative_check
    check (sales_amount >= 0) not valid,
  add constraint sales_daily_history_transactions_nonnegative_check
    check (transactions >= 0) not valid,
  add constraint sales_daily_history_hourly_data_shape_check
    check (private.sales_hour_map_is_valid(hourly_data, false)) not valid,
  add constraint sales_daily_history_hourly_transactions_shape_check
    check (private.sales_hour_map_is_valid(hourly_transactions, true)) not valid,
  add constraint sales_daily_history_hour_keys_match_check
    check (private.sales_hour_keys_match(hourly_data, hourly_transactions)) not valid,
  add constraint sales_daily_history_hourly_sales_total_check
    check (sales_amount = private.sales_hour_map_rounded_total(hourly_data)) not valid,
  add constraint sales_daily_history_hourly_transactions_total_check
    check (transactions::numeric = private.sales_hour_map_total(hourly_transactions)) not valid;

alter table public.sales_daily_history
  validate constraint sales_daily_history_sales_amount_nonnegative_check;
alter table public.sales_daily_history
  validate constraint sales_daily_history_transactions_nonnegative_check;
alter table public.sales_daily_history
  validate constraint sales_daily_history_hourly_data_shape_check;
alter table public.sales_daily_history
  validate constraint sales_daily_history_hourly_transactions_shape_check;
alter table public.sales_daily_history
  validate constraint sales_daily_history_hour_keys_match_check;
alter table public.sales_daily_history
  validate constraint sales_daily_history_hourly_sales_total_check;
alter table public.sales_daily_history
  validate constraint sales_daily_history_hourly_transactions_total_check;

-- The composite candidate key lets the child FK prove that the parent id,
-- store and date always describe the same daily row.
do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.sales_daily_history'::regclass
      and conname = 'sales_daily_history_parent_identity_key'
  ) then
    alter table public.sales_daily_history
      add constraint sales_daily_history_parent_identity_key
      unique (id, store_id, sales_date);
  end if;
end
$migration$;

create or replace function private.sync_sales_hourly_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours smallint[] := '{}'::smallint[];
  v_hour smallint;
  v_sales_channels jsonb;
  v_transaction_channels jsonb;
  v_hour_sales numeric(14,2);
  v_hour_transactions integer;
  v_participation numeric(8,5);
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
      from pg_catalog.jsonb_object_keys(new.hourly_data) as sales_key(key)
      union
      select transaction_key.key as hour_key
      from pg_catalog.jsonb_object_keys(new.hourly_transactions) as transaction_key(key)
    ) as hour_keys
  ) as normalized;

  foreach v_hour in array v_hours
  loop
    v_sales_channels := private.sales_channels_for_hour(new.hourly_data, v_hour);
    v_transaction_channels := private.sales_channels_for_hour(new.hourly_transactions, v_hour);
    v_hour_sales := pg_catalog.round(
      private.sales_channel_map_total(v_sales_channels),
      2
    )::numeric(14,2);
    v_hour_transactions := private.sales_channel_map_total(v_transaction_channels)::integer;
    v_participation := case
      when new.sales_amount > 0
        then pg_catalog.round((v_hour_sales * 100 / new.sales_amount)::numeric, 5)::numeric(8,5)
      else 0::numeric(8,5)
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

  delete from public.sales_hourly_history as hourly
  where hourly.sales_daily_id = new.id
    and (
      hourly.store_id is distinct from new.store_id
      or hourly.sales_date is distinct from new.sales_date
      or extract(minute from hourly.sales_hour) <> 0
      or extract(second from hourly.sales_hour) <> 0
      or not (
        extract(hour from hourly.sales_hour)::smallint = any(v_hours)
      )
    );

  return new;
end;
$$;

revoke all on function private.sync_sales_hourly_history() from public, anon, authenticated;

drop trigger if exists sales_daily_history_sync_hourly on public.sales_daily_history;
create trigger sales_daily_history_sync_hourly
after insert or update of store_id, sales_date, sales_amount, transactions, hourly_data, hourly_transactions
on public.sales_daily_history
for each row
execute function private.sync_sales_hourly_history();

-- Mentioning the canonical column makes the UPDATE trigger rebuild every daily
-- row. Existing hourly ids are preserved where their unique hour already exists.
update public.sales_daily_history
set hourly_transactions = hourly_transactions;

-- Remove any child that cannot be derived from its canonical daily maps. This
-- also cleans up mismatched legacy parent/store/date combinations before the FK.
delete from public.sales_hourly_history as hourly
where not exists (
  select 1
  from public.sales_daily_history as daily
  cross join lateral (
    select distinct private.sales_hour_from_key(hour_keys.hour_key) as hour_value
    from (
      select sales_key.key as hour_key
      from pg_catalog.jsonb_object_keys(daily.hourly_data) as sales_key(key)
      union
      select transaction_key.key as hour_key
      from pg_catalog.jsonb_object_keys(daily.hourly_transactions) as transaction_key(key)
    ) as hour_keys
  ) as expected
  where daily.id = hourly.sales_daily_id
    and daily.store_id = hourly.store_id
    and daily.sales_date = hourly.sales_date
    and expected.hour_value = extract(hour from hourly.sales_hour)::smallint
    and extract(minute from hourly.sales_hour) = 0
    and extract(second from hourly.sales_hour) = 0
);

alter table public.sales_hourly_history
  drop constraint if exists sales_hourly_history_sales_daily_id_fkey;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.sales_hourly_history'::regclass
      and conname = 'sales_hourly_history_daily_parent_fkey'
  ) then
    alter table public.sales_hourly_history
      add constraint sales_hourly_history_daily_parent_fkey
      foreign key (sales_daily_id, store_id, sales_date)
      references public.sales_daily_history (id, store_id, sales_date)
      on delete cascade
      not valid;
  end if;
end
$migration$;

alter table public.sales_hourly_history
  validate constraint sales_hourly_history_daily_parent_fkey;

alter table public.sales_hourly_history
  drop constraint if exists sales_hourly_history_transactions_check,
  drop constraint if exists sales_hourly_history_sales_amount_nonnegative_check,
  drop constraint if exists sales_hourly_history_participation_range_check,
  drop constraint if exists sales_hourly_history_full_hour_check,
  drop constraint if exists sales_hourly_history_source_shape_check,
  drop constraint if exists sales_hourly_history_source_sales_total_check,
  drop constraint if exists sales_hourly_history_source_transactions_total_check;

alter table public.sales_hourly_history
  add constraint sales_hourly_history_transactions_check
    check (transactions >= 0) not valid,
  add constraint sales_hourly_history_sales_amount_nonnegative_check
    check (sales_amount >= 0) not valid,
  add constraint sales_hourly_history_participation_range_check
    check (participation_percentage is null or participation_percentage between 0 and 100) not valid,
  add constraint sales_hourly_history_full_hour_check
    check (
      extract(minute from sales_hour) = 0
      and extract(second from sales_hour) = 0
    ) not valid,
  add constraint sales_hourly_history_source_shape_check
    check (
      pg_catalog.jsonb_typeof(source_data) = 'object'
      and private.sales_hour_map_is_valid(
        pg_catalog.jsonb_build_object('0', coalesce(source_data -> 'hourlyData', '{}'::jsonb)),
        false
      )
      and private.sales_hour_map_is_valid(
        pg_catalog.jsonb_build_object('0', coalesce(source_data -> 'hourlyTxs', '{}'::jsonb)),
        true
      )
    ) not valid,
  add constraint sales_hourly_history_source_sales_total_check
    check (
      sales_amount = pg_catalog.round(
        private.sales_channel_map_total(
          case
            when pg_catalog.jsonb_typeof(source_data -> 'hourlyData') = 'object'
              then source_data -> 'hourlyData'
            else '{}'::jsonb
          end
        ),
        2
      )
    ) not valid,
  add constraint sales_hourly_history_source_transactions_total_check
    check (
      transactions::numeric = private.sales_channel_map_total(
        case
          when pg_catalog.jsonb_typeof(source_data -> 'hourlyTxs') = 'object'
            then source_data -> 'hourlyTxs'
          else '{}'::jsonb
        end
      )
    ) not valid;

alter table public.sales_hourly_history
  validate constraint sales_hourly_history_transactions_check;
alter table public.sales_hourly_history
  validate constraint sales_hourly_history_sales_amount_nonnegative_check;
alter table public.sales_hourly_history
  validate constraint sales_hourly_history_participation_range_check;
alter table public.sales_hourly_history
  validate constraint sales_hourly_history_full_hour_check;
alter table public.sales_hourly_history
  validate constraint sales_hourly_history_source_shape_check;
alter table public.sales_hourly_history
  validate constraint sales_hourly_history_source_sales_total_check;
alter table public.sales_hourly_history
  validate constraint sales_hourly_history_source_transactions_total_check;

create or replace function public.save_sales_history_batch(
  p_store_id uuid,
  p_days jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day_count integer;
  v_day jsonb;
  v_date_text text;
  v_sales_date date;
  v_seen_dates date[] := '{}'::date[];
  v_sales_amount numeric(14,2);
  v_transactions integer;
  v_numeric_value numeric;
  v_hourly_sales jsonb;
  v_hourly_transactions jsonb;
  v_sales_hours smallint[];
  v_transaction_hours smallint[];
  v_processed integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_store_id is null or not private.can_manage_sales(p_store_id) then
    raise exception 'Only an active admin can save sales for this store'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.stores where id = p_store_id) then
    raise exception 'Store not found' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_days) is distinct from 'array' then
    raise exception 'p_days must be a JSON array' using errcode = '22023';
  end if;

  v_day_count := pg_catalog.jsonb_array_length(p_days);
  if v_day_count not between 1 and 1000 then
    raise exception 'A sales batch must contain between 1 and 1000 days'
      using errcode = '22023';
  end if;

  for v_day in
    select element.value
    from pg_catalog.jsonb_array_elements(p_days) as element
  loop
    if pg_catalog.jsonb_typeof(v_day) <> 'object' then
      raise exception 'Every sales day must be a JSON object' using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(v_day -> 'date') <> 'string' then
      raise exception 'Every sales day requires an ISO date' using errcode = '22023';
    end if;
    v_date_text := v_day ->> 'date';
    begin
      v_sales_date := v_date_text::date;
    exception
      when others then
        raise exception 'Invalid sales date' using errcode = '22023';
    end;
    if pg_catalog.to_char(v_sales_date, 'YYYY-MM-DD') <> v_date_text
      or v_sales_date < date '2000-01-01'
      or v_sales_date > current_date + 1
    then
      raise exception 'Sales date is outside the accepted range' using errcode = '22023';
    end if;
    if v_sales_date = any(v_seen_dates) then
      raise exception 'Duplicate sales date in batch' using errcode = '22023';
    end if;
    v_seen_dates := pg_catalog.array_append(v_seen_dates, v_sales_date);

    if pg_catalog.jsonb_typeof(v_day -> 'totalSales') <> 'number' then
      raise exception 'totalSales must be numeric' using errcode = '22023';
    end if;
    begin
      v_numeric_value := (v_day ->> 'totalSales')::numeric;
    exception
      when others then
        raise exception 'Invalid totalSales value' using errcode = '22023';
    end;
    if v_numeric_value < 0 or v_numeric_value > 999999999999.99 then
      raise exception 'totalSales is outside the accepted range' using errcode = '22023';
    end if;
    v_sales_amount := pg_catalog.round(v_numeric_value, 2)::numeric(14,2);

    if pg_catalog.jsonb_typeof(v_day -> 'totalTxs') <> 'number' then
      raise exception 'totalTxs must be numeric' using errcode = '22023';
    end if;
    begin
      v_numeric_value := (v_day ->> 'totalTxs')::numeric;
    exception
      when others then
        raise exception 'Invalid totalTxs value' using errcode = '22023';
    end;
    if v_numeric_value < 0
      or v_numeric_value > 2147483647
      or pg_catalog.trunc(v_numeric_value) <> v_numeric_value
    then
      raise exception 'totalTxs must be a non-negative integer' using errcode = '22023';
    end if;
    v_transactions := v_numeric_value::integer;

    v_hourly_sales := v_day -> 'hourlyData';
    v_hourly_transactions := v_day -> 'hourlyTxs';
    if not coalesce(private.sales_hour_map_is_valid(v_hourly_sales, false), false) then
      raise exception 'hourlyData must map unique hours and channels to non-negative numbers'
        using errcode = '22023';
    end if;
    if not coalesce(private.sales_hour_map_is_valid(v_hourly_transactions, true), false) then
      raise exception 'hourlyTxs must map unique hours and channels to non-negative integers'
        using errcode = '22023';
    end if;

    select coalesce(
      pg_catalog.array_agg(hours.hour_value order by hours.hour_value),
      '{}'::smallint[]
    )
    into v_sales_hours
    from (
      select distinct private.sales_hour_from_key(key) as hour_value
      from pg_catalog.jsonb_object_keys(v_hourly_sales) as sales_key(key)
    ) as hours;

    select coalesce(
      pg_catalog.array_agg(hours.hour_value order by hours.hour_value),
      '{}'::smallint[]
    )
    into v_transaction_hours
    from (
      select distinct private.sales_hour_from_key(key) as hour_value
      from pg_catalog.jsonb_object_keys(v_hourly_transactions) as transaction_key(key)
    ) as hours;

    if v_sales_hours <> v_transaction_hours then
      raise exception 'hourlyData and hourlyTxs must contain the same hours'
        using errcode = '22023';
    end if;
    if v_sales_amount <> private.sales_hour_map_rounded_total(v_hourly_sales) then
      raise exception 'Hourly sales do not match totalSales' using errcode = '23514';
    end if;
    if v_transactions::numeric <> private.sales_hour_map_total(v_hourly_transactions) then
      raise exception 'Hourly transactions do not match totalTxs' using errcode = '23514';
    end if;

    insert into public.sales_daily_history (
      store_id,
      sales_date,
      sales_amount,
      transactions,
      hourly_data,
      hourly_transactions,
      source_data,
      updated_at
    ) values (
      p_store_id,
      v_sales_date,
      v_sales_amount,
      v_transactions,
      v_hourly_sales,
      v_hourly_transactions,
      pg_catalog.jsonb_build_object(
        'date', v_date_text,
        'totalSales', v_sales_amount,
        'totalTxs', v_transactions,
        'hourlyData', v_hourly_sales,
        'hourlyTxs', v_hourly_transactions
      ),
      pg_catalog.clock_timestamp()
    )
    on conflict (store_id, sales_date) do update
    set sales_amount = excluded.sales_amount,
        transactions = excluded.transactions,
        hourly_data = excluded.hourly_data,
        hourly_transactions = excluded.hourly_transactions,
        source_data = coalesce(public.sales_daily_history.source_data, '{}'::jsonb) || excluded.source_data,
        updated_at = excluded.updated_at;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.save_sales_history_batch(uuid, jsonb) from public, anon;
grant execute on function public.save_sales_history_batch(uuid, jsonb) to authenticated;

-- Sales rows are visible only to active superadmins and active store admins.
-- Daily writes remain available to those roles because the public RPC is
-- SECURITY INVOKER; the trigger guarantees that direct daily writes also keep
-- the read-only hourly derivative synchronized.
alter table public.sales_month_configs enable row level security;
alter table public.sales_daily_history enable row level security;
alter table public.sales_hourly_history enable row level security;

drop policy if exists sales_month_read on public.sales_month_configs;
drop policy if exists sales_month_admin_write on public.sales_month_configs;
drop policy if exists sales_month_admin_read on public.sales_month_configs;
drop policy if exists sales_month_admin_insert on public.sales_month_configs;
drop policy if exists sales_month_admin_update on public.sales_month_configs;
drop policy if exists sales_month_admin_delete on public.sales_month_configs;

create policy sales_month_admin_read
on public.sales_month_configs
for select
to authenticated
using ((select private.can_manage_sales(store_id)));

create policy sales_month_admin_insert
on public.sales_month_configs
for insert
to authenticated
with check ((select private.can_manage_sales(store_id)));

create policy sales_month_admin_update
on public.sales_month_configs
for update
to authenticated
using ((select private.can_manage_sales(store_id)))
with check ((select private.can_manage_sales(store_id)));

create policy sales_month_admin_delete
on public.sales_month_configs
for delete
to authenticated
using ((select private.can_manage_sales(store_id)));

drop policy if exists sales_daily_read on public.sales_daily_history;
drop policy if exists sales_daily_admin_write on public.sales_daily_history;
drop policy if exists sales_daily_admin_read on public.sales_daily_history;
drop policy if exists sales_daily_admin_insert on public.sales_daily_history;
drop policy if exists sales_daily_admin_update on public.sales_daily_history;
drop policy if exists sales_daily_admin_delete on public.sales_daily_history;

create policy sales_daily_admin_read
on public.sales_daily_history
for select
to authenticated
using ((select private.can_manage_sales(store_id)));

create policy sales_daily_admin_insert
on public.sales_daily_history
for insert
to authenticated
with check ((select private.can_manage_sales(store_id)));

create policy sales_daily_admin_update
on public.sales_daily_history
for update
to authenticated
using ((select private.can_manage_sales(store_id)))
with check ((select private.can_manage_sales(store_id)));

create policy sales_daily_admin_delete
on public.sales_daily_history
for delete
to authenticated
using ((select private.can_manage_sales(store_id)));

drop policy if exists sales_hourly_read on public.sales_hourly_history;
drop policy if exists sales_hourly_admin_write on public.sales_hourly_history;
drop policy if exists sales_hourly_admin_read on public.sales_hourly_history;

create policy sales_hourly_admin_read
on public.sales_hourly_history
for select
to authenticated
using ((select private.can_manage_sales(store_id)));

revoke all on table public.sales_month_configs from public, anon, authenticated;
grant select, insert, update, delete on table public.sales_month_configs to authenticated;

revoke all on table public.sales_daily_history from public, anon, authenticated;
grant select, insert, update, delete on table public.sales_daily_history to authenticated;

revoke all on table public.sales_hourly_history from public, anon, authenticated;
grant select on table public.sales_hourly_history to authenticated;

revoke all on sequence public.sales_daily_history_id_seq from public, anon, authenticated;
grant usage, select on sequence public.sales_daily_history_id_seq to authenticated;
revoke all on sequence public.sales_hourly_history_id_seq from public, anon, authenticated;
revoke all on sequence public.sales_month_configs_id_seq from public, anon, authenticated;
grant usage, select on sequence public.sales_month_configs_id_seq to authenticated;

-- Fail the migration instead of silently accepting another partial repair.
do $verification$
declare
  v_expected_hours bigint;
  v_actual_hours bigint;
begin
  select count(*)
  into v_expected_hours
  from public.sales_daily_history as daily
  cross join lateral (
    select distinct private.sales_hour_from_key(hour_keys.hour_key) as hour_value
    from (
      select sales_key.key as hour_key
      from pg_catalog.jsonb_object_keys(daily.hourly_data) as sales_key(key)
      union
      select transaction_key.key as hour_key
      from pg_catalog.jsonb_object_keys(daily.hourly_transactions) as transaction_key(key)
    ) as hour_keys
  ) as expected;

  select count(*) into v_actual_hours
  from public.sales_hourly_history;

  if v_actual_hours <> v_expected_hours then
    raise exception 'Hourly repair incomplete: expected %, found %', v_expected_hours, v_actual_hours
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.sales_daily_history as daily
    left join (
      select
        hourly.sales_daily_id,
        pg_catalog.sum(hourly.sales_amount) as sales_amount,
        pg_catalog.sum(hourly.transactions) as transactions
      from public.sales_hourly_history as hourly
      group by hourly.sales_daily_id
    ) as totals on totals.sales_daily_id = daily.id
    where coalesce(totals.sales_amount, 0) <> daily.sales_amount
      or coalesce(totals.transactions, 0) <> daily.transactions
  ) then
    raise exception 'Hourly totals do not match canonical daily totals'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.sales_hourly_history as hourly
    join public.sales_daily_history as daily
      on daily.id = hourly.sales_daily_id
    where (hourly.store_id, hourly.sales_date)
      is distinct from (daily.store_id, daily.sales_date)
  ) then
    raise exception 'Hourly parent identity mismatch remains after repair'
      using errcode = '23514';
  end if;
end
$verification$;

-- Post-apply verification (expected on the audited dataset: 223 / 3415):
-- select
--   (select count(*) from public.sales_daily_history) as daily_rows,
--   (select count(*) from public.sales_hourly_history) as hourly_rows,
--   (select sum(sales_amount) from public.sales_daily_history) as daily_sales,
--   (select sum(sales_amount) from public.sales_hourly_history) as hourly_sales,
--   (select sum(transactions) from public.sales_daily_history) as daily_txs,
--   (select sum(transactions) from public.sales_hourly_history) as hourly_txs;
--
-- select conname, convalidated
-- from pg_catalog.pg_constraint
-- where conrelid = 'public.sales_hourly_history'::regclass
--   and conname = 'sales_hourly_history_daily_parent_fkey';
--
-- set local role authenticated;
-- -- Test with request.jwt.claim.sub set to an active admin/superadmin UUID:
-- select public.save_sales_history_batch(<store_uuid>, <one_valid_day_payload>::jsonb);
-- reset role;
