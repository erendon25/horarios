// Real SQL account-deletion functions with isolated Auth, Storage and store fixtures.
// Never connects to production and never deletes a real employee.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createCompetitionTestDb } from './competition-test-db.mjs';

const db = await createCompetitionTestDb();
const passed = [];
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const check = async (name, operation) => {
  await operation(); passed.push(name); console.log(`PASS: ${name}`);
};
const migration = process.env.STAFF_DELETE_MIGRATION || 'supabase/migrations/20261025011205_store_admin_delete_staff.sql';
try {
  // Match the fixture used by test-superadmin-accounts-db, including real archive
  // migrations, Auth cleanup triggers, signed training and competition cascades.
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
    create table schedule_weeks(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade, week_start date, label text);
    create table schedule_shifts(id uuid primary key default gen_random_uuid(), schedule_week_id uuid references schedule_weeks on delete cascade, start_time time, end_time time, position text);
    create table study_schedule_days(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade);
    create table study_schedule_blocks(id uuid primary key default gen_random_uuid(), study_day_id uuid references study_schedule_days on delete cascade);
    create table training_evaluations(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade, trainer_id uuid references auth.users on delete set null, status text, score numeric, collaborator_signature_path text, trainer_signature_path text);
    create table private.approved_legacy_staff_logins(staff_id uuid references staff_profiles on delete cascade);
  `);
  for (const table of ['extra_hours', 'worked_holidays', 'schedule_requests', 'staff_skills', 'cessations', 'suggestive_sales_goal_assignments']) {
    await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(), staff_id uuid references staff_profiles on delete cascade)`);
  }
  for (const name of [
    '20261001004512_archive_historical_staff_without_accounts.sql',
    '20261011031701_scope_cessation_account_name_cleanup.sql',
    '20261024180657_superadmin_account_management.sql',
    '20261024190312_superadmin_delete_active_staff.sql',
    '20261024191003_superadmin_delete_administrators.sql',
  ]) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  await db.exec('create trigger training_evaluations_protect_completion before update or delete on training_evaluations for each row execute function private.protect_completed_training_evaluation()');
  const schema = await readFile('supabase/schema.sql', 'utf8');
  const staffPolicies = ['staff_profiles_read', 'staff_profiles_admin_write'].map(name => {
    const policy = schema.match(new RegExp(`create policy ${name} on public\\.staff_profiles[\\s\\S]*?;`))?.[0];
    assert.ok(policy, `Missing real policy ${name}`); return policy;
  });
  await db.exec(`grant select,insert,update,delete on staff_profiles to authenticated;
    alter table staff_profiles enable row level security;
    ${staffPolicies.join('\n')}`);
  await db.exec(await readFile('supabase/migrations/20261001011834_restore_admin_staff_profile_writes.sql', 'utf8'));
  await db.exec(await readFile(migration, 'utf8'));

  const stores = [];
  for (let i = 0; i < 3; i += 1) stores.push(await scalar('insert into stores default values returning id'));
  await db.query('update stores set is_active=false where id=$1', [stores[2]]);
  async function fixture({ role = 'collaborator', status = 'active', store = stores[0], linked = true, name = 'Persona Prueba', staffStatus = status } = {}) {
    const [firstName, ...surname] = name.split(' ');
    let user = null;
    if (linked) user = await scalar("insert into auth.users(id,email) values(gen_random_uuid(),gen_random_uuid()::text||'@example.test') returning id");
    const staff = await scalar('insert into staff_profiles(store_id,user_id,first_name,last_name,email,status,modality) values($1,$2,$3,$4,$5,$6,\'Part-Time\') returning id', [store, user, firstName, surname.join(' '), linked ? 'person@example.test' : null, staffStatus]);
    if (linked) {
      await db.query('insert into user_profiles(id,store_id,staff_profile_id,role,status,first_name,last_name,email) values($1,$2,$3,$4,$5,$6,$7,\'person@example.test\')', [user, store, staff, role, status, firstName, surname.join(' ')]);
      await db.query('insert into auth.sessions(user_id) values($1)', [user]);
      await db.query('insert into auth.identities(user_id) values($1)', [user]);
    }
    return { user, staff, store };
  }
  const asUser = async (user, operation) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
    await db.exec('set role authenticated');
    try { return await operation(); } finally { await db.exec('reset role'); }
  };
  const manage = (target, operation = 'delete_staff', expected = target.user) => scalar('select public.superadmin_manage_staff_account($1,$2,$3)', [target.staff, operation, expected]);
  const snapshot = async () => {
    const result = {};
    for (const table of ['auth.users', 'auth.sessions', 'auth.identities', 'user_profiles', 'staff_profiles', 'schedule_weeks', 'schedule_shifts', 'training_evaluations', 'storage.objects', 'staff_history_archives']) {
      result[table] = await scalar(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from ${table} t`);
    }
    return result;
  };
  const superadmin = await fixture({ role: 'superadmin', name: 'Super Administrador' });
  const adminA = await fixture({ role: 'admin', name: 'Administrador A' });
  const adminB = await fixture({ role: 'admin', store: stores[1], name: 'Administrador B' });
  const inactiveAdmin = await fixture({ role: 'admin', status: 'inactive' });
  const noStoreAdmin = await fixture({ role: 'admin', store: null });
  const inactiveStoreAdmin = await fixture({ role: 'admin', store: stores[2] });
  const peer = await fixture({ role: 'trainer', name: 'Evaluador Preservado' });
  const other = await fixture({ store: stores[1], name: 'Persona Otra Tienda' });
  const target = await fixture({ name: 'Colaborador Activo' });
  const week = await scalar("insert into schedule_weeks(staff_id,week_start,label) values($1,'2026-10-19','Semana histórica') returning id", [target.staff]);
  await db.query("insert into schedule_shifts(schedule_week_id,start_time,end_time,position) values($1,'12:00','16:00','Masa')", [week]);
  const ownEvaluation = await scalar("insert into training_evaluations(staff_id,trainer_id,status,score) values($1,$2,'completed',95) returning id", [target.staff, peer.user]);
  const otherEvaluation = await scalar("insert into training_evaluations(staff_id,trainer_id,status,score) values($1,$2,'completed',90) returning id", [peer.staff, target.user]);
  const protectedFile = `${other.user}/avatar.jpg`;
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('profile-photos',$1,$2)", [protectedFile, other.user]);

  await check('superadmin conserva edición en todas las tiendas y la eliminación directa no puede saltarse las protecciones', async () => {
    const updated = await asUser(superadmin.user, () => db.query("update staff_profiles set first_name='Editado' where id=$1 returning id", [other.staff]));
    assert.deepEqual(updated.rows, [{ id: other.staff }]);
    await db.query("update staff_profiles set first_name='Persona' where id=$1", [other.staff]);
    const rejected = await asUser(adminA.user, () => db.query("update staff_profiles set first_name='No permitido' where id=$1 returning id", [other.staff]));
    assert.deepEqual(rejected.rows, []);
    assert.equal(await scalar("select has_table_privilege('authenticated','public.staff_profiles','UPDATE')"), true);
    assert.equal(await scalar("select has_table_privilege('authenticated','public.staff_profiles','DELETE')"), false);
    assert.equal(await scalar("select has_function_privilege('authenticated','private.archive_staff_before_removal(uuid)','EXECUTE')"), false);
    await assert.rejects(() => asUser(adminA.user, () => db.query('delete from staff_profiles where id=$1', [target.staff])), /permission denied/);
    await assert.rejects(() => asUser(superadmin.user, () => db.query('delete from staff_profiles where id=$1', [target.staff])), /permission denied/);
  });

  await check('admin de otra tienda no inspecciona ni elimina; Auth, archivos e históricos permanecen idénticos', async () => {
    const before = await snapshot();
    for (const [caller, victim] of [[adminA, other], [adminB, target]]) {
      for (const operation of ['inspect_delete_staff', 'delete_staff']) {
        await assert.rejects(() => asUser(caller.user, () => manage(victim, operation)), /forbidden|store_not_authorized/);
      }
    }
    assert.deepEqual(await snapshot(), before);
  });

  await check('roles no autorizados, admin inactivo/sin tienda y tienda inactiva no mutan datos', async () => {
    const before = await snapshot();
    for (const caller of [peer, inactiveAdmin, noStoreAdmin, inactiveStoreAdmin]) {
      await assert.rejects(() => asUser(caller.user, () => manage(target)), /forbidden|inactive_store|store_not_authorized/);
    }
    await assert.rejects(() => asUser(null, () => manage(target)), /forbidden/);
    await db.exec('set role anon');
    await assert.rejects(() => manage(target), /permission denied/);
    await db.exec('reset role');
    assert.deepEqual(await snapshot(), before);
  });

  await check('admin no elimina su cuenta, otro administrador ni superadmin y no puede desvincular correos', async () => {
    const before = await snapshot();
    for (const victim of [adminA, superadmin]) {
      for (const operation of ['inspect_delete_staff', 'delete_staff']) {
        await assert.rejects(() => asUser(adminA.user, () => manage(victim, operation)), /protected_account/);
      }
    }
    const ownStoreAdmin = await fixture({ role: 'admin' });
    await assert.rejects(() => asUser(adminA.user, () => manage(ownStoreAdmin)), /protected_account/);
    for (const operation of ['inspect_unlink_staff', 'unlink_staff']) {
      await assert.rejects(() => asUser(adminA.user, () => manage(target, operation)), /forbidden/);
    }
    await assert.rejects(() => asUser(adminA.user, () => scalar('select public.superadmin_manage_admin_account($1,\'delete_admin\')', [adminB.user])), /forbidden/);
    // The only difference is the explicitly added fixture; all protected originals remain.
    const after = await snapshot();
    for (const table of Object.keys(before)) {
      if (['auth.users', 'auth.sessions', 'auth.identities', 'user_profiles', 'staff_profiles'].includes(table)) continue;
      assert.deepEqual(after[table], before[table]);
    }
    for (const victim of [adminA, adminB, superadmin]) assert.equal(await scalar('select count(*)::int from auth.users where id=$1', [victim.user]), 1);
  });

  await check('validación del vínculo y Storage ocurre antes de borrar perfil o archivar', async () => {
    const before = await snapshot();
    await assert.rejects(() => asUser(adminA.user, () => manage(target, 'delete_staff', peer.user)), /account_link_conflict/);
    assert.deepEqual(await snapshot(), before);
    const path = `${target.user}/avatar.jpg`;
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values('profile-photos',$1,$2)", [path, target.user]);
    const plan = await asUser(adminA.user, () => manage(target, 'inspect_delete_staff'));
    assert.equal(plan.userId, target.user);
    assert.deepEqual(plan.files, [{ bucket: 'profile-photos', path }]);
    const withFile = await snapshot();
    await assert.rejects(() => asUser(adminA.user, () => manage(target)), /account_has_storage_objects/);
    assert.deepEqual(await snapshot(), withFile);
    await db.query('delete from storage.objects where owner_id=$1', [target.user]); // Simulate the Storage API.
  });

  await check('evaluaciones firmadas siguen inmutables y un fallo tardío revierte archivo, perfil y Auth', async () => {
    await assert.rejects(() => db.query('delete from training_evaluations where id=$1', [ownEvaluation]), /no se elimina/);
    await db.exec("create function private.reject_auth_delete_test() returns trigger language plpgsql as $$begin raise exception 'fixture_auth_delete_failure';end$$; create trigger reject_auth_delete_test before delete on auth.users for each row execute function private.reject_auth_delete_test()");
    const before = await snapshot();
    await assert.rejects(() => asUser(adminA.user, () => manage(target)), /fixture_auth_delete_failure/);
    assert.deepEqual(await snapshot(), before);
    await db.exec('drop trigger reject_auth_delete_test on auth.users');
  });

  await check('admin elimina colaborador activo propio y conserva turnos/evaluaciones como texto sin usuario vinculado', async () => {
    const beforeOther = (await snapshot()).staff_profiles.find(row => row.id === other.staff);
    const result = await asUser(adminA.user, () => manage(target));
    assert.equal(result.deleted, true);
    for (const [table, column, value] of [
      ['staff_profiles', 'id', target.staff], ['auth.users', 'id', target.user], ['user_profiles', 'id', target.user],
      ['auth.sessions', 'user_id', target.user], ['auth.identities', 'user_id', target.user],
      ['schedule_weeks', 'staff_id', target.staff], ['schedule_shifts', 'schedule_week_id', week],
    ]) assert.equal(await scalar(`select count(*)::int from ${table} where ${column}=$1`, [value]), 0);
    const archive = (await db.query('select * from staff_history_archives where fingerprint=md5($1)', [target.staff])).rows[0];
    assert.ok(archive, 'Deleted employee must have an immutable text archive');
    assert.equal(archive.store_id, stores[0]);
    assert.equal(archive.display_name, 'Colaborador Activo');
    const rawArchive = JSON.stringify({ snapshot: archive.staff_snapshot, records: archive.records });
    assert.ok(rawArchive.includes('12:00:00') && rawArchive.includes('16:00:00') && rawArchive.includes('Masa'));
    assert.equal(rawArchive.includes(target.user), false);
    assert.equal(rawArchive.includes(target.staff), false);
    assert.ok(JSON.stringify(archive.records).includes('95'));
    assert.deepEqual((await snapshot()).staff_profiles.find(row => row.id === other.staff), beforeOther);
    const preserved = (await db.query('select * from training_evaluations where id=$1', [otherEvaluation])).rows[0];
    assert.equal(Number(preserved.score), 90);
    assert.equal(preserved.trainer_id, null);
    assert.equal(preserved.trainer_name_snapshot, 'Colaborador Activo');
    await assert.rejects(() => db.query('delete from training_evaluations where id=$1', [otherEvaluation]), /no se elimina/);
    assert.equal(await scalar('select count(*)::int from storage.objects where name=$1', [protectedFile]), 1);
  });

  await check('admin elimina perfiles propios pendientes sin cuenta e inactivos sin reactivarlos', async () => {
    for (const [status, linked] of [['pending', false], ['inactive', false], ['inactive', true]]) {
      const person = await fixture({ status, linked, name: `Registro ${status}` });
      const result = await asUser(adminA.user, () => manage(person));
      assert.equal(result.deleted, true);
      assert.equal(await scalar('select count(*)::int from staff_profiles where id=$1', [person.staff]), 0);
      assert.equal(await scalar('select count(*)::int from staff_history_archives where fingerprint=md5($1)', [person.staff]), 1);
      if (linked) assert.equal(await scalar('select count(*)::int from auth.users where id=$1', [person.user]), 0);
    }
  });

  await check('superadmin conserva eliminación y desvinculación entre tiendas; admin ve solo archivos de su tienda', async () => {
    const person = await fixture({ store: stores[1] });
    assert.equal((await asUser(superadmin.user, () => manage(person, 'unlink_staff'))).unlinked, true);
    assert.equal(await scalar('select user_id from staff_profiles where id=$1', [person.staff]), null);
    assert.equal((await asUser(superadmin.user, () => manage({ ...person, user: null }))).deleted, true);
    const ownArchives = await asUser(adminA.user, () => db.query('select distinct store_id from staff_history_archives'));
    assert.deepEqual(ownArchives.rows, [{ store_id: stores[0] }]);
    const otherArchives = await asUser(adminB.user, () => db.query('select distinct store_id from staff_history_archives'));
    assert.deepEqual(otherArchives.rows, [{ store_id: stores[1] }]);
    assert.equal(await scalar('select count(*)::int from stores'), 3);
  });

  await check('revocar eliminación directa conserva archivo automático de históricos y limpieza autorizada por cese', async () => {
    const historical = await fixture({ status: 'inactive', linked: false });
    await db.query("update staff_profiles set first_name='Histórico Prueba legacy',last_name='' where id=$1", [historical.staff]);
    const archiveId = await scalar('select private.archive_synthetic_staff($1)', [historical.staff]);
    assert.ok(archiveId);
    assert.equal(await scalar('select count(*)::int from staff_profiles where id=$1', [historical.staff]), 0);
    assert.equal(await scalar('select reason from staff_history_archives where id=$1', [archiveId]), 'historical_import');

    const ceased = await fixture({ name: 'Persona Cese' });
    // The cessation rule uses Lima and keeps its last day inclusive. Three days
    // avoids a UTC/Lima boundary accidentally producing a still-valid last day.
    await asUser(adminA.user, () => db.query('update staff_profiles set cessation_date=current_date-3 where id=$1', [ceased.staff]));
    assert.equal(await scalar('select count(*)::int from auth.users where id=$1', [ceased.user]), 0);
    assert.equal(await scalar('select user_id from staff_profiles where id=$1', [ceased.staff]), null);
    assert.equal(await scalar('select status from staff_profiles where id=$1', [ceased.staff]), 'inactive');
  });

  const output = new URL('../output/staff-delete-store-qa/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('db-result.json', output), JSON.stringify({ status: 'PASS', passed, migration,
    scope: 'PGlite with real SQL migrations, fake Auth/Storage/store records; no production access.' }, null, 2) + '\n');
} finally { await db.close(); }
