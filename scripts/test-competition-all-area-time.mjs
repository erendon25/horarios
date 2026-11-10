import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompetitionTestDb } from './competition-test-db.mjs';
import { defaultChecklist } from '../src/services/competitionChecklist.js';

const db = await createCompetitionTestDb({ includeTimeScoring: false });
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const scalar = async (sql, params = []) => Object.values((await rows(sql, params))[0])[0];
const command = (id, action, payload = {}) => scalar('select public.competition_command($1,$2,$3::jsonb)', [id, action, JSON.stringify(payload)]);
const login = async id => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
};
const rubric = id => rows('select r.*,a.name area_name from competition_rubric_items r join competition_areas a on a.id=r.area_id where r.competition_id=$1 order by a.sort_order,r.sort_order', [id]);

try {
  const store = await scalar('insert into stores default values returning id');
  const admin = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
  const trainer = await scalar("insert into staff_profiles(store_id,first_name,position) values($1,'Trainer','ENTRENADOR') returning id", [store]);
  await db.query("insert into user_profiles(id,store_id,role) values($1,$2,'admin')", [admin,store]);
  await login(admin);

  const create = async name => {
    const c = await command(null,'create',{ store_id:store,name });
    const areas = await rows('select * from competition_areas where competition_id=$1 order by sort_order',[c.id]);
    for (const area of areas) await command(c.id,'area',{ ...area,maximum_duration_ms:1000 });
    const team = await command(c.id,'team',{ name:'Equipo de prueba',trainer_staff_id:trainer });
    return { c,areas,team };
  };
  const registerPair = async (contest,area) => {
    const entries = [];
    for (let i=0;i<2;i++) {
      await db.exec('reset role');
      const staff = await scalar("insert into staff_profiles(store_id,first_name) values($1,$2) returning id",[store,`Participante ${area.name} ${i}`]);
      await login(admin);
      const member = await command(contest.c.id,'member',{ team_id:contest.team.id,staff_id:staff });
      entries.push(await command(contest.c.id,'entry',{ member_id:member.id,area_id:area.id }));
    }
    return entries;
  };
  const activate = async contest => {
    await command(contest.c.id,'publication',{ published:true });
    await command(contest.c.id,'status',{ status:'active' });
  };
  const evaluate = async (contest,entry,duration) => {
    const e = await command(contest.c.id,'prepare',{ entry_id:entry.id });
    await command(contest.c.id,'start',{ evaluation_id:e.id });
    await command(contest.c.id,'stop',{ evaluation_id:e.id });
    await db.exec('reset role');
    await db.query('update competition_evaluations set duration_ms=$1 where id=$2',[duration,e.id]);
    await login(admin);
    const scores = await rows('select * from competition_evaluation_scores where evaluation_id=$1 order by sort_order',[e.id]);
    // Deliberately send true and forged numeric scores even for an exceeded time.
    const checks = Object.fromEntries(scores.map(r=>[r.rubric_item_id,Object.fromEntries(r.checklist.map(step=>[step.id,true]))]));
    const result = await command(contest.c.id,'finalize',{
      evaluation_id:e.id,checks,scores:Object.fromEntries(scores.map(r=>[r.rubric_item_id,10000])),
    });
    return { e,result,scores:await rows('select * from competition_evaluation_scores where evaluation_id=$1 order by sort_order',[e.id]) };
  };

  const historic = await create('Histórico activo');
  const [historicEntry] = await registerPair(historic,historic.areas[0]);
  await activate(historic);
  const oldEvaluation = await evaluate(historic,historicEntry,1000);
  const historicRubric = await rubric(historic.c.id);
  const oldSnapshot = oldEvaluation.scores;
  const draft = await create('Borrador inicial');
  const custom = await create('Borrador personalizado');
  await db.exec('reset role');
  const customArea = custom.areas[0];
  await db.query("update competition_rubric_items set checklist=jsonb_set(checklist,'{0,label}','\"Mi instrucción personalizada\"') where area_id=$1 and sort_order=1",[customArea.id]);
  const customBefore = (await rubric(custom.c.id)).filter(r=>r.area_id===customArea.id);
  await db.exec(await readFile('supabase/migrations/20261011070918_score_time_in_all_competition_areas.sql','utf8'));
  assert.deepEqual(await rubric(historic.c.id),historicRubric,'Concurso activo conserva sus rúbricas');
  assert.deepEqual(await rows('select * from competition_evaluation_scores where evaluation_id=$1 order by sort_order',[oldEvaluation.e.id]),oldSnapshot,'Historial guardado intacto');
  assert.deepEqual((await rubric(custom.c.id)).filter(r=>r.area_id===customArea.id),customBefore,'Instrucciones personalizadas intactas');
  assert.equal(Number(await scalar('select quality_score from competition_evaluations where id=$1',[oldEvaluation.e.id])),100);

  await login(admin);
  const fresh = await create('Nueva plantilla con tiempo');
  for (const contest of [draft,fresh]) {
    const criteria = await rubric(contest.c.id);
    assert.equal(criteria.length,46);
    for (const area of contest.areas) {
      const items = criteria.filter(r=>r.area_id===area.id);
      assert.equal(items.reduce((sum,r)=>sum+Number(r.max_score),0),100,area.name);
      const time = items.filter(r=>['Tiempo','Rapidez'].includes(r.label));
      assert.equal(time.length,1,area.name);
      assert.equal(Number(time[0].max_score),15);
      assert.equal(time[0].checklist[0].automatic,'time_limit');
      for (const r of items) assert.deepEqual(r.checklist,defaultChecklist(area.name,r.label,r.max_score));
    }
  }
  const participants = [];
  for (const area of fresh.areas) participants.push({ area,entries:await registerPair(fresh,area) });
  await activate(fresh);
  for (const { area,entries } of participants) {
    const onTime = await evaluate(fresh,entries[0],1000);
    const late = await evaluate(fresh,entries[1],1001);
    const timeScore = result => result.scores.find(r=>['Tiempo','Rapidez'].includes(r.label));
    assert.equal(Number(onTime.result.quality_score),100,area.name);
    assert.equal(onTime.result.approved,true,area.name);
    assert.equal(Number(timeScore(onTime).score),15,area.name);
    assert.equal(timeScore(onTime).checked_steps.tiempo,true);
    assert.equal(Number(late.result.quality_score),85,area.name);
    assert.equal(late.result.approved,false,area.name);
    assert.equal(Number(timeScore(late).score),0,area.name);
    assert.equal(timeScore(late).checked_steps.tiempo,false);
  }
  console.log('PASS: 7 áreas, tiempo automático de 15 puntos, sumas de 100, frontera exacta, intento fuera de tiempo, borradores actualizados y personalización/historial conservados.');
} finally {
  await db.close();
}
