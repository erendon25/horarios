import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompetitionTestDb } from './competition-test-db.mjs';
import { trainingRecognition } from '../src/services/trainingRecognition.js';
const db=await createCompetitionTestDb({includeObservable:false,includeRecognition:false});
const rows=async(sql,params=[])=> (await db.query(sql,params)).rows;
const scalar=async(sql,params=[])=>Object.values((await rows(sql,params))[0])[0];
const login=async uid=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
const cmd=(id,action,payload={})=>scalar('select competition_command($1,$2,$3::jsonb)',[id,action,JSON.stringify(payload)]);
try {
 const store=await scalar('insert into stores default values returning id');
 const otherStore=await scalar('insert into stores default values returning id');
 const users=[]; for(let i=0;i<3;i++)users.push(await scalar('insert into auth.users values(gen_random_uuid()) returning id'));
 const people=[]; for(let i=0;i<3;i++)people.push(await scalar("insert into staff_profiles(store_id,first_name,position) values($1,$2,$3) returning id",[store,`Persona ${i}`,i===0?'ENTRENADOR':'COLABORADOR']));
 await db.query("insert into user_profiles(id,store_id,role,staff_profile_id) values($1,$4,'admin',null),($2,$4,'collaborator',$6),($3,$5,'admin',null)",[...users,store,otherStore,people[1]]);
 await db.query("update staff_profiles set training_scores=$2,position_abilities=$3 where id=$1",[people[1],{SHEETOUT:74,VESTIDO:96},['VESTIDO']]);
 await db.exec('grant select on staff_profiles to authenticated');
 await login(users[0]);
 const setup=async(name,selected=['Sheetout','Landing'])=>{
   const c=await cmd(null,'create',{store_id:store,name});
   const t=await cmd(c.id,'team',{name:'Equipo',trainer_staff_id:people[0]});
   const allAreas=await rows('select * from competition_areas where competition_id=$1 order by sort_order',[c.id]);
   for(const a of allAreas)await cmd(c.id,'area',{...a,maximum_duration_ms:45000});
   const areas=allAreas.filter(a=>selected.includes(a.name));
   const entries=[];
   for(const person of people.slice(1)){
     const member=await cmd(c.id,'member',{team_id:t.id,staff_id:person});
     for(const a of areas){
       const e=await cmd(c.id,'entry',{member_id:member.id,area_id:a.id});
       entries.push({...e,area_name:a.name,staff_id:person});
     }
   }
   await cmd(c.id,'status',{status:'active'});
   return {c,entries};
 };
 const evaluate=async(c,entry,critical=false)=>{
   const e=await cmd(c.id,'prepare',{entry_id:entry.id});
   await cmd(c.id,'start',{evaluation_id:e.id});await cmd(c.id,'stop',{evaluation_id:e.id});
   const scores=Object.fromEntries((await rows('select * from competition_evaluation_scores where evaluation_id=$1',[e.id])).map(r=>[r.rubric_item_id,r.max_score]));
   const result=await cmd(c.id,'finalize',{evaluation_id:e.id,scores,critical_error:critical,reason:critical?'Error crítico probado':undefined});
   assert.equal(result.approved,!critical); return {e,scores};
 };
 const fresh=await setup('Concurso histórico');
 const own=name=>fresh.entries.find(x=>x.staff_id===people[1]&&x.area_name===name);
 const old=await evaluate(fresh.c,own('Sheetout'));
 await db.exec('reset role');
 await db.exec(await readFile('supabase/migrations/20261011063222_competition_profile_recognition.sql','utf8'));
 await login(users[0]);
 const profile=async()=> (await rows('select * from staff_profiles where id=$1',[people[1]]))[0];
 assert.deepEqual((await profile()).competition_recognition.certifications,{SHEETOUT:100},'Backfill de avances previos');
 assert.deepEqual((await profile()).training_scores,{SHEETOUT:74,VESTIDO:96});
 assert.equal(trainingRecognition(await profile()).trainingScores.SHEETOUT,100);
 await cmd(fresh.c.id,'finalize',{evaluation_id:old.e.id,scores:old.scores});
 assert.deepEqual((await profile()).competition_recognition.certifications,{SHEETOUT:100},'Reenvío idempotente');
 await evaluate(fresh.c,own('Landing'));
 for(const names of [['Landing Crazy','Vestido'],['Masa','Drive Thru'],['Servicio']]){
   const extra=await setup(`Estaciones ${names.join(', ')}`,names);
   for(const e of extra.entries.filter(x=>x.staff_id===people[1]))await evaluate(extra.c,e,e.area_name==='Servicio');
 }
 assert.deepEqual((await profile()).competition_recognition.certifications,{SHEETOUT:100,LANDING:100,VESTIDO:100,PREPARACION:100,TRAFICO:100});
 assert.equal((await profile()).competition_recognition.certifications.SERVICIO,undefined,'Un rechazo no certifica');
 await evaluate(fresh.c,own('Landing'),true);
 assert.equal((await profile()).competition_recognition.certifications.LANDING,100,'El avance previo válido permanece tras una derrota posterior');
 await evaluate(fresh.c,fresh.entries.find(x=>x.staff_id===people[2]&&x.area_name==='Sheetout'),true);
 for(let i=0;i<3;i++)await evaluate(fresh.c,own('Sheetout'));
 await cmd(fresh.c.id,'champion',{area_id:own('Sheetout').area_id});
 assert.deepEqual((await profile()).competition_recognition.championships.map(x=>x.area_name),['Sheetout']);
 const another=await setup('Otro concurso');
 const anotherEntry=another.entries.find(x=>x.staff_id===people[1]&&x.area_name==='Sheetout');
 const independent=await evaluate(another.c,anotherEntry);
 await cmd(fresh.c.id,'correct',{evaluation_id:old.e.id,reason:'Anular avance inicial y fases dependientes'});
 assert.equal((await profile()).competition_recognition.certifications.SHEETOUT,100,'Otra aprobación válida conserva certificación');
 assert.deepEqual((await profile()).competition_recognition.championships,[],'Corrección retira laureles');
 await cmd(another.c.id,'correct',{evaluation_id:independent.e.id,reason:'Anular única aprobación restante'});
 assert.equal((await profile()).competition_recognition.certifications.SHEETOUT,undefined);
 assert.equal(trainingRecognition(await profile()).trainingScores.SHEETOUT,74,'Recupera puntuación previa, sin inventar evaluación');
 assert.ok(trainingRecognition(await profile()).skills.includes('VESTIDO'),'Capacitación independiente preservada');
 await db.exec('reset role');
 await db.exec('grant update(competition_recognition) on staff_profiles to authenticated');
 await login(users[1]);
 await db.query("update staff_profiles set competition_recognition=$2 where id=$1",[people[1],{certifications:{SERVICIO:100},championships:[{area_name:'Inventada'}]}]);
 assert.equal((await profile()).competition_recognition.certifications.SERVICIO,undefined,'Campo derivado no falsificable');
 await assert.rejects(()=>cmd(fresh.c.id,'champion',{area_id:own('Sheetout').area_id}),/Solo administradores/);
 await assert.rejects(()=>scalar('select private.staff_competition_recognition($1)',[people[1]]),/permission denied/);
 await assert.rejects(()=>scalar("select private.competition_command_before_recognition($1,'finalize','{}')",[fresh.c.id]),/permission denied/);
 await login(users[2]);await assert.rejects(()=>cmd(fresh.c.id,'correct',{evaluation_id:old.e.id,reason:'Otra tienda'}),/Tienda no autorizada/);
 console.log('PASS: backfill, avance al 100%, siete áreas, rechazos, idempotencia, derrotas posteriores, campeón, correcciones, varios concursos, capacitación independiente y permisos.');
}finally{await db.close();}
