alter table public.sales_daily_history
  add column if not exists suggestive_products jsonb not null default '{}'::jsonb;

comment on column public.sales_daily_history.suggestive_products is
  'Unidades de los SKU de venta sugestiva, agrupadas por producto, hora y canal directo.';
