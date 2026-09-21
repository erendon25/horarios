create or replace function public.save_sales_history_batch(
  p_store_id uuid,
  p_days jsonb
)
returns integer
language plpgsql
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
  v_suggestive_products jsonb;
  v_has_suggestive_products boolean;
  v_product_id text;
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

    v_has_suggestive_products := v_day ? 'suggestiveProducts';
    if v_has_suggestive_products then
      v_suggestive_products := v_day -> 'suggestiveProducts';
      if pg_catalog.jsonb_typeof(v_suggestive_products) <> 'object'
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_suggestive_products) as product(key)
          where product.key not in ('cheeseBorder', 'canelitas4', 'crazy4')
        )
      then
        raise exception 'suggestiveProducts contains an invalid product key or structure'
          using errcode = '22023';
      end if;

      foreach v_product_id in array array['cheeseBorder', 'canelitas4', 'crazy4']::text[]
      loop
        if v_suggestive_products ? v_product_id
          and not coalesce(private.sales_hour_map_is_valid(v_suggestive_products -> v_product_id, true), false)
        then
          raise exception 'suggestiveProducts must map hours and channels to non-negative integer quantities'
            using errcode = '22023';
        end if;
      end loop;
    else
      v_suggestive_products := null;
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
      suggestive_products,
      source_data,
      updated_at
    ) values (
      p_store_id,
      v_sales_date,
      v_sales_amount,
      v_transactions,
      v_hourly_sales,
      v_hourly_transactions,
      coalesce(v_suggestive_products, '{}'::jsonb),
      pg_catalog.jsonb_build_object(
        'date', v_date_text,
        'totalSales', v_sales_amount,
        'totalTxs', v_transactions,
        'hourlyData', v_hourly_sales,
        'hourlyTxs', v_hourly_transactions
      ) || case
        when v_has_suggestive_products
          then pg_catalog.jsonb_build_object('suggestiveProducts', v_suggestive_products)
        else '{}'::jsonb
      end,
      pg_catalog.clock_timestamp()
    )
    on conflict (store_id, sales_date) do update
    set sales_amount = excluded.sales_amount,
        transactions = excluded.transactions,
        hourly_data = excluded.hourly_data,
        hourly_transactions = excluded.hourly_transactions,
        suggestive_products = case
          when v_has_suggestive_products then excluded.suggestive_products
          else public.sales_daily_history.suggestive_products
        end,
        source_data = coalesce(public.sales_daily_history.source_data, '{}'::jsonb) || excluded.source_data,
        updated_at = excluded.updated_at;

    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

comment on function public.save_sales_history_batch(uuid, jsonb) is
  'Guarda ventas, transacciones y SKU sugestivos en una única operación validada y atómica.';
