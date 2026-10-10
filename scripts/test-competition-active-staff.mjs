import assert from 'node:assert/strict';
import { createCompetitionTestDb } from './competition-test-db.mjs';
const db = await createCompetitionTestDb();
const scalar = async (sql, params=[]) => Object.values((await db.query(sql, params)).rows[0])[0];
const cmd = (id, action, payload={}) => scalar('select competition_command($1,$2,$3::jsonb)', [id,action,JSON.stringify(payload)]);
try {
  const store = await scalar('insert into stores default values returning id');
  const admin = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
  await db.query("insert into user_profiles(id,store_id,role) values($1,$2,'admin')", [admin,store]);
  const createStaff = (status='active', trainee=false, days=null, position='COLABORADOR') => scalar(
    "insert into staff_profiles(store_id,first_name,status,is_trainee,training_end_date,position) values($1,'Perfil',$2,$3,case when $4::integer is null then null else (clock_timestamp() at time zone 'America/Lima')::date+$4::integer end,$5) returning id",
    [store,status,trainee,days,position]);
  const trainer = await createStaff('active',false,null,'ENTRENADOR');
  const inactive = await createStaff('inactive');
  const pending = await createStaff('pending');
  const ended = await createStaff('active',true,-1);
  const lastDay = await createStaff('active',true,0);
  const future = await createStaff('active',true,1);
  const pendingTrainer = await createStaff('pending',false,null,'ENTRENADOR');
  const endedTrainer = await createStaff('active',true,-1,'ENTRENADOR');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  await db.exec('set role authenticated');
  const c = await cmd(null,'create',{store_id:store});
  const team = await cmd(c.id,'team',{name:'Equipo',trainer_staff_id:trainer});
  for (const id of [inactive,ended]) {
    assert.equal(await scalar('select private.competition_staff_eligible($1,$2)',[id,c.id]),false);
    await assert.rejects(()=>cmd(c.id,'member',{team_id:team.id,staff_id:id}),/Solo colaboradores activos/);
    await assert.rejects(()=>cmd(c.id,'draw',{staff_ids:[lastDay,id]}),/Solo colaboradores activos/);
    assert.equal(Number(await scalar('select count(*) from competition_team_members')),0,'El sorteo inválido revierte toda asignación');
    const empty = await cmd(null,'create',{store_id:store});
    await assert.rejects(()=>cmd(empty.id,'roster',{teams:[{name:'Equipo',trainer_staff_id:trainer,staff_ids:[id]}]}),/Solo colaboradores activos/);
    assert.equal(Number(await scalar('select count(*) from competition_teams where competition_id=$1',[empty.id])),0,'La plantilla inválida se revierte');
  }
  for (const id of [endedTrainer]) {
    await assert.rejects(()=>cmd(c.id,'team',{name:'Inválido',trainer_staff_id:id}),/puesto ENTRENADOR/);
  }
  const pendingTeam = await cmd(c.id,'team',{name:'Registro pendiente',trainer_staff_id:pendingTrainer});
  assert.equal(await scalar('select trainer_eligible from competition_current_teams where id=$1',[pendingTeam.id]),true,'El registro pendiente no impide liderar');
  for (const id of [lastDay,future,pending]) {
    assert.equal(await scalar('select private.competition_staff_eligible($1,$2)',[id,c.id]),true);
    await cmd(c.id,'member',{team_id:team.id,staff_id:id});
  }
  await assert.rejects(()=>scalar("select private.competition_command_before_active_staff($1,'member','{}'::jsonb)",[c.id]),/permission denied/);
  await db.exec('reset role');
  await db.query("update staff_profiles set training_end_date=(clock_timestamp() at time zone 'America/Lima')::date-1 where id=$1",[lastDay]);
  await db.exec('set role authenticated');
  assert.equal(await scalar('select private.competition_staff_eligible($1,$2)',[lastDay,c.id]),false,'El fin de entrenamiento actualiza la elegibilidad');
  assert.equal(Number(await scalar('select count(*) from competition_team_members')),3,'Se conserva el historial');
  console.log('PASS: vigencia laboral independiente del registro; pending vigente puede participar/liderar; inactivos y entrenamientos finalizados excluidos; último día válido; asignación, sorteo y plantilla validados en servidor.');
} finally { await db.close(); }
