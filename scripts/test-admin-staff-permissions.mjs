import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
try {
await db.exec(`
create role authenticated;
create schema private;
create table staff_profiles(id int primary key,store_id int,first_name text);
alter table staff_profiles enable row level security;
create function private.current_user_role() returns text language sql stable as $$select nullif(current_setting('test.role',true),'')$$;
create function private.current_user_store_id() returns int language sql stable as $$select nullif(current_setting('test.store',true),'')::int$$;
grant usage on schema private to authenticated;
grant select on staff_profiles to authenticated;
create policy staff_read on staff_profiles for select to authenticated using(private.current_user_role()='superadmin' or store_id=private.current_user_store_id());
insert into staff_profiles values(1,1,'Original'),(2,2,'Otra tienda');
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261001011834_restore_admin_staff_profile_writes.sql',import.meta.url),'utf8'));
await db.exec("set role authenticated; select set_config('test.role','admin',false),set_config('test.store','1',false)");
await db.exec("insert into staff_profiles values(1,1,'Actualizado') on conflict(id) do update set first_name=excluded.first_name returning id");
assert.equal((await db.query('select first_name from staff_profiles where id=1')).rows[0].first_name,'Actualizado');
await db.exec("insert into staff_profiles values(3,1,'Nuevo')");
await assert.rejects(()=>db.exec("insert into staff_profiles values(4,2,'No permitido')"),/row-level security/);
await assert.rejects(()=>db.exec('update staff_profiles set store_id=2 where id=1'),/row-level security/);
assert.equal((await db.query("update staff_profiles set first_name='No permitido' where id=2 returning id")).rows.length,0);
for(const role of ['collaborator','trainer','']) {
await db.query("select set_config('test.role',$1,false)",[role]);
await assert.rejects(()=>db.exec("insert into staff_profiles values(5,1,'No permitido')"),/row-level security/);
assert.equal((await db.query("update staff_profiles set first_name='No permitido' where id=1 returning id")).rows.length,0);
}
await db.exec("select set_config('test.role','superadmin',false)");
assert.equal((await db.query("update staff_profiles set first_name='Superadmin' where id=2 returning id")).rows.length,1);
await db.exec("insert into staff_profiles values(6,2,'Superadmin nuevo')");
console.log('PASS: admin creation/update/upsert, cross-store isolation, collaborator/trainer denial, superadmin access');
} finally {await db.close();}
