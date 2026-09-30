-- Keep the former combo x4 quantities under their original keys. The HAZLO V3
-- SKUs have different keys and cannot inherit those quantities or assignments.
do $migration$
declare
  definition text;
  previous text;
  old_keys text := '''cheeseBorder'', ''canelitas4'', ''crazy4''';
  new_keys text := '''cheeseBorder'', ''canelitas4'', ''crazy4'', ''hazloCanelitasV3'', ''hazloCrazyV3''';
begin
  definition := pg_get_functiondef('public.save_sales_history_batch(uuid,jsonb)'::regprocedure);
  if (length(definition) - length(replace(definition, old_keys, ''))) <> 2 * length(old_keys) then
    raise exception 'Unexpected sales importer definition; review the product validators before applying';
  end if;
  definition := replace(definition, old_keys, new_keys);
  previous := definition;
  definition := replace(definition,
    'when v_has_suggestive_products then excluded.suggestive_products',
    'when v_has_suggestive_products then public.sales_daily_history.suggestive_products || excluded.suggestive_products');
  if definition = previous then
    raise exception 'Unexpected sales importer upsert; preserve existing product history before applying';
  end if;
  execute definition;

  definition := pg_get_functiondef('public.get_my_suggestive_sales_goals(date)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'and assignment.channel = ''SALÓN''',
    'and assignment.channel = ''SALÓN''
    and assignment.goals ?& array[''cheeseBorder'', ''hazloCanelitasV3'', ''hazloCrazyV3'']');
  if definition = previous then
    raise exception 'Unexpected collaborator goal reader; review before applying';
  end if;
  execute definition;

  definition := pg_get_functiondef('private.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'or v_channel <> ''SALÓN''',
    'or v_channel <> ''SALÓN''
      or not coalesce((v_row -> ''goals'') ?& array[''cheeseBorder'', ''hazloCanelitasV3'', ''hazloCrazyV3''], false)
      or coalesce((v_row -> ''goals'') ?| array[''canelitas4'', ''crazy4''], false)');
  if definition = previous then
    raise exception 'Unexpected goal publisher; review before applying';
  end if;
  execute definition;
end;
$migration$;

comment on column public.sales_daily_history.suggestive_products is
  'Quantities by SKU, hour and channel. Current: cheeseBorder, hazloCanelitasV3, hazloCrazyV3. Legacy canelitas4/crazy4 remain distinct historical SKUs.';
