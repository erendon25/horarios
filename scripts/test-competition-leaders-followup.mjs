import assert from 'node:assert/strict';
import { createCompetitionTestDb } from './competition-test-db.mjs';
const db = await createCompetitionTestDb({ includeRecognition: false });
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const login = async id => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec('set role authenticated');
};
const command = (id,action,payload={}) => scalar('select competition_command($1,$2,$3::jsonb)',[id,action,JSON.stringify(payload)]);
try {
  const store = await scalar('insert into stores default values returning id');
  const admin = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
  await db.query("insert into user_profiles(id,store_id,role) values($1,$2,'admin')",[admin,store]);
  const people = [];
  for (const [name,position,role] of [['Líder','ENTRENADOR','trainer'],['Integrante 1','COLABORADOR','collaborator'],['Integrante 2','COLABORADOR','collaborator']]) {
    const staff = await scalar('insert into staff_profiles(store_id,first_name,position) values($1,$2,$3) returning id',[store,name,position]);
    const account = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
    await db.query('insert into user_profiles(id,store_id,staff_profile_id,role) values($1,$2,$3,$4::app_role)',[account,store,staff,role]);
    people.push({staff,account});
  }
  const [leader,first,second] = people;
  await login(admin);
  const contest = await command(null,'create',{store_id:store});
  const team = await command(contest.id,'team',{name:'Equipo',trainer_staff_id:leader.staff});
  for (const person of [first,second]) person.member = await command(contest.id,'member',{team_id:team.id,staff_id:person.staff});
  for (const configured of (await db.query('select * from competition_areas where competition_id=$1',[contest.id])).rows)
    await command(contest.id,'area',{...configured,maximum_duration_ms:45000});
  const area = await scalar('select id from competition_areas where competition_id=$1 order by sort_order limit 1',[contest.id]);
  await command(contest.id,'publication',{published:true});
  await login(leader.account);
  await assert.rejects(()=>command(contest.id,'register',{area_id:area,staff_id:first.staff,member_id:first.member.id}),/Los líderes de equipo no se inscriben/);
  assert.equal(Number(await scalar('select count(*) from competition_entries')),0);
  assert.equal(Number(await scalar('select count(*) from competition_team_members')),2);
  assert.equal(Number(await scalar('select count(*) from competition_trainer_ranking')),1,'Conserva el ranking del líder');
  await db.exec('reset role');
  await db.query("update user_profiles set role='collaborator' where id=$1",[leader.account]);
  const legacy = await scalar('insert into competition_team_members(competition_id,team_id,staff_id,display_name) values($1,$2,$3,$4) returning id',[contest.id,team.id,leader.staff,'Líder histórico']);
  await login(leader.account);
  await assert.rejects(()=>command(contest.id,'register',{area_id:area}),/Los líderes de equipo no se inscriben/,'Un vínculo histórico como integrante y un rol de cuenta distinto no permiten inscribirse');
  await db.exec('reset role');
  await db.query('delete from competition_team_members where id=$1',[legacy]);
  for (const person of [first,second]) {
    await login(person.account);
    const entry = await command(contest.id,'register',{area_id:area});
    assert.equal(entry.member_id,person.member.id);
  }
  await login(leader.account);
  assert.equal(Number(await scalar('select count(*) from competition_fixture_view')),2,'Puede consultar a sus colaboradores');
  assert.equal(Number(await scalar('select count(*) from competition_individual_ranking')),2,'Solo colaboradores en ranking individual');
  assert.equal(Number(await scalar('select members from competition_trainer_ranking')),2,'El promedio conserva el denominador del equipo');
  await login(admin);
  await command(contest.id,'status',{status:'active'});
  await login(leader.account);
  await assert.rejects(()=>command(contest.id,'register',{area_id:area}),/inscripciones están cerradas/);
  await assert.rejects(()=>scalar("select private.competition_command_before_publication($1,'register',$2::jsonb)",[contest.id,JSON.stringify({area_id:area})]),/permission denied/);
  console.log('PASS: líderes sin inscripción ni suplantación, incluso con rol distinto o vínculo histórico; seguimiento, colaboradores, ranking y cierre al activar conservados.');
} finally { await db.close(); }
