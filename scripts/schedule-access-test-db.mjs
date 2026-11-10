// Local PostgreSQL fixture for per-store schedule access. No remote connections.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStaffImportTestDb, STAFF_IMPORT_TEST_IDS } from './staff-planilla-test-db.mjs';

export const SCHEDULE_ACCESS_TEST_IDS = {
  ...STAFF_IMPORT_TEST_IDS,
  otherCollaborator: '20000000-0000-4000-8000-000000000020',
  secondAdmin: '20000000-0000-4000-8000-000000000030',
};

export async function createScheduleAccessTestDb() {
  const db = await createStaffImportTestDb();
  const schema = await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  const table = name => {
    const sql = schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
    assert.ok(sql,`Missing actual table ${name}`); return sql;
  };
  const policy = name => {
    const sql = schema.match(new RegExp(`create policy ${name} on public\\.[\\s\\S]*?;`))?.[0];
    assert.ok(sql,`Missing actual policy ${name}`); return sql;
  };
  await db.exec(`create type public.request_status as enum ('pending','approved','rejected','cancelled');
    create type public.holiday_balance_type as enum ('ganado','compensado');
    ${['store_configs','schedule_weeks','schedule_shifts','study_schedule_days','study_schedule_blocks','worked_holidays','schedule_requests'].map(table).join('\n')}`);
  const policies = [
    'store_configs_access','store_configs_admin_write','schedule_weeks_read','schedule_weeks_admin_write',
    'schedule_shifts_read','schedule_shifts_admin_write','study_days_read','study_days_write','study_blocks_read','study_blocks_write',
    'schedule_requests_read','schedule_requests_create','schedule_requests_admin_update','schedule_requests_admin_delete',
  ];
  for (const name of ['store_configs','schedule_weeks','schedule_shifts','study_schedule_days','study_schedule_blocks','schedule_requests']) {
    await db.exec(`alter table ${name} enable row level security; grant select,insert,update,delete on ${name} to authenticated`);
  }
  await db.exec(policies.map(policy).join('\n'));
  await db.exec('grant usage,select on all sequences in schema public to authenticated');
  for (const file of ['study_schedule_management.sql','weekly_schedule_management.sql']) {
    await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
  }
  await db.exec(await readFile(new URL('../supabase/migrations/20260912150000_enforce_schedule_lock.sql',import.meta.url),'utf8'));
  // Production's hardened identity policy no longer embeds the earlier lock
  // predicate. The new INSERT trigger must enforce that closure on its own.
  await db.exec(`drop policy schedule_requests_create on public.schedule_requests;
    create policy schedule_requests_create on public.schedule_requests for insert to authenticated with check (
      user_id=auth.uid() and store_id=private.current_user_store_id() and status='pending'
      and reviewed_by is null and reviewed_at is null and admin_comment is null
      and exists(select 1 from public.staff_profiles person where person.id=schedule_requests.staff_id
        and person.user_id=auth.uid() and person.store_id=schedule_requests.store_id)
    );`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261025043425_enforce_study_availability_for_requested_shifts.sql',import.meta.url),'utf8'));
  const ids=SCHEDULE_ACCESS_TEST_IDS;
  await db.query("insert into auth.users(id,email) values($1,'other-employee@example.test')",[ids.otherCollaborator]);
  await db.query("insert into user_profiles(id,email,role,status,store_id) values($1,'other-employee@example.test','collaborator','active',$2)",[ids.otherCollaborator,ids.storeB]);
  await db.query("insert into auth.users(id,email) values($1,'second-store-admin@example.test')",[ids.secondAdmin]);
  await db.query("insert into user_profiles(id,email,role,status,store_id) values($1,'second-store-admin@example.test','admin','active',$2)",[ids.secondAdmin,ids.storeA]);
  const staff={};
  for (const [key,userId,storeId,label] of [
    ['own',ids.collaborator,ids.storeA,'Personal A'],
    ['trainer',ids.trainer,ids.storeA,'Entrenador A'],
    ['other',ids.otherCollaborator,ids.storeB,'Personal B'],
  ]) {
    staff[key]=(await db.query("insert into staff_profiles(store_id,user_id,first_name,last_name,modality,status) values($1,$2,$3,'Prueba','Part-Time','active') returning id",[storeId,userId,label])).rows[0].id;
    await db.query('update user_profiles set staff_profile_id=$1 where id=$2',[staff[key],userId]);
  }
  // Optional readonly production catalog snapshot verifies the exact hardened
  // baseline locally. The snapshot contains SQL definitions/policies, no staff.
  if(process.env.SCHEDULE_ACCESS_REMOTE_BASELINE){
    const baseline=JSON.parse(await readFile(process.env.SCHEDULE_ACCESS_REMOTE_BASELINE,'utf8'));
    for(const name of ['current_staff_profile_id','current_user_role','current_user_store_id','replace_study_schedule','save_study_schedule']){
      const item=baseline.functions.find(fn=>fn.name===name);
      assert.ok(item,`Missing readonly baseline function ${name}`);await db.exec(item.definition);
    }
    await db.exec('grant execute on function private.current_staff_profile_id() to authenticated');
    for(const item of baseline.policies){
      if(!['store_configs','study_schedule_days','study_schedule_blocks','schedule_requests'].includes(item.tablename))continue;
      assert.match(item.policyname,/^[a-z_]+$/);assert.match(item.cmd,/^(ALL|SELECT|INSERT|UPDATE|DELETE)$/);
      await db.exec(`drop policy if exists ${item.policyname} on public.${item.tablename};
        create policy ${item.policyname} on public.${item.tablename} for ${item.cmd.toLowerCase()} to authenticated
        ${item.qual?`using (${item.qual})`:''} ${item.with_check?`with check (${item.with_check})`:''};`);
    }
  }
  return {db,staff,ids};
}

export async function asScheduleActor(db,userId,operation) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId||'']);
  await db.exec('set role authenticated');
  try { return await operation(); } finally { await db.exec('reset role'); }
}
