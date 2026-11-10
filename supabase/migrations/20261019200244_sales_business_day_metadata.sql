-- Preserve the importer business-date convention without rewriting historical
-- dates. Existing unmarked imports may already use the 06:00 cutoff.
do $migration$
declare
  definition text;
  previous text;
begin
  definition := pg_catalog.pg_get_functiondef('public.save_sales_history_batch(uuid,jsonb)'::regprocedure);
  previous := definition;
  definition := pg_catalog.replace(definition,
    'v_date_text := v_day ->> ''date'';',
    $validation$v_date_text := v_day ->> 'date';
    if v_day ? 'businessDateVersion' or v_day ? 'salesDayBasis' then
      if (v_day -> 'businessDateVersion') is distinct from '1'::jsonb
        or (v_day ->> 'salesDayBasis') is distinct from 'business-06:00'
      then
        raise exception 'Unsupported sales business-date convention' using errcode = '22023';
      end if;
    end if;
    if v_day ? 'productSalesRecorded'
      and pg_catalog.jsonb_typeof(v_day -> 'productSalesRecorded') is distinct from 'boolean' then
      raise exception 'productSalesRecorded must be boolean' using errcode = '22023';
    end if;
    if v_day -> 'productSalesRecorded' = 'true'::jsonb and not (v_day ? 'productSales') then
      raise exception 'Verified products require productSales detail' using errcode = '22023';
    end if;
    if v_day ? 'productRevenueRecorded'
      and pg_catalog.jsonb_typeof(v_day -> 'productRevenueRecorded') is distinct from 'boolean' then
      raise exception 'productRevenueRecorded must be boolean' using errcode = '22023';
    end if;
    if v_day -> 'productRevenueRecorded' = 'true'::jsonb
      and not (v_day ? 'productSales') then
      raise exception 'Verified product revenue requires productSales detail' using errcode = '22023';
    end if;
    if v_day ? 'productSales' then
      if pg_catalog.jsonb_typeof(v_day -> 'productSales') is distinct from 'array' then
        raise exception 'productSales must be an array' using errcode = '22023';
      end if;
      if pg_catalog.jsonb_array_length(v_day -> 'productSales') > 50000 then
        raise exception 'Too many reported product entries' using errcode = '22023';
      end if;
      if exists (
        select 1 from pg_catalog.jsonb_array_elements(v_day -> 'productSales') product
        where pg_catalog.jsonb_typeof(product) is distinct from 'object'
          or pg_catalog.jsonb_typeof(product -> 'name') is distinct from 'string'
          or length(btrim(coalesce(product ->> 'name', ''))) not between 1 and 160
          or (product ->> 'name') ~ '[[:cntrl:]]'
          or pg_catalog.jsonb_typeof(product -> 'channel') is distinct from 'string'
          or length(btrim(coalesce(product ->> 'channel', ''))) not between 1 and 80
          or (product ->> 'channel') ~ '[[:cntrl:]]'
          or not case when pg_catalog.jsonb_typeof(product -> 'hour') = 'number' then
            (product ->> 'hour')::numeric between 0 and 23
              and trunc((product ->> 'hour')::numeric) = (product ->> 'hour')::numeric
            else false end
          or not case when pg_catalog.jsonb_typeof(product -> 'quantity') = 'number' then
            (product ->> 'quantity')::numeric between 0 and 1000000000
            else false end
          or case when product ? 'revenue' and product -> 'revenue' <> 'null'::jsonb then
            not case when pg_catalog.jsonb_typeof(product -> 'revenue') = 'number' then
              (product ->> 'revenue')::numeric between 0 and 1000000000
              else false end
            else false end
          or (v_day -> 'productRevenueRecorded' = 'true'::jsonb
            and pg_catalog.jsonb_typeof(product -> 'revenue') is distinct from 'number')
      ) then
        raise exception 'Invalid exact product sales detail' using errcode = '22023';
      end if;
    end if;$validation$);
  if definition = previous then
    raise exception 'Unexpected sales importer date validation; review before applying';
  end if;
  previous := definition;
  definition := pg_catalog.replace(definition,
    '''hourlyTxs'', v_hourly_transactions',
    $metadata$'hourlyTxs', v_hourly_transactions,
        'businessDateVersion', case when v_day -> 'businessDateVersion' = '1'::jsonb then 1 else 0 end,
        'salesDayBasis', case when v_day ->> 'salesDayBasis' = 'business-06:00'
          then 'business-06:00' else 'unknown' end,
        'productSales', coalesce(v_day -> 'productSales', '[]'::jsonb),
        'productSalesRecorded', coalesce(v_day -> 'productSalesRecorded', 'false'::jsonb),
        'productRevenueRecorded', coalesce(v_day -> 'productRevenueRecorded', 'false'::jsonb)$metadata$);
  if definition = previous then
    raise exception 'Unexpected sales importer source data; review before applying';
  end if;
  execute definition;
end;
$migration$;
