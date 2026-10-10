import assert from 'node:assert/strict';
import { createCompetitionTestDb } from './competition-test-db.mjs';
import { COMPETITION_AREAS } from '../src/services/competitionRules.js';
const db = await createCompetitionTestDb();
const scalar = async (sql, params=[]) => Object.values((await db.query(sql,params)).rows[0])[0];
const login = async id => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
};
const cmd = (id, action, payload={}) => scalar('select competition_command($1,$2,$3::jsonb)',[id,action,JSON.stringify(payload)]);
try {
  const store = await scalar('insert into stores default values returning id');
  const admin = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
  await db.query("insert into user_profiles(id,store_id,role) values($1,$2,'admin')",[admin,store]);
  const trainer = await scalar("insert into staff_profiles(store_id,first_name,position) values($1,'Trainer','ENTRENADOR') returning id",[store]);
  const people = [];
  for(let i=0;i<2;i++) {
    const staff = await scalar("insert into staff_profiles(store_id,first_name) values($1,$2) returning id",[store,`Colaborador ${i}`]);
    const account = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
    await db.query("insert into user_profiles(id,store_id,staff_profile_id,role) values($1,$2,$3,'collaborator')",[account,store,staff]);
    people.push({staff,account});
  }
  await login(admin);
  const c = await cmd(null,'create',{store_id:store});
  const team = await cmd(c.id,'team',{name:'Equipo',trainer_staff_id:trainer});
  for(const p of people) p.member = await cmd(c.id,'member',{team_id:team.id,staff_id:p.staff});
  const areas = (await db.query('select id,name from competition_areas where competition_id=$1 order by sort_order',[c.id])).rows;
  assert.deepEqual(areas.map(a=>a.name),COMPETITION_AREAS);
  const sheetout = areas.find(a=>a.name === 'Sheetout');
  await assert.rejects(()=>cmd(c.id,'config',{max_areas_per_participant:3}),/competition_two_areas_limit/);
  const extra = await cmd(c.id,'area',{name:'Otra área',active:false});
  for(const a of areas) await cmd(c.id,'area',{...a,maximum_duration_ms:45000});
  await login(people[0].account);
  await assert.rejects(()=>cmd(c.id,'register',{area_id:sheetout.id}),/Concurso no disponible/,'Oculto hasta publicar');
  await login(admin);
  await cmd(c.id,'publication',{published:true});
  await login(people[0].account);
  await assert.rejects(()=>cmd(c.id,'register',{area_id:extra.id}),/siete áreas/);
  const first = await cmd(c.id,'register',{area_id:sheetout.id,member_id:people[1].member.id,staff_id:people[1].staff});
  assert.equal(first.area_id,sheetout.id,'Sheetout disponible para elección propia');
  assert.equal(first.member_id,people[0].member.id,'La identidad proviene de la sesión, no del payload');
  await cmd(c.id,'register',{area_id:areas[1].id});
  await cmd(c.id,'register',{area_id:areas[1].id});
  await assert.rejects(()=>cmd(c.id,'register',{area_id:areas[2].id}),/Límite de áreas/);
  assert.equal(Number(await scalar('select count(*) from competition_entries where member_id=$1',[people[0].member.id])),2,'Máximo dos y sin duplicados');
  assert.equal(Number(await scalar('select count(*) from competition_entries where member_id=$1',[people[1].member.id])),0,'No inscribe a otra persona');
  await cmd(c.id,'withdraw',{area_id:sheetout.id});
  await cmd(c.id,'register',{area_id:areas[2].id});
  await login(people[1].account);
  for(const a of [areas[1],areas[2]]) await cmd(c.id,'register',{area_id:a.id});
  await login(admin);
  await cmd(c.id,'status',{status:'active'});
  await login(people[0].account);
  await assert.rejects(()=>cmd(c.id,'withdraw',{area_id:areas[1].id}),/inscripciones están cerradas/);
  await assert.rejects(()=>cmd(c.id,'register',{area_id:areas[0].id}),/inscripciones están cerradas/);
  console.log('PASS: siete áreas incluyendo Sheetout, elección por sesión propia, máximo dos, sin duplicados, cambio de elección en borrador, publicación y cierre al activar.');
} finally { await db.close(); }
