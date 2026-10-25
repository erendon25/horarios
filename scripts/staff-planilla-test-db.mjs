// PostgreSQL fixtures for staff spreadsheet import. No production connections.
import { readFile, readdir } from 'node:fs/promises';

export const STAFF_IMPORT_TEST_IDS = {
  storeA: '10000000-0000-4000-8000-000000000001',
  storeB: '10000000-0000-4000-8000-000000000002',
  storeC: '10000000-0000-4000-8000-000000000003',
  storeD: '10000000-0000-4000-8000-000000000004',
  inactiveStore: '10000000-0000-4000-8000-000000000005',
  admin: '20000000-0000-4000-8000-000000000001',
  otherAdmin: '20000000-0000-4000-8000-000000000002',
  superadmin: '20000000-0000-4000-8000-000000000003',
  collaborator: '20000000-0000-4000-8000-000000000004',
  inactiveAdmin: '20000000-0000-4000-8000-000000000005',
  trainer: '20000000-0000-4000-8000-000000000006',
};

export async function staffPlanillaMigrationSql() {
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith('_import_staff_planilla.sql'));
  if (files.length !== 1) throw new Error('Expected the staff planilla import migration');
  return readFile(new URL(files[0], directory), 'utf8');
}

export async function setStaffImportActor(db, userId = STAFF_IMPORT_TEST_IDS.admin) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId || '']);
  await db.exec('set role authenticated');
}

export async function createStaffImportTestDb() {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const table = name => {
    const result = schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`));
    if (!result) throw new Error(`Missing real schema definition: ${name}`);
    return result[0];
  };
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create type public.app_role as enum ('superadmin','admin','trainer','collaborator');
    create type public.record_status as enum ('pending','active','inactive');
    create table auth.users(id uuid primary key default gen_random_uuid(),email text unique);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    ${table('stores')}
    ${table('staff_profiles')}
    ${table('user_profiles')}
    alter table public.user_profiles add constraint user_profiles_staff_profile_id_fkey
      foreign key(staff_profile_id) references public.staff_profiles(id) on delete set null;
    create function private.current_user_role() returns public.app_role
      language sql stable security definer set search_path='' as $$
      select role from public.user_profiles where id=auth.uid()
    $$;
    create function private.current_user_store_id() returns uuid
      language sql stable security definer set search_path='' as $$
      select store_id from public.user_profiles where id=auth.uid()
    $$;
    grant usage on schema private,auth to authenticated;
    grant execute on all functions in schema private,auth to authenticated;
    grant select on public.stores,public.staff_profiles,public.user_profiles to authenticated;
    alter table public.stores enable row level security;
    alter table public.staff_profiles enable row level security;
    alter table public.user_profiles enable row level security;
    create policy store_read on public.stores for select to authenticated
      using(is_active or private.current_user_role()='superadmin');
    create policy user_self_read on public.user_profiles for select to authenticated using(id=auth.uid());
    create policy staff_read on public.staff_profiles for select to authenticated using(
      user_id=auth.uid() or private.current_user_role()='superadmin'
      or (store_id=private.current_user_store_id() and private.current_user_role() in('admin','trainer'))
    );
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261001011834_restore_admin_staff_profile_writes.sql', import.meta.url), 'utf8'));
  const management = await readFile(new URL('../supabase/staff_management.sql', import.meta.url), 'utf8');
  await db.exec(management.slice(0, management.indexOf('create or replace function public.link_invited_staff_account')));
  const signature = 'uuid,uuid,text,text,text,text,text,date,text,text,public.record_status,date,date,boolean,boolean,date,date,text';
  await db.exec(`alter function public.save_staff_profile(${signature}) set schema private`);
  const hardened = await readFile(new URL('../supabase/migrations/20260913190000_harden_public_rpc_and_private_issue_tables.sql', import.meta.url), 'utf8');
  const wrapper = hardened.match(/create function public\.save_staff_profile\([\s\S]*?\$function\$;/)?.[0];
  if (!wrapper) throw new Error('Missing real save_staff_profile public wrapper');
  await db.exec(wrapper);
  await db.exec(`revoke all on function public.save_staff_profile(${signature}) from public,anon;
    grant execute on function public.save_staff_profile(${signature}) to authenticated;`);
  await db.exec(await staffPlanillaMigrationSql());
  const ids = STAFF_IMPORT_TEST_IDS;
  for (const [id,name,isActive] of [[ids.storeA,'Porongoche',true],[ids.storeB,'La Salle',true],
    [ids.storeC,'Misti',true],[ids.storeD,'San Jerónimo',true],[ids.inactiveStore,'Tienda cerrada',false]]) {
    await db.query('insert into public.stores(id,name,is_active) values($1,$2,$3)', [id,name,isActive]);
  }
  for (const [id,role,status,storeId] of [[ids.admin,'admin','active',ids.storeA],
    [ids.otherAdmin,'admin','active',ids.storeB],[ids.superadmin,'superadmin','active',null],
    [ids.collaborator,'collaborator','active',ids.storeA],[ids.inactiveAdmin,'admin','inactive',ids.storeA],
    [ids.trainer,'trainer','active',ids.storeA]]) {
    const email = `qa-${id.slice(-4)}@example.test`;
    await db.query('insert into auth.users(id,email) values($1,$2)', [id,email]);
    await db.query('insert into public.user_profiles(id,email,role,status,store_id) values($1,$2,$3,$4,$5)', [id,email,role,status,storeId]);
  }
  return db;
}
