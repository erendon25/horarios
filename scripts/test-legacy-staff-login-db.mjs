import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create type app_role as enum('superadmin','admin','trainer','collaborator');
    create type record_status as enum('active','inactive','pending');
    create table auth.users(id uuid primary key default gen_random_uuid(),email text unique,
      raw_app_meta_data jsonb default '{}',deleted_at timestamptz,banned_until timestamptz);
    create table stores(id uuid primary key default gen_random_uuid(),is_active boolean default true);
    create table staff_profiles(id uuid primary key default gen_random_uuid(),store_id uuid references stores,
      user_id uuid unique references auth.users,email text,first_name text default 'Persona',last_name text default 'Prueba',
      position text default 'COLABORADOR',status record_status default 'pending',cessation_date date,
      is_trainee boolean default false,training_end_date date,dni text default '00123456',
      linked_at timestamptz,updated_at timestamptz);
    create table user_profiles(id uuid primary key references auth.users,email text,first_name text,last_name text,
      role app_role not null,status record_status,store_id uuid references stores,staff_profile_id uuid references staff_profiles,
      registration_pending boolean,updated_at timestamptz,
      check(role not in ('trainer','collaborator') or status <> 'active' or registration_pending or (staff_profile_id is not null and store_id is not null)));
    create table schedules(id uuid primary key default gen_random_uuid(),staff_id uuid references staff_profiles,
      schedule_date date,start_time time,end_time time,position text);
    create function private.enforce_linked_staff_identity() returns trigger language plpgsql security definer set search_path='' as $$
    begin
      if new.user_id is not null and not exists(select 1 from auth.users where id=new.user_id and lower(btrim(email))=lower(btrim(new.email)))
        then raise exception 'linked Auth email mismatch'; end if;
      return new;
    end $$;
    create trigger staff_profiles_enforce_linked_identity before insert or update of user_id,email,store_id on staff_profiles
      for each row execute function private.enforce_linked_staff_identity();
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261011150359_recover_approved_legacy_staff_login.sql', import.meta.url), 'utf8'));
  const store = await scalar('insert into stores default values returning id');
  async function seed(previous = false) {
    const email = `qa-${crypto.randomUUID()}@example.test`;
    const old = previous ? await scalar("insert into auth.users(email) values($1) returning id", [`old-${email}`]) : null;
    const staff = await scalar('insert into staff_profiles(store_id,user_id,email) values($1,$2,$3) returning id', [store, old, old ? `old-${email}` : null]);
    if (old) await db.query("insert into user_profiles(id,email,role,status,store_id,staff_profile_id,registration_pending) values($1,$2,'collaborator','active',$3,$4,false)", [old, `old-${email}`, store, staff]);
    await db.query("insert into schedules(staff_id,schedule_date,start_time,end_time,position) values($1,'2026-10-12','12:00','16:00','Masa')", [staff]);
    const approval = await scalar('insert into private.approved_legacy_staff_logins(email,firebase_uid,staff_id,expected_store_id,expected_previous_user_id,expected_staff_email) values($1,$2,$3,$4,$5,$6) returning approval_id', [email, `firebase-${email}`, staff, store, old, old ? `old-${email}` : null]);
    const user = await scalar('insert into auth.users(email,raw_app_meta_data) values($1,$2::jsonb) returning id', [email, JSON.stringify({ legacy_staff_recovery_id: approval, firebase_uid: `firebase-${email}` })]);
    return { email, staff, user, old, approval, firebase: `firebase-${email}` };
  }
  const prepare = person => scalar('select prepare_approved_legacy_staff_login($1)', [person.email]);
  const complete = (person, uid = person.user, firebase = person.firebase) => scalar('select complete_approved_legacy_staff_login($1,$2,$3)', [person.email, uid, firebase]);
  for (const previous of [false, true]) {
    const person = await seed(previous);
    assert.equal((await prepare(person)).user_id, person.user, 'resume exact server-tagged account');
    const schedules = (await db.query('select * from schedules where staff_id=$1', [person.staff])).rows;
    assert.equal(await complete(person), true);
    assert.equal(await complete(person), true, 'idempotent completion');
    assert.equal(await prepare(person), null, 'completed approval cannot recover again');
    const staff = (await db.query('select * from staff_profiles where id=$1', [person.staff])).rows[0];
    assert.equal(staff.user_id, person.user);
    assert.equal(staff.email, person.email);
    assert.equal(staff.status, 'active');
    assert.equal(staff.dni, '00123456');
    const profile = (await db.query('select * from user_profiles where id=$1', [person.user])).rows[0];
    assert.equal(profile.staff_profile_id, person.staff);
    assert.equal(profile.role, 'collaborator');
    assert.equal(profile.registration_pending, false);
    assert.deepEqual((await db.query('select * from schedules where staff_id=$1', [person.staff])).rows, schedules);
    if (previous) {
      const old = (await db.query('select * from user_profiles where id=$1', [person.old])).rows[0];
      assert.equal(old.status, 'inactive');
      assert.equal(old.staff_profile_id, null);
      assert.equal(old.store_id, null);
      assert.equal(await scalar('select email from auth.users where id=$1', [person.old]), `old-${person.email}`);
      assert.equal((await scalar('select previous_account_snapshot from private.approved_legacy_staff_logins where email=$1', [person.email])).staff_profile_id, person.staff);
    }
  }
  const changes = [
    ["update staff_profiles set status='inactive' where id=$1", 'staff'],
    ["update staff_profiles set cessation_date='2000-01-01' where id=$1", 'staff'],
    ["update staff_profiles set is_trainee=true,training_end_date='2000-01-01' where id=$1", 'staff'],
    ["update staff_profiles set position='GERENTE' where id=$1", 'staff'],
    ["update staff_profiles set position=null where id=$1", 'staff'],
    ["update private.approved_legacy_staff_logins set expires_at=now()-interval '1 day' where email=$1", 'email'],
    ["update private.approved_legacy_staff_logins set enabled=false where email=$1", 'email'],
    ["update auth.users set raw_app_meta_data='{}' where id=$1", 'user'],
    ["update auth.users set banned_until=now()+interval '1 day' where id=$1", 'user'],
    ["insert into user_profiles(id,role,status,registration_pending) values($1,'admin','active',false)", 'user'],
    ["update staff_profiles set user_id=null,email=null where id=$1", 'staff'],
  ];
  for (const [sql, key] of changes) {
    await db.exec('begin');
    const person = await seed(true);
    await db.query(sql, [person[key]]);
    assert.equal(await prepare(person), null, sql);
    assert.equal(await complete(person), false, sql);
    assert.equal(await scalar('select completed_at from private.approved_legacy_staff_logins where email=$1', [person.email]), null);
    await db.exec('rollback');
  }
  const person = await seed(true);
  assert.equal(await complete(person, person.user, 'wrong-firebase'), false);
  assert.equal(await complete(person, person.old), false);
  await db.exec('update stores set is_active=false');
  assert.equal(await prepare(person), null);
  assert.equal(await complete(person), false);
  await db.exec('update stores set is_active=true');
  // A normal Supabase signup cannot grant itself an approval via user metadata.
  await db.query('update auth.users set raw_app_meta_data=$1::jsonb where id=$2', [JSON.stringify({ firebase_uid: person.firebase, user_metadata: { legacy_staff_recovery_id: person.approval } }), person.user]);
  assert.equal(await prepare(person), null);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => prepare(person), /permission denied/);
    await assert.rejects(() => complete(person), /permission denied/);
    await assert.rejects(() => db.query('select * from private.approved_legacy_staff_logins'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal(await scalar('select prepare_approved_legacy_staff_login($1)', ['unknown@example.test']), null);
  await db.exec('reset role');
  console.log('PASS: pending and incorrect-link recovery, unchanged shifts/DNI, idempotency, server identity/owner/role/expiry/eligibility guards and denied public RPCs.');
} finally { await db.close(); }
