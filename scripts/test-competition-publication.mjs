// Execute real PostgreSQL permissions and commands with isolated fixtures.
import assert from 'node:assert/strict';
import { createCompetitionTestDb } from './competition-test-db.mjs';

const db = await createCompetitionTestDb();
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const login = async (id) => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
};
const cmd = (id, action, payload = {}) => scalar('select public.competition_command($1,$2,$3::jsonb)', [id, action, JSON.stringify(payload)]);
try {
  const store = await scalar('insert into stores default values returning id');
  const otherStore = await scalar('insert into stores default values returning id');
  const users = {};
  for (const role of ['admin', 'collaborator', 'trainer', 'superadmin']) {
    users[role] = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
    await db.query('insert into user_profiles(id,store_id,role) values($1,$2,$3::app_role)', [users[role], store, role]);
  }
  users.otherAdmin = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
  await db.query("insert into user_profiles(id,store_id,role) values($1,$2,'admin')", [users.otherAdmin, otherStore]);
  const trainer = await scalar("insert into staff_profiles(store_id,first_name,last_name,position) values($1,'Trainer','Prueba','ENTRENADOR') returning id", [store]);
  const staff = await scalar("insert into staff_profiles(store_id,first_name,last_name) values($1,'Integrante','Prueba') returning id", [store]);
  await db.query('update user_profiles set staff_profile_id=$1 where id=$2', [staff, users.collaborator]);
  await login(users.admin);
  const contest = await cmd(null, 'create', { store_id: store });
  assert.equal(contest.published_at, null);
  const team = await cmd(contest.id, 'team', { name: 'Equipo', trainer_staff_id: trainer });
  const member = await cmd(contest.id, 'member', { team_id: team.id, staff_id: staff });
  const area = await scalar('select id from competition_areas where competition_id=$1 limit 1', [contest.id]);
  await cmd(contest.id, 'entry', { member_id: member.id, area_id: area });

  const tables = ['competitions', 'competition_teams', 'competition_team_members', 'competition_areas', 'competition_phases', 'competition_rubric_items', 'competition_entries', 'competition_evaluations', 'competition_evaluation_scores', 'competition_timer_events', 'competition_fixture_view', 'competition_individual_ranking', 'competition_team_ranking', 'competition_trainer_ranking'];
  for (const role of ['collaborator', 'trainer']) {
    await login(users[role]);
    for (const table of tables) assert.equal(Number(await scalar(`select count(*) from public.${table}`)), 0, `${role}: ${table} oculto`);
    await assert.rejects(() => cmd(contest.id, 'register', { area_id: area }), /Concurso no disponible/);
    await assert.rejects(() => cmd(contest.id, 'withdraw', { area_id: area }), /Concurso no disponible/);
    await assert.rejects(() => cmd(contest.id, 'publication', { published: true }), /Concurso no disponible/);
    await assert.rejects(() => scalar("select private.competition_command_before_publication($1,'register',$2::jsonb)", [contest.id, JSON.stringify({ area_id: area })]), /permission denied/);
  }
  await login(users.otherAdmin);
  assert.equal(Number(await scalar('select count(*) from competitions')), 0);
  await assert.rejects(() => cmd(contest.id, 'publication', { published: true }), /Tienda no autorizada/);
  await login(users.admin);
  await assert.rejects(() => cmd(contest.id, 'publication', {}), /Indique/);
  await assert.rejects(() => cmd(contest.id, 'publication', { published: 'true' }), /Indique/);
  const published = await cmd(contest.id, 'publication', { published: true });
  assert.ok(published.published_at);
  assert.equal(published.status, 'draft', 'Publicar no activa ni cierra las inscripciones');
  assert.equal((await cmd(contest.id, 'publication', { published: true })).published_at, published.published_at);
  for (const role of ['collaborator', 'trainer']) {
    await login(users[role]);
    assert.equal(Number(await scalar('select count(*) from competitions')), 1);
    assert.equal(Number(await scalar('select count(*) from competition_fixture_view')), 1);
    await assert.rejects(() => cmd(contest.id, 'publication', { published: false }), /Solo administradores/);
  }
  await login(users.collaborator);
  assert.equal((await cmd(contest.id, 'register', { area_id: area })).unchanged, true);
  await login(users.superadmin);
  const hidden = await cmd(contest.id, 'publication', { published: false });
  assert.equal(hidden.published_at, null);
  assert.equal(Number(await scalar('select count(*) from competition_entries')), 1, 'Ocultar conserva inscripciones');
  await login(users.collaborator);
  assert.equal(Number(await scalar('select count(*) from competition_fixture_view')), 0);
  await assert.rejects(() => cmd(contest.id, 'withdraw', { area_id: area }), /Concurso no disponible/);
  await login(users.admin);
  const second = await cmd(null, 'create', { store_id: store });
  assert.equal(second.published_at, null, 'Cada concurso nuevo permanece oculto');
  await db.exec('reset role');
  await db.query("update competitions set status='active' where id=$1", [contest.id]);
  await login(users.collaborator);
  assert.equal(Number(await scalar('select count(*) from competitions')), 0, 'Activar no publica');
  await login(users.admin);
  assert.equal((await cmd(contest.id, 'publication', { published: true })).status, 'active');
  await db.exec('reset role');
  assert.equal(Number(await scalar("select count(*) from audit_log where new_data->>'event'='publication'")), 4);
  await db.exec('reset role; set role anon');
  await assert.rejects(() => cmd(contest.id, 'publication', { published: true }), /permission denied/);
  console.log('PASS: concursos ocultos por defecto, RLS en tablas y rankings, bloqueo de RPC directo, roles/tiendas, publicación independiente de activación, retirada y conservación de inscripciones.');
} finally {
  await db.close();
}
