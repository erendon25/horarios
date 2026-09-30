-- Company payment decisions are per store/date, independent of schedule rows.
-- Re-saving a schedule therefore cannot turn a payroll holiday back into credit.
create table public.store_holiday_payment_rules (
  store_id uuid not null references public.stores(id) on delete cascade,
  holiday_date date not null,
  payment_method text not null check (payment_method in ('descanso', 'boleta')),
  note text not null default '' check (char_length(note) <= 500),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (store_id, holiday_date)
);
alter table public.store_holiday_payment_rules enable row level security;
revoke all on public.store_holiday_payment_rules from anon, authenticated;
grant select on public.store_holiday_payment_rules to authenticated;
grant insert (store_id, holiday_date, payment_method, note),
      update (payment_method, note) on public.store_holiday_payment_rules to authenticated;

create policy holiday_payment_rules_read on public.store_holiday_payment_rules
for select to authenticated using (
  (select auth.uid()) is not null and (
    (select private.current_user_role()) = 'superadmin'
    or store_id = (select private.current_user_store_id())
    or exists (select 1 from public.worked_holidays w
      where w.staff_id = (select private.current_staff_profile_id())
        and w.store_id = store_holiday_payment_rules.store_id
        and w.holiday_date = store_holiday_payment_rules.holiday_date)
  )
);
create policy holiday_payment_rules_insert on public.store_holiday_payment_rules
for insert to authenticated with check (
  (select auth.uid()) is not null and (
    (select private.current_user_role()) = 'superadmin'
    or ((select private.current_user_role()) = 'admin' and store_id = (select private.current_user_store_id()))
  )
);
create policy holiday_payment_rules_update on public.store_holiday_payment_rules
for update to authenticated using (
  (select auth.uid()) is not null and (
    (select private.current_user_role()) = 'superadmin'
    or ((select private.current_user_role()) = 'admin' and store_id = (select private.current_user_store_id()))
  )
) with check (
  (select auth.uid()) is not null and (
    (select private.current_user_role()) = 'superadmin'
    or ((select private.current_user_role()) = 'admin' and store_id = (select private.current_user_store_id()))
  )
);

create function private.validate_holiday_payment_rule()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sesión requerida' using errcode = '42501'; end if;
  if not exists (select 1 from public.official_holidays h where h.holiday_date = new.holiday_date)
     and not exists (select 1 from public.worked_holidays w
       where w.store_id = new.store_id and w.holiday_date = new.holiday_date and w.balance_type = 'ganado') then
    raise exception 'Selecciona un feriado oficial o una fecha con feriados trabajados registrados' using errcode = '23514';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.validate_holiday_payment_rule() from public, anon, authenticated;
create trigger validate_holiday_payment_rule before insert or update
on public.store_holiday_payment_rules for each row execute function private.validate_holiday_payment_rule();

-- This view obeys the base tables' RLS, including canonical staff ownership.
-- An instruction to pay in payroll is NOT a confirmation that payroll was paid.
create view public.worked_holiday_ledger with (security_invoker = true) as
select w.id, w.staff_id, w.store_id, w.holiday_date, w.name, w.balance_type,
  case when w.balance_type = 'ganado' then coalesce(r.payment_method, 'descanso')
       else 'descanso' end as payment_method,
  case when w.balance_type = 'ganado' then coalesce(r.note, '') else '' end as payment_note,
  w.holiday_date > (now() at time zone 'America/Lima')::date as is_future,
  case
    when w.holiday_date > (now() at time zone 'America/Lima')::date then 0
    when w.balance_type = 'compensado' then -1
    when w.balance_type = 'ganado' and coalesce(r.payment_method, 'descanso') <> 'boleta' then 1
    else 0
  end as balance_delta
from public.worked_holidays w
left join public.store_holiday_payment_rules r on r.store_id = w.store_id and r.holiday_date = w.holiday_date;
revoke all on public.worked_holiday_ledger from public, anon, authenticated;
grant select on public.worked_holiday_ledger to authenticated;
notify pgrst, 'reload schema';
