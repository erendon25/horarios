// PostgreSQL regression for the real ledger migrations; disposable identities.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeHolidayLedger} from '../src/services/holidayBalance.js';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
const scalar=async(sql,args=[]) => Object.values((await rows(sql,args))[0])[0];
const login=async(id,role='authenticated') => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']);
  await db.exec(`set role ${role}`);
};
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create type public.holiday_balance_type as enum ('ganado','compensado');
    create table public.stores(id uuid primary key default gen_random_uuid());
    create table public.staff_profiles(id uuid primary key default gen_random_uuid(),store_id uuid references stores);
    create table public.user_profiles(id uuid references auth.users,store_id uuid references stores,staff_id uuid references staff_profiles,role text);
    create function private.current_user_role() returns text language sql security definer set search_path='' as $$select role from public.user_profiles where id=auth.uid()$$;
    create function private.current_user_store_id() returns uuid language sql security definer set search_path='' as $$select store_id from public.user_profiles where id=auth.uid()$$;
    create function private.current_staff_profile_id() returns uuid language sql security definer set search_path='' as $$select staff_id from public.user_profiles where id=auth.uid()$$;
    grant usage on schema auth,private to authenticated;
    grant execute on all functions in schema auth,private to authenticated;
    create table public.official_holidays(holiday_date date primary key);
    grant select on public.official_holidays to authenticated;
  `);
  // Use the canonical table definition; the tested migration changes only its view.
  const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  await db.exec(schema.match(/create table public\.worked_holidays \([\s\S]*?\n\);/)[0]);
  await db.exec(`
    alter table worked_holidays enable row level security;
    grant select,delete on worked_holidays to authenticated;
    create policy worked_holidays_read on worked_holidays for select to authenticated using (
      staff_id=(select private.current_staff_profile_id())
      or (select private.current_user_role())='superadmin'
      or (store_id=(select private.current_user_store_id()) and (select private.current_user_role()) in ('admin','trainer'))
    );
    create policy worked_holidays_admin_delete on worked_holidays for delete to authenticated using (
      (select private.current_user_role())='superadmin'
      or (store_id=(select private.current_user_store_id()) and (select private.current_user_role())='admin')
    );
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20260922044944_holiday_payment_rules_and_ledger.sql',import.meta.url),'utf8'));
  const store=await scalar('insert into stores default values returning id');
  const foreignStore=await scalar('insert into stores default values returning id');
  const people=[];
  for(const [s,role] of [[store,'admin'],[store,'collaborator'],[store,'collaborator'],[foreignStore,'collaborator']]) {
    const staff=await scalar('insert into staff_profiles(store_id) values($1) returning id',[s]);
    const account=await scalar('insert into auth.users default values returning id');
    await db.query('insert into user_profiles values($1,$2,$3,$4)',[account,s,staff,role]);
    people.push({staff,account,store:s});
  }
  const [admin,person,other,foreign]=people;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin.account]);
  const record=async(p,offset,type) => scalar(`insert into worked_holidays(staff_id,user_id,store_id,holiday_date,name,balance_type)
    values($1,$2,$3,(now() at time zone 'America/Lima')::date+$4::integer,$5,$6::holiday_balance_type) returning id`,[p.staff,p.account,p.store,offset,type,type]);
  for(let i=1;i<=7;i++) await record(person,-i,'ganado');
  const compensations=[];
  for(let i=1;i<=4;i++) compensations.push(await record(person,i,'compensado'));
  await record(person,10,'ganado');
  for(let i=11;i<=13;i++) {
    await record(person,-i,'ganado');
    await db.query("insert into store_holiday_payment_rules(store_id,holiday_date,payment_method) values($1,(now() at time zone 'America/Lima')::date-$2::integer,'boleta')",[store,i]);
  }
  await record(other,1,'compensado'); await record(foreign,-1,'ganado');
  const historyBefore=await rows('select * from worked_holidays order by id');
  const paymentsBefore=await rows('select * from store_holiday_payment_rules order by holiday_date');
  await login(person.account);
  assert.equal(Number(await scalar('select sum(balance_delta) from worked_holiday_ledger')),7,'Original future compensation bug reproduced');
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/20261016144134_holiday_compensation_available_balance.sql',import.meta.url),'utf8'));
  assert.deepEqual(await rows('select * from worked_holidays order by id'),historyBefore,'Migration preserves all history');
  assert.deepEqual(await rows('select * from store_holiday_payment_rules order by holiday_date'),paymentsBefore,'Payroll decisions preserved');
  await login(person.account);
  const ledger=await rows('select * from worked_holiday_ledger');
  assert.ok(ledger.every(r=>r.staff_id===person.staff),'View still enforces ownership');
  assert.equal(ledger.length,15);
  assert.equal(summarizeHolidayLedger(ledger).balance,3);
  assert.equal(summarizeHolidayLedger(ledger).scheduledCompensations,4);
  assert.equal(ledger.filter(r=>r.is_future && r.balance_type==='compensado' && r.balance_delta===-1).length,4);
  assert.ok(ledger.filter(r=>r.balance_type==='ganado' && (r.is_future || r.payment_method==='boleta')).every(r=>r.balance_delta===0));
  // Simulate the scheduled day arriving. Its debit must stay exactly -1.
  await db.exec('reset role');
  await db.query("update worked_holidays set holiday_date=(now() at time zone 'America/Lima')::date where id=$1",[compensations[0]]);
  await login(person.account);
  assert.equal(summarizeHolidayLedger(await rows('select * from worked_holiday_ledger')).balance,3);
  assert.equal(summarizeHolidayLedger(await rows('select * from worked_holiday_ledger')).compensated,1);
  assert.equal((await rows('delete from worked_holidays where id=$1 returning id',[compensations[1]])).length,0,'Collaborator cannot remove the debit');
  await login(admin.account);
  await db.query('delete from worked_holidays where id=$1',[compensations[1]]);
  assert.equal(Number(await scalar('select sum(balance_delta) from worked_holiday_ledger where staff_id=$1',[person.staff])),4,'Removing a scheduled compensation restores one day');
  assert.ok((await rows('select * from worked_holiday_ledger')).every(r=>r.store_id===store),'Admin cannot see another store');
  await login(other.account);
  assert.equal(summarizeHolidayLedger(await rows('select * from worked_holiday_ledger')).balance,-1,'No zero clamp hides overscheduling');
  await login(null,'anon');
  await assert.rejects(()=>rows('select * from worked_holiday_ledger'),/permission denied/);
  console.log('PASS: real PostgreSQL migration fixes 7−4=3, preserves history/payroll, keeps future earnings at zero, avoids double debit, restores canceled leave, and preserves own/store/anonymous permissions.');
} finally {await db.close();}
