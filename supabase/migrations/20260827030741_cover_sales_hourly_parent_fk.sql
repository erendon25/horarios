-- Cover the composite daily-parent foreign key used when a sales day changes
-- Applied remotely as migration version 20260827030741.
-- or is removed.  The hourly table is derived, so parent maintenance must not
-- fall back to a full scan as history grows.

create index if not exists sales_hourly_history_daily_parent_idx
  on public.sales_hourly_history (sales_daily_id, store_id, sales_date);
