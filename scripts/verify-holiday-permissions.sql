-- Run as the database administrator. All test writes are rolled back.
begin;
do $$
declare a public.user_profiles%rowtype; c public.user_profiles%rowtype; d date;
begin
  select u.* into a from public.user_profiles u join public.stores s on s.id=u.store_id
    where u.role in ('admin','superadmin') and u.status='active' and s.is_active order by (u.role='admin') desc limit 1;
  if a.id is null then raise exception 'No active administrator available for verification'; end if;
  select u.* into c from public.user_profiles u join public.staff_profiles s
    on s.id=u.staff_profile_id and s.user_id=u.id and s.store_id=u.store_id
    where u.role='collaborator' and u.status='active' and not u.registration_pending
      and u.store_id=a.store_id and (s.cessation_date is null or s.cessation_date >= current_date)
      and (not s.is_trainee or s.training_end_date is null or s.training_end_date >= current_date)
      and exists(select 1 from public.worked_holidays w where w.staff_id=s.id) limit 1;
  if c.id is null then raise exception 'No linked collaborator available for verification'; end if;
  select w.holiday_date into d from public.worked_holidays w join public.official_holidays h using(holiday_date)
    where w.staff_id=c.staff_profile_id and w.balance_type='ganado' and w.holiday_date <= current_date
      and not exists(select 1 from public.store_holiday_payment_rules r where r.store_id=a.store_id and r.holiday_date=w.holiday_date)
    order by w.holiday_date desc limit 1;
  if d is null then raise exception 'No available holiday fixture'; end if;
  perform set_config('test.admin',a.id::text,true);
  perform set_config('test.admin_role',a.role::text,true);
  perform set_config('test.collaborator',c.id::text,true);
  perform set_config('test.staff',c.staff_profile_id::text,true);
  perform set_config('test.store',a.store_id::text,true);
  perform set_config('test.foreign_store',coalesce((select id::text from public.stores where id<>a.store_id limit 1),gen_random_uuid()::text),true);
  perform set_config('test.date',d::text,true);
  perform set_config('test.history_count',(select count(*)::text from public.worked_holidays),true);
  perform set_config('test.rule_count',(select count(*)::text from public.store_holiday_payment_rules),true);
  perform set_config('request.jwt.claim.sub',a.id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$
declare n integer; total_before integer; total_after integer;
begin
  if private.current_user_role()::text is distinct from current_setting('test.admin_role') then raise exception 'Invalid admin test context'; end if;
  select count(*) into n from public.worked_holiday_ledger where store_id=current_setting('test.store')::uuid
    and holiday_date=current_setting('test.date')::date and balance_type='ganado';
  if n=0 then raise exception 'No earned records for test'; end if;
  select coalesce(sum(balance_delta),0) into total_before from public.worked_holiday_ledger where store_id=current_setting('test.store')::uuid;
  insert into public.store_holiday_payment_rules(store_id,holiday_date,payment_method,note)
    values(current_setting('test.store')::uuid,current_setting('test.date')::date,'boleta','Transactional test; rolled back');
  select coalesce(sum(balance_delta),0) into total_after from public.worked_holiday_ledger where store_id=current_setting('test.store')::uuid;
  if total_after <> total_before-n then raise exception 'Payroll rule must exclude all earned credits for the date'; end if;
  if exists(select 1 from public.worked_holiday_ledger where store_id=current_setting('test.store')::uuid
    and balance_type='compensado' and not is_future and balance_delta<>-1) then raise exception 'Compensated leave was altered'; end if;
  if exists(select 1 from public.store_holiday_payment_rules where store_id=current_setting('test.store')::uuid
    and holiday_date=current_setting('test.date')::date and updated_by<>auth.uid()) then raise exception 'Incorrect audit identity'; end if;
  update public.store_holiday_payment_rules set payment_method='descanso'
    where store_id=current_setting('test.store')::uuid and holiday_date=current_setting('test.date')::date;
  select coalesce(sum(balance_delta),0) into total_after from public.worked_holiday_ledger where store_id=current_setting('test.store')::uuid;
  if total_after<>total_before then raise exception 'Reverting to leave must restore credit'; end if;
  update public.store_holiday_payment_rules set payment_method='boleta'
    where store_id=current_setting('test.store')::uuid and holiday_date=current_setting('test.date')::date;
  if current_setting('test.admin_role')='admin' then begin
    insert into public.store_holiday_payment_rules(store_id,holiday_date,payment_method)
      values(current_setting('test.foreign_store')::uuid,current_setting('test.date')::date,'boleta');
    raise exception 'Admin unexpectedly wrote another store';
  exception when insufficient_privilege then null; end; end if;
  begin
    update public.store_holiday_payment_rules set updated_by=current_setting('test.collaborator')::uuid
      where store_id=current_setting('test.store')::uuid and holiday_date=current_setting('test.date')::date;
    raise exception 'Audit identity could be forged';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  perform set_config('request.jwt.claim.sub',current_setting('test.collaborator'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.collaborator'),'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$
declare affected integer;
begin
  if private.current_user_role()<>'collaborator' or private.current_staff_profile_id()<>current_setting('test.staff')::uuid then raise exception 'Invalid collaborator context'; end if;
  if not exists(select 1 from public.worked_holiday_ledger) then raise exception 'Own holiday history is inaccessible'; end if;
  if exists(select 1 from public.worked_holiday_ledger where staff_id<>current_setting('test.staff')::uuid) then raise exception 'Another collaborator history is exposed'; end if;
  if not exists(select 1 from public.worked_holiday_ledger where holiday_date=current_setting('test.date')::date and payment_method='boleta' and balance_delta=0) then raise exception 'Own payroll holiday is not shown correctly'; end if;
  update public.store_holiday_payment_rules set payment_method='descanso'
    where store_id=current_setting('test.store')::uuid and holiday_date=current_setting('test.date')::date;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Collaborator can update company payment rules'; end if;
  begin
    insert into public.store_holiday_payment_rules(store_id,holiday_date,payment_method)
      values(current_setting('test.store')::uuid,current_setting('test.date')::date,'boleta');
    raise exception 'Collaborator can insert payment rules';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.worked_holiday_ledger limit 1;
    raise exception 'Anonymous ledger access';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.store_holiday_payment_rules limit 1;
    raise exception 'Anonymous rules access';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.worked_holidays)<>current_setting('test.history_count')::integer then raise exception 'History count changed'; end if;
end $$;
select 'PASS: responsible write, all-staff payroll exclusion, reversal, own-only history, collaborator/anonymous denial, unchanged history. Test writes rolled back.' as result, current_setting('test.admin_role') as tested_responsible_role;
rollback;
