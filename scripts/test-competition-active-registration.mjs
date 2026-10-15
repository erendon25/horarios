// Real PostgreSQL commands and permissions; no production data or credentials.
import assert from 'node:assert/strict';
import { createCompetitionTestDb } from './competition-test-db.mjs';
import { competitionAreaRegistrationIssue } from '../src/services/competitionRules.js';
const db = await createCompetitionTestDb({includeRecognition:false});
const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
const scalar = async (sql,args=[]) => Object.values((await rows(sql,args))[0])[0];
const login = async id => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
};
const cmd = (id,action,payload={}) => scalar('select competition_command($1,$2,$3::jsonb)',[id,action,JSON.stringify(payload)]);
try {
  const store = await scalar('insert into stores default values returning id');
  const otherStore = await scalar('insert into stores default values returning id');
  const admin = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
  await db.query("insert into user_profiles(id,store_id,role) values($1,$2,'admin')",[admin,store]);
  const people=[];
  for(let i=0;i<7;i++) {
    const staff=await scalar('insert into staff_profiles(store_id,first_name,position) values($1,$2,$3) returning id',[i===6?otherStore:store,`Persona ${i}`,i===0?'ENTRENADOR':'COLABORADOR']);
    const account=await scalar('insert into auth.users values(gen_random_uuid()) returning id');
    await db.query("insert into user_profiles(id,store_id,staff_profile_id,role) values($1,$2,$3,'collaborator')",[account,i===6?otherStore:store,staff]);
    people.push({staff,account});
  }
  await login(admin);
  const contest=await cmd(null,'create',{store_id:store});
  const id=contest.id;
  const team=await cmd(id,'team',{name:'Equipo',trainer_staff_id:people[0].staff});
  for(const p of people.slice(1,6)) p.member=await cmd(id,'member',{team_id:team.id,staff_id:p.staff});
  const areas=await rows('select * from competition_areas where competition_id=$1 order by sort_order',[id]);
  for(const a of areas) await cmd(id,'area',{...a,maximum_duration_ms:45000});
  await cmd(id,'publication',{published:true});
  for(const p of people.slice(1,3)) {await login(p.account);await cmd(id,'register',{area_id:areas[0].id});}
  await login(admin); await cmd(id,'status',{status:'active'});
  const initial=await rows('select * from competition_entries where competition_id=$1 order by id',[id]);
  const drawn=await scalar('select drawn_at from competitions where id=$1',[id]);
  const pending=await cmd(id,'prepare',{entry_id:initial[0].id});
  const pendingBefore=await rows('select * from competition_evaluations where id=$1',[pending.id]);
  const teamsBefore=await rows('select * from competition_teams where competition_id=$1',[id]);
  const membersBefore=await rows('select * from competition_team_members where competition_id=$1 order by id',[id]);
  const late=people[3]; await login(late.account);
  const entry=await cmd(id,'register',{area_id:areas[0].id,member_id:people[4].member.id,staff_id:people[4].staff});
  assert.equal(entry.member_id,late.member.id,'Only the authenticated person registers');
  assert.equal(entry.seed_order,3); assert.equal(entry.draw_group,2);
  assert.equal((await cmd(id,'register',{area_id:areas[0].id})).unchanged,true);
  const second=await cmd(id,'register',{area_id:areas[1].id});
  assert.equal(second.seed_order,1); assert.equal(second.draw_group,1);
  await assert.rejects(()=>cmd(id,'register',{area_id:areas[2].id}),/Límite de áreas/);
  await assert.rejects(()=>cmd(id,'withdraw',{area_id:areas[0].id}),/no se pueden retirar/);
  await assert.rejects(()=>db.query('select private.competition_command_before_publication($1,$2,$3::jsonb)',[id,'register','{}']),/permission denied/);
  await login(admin);
  await assert.rejects(()=>cmd(id,'prepare',{entry_id:second.id}),/al menos 2 inscritos/);
  await login(people[4].account);
  const fourth=await cmd(id,'register',{area_id:areas[0].id});
  assert.equal(fourth.seed_order,4); assert.equal(fourth.draw_group,2,'Fill the last group without changing old groups');
  await cmd(id,'register',{area_id:areas[1].id});
  await login(admin);
  assert.ok((await cmd(id,'prepare',{entry_id:second.id})).id,'New participants can be evaluated once the minimum is reached');
  assert.deepEqual(await rows('select * from competition_entries where id=any($1::uuid[]) order by id',[initial.map(x=>x.id)]),initial);
  assert.deepEqual(await rows('select * from competition_evaluations where id=$1',[pending.id]),pendingBefore);
  assert.deepEqual(await rows('select * from competition_teams where competition_id=$1',[id]),teamsBefore);
  assert.deepEqual(await rows('select * from competition_team_members where competition_id=$1 order by id',[id]),membersBefore);
  assert.deepEqual(await scalar('select drawn_at from competitions where id=$1',[id]),drawn);
  console.log('PASS: late registration appends, duplicates are idempotent, own identity/max two/min two enforced; teams, draw and pending evaluations preserved.');

  await login(people[0].account);
  await assert.rejects(()=>cmd(id,'register',{area_id:areas[2].id}),/Los líderes de equipo no se inscriben/);
  await login(people[6].account);
  await assert.rejects(()=>cmd(id,'register',{area_id:areas[2].id}),/Tienda no autorizada|Concurso no disponible/);
  await db.exec('reset role');
  await db.query("update staff_profiles set cessation_date=current_date-1 where id=$1",[people[5].staff]);
  await login(people[5].account);
  await assert.rejects(()=>cmd(id,'register',{area_id:areas[2].id}),/cese efectivo|perfil inactivo/);
  await db.exec('reset role');
  await db.query('update staff_profiles set cessation_date=null where id=$1',[people[5].staff]);
  await login(admin);
  // Save a real successful evaluation: advancement must now close only this area.
  await cmd(id,'start',{evaluation_id:pending.id}); await cmd(id,'stop',{evaluation_id:pending.id});
  const rubric=await rows('select * from competition_evaluation_scores where evaluation_id=$1',[pending.id]);
  const checks=Object.fromEntries(rubric.map(r=>[r.rubric_item_id,Object.fromEntries(r.checklist.map(step=>[step.id,true]))]));
  const saved=await cmd(id,'finalize',{evaluation_id:pending.id,checks});
  assert.equal(saved.approved,true);
  const resultsBefore=await rows('select * from competition_evaluations where id=$1',[pending.id]);
  const rankingBefore=await rows('select * from competition_individual_ranking where competition_id=$1 order by member_id',[id]);
  const phases=await rows('select * from competition_phases where competition_id=$1',[id]);
  const advanced=await rows('select * from competition_entries where competition_id=$1',[id]);
  assert.match(competitionAreaRegistrationIssue({...contest,status:'active'},areas[0],{phases,entries:advanced}),/avanzó de fase/);
  await login(people[5].account);
  await assert.rejects(()=>cmd(id,'register',{area_id:areas[0].id}),/avanzó de fase/);
  await cmd(id,'register',{area_id:areas[2].id});
  await login(admin);
  assert.deepEqual(await rows('select * from competition_evaluations where id=$1',[pending.id]),resultsBefore);
  // Registration in a different area must not reset any earned points.
  assert.deepEqual((await rows('select * from competition_individual_ranking where competition_id=$1 order by member_id',[id])).map(x=>[x.member_id,x.points]),rankingBefore.map(x=>[x.member_id,x.points]));
  for(const status of ['completed','tiebreak_required']) {
    await db.exec('reset role'); await db.query('update competition_areas set status=$1 where id=$2',[status,areas[3].id]);
    await login(people[1].account);
    await assert.rejects(()=>cmd(id,'register',{area_id:areas[3].id}),/avanzó de fase/);
    assert.match(competitionAreaRegistrationIssue({...contest,status:'active'},{...areas[3],status},{phases,entries:advanced}),/avanzó de fase/);
  }
  await db.exec('reset role');await db.query("update competitions set status='completed' where id=$1",[id]);
  await login(people[1].account);await assert.rejects(()=>cmd(id,'register',{area_id:areas[4].id}),/ya finalizó/);
  assert.match(competitionAreaRegistrationIssue({...contest,status:'completed'},areas[4],{phases,entries:advanced}),/cerradas/);
  console.log('PASS: leaders, other stores and ceased staff denied; advanced/resolved/tiebreak areas and completed contests closed, saved results/points preserved.');
} finally {await db.close();}
