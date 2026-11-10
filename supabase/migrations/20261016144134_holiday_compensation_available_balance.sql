-- A recorded compensatory day reserves one day immediately, even when scheduled
-- in the future. Future earned holidays still do not create usable credit.
-- Keep the view contract and base-table RLS; no historical records are rewritten.
create or replace view public.worked_holiday_ledger with (security_invoker = true) as
select w.id, w.staff_id, w.store_id, w.holiday_date, w.name, w.balance_type,
  case when w.balance_type = 'ganado' then coalesce(r.payment_method, 'descanso')
       else 'descanso' end as payment_method,
  case when w.balance_type = 'ganado' then coalesce(r.note, '') else '' end as payment_note,
  w.holiday_date > (now() at time zone 'America/Lima')::date as is_future,
  case
    when w.balance_type = 'compensado' then -1
    when w.holiday_date > (now() at time zone 'America/Lima')::date then 0
    when w.balance_type = 'ganado' and coalesce(r.payment_method, 'descanso') <> 'boleta' then 1
    else 0
  end as balance_delta
from public.worked_holidays w
left join public.store_holiday_payment_rules r on r.store_id = w.store_id and r.holiday_date = w.holiday_date;
revoke all on public.worked_holiday_ledger from public, anon, authenticated;
grant select on public.worked_holiday_ledger to authenticated;
notify pgrst, 'reload schema';
