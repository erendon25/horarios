alter table public.extra_hours
  add column if not exists source_key text;

update public.extra_hours
set source_key = concat(
  'geovictoria:',
  staff_id::text,
  ':',
  coalesce(nullif(legacy_data ->> 'periodStart', ''), work_date::text),
  ':',
  coalesce(nullif(legacy_data ->> 'periodEnd', ''), work_date::text)
)
where source = 'geovictoria_extra_hours'
  and source_key is null;

create unique index if not exists extra_hours_source_key_key
  on public.extra_hours (source_key)
  where source_key is not null;

comment on column public.extra_hours.source_key is
  'Clave idempotente del sistema origen, construida exclusivamente con identificadores canónicos de Supabase.';
