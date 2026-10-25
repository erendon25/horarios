import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompetitionTestDb } from './competition-test-db.mjs';

const db = await createCompetitionTestDb();
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const migration = 'supabase/migrations/20261024180657_superadmin_account_management.sql';
try {
  await db.exec(`
    alter table auth.users add column email text unique;
    create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade);
    create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade);
    alter table staff_profiles add column user_id uuid unique references auth.users on delete set null;
    alter table staff_profiles add column email text;
    alter table staff_profiles add column linked_at timestamptz;
    alter table staff_profiles add column modality text;
    alter table staff_profiles add column join_date date;
    alter table user_profiles add column email text;
    alter table user_profiles add column first_name text;
    alter table user_profiles add column last_name text;
    alter table user_profiles add column registration_pending boolean not null default false;
    alter table user_profiles add constraint user_profiles_active_staff_link_check
      check (role not in ('trainer','collaborator') or status <> 'active' or registration_pending
        or (staff_profile_id is not null and store_id is not null)) not valid;
    alter table user_profiles drop constraint user_profiles_id_fkey;
    alter table user_profiles add constraint user_profiles_id_fkey foreign key(id) references auth.users on delete cascade;
    alter table user_profiles drop constraint user_profiles_staff_profile_id_fkey;
    alter table user_profiles add constraint user_profiles_staff_profile_id_fkey foreign key(staff_profile_id) references staff_profiles on delete set null;
    create table schedule_weeks(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade);
    create table schedule_shifts(id uuid primary key default gen_random_uuid(), schedule_week_id uuid references schedule_weeks on delete cascade);
    create table study_schedule_days(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade);
    create table study_schedule_blocks(id uuid primary key default gen_random_uuid(), study_day_id uuid references study_schedule_days on delete cascade);
    create table training_evaluations(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade, trainer_id uuid references auth.users on delete set null, status text, score numeric, collaborator_signature_path text, trainer_signature_path text);
    create table private.approved_legacy_staff_logins(staff_id uuid references staff_profiles on delete cascade);
  `);
  for (const table of ['extra_hours', 'worked_holidays', 'schedule_requests', 'staff_skills', 'cessations', 'suggestive_sales_goal_assignments']) {
    await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade)`);
  }
  await db.exec(await readFile('supabase/migrations/20261001004512_archive_historical_staff_without_accounts.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261011031701_scope_cessation_account_name_cleanup.sql', 'utf8'));
  await db.exec('create trigger training_evaluations_protect_completion before update or delete on training_evaluations for each row execute function private.protect_completed_training_evaluation()');
  await db.exec(await readFile(migration, 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261024190312_superadmin_delete_active_staff.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261024191003_superadmin_delete_administrators.sql', 'utf8'));
  await db.exec(await readFile(process.env.STAFF_DELETE_MIGRATION || 'supabase/migrations/20261025011205_store_admin_delete_staff.sql', 'utf8'));

  const store = await scalar('insert into stores default values returning id');
  async function fixture(role = 'collaborator', status = 'active') {
    const user = await scalar("insert into auth.users(id,email) values(gen_random_uuid(),gen_random_uuid()::text||'@example.test') returning id");
    const staff = await scalar("insert into staff_profiles(store_id,user_id,first_name,last_name,email) values($1,$2,'Persona','Prueba','old@example.test') returning id", [store, user]);
    await db.query('insert into user_profiles(id,store_id,staff_profile_id,role,status,first_name,last_name,email) values($1,$2,$3,$4,$5,\'Persona\',\'Prueba\',\'old@example.test\')', [user, store, staff, role, status]);
    await db.query('insert into auth.sessions(user_id) values($1)', [user]);
    await db.query('insert into auth.identities(user_id) values($1)', [user]);
    return { user, staff };
  }
  const superadmin = await fixture('superadmin');
  const admin = await fixture('admin');
  const target = await fixture('trainer');
  const other = await fixture();
  const inactive = await fixture('superadmin', 'inactive');
  const asUser = async (user, operation) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec('set role authenticated');
    try { return await operation(); } finally { await db.exec('reset role'); }
  };
  const manage = (item, operation = 'delete_staff') => scalar('select public.superadmin_manage_staff_account($1,$2,$3)', [item.staff, operation, item.user]);
  for (const caller of [target, other, inactive]) {
    await assert.rejects(() => asUser(caller.user, () => manage(target)), /forbidden/);
  }
  assert.equal((await asUser(admin.user, () => manage(target, 'inspect_delete_staff'))).userId, target.user);
  await assert.rejects(() => asUser(admin.user, () => manage(target, 'unlink_staff')), /forbidden/);
  await assert.rejects(() => asUser('', () => manage(target)), /forbidden/);
  await db.exec('set role anon');
  await assert.rejects(() => manage(target), /permission denied/);
  await db.exec('reset role');
  await assert.rejects(() => asUser(superadmin.user, () => manage(superadmin)), /protected_account/);
  await assert.rejects(() => asUser(superadmin.user, () => manage(admin)), /protected_account/);

  // Auth update propagates to both public profiles in the same transaction.
  await db.query('update auth.users set email=$1 where id=$2', ['edited@example.test', admin.user]);
  assert.equal(await scalar('select email from user_profiles where id=$1', [admin.user]), 'edited@example.test');
  assert.equal(await scalar('select email from staff_profiles where id=$1', [admin.staff]), 'edited@example.test');
  await db.exec("create function private.fail_profile_email_test() returns trigger language plpgsql as $$begin if new.email='fail@example.test' then raise exception 'test profile failure'; end if;return new;end$$; create trigger fail_profile_email_test before update on user_profiles for each row execute function private.fail_profile_email_test()");
  await assert.rejects(() => db.query('update auth.users set email=$1 where id=$2', ['fail@example.test', admin.user]), /test profile failure/);
  assert.equal(await scalar('select email from auth.users where id=$1', [admin.user]), 'edited@example.test');

  const week = await scalar('insert into schedule_weeks(staff_id) values($1) returning id', [target.staff]);
  await db.query('insert into schedule_shifts(schedule_week_id) values($1)', [week]);
  await db.query("insert into training_evaluations(staff_id,trainer_id,status,score) values($1,$2,'completed',100),($3,$4,'completed',90)", [target.staff, superadmin.user, other.staff, target.user]);
  for (const table of ['extra_hours', 'worked_holidays', 'schedule_requests', 'staff_skills', 'cessations', 'suggestive_sales_goal_assignments']) {
    await db.query(`insert into ${table}(staff_id) values($1),($2)`, [target.staff, other.staff]);
  }
  await db.query('insert into private.approved_legacy_staff_logins values($1)', [target.staff]);
  const competition = await scalar("insert into competitions(store_id,name,created_by) values($1,'Prueba',$2) returning id", [store, target.user]);
  const team = await scalar("insert into competition_teams(competition_id,name,trainer_staff_id,trainer_name) values($1,'Equipo',$2,'Persona Prueba') returning id", [competition, target.staff]);
  const member = await scalar("insert into competition_team_members(competition_id,team_id,staff_id,display_name) values($1,$2,$3,'Persona Prueba') returning id", [competition, team, target.staff]);
  await db.query("insert into competition_team_members(competition_id,team_id,staff_id,display_name) values($1,$2,$3,'Otro participante')", [competition, team, other.staff]);
  const area = await scalar("insert into competition_areas(competition_id,name) values($1,'Masa') returning id", [competition]);
  const phase = await scalar("insert into competition_phases(competition_id,name,phase_order,points) values($1,'Primera',1,1) returning id", [competition]);
  const entry = await scalar('insert into competition_entries(competition_id,member_id,area_id,current_phase_id) values($1,$2,$3,$4) returning id', [competition, member, area, phase]);
  const evaluation = await scalar('insert into competition_evaluations(competition_id,entry_id,phase_id,attempt_number,minimum_quality,maximum_duration_ms,phase_points,evaluated_by) values($1,$2,$3,1,90,1000,1,$4) returning id', [competition, entry, phase, target.user]);
  await db.query("insert into competition_timer_events(competition_id,evaluation_id,action,performed_by) values($1,$2,'start',$3)", [competition, evaluation, target.user]);

  // A failure late in Auth deletion must restore every earlier staff deletion.
  await db.exec("create function private.fail_auth_delete_test() returns trigger language plpgsql as $$begin raise exception 'test auth failure';end$$; create trigger fail_auth_delete_test before delete on auth.users for each row execute function private.fail_auth_delete_test()");
  await assert.rejects(() => asUser(superadmin.user, () => manage(target)), /test auth failure/);
  assert.equal(await scalar('select count(*)::int from staff_profiles where id=$1', [target.staff]), 1);
  assert.equal(await scalar('select count(*)::int from schedule_shifts where schedule_week_id=$1', [week]), 1);
  assert.equal(await scalar('select count(*)::int from competition_entries where id=$1', [entry]), 1);
  assert.equal(await scalar('select status from user_profiles where id=$1', [target.user]), 'active');
  await db.exec('drop trigger fail_auth_delete_test on auth.users');

  // Storage is planned before mutations; callers cannot finalize with live files.
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('profile-photos',$1,$2)", [`${target.user}/profile.jpg`, target.user]);
  const plan = await asUser(superadmin.user, () => manage(target, 'inspect_delete_staff'));
  assert.equal(plan.files[0].path, `${target.user}/profile.jpg`);
  await assert.rejects(() => asUser(superadmin.user, () => manage(target)), /account_has_storage_objects/);
  await db.query('delete from storage.objects where owner_id=$1', [target.user]); // Simulated Storage API contract.
  await db.exec("insert into storage.buckets(id,name) values('training-signatures','training-signatures')");
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('training-signatures','shared-signature.png',$1)", [target.user]);
  const shared = await scalar("insert into training_evaluations(staff_id,trainer_id,status,trainer_signature_path) values($1,$2,'draft','shared-signature.png') returning id", [other.staff, target.user]);
  await assert.rejects(() => asUser(superadmin.user, () => manage(target, 'inspect_delete_staff')), /account_has_shared_files/);
  assert.equal(await scalar("select count(*)::int from storage.objects where name='shared-signature.png'"), 1);
  await db.query('delete from training_evaluations where id=$1', [shared]);
  await db.query('delete from storage.objects where owner_id=$1', [target.user]);
  await assert.rejects(() => asUser(superadmin.user, () => manage({ ...target, user: other.user })), /account_link_conflict/);
  const deleted = await asUser(superadmin.user, () => manage(target));
  assert.equal(deleted.deleted, true);
  for (const table of ['auth.users', 'user_profiles']) assert.equal(await scalar(`select count(*)::int from ${table} where id=$1`, [target.user]), 0);
  for (const table of ['auth.sessions', 'auth.identities']) assert.equal(await scalar(`select count(*)::int from ${table} where user_id=$1`, [target.user]), 0);
  assert.equal(await scalar('select count(*)::int from staff_profiles where id=$1', [target.staff]), 0);
  assert.equal(await scalar('select count(*)::int from schedule_shifts where schedule_week_id=$1', [week]), 0);
  assert.equal(await scalar('select count(*)::int from training_evaluations where staff_id=$1', [target.staff]), 0);
  assert.equal(await scalar('select count(*)::int from competition_entries where id=$1', [entry]), 0);
  assert.equal(await scalar('select count(*)::int from competition_timer_events where evaluation_id=$1', [evaluation]), 0);
  assert.equal(await scalar('select count(*)::int from competition_team_members where staff_id=$1', [other.staff]), 1);
  assert.equal(await scalar('select trainer_staff_id from competition_teams where id=$1', [team]), null);
  const preserved = (await db.query('select * from training_evaluations where staff_id=$1', [other.staff])).rows[0];
  assert.equal(Number(preserved.score), 90); assert.equal(preserved.trainer_id, null); assert.equal(preserved.trainer_name_snapshot, 'Persona Prueba');
  await assert.rejects(() => db.query('delete from training_evaluations where id=$1', [preserved.id]), /no se elimina/);
  for (const table of ['extra_hours', 'worked_holidays', 'schedule_requests', 'staff_skills', 'cessations', 'suggestive_sales_goal_assignments']) {
    assert.equal(await scalar(`select count(*)::int from ${table} where staff_id=$1`, [target.staff]), 0);
    assert.equal(await scalar(`select count(*)::int from ${table} where staff_id=$1`, [other.staff]), 1);
  }
  const unlinked = await fixture();
  await db.query('insert into schedule_weeks(staff_id) values($1)', [unlinked.staff]);
  await asUser(superadmin.user, () => manage(unlinked, 'unlink_staff'));
  const unlinkedProfile = (await db.query('select * from staff_profiles where id=$1', [unlinked.staff])).rows[0];
  assert.equal(unlinkedProfile.user_id, null); assert.equal(unlinkedProfile.email, null); assert.equal(unlinkedProfile.status, 'pending');
  assert.equal(await scalar('select count(*)::int from schedule_weeks where staff_id=$1', [unlinked.staff]), 1);
  await asUser(superadmin.user, () => manage({ ...unlinked, user: null }));
  assert.equal(await scalar('select count(*)::int from staff_profiles where id=$1', [unlinked.staff]), 0);
  const deleteAdmin = (id, operation = 'delete_admin') => scalar('select public.superadmin_manage_admin_account($1,$2)', [id, operation]);
  for (const caller of [admin, other, inactive]) {
    await assert.rejects(() => asUser(caller.user, () => deleteAdmin(admin.user)), /forbidden/);
  }
  await assert.rejects(() => asUser('', () => deleteAdmin(admin.user)), /forbidden/);
  await db.exec('set role anon');
  await assert.rejects(() => deleteAdmin(admin.user), /permission denied/);
  await db.exec('reset role');
  await assert.rejects(() => asUser(superadmin.user, () => deleteAdmin(superadmin.user)), /protected_account/);
  await assert.rejects(() => asUser(superadmin.user, () => deleteAdmin(inactive.user)), /protected_account/);
  await assert.rejects(() => asUser(superadmin.user, () => deleteAdmin(other.user)), /protected_account/);
  const adminEvaluation = await scalar("insert into training_evaluations(staff_id,trainer_id,status,score) values($1,$2,'completed',95) returning id", [other.staff, admin.user]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('profile-photos',$1,$2)", [`${admin.user}/profile.jpg`, admin.user]);
  const adminPlan = await asUser(superadmin.user, () => deleteAdmin(admin.user, 'inspect_delete_admin'));
  assert.equal(adminPlan.files.length, 1);
  await assert.rejects(() => asUser(superadmin.user, () => deleteAdmin(admin.user)), /account_has_storage_objects/);
  await db.query('delete from storage.objects where owner_id=$1', [admin.user]);
  await db.exec('create trigger fail_auth_delete_test before delete on auth.users for each row execute function private.fail_auth_delete_test()');
  await assert.rejects(() => asUser(superadmin.user, () => deleteAdmin(admin.user)), /test auth failure/);
  assert.equal(await scalar('select user_id from staff_profiles where id=$1', [admin.staff]), admin.user);
  await db.exec('drop trigger fail_auth_delete_test on auth.users');
  assert.equal((await asUser(superadmin.user, () => deleteAdmin(admin.user))).deleted, true);
  assert.equal(await scalar('select count(*)::int from auth.users where id=$1', [admin.user]), 0);
  assert.equal(await scalar('select count(*)::int from user_profiles where id=$1', [admin.user]), 0);
  assert.equal(await scalar('select count(*)::int from auth.sessions where user_id=$1', [admin.user]), 0);
  assert.equal(await scalar('select user_id from staff_profiles where id=$1', [admin.staff]), null);
  assert.equal(await scalar('select email from staff_profiles where id=$1', [admin.staff]), null);
  assert.equal(await scalar('select count(*)::int from stores where id=$1', [store]), 1);
  const adminHistory = (await db.query('select * from training_evaluations where id=$1', [adminEvaluation])).rows[0];
  assert.equal(Number(adminHistory.score), 95);
  assert.equal(adminHistory.trainer_id, null);
  assert.equal(adminHistory.trainer_name_snapshot, 'Persona Prueba');
  await assert.rejects(() => asUser(superadmin.user, () => deleteAdmin(admin.user)), /admin_not_found/);
  console.log('PASS: SQL permissions, admin/staff deletion, active-link constraint, rollback, email synchronization, Auth sessions, Storage preflight and preservation of stores, staff and signed history');
} finally { await db.close(); }
