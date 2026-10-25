// Real request RLS, study RPC and weekly save RPC in isolated PostgreSQL.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createStaffImportTestDb, STAFF_IMPORT_TEST_IDS as ids } from './staff-planilla-test-db.mjs';

const db = await createStaffImportTestDb();
const schema = await readFile('supabase/schema.sql', 'utf8');
const migration = process.env.STUDY_AVAILABILITY_MIGRATION || 'supabase/migrations/20261025043425_enforce_study_availability_for_requested_shifts.sql';
const passed = [];
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const table = name => {
  const sql = schema.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(sql, `Missing real table ${name}`); return sql;
};
const policy = name => {
  const sql = schema.match(new RegExp(`create policy ${name} on public\\.[\\s\\S]*?;`))?.[0];
  assert.ok(sql, `Missing real policy ${name}`); return sql;
};
const as = async (actor, operation) => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor || '']);
  await db.exec('set role authenticated');
  try { return await operation(); } finally { await db.exec('reset role'); }
};
const check = async (name, operation) => { await operation(); passed.push(name); console.log(`PASS: ${name}`); };
const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const study = (staffId, values = {}, actor = ids.admin) => as(actor, () => db.query(
  'select public.save_study_schedule($1,$2::jsonb)', [staffId, JSON.stringify(Object.fromEntries(days.map(day => [day, values[day] || { free: false, blocks: [] }])))]));
const shift = (date, start, end, metadata = {}, extra = {}) => ({ date, start, end, position: 'Masa', off: false, holiday: false, metadata, ...extra });
const save = (staffId, values, actor = ids.admin) => as(actor, () => scalar(
  "select public.save_weekly_schedules('2026-10-26',$1::jsonb)", [JSON.stringify([{ staffId, days: values }])]));
const request = (staffId, actor = ids.collaborator, date = '2026-10-26', start = '08:00', end = '12:00', type = 'rango', store = ids.storeA) => as(actor, () => scalar(`
  insert into schedule_requests(staff_id,user_id,store_id,requested_date,shift_type,start_time,end_time,reason)
  values($1,$2,$3,$4,$5,$6,$7,'Prueba aislada') returning id`, [staffId, actor, store, date, type, start, end]));
const approve = (id, status = 'approved', actor = ids.admin) => as(actor, () => db.query(
  'update schedule_requests set status=$2,reviewed_by=$3,reviewed_at=now() where id=$1 returning id,status', [id, status, actor]));
const shifts = staffId => db.query(`select shift.work_date,shift.start_time,shift.end_time,shift.position,shift.is_day_off,shift.is_holiday,shift.notes,shift.metadata
  from schedule_shifts shift join schedule_weeks week on week.id=shift.schedule_week_id where week.staff_id=$1 order by shift.work_date`, [staffId]).then(result => result.rows);
const expectConflict = operation => assert.rejects(operation, /horario de estudio|día libre|día está marcado/);

try {
  await db.exec(`create type public.request_status as enum ('pending','approved','rejected','cancelled');
    create type public.holiday_balance_type as enum ('ganado','compensado');
    ${['store_configs','schedule_weeks','schedule_shifts','study_schedule_days','study_schedule_blocks','worked_holidays','schedule_requests'].map(table).join('\n')}`);
  const policies = [
    'store_configs_access','store_configs_admin_write','schedule_weeks_read','schedule_weeks_admin_write',
    'schedule_shifts_read','schedule_shifts_admin_write','study_days_read','study_days_write','study_blocks_read','study_blocks_write',
    'schedule_requests_read','schedule_requests_create','schedule_requests_admin_update','schedule_requests_admin_delete',
  ];
  for (const name of ['store_configs','schedule_weeks','schedule_shifts','study_schedule_days','study_schedule_blocks','schedule_requests']) {
    await db.exec(`alter table ${name} enable row level security; grant select,insert,update,delete on ${name} to authenticated`);
  }
  await db.exec(policies.map(policy).join('\n'));
  await db.exec('grant usage,select on all sequences in schema public to authenticated');
  await db.exec(await readFile('supabase/study_schedule_management.sql', 'utf8'));
  await db.exec(await readFile('supabase/weekly_schedule_management.sql', 'utf8'));
  const staffA = await scalar("insert into staff_profiles(store_id,user_id,first_name,last_name,modality,status) values($1,$2,'Persona','A','Part-Time','active') returning id", [ids.storeA, ids.collaborator]);
  await db.query('update user_profiles set staff_profile_id=$1 where id=$2', [staffA, ids.collaborator]);
  const staffOther = await scalar("insert into staff_profiles(store_id,first_name,last_name,modality,status) values($1,'Persona','B','Part-Time','active') returning id", [ids.storeB]);
  const staffSplit = await scalar("insert into staff_profiles(store_id,first_name,last_name,modality,status) values($1,'Persona','Partido','Part-Time','active') returning id", [ids.storeA]);
  const staffLegacy = await scalar("insert into staff_profiles(store_id,first_name,last_name,modality,status) values($1,'Persona','Anterior','Part-Time','active') returning id", [ids.storeA]);
  // A genuine historical schedule exists before this new guard is installed.
  await save(staffLegacy, [shift('2026-10-26','10:00','14:00',{}, { notes: 'Horario anterior' })]);
  await db.exec(await readFile(migration, 'utf8'));

  await check('sin estudios registrados permite solicitudes y turnos; los helpers nuevos no omiten RLS', async () => {
    const id = await request(staffA);
    assert.ok(id);
    assert.equal((await save(staffA,[shift('2026-10-26','08:00','12:00')])).savedStaff, 1);
    const functions = (await db.query(`select proname,prosecdef from pg_proc join pg_namespace ns on ns.oid=pronamespace
      where ns.nspname='private' and proname in ('study_extra_minutes','assert_shift_study_availability','enforce_request_study_availability') order by proname`)).rows;
    assert.equal(functions.length, 3);
    assert.equal(functions.every(row => row.prosecdef === false), true);
    assert.equal(await scalar("select prosecdef from pg_proc join pg_namespace ns on ns.oid=pronamespace where ns.nspname='public' and proname='save_weekly_schedules'"), false);
  });

  await check('traslapes rechazados al solicitar/guardar; tocar el comienzo o final de clase sí permite', async () => {
    await study(staffA, { monday: { blocks: [{ start: '12:00', end: '16:00' }] } });
    await request(staffA, ids.collaborator, '2026-10-26','08:00','12:00');
    await request(staffA, ids.collaborator, '2026-10-26','16:00','20:00');
    await expectConflict(() => request(staffA, ids.collaborator, '2026-10-26','11:45','12:15'));
    const before = await shifts(staffA);
    await expectConflict(() => save(staffA,[shift('2026-10-26','11:45','16:00')]));
    assert.deepEqual(await shifts(staffA), before);
    await save(staffA,[shift('2026-10-26','16:00','20:00')]);
    assert.equal((await shifts(staffA))[0].start_time, '16:00:00');
  });

  await check('día libre bloquea solicitudes genéricas/rango y trabajo nocturno que entra al día libre', async () => {
    await study(staffA, { monday: { free: true }, tuesday: { free: true } });
    // Even stale class rows on a free day cannot make it assignable.
    await db.query("insert into study_schedule_blocks(study_day_id,start_time,end_time) select id,'10:00','11:00' from study_schedule_days where staff_id=$1 and weekday=0", [staffA]);
    await expectConflict(() => request(staffA));
    await expectConflict(() => request(staffA, ids.collaborator, '2026-10-26',null,null,'apertura'));
    await expectConflict(() => save(staffA,[shift('2026-10-26','18:00','23:00')]));
    await expectConflict(() => request(staffA, ids.collaborator, '2026-10-25','22:00','01:00'));
    await request(staffA, ids.collaborator, '2026-10-25','22:00','00:00');
    await save(staffA,[shift('2026-10-26','','',{}, { off: true })]);
    assert.equal((await shifts(staffA))[0].is_day_off, true);
  });

  await check('medianoche usa clases del día siguiente y del anterior, también domingo/lunes', async () => {
    await study(staffA, { monday: { blocks: [{ start: '23:00', end: '02:00' }] }, tuesday: { blocks: [{ start: '01:00', end: '03:00' }] } });
    await expectConflict(() => request(staffA, ids.collaborator,'2026-10-26','20:00','01:30'));
    await expectConflict(() => request(staffA, ids.collaborator,'2026-10-27','00:30','04:00'));
    await request(staffA, ids.collaborator,'2026-10-27','03:00','07:00');
    await study(staffA, { sunday: { blocks: [{ start: '23:30', end: '01:00' }] } });
    await expectConflict(() => request(staffA, ids.collaborator,'2026-10-26','00:30','04:00'));
    await request(staffA, ids.collaborator,'2026-10-26','01:00','04:00');
  });

  await check('aprobar revalida estudios actuales; rechazar conserva la revisión de una solicitud incompatible', async () => {
    await study(staffA);
    const id = await request(staffA, ids.collaborator,'2026-10-26','10:00','14:00');
    await study(staffA, { monday: { blocks: [{ start:'12:00',end:'16:00' }] } });
    await expectConflict(() => approve(id));
    assert.equal(await scalar('select status from schedule_requests where id=$1',[id]),'pending');
    assert.equal((await approve(id,'rejected')).rows[0].status,'rejected');
    await as(ids.admin, () => db.query("update schedule_requests set reason='Comentario sin cambiar turno' where id=$1",[id]));
    assert.equal(await scalar('select reason from schedule_requests where id=$1',[id]),'Comentario sin cambiar turno');
    await expectConflict(() => as(ids.admin, () => db.query("update schedule_requests set start_time='11:00' where id=$1",[id])));
  });

  await check('turno anterior incompatible sigue guardable si solo cambian posición, notas o break', async () => {
    await study(staffLegacy, { monday: { blocks: [{start:'11:00',end:'13:00'}] } });
    await save(staffLegacy,[shift('2026-10-26','10:00','14:00',{breakStart:'11:00'}, {position:'Landing',notes:'Solo nota y posición'})]);
    assert.equal((await shifts(staffLegacy))[0].position,'Landing');
    assert.equal((await shifts(staffLegacy))[0].notes,'Solo nota y posición');
    const before = await shifts(staffLegacy);
    await expectConflict(() => save(staffLegacy,[shift('2026-10-26','10:15','14:00')]));
    assert.deepEqual(await shifts(staffLegacy), before);
    await save(staffLegacy,[shift('2026-10-26','13:00','17:00')]);
  });

  await check('horas extra se validan al cambiar y turno partido no rellena el hueco entre sus tramos', async () => {
    await study(staffSplit, { monday: { blocks: [{start:'12:00',end:'16:00'}] }, sunday: {blocks:[{start:'23:00',end:'00:30'}]} });
    await save(staffSplit,[shift('2026-10-26','08:00','12:00',{splitShift:true,start2:'16:00',end2:'20:00'})]);
    const before = await shifts(staffSplit);
    await expectConflict(() => save(staffSplit,[shift('2026-10-26','08:00','12:00',{splitShift:true,start2:'15:45',end2:'20:00'})]));
    assert.deepEqual(await shifts(staffSplit),before);
    await expectConflict(() => save(staffSplit,[shift('2026-10-26','08:00','12:00',{extraHoursPost:0.25})]));
    await expectConflict(() => save(staffSplit,[shift('2026-10-26','16:00','20:00',{extraHoursPre:0.25})]));
    await expectConflict(() => save(staffSplit,[shift('2026-10-26','00:30','04:00',{extraHoursPre:0.25})]));
    await save(staffSplit,[shift('2026-10-26','16:00','20:00',{extraHoursPre:0,extraHoursPost:0})]);
    await expectConflict(() => save(staffSplit,[shift('2026-10-26','16:00','20:00',{extraHoursPre:'0,25'})]));
    await save(staffSplit,[shift('2026-10-26','08:00','12:00',{breakStart:'11:00'})]);
  });

  await check('un conflicto en un lote semanal revierte todos los colaboradores sin borrar turnos existentes', async () => {
    const beforeA = await shifts(staffA), beforeLegacy = await shifts(staffLegacy);
    const payload = [{staffId:staffLegacy,days:[shift('2026-10-26','16:00','20:00')]},{staffId:staffA,days:[shift('2026-10-26','11:00','14:00')]}];
    await expectConflict(() => as(ids.admin,() => scalar("select public.save_weekly_schedules('2026-10-26',$1::jsonb)",[JSON.stringify(payload)])));
    assert.deepEqual(await shifts(staffA),beforeA);
    assert.deepEqual(await shifts(staffLegacy),beforeLegacy);
  });

  await check('horas extra enormes tienen recorrido acotado y detectan la clase repetida de la semana siguiente', async () => {
    await study(staffSplit);
    const startedAt = performance.now();
    await save(staffSplit,[shift('2026-10-26','08:00','12:00',{extraHoursPost:100000})]);
    assert.ok(performance.now() - startedAt < 3000, 'A weekly availability cycle must not scan thousands of extra-hour days');
    // This Monday's 06:00 class precedes an 08:00 arrival, but the same class
    // occurs next Monday while the extended work interval is still running.
    await study(staffSplit,{monday:{blocks:[{start:'06:00',end:'07:00'}]}});
    const before = await shifts(staffSplit);
    await expectConflict(() => save(staffSplit,[shift('2026-10-26','08:15','12:00',{extraHoursPost:100000})]));
    assert.deepEqual(await shifts(staffSplit), before);
  });

  await check('RLS y sesión mantienen alcance: colaborador propio, admin propia tienda, superadmin y rechazos ajenos/inactivos', async () => {
    await study(staffA);
    const count = await scalar('select count(*)::int from schedule_requests');
    await assert.rejects(() => request(staffOther), /row-level security/);
    assert.equal(await scalar('select count(*)::int from schedule_requests'),count);
    await assert.rejects(() => save(staffOther,[shift('2026-10-26','08:00','12:00')]), /Colaborador no encontrado|otra tienda/);
    await assert.rejects(() => save(staffA,[shift('2026-10-26','08:00','12:00')],ids.collaborator), /sin permiso/);
    await assert.rejects(() => save(staffA,[shift('2026-10-26','08:00','12:00')],ids.inactiveAdmin), /sin permiso/);
    assert.equal((await save(staffOther,[shift('2026-10-26','08:00','12:00')],ids.superadmin)).savedStaff,1);
    const id = await request(staffA);
    assert.deepEqual((await approve(id,'approved',ids.otherAdmin)).rows,[]);
    await assert.rejects(() => approve(id,'approved',ids.inactiveAdmin), /sin acceso/);
    assert.equal((await approve(id,'approved')).rows[0].status,'approved');
    await db.query("update user_profiles set status='inactive' where id=$1",[ids.collaborator]);
    await assert.rejects(() => request(staffA), /sin acceso|row-level security/);
    await db.query("update user_profiles set status='active' where id=$1",[ids.collaborator]);
  });

  await check('descansos/feriados compensados no se consideran trabajo y rangos incompletos no se guardan', async () => {
    await study(staffA,{wednesday:{free:true}});
    await save(staffA,[shift('2026-10-28','08:00','16:45',{}, {holiday:true})]);
    assert.equal((await shifts(staffA))[0].is_holiday,true);
    await assert.rejects(() => request(staffA,ids.collaborator,'2026-10-26',null,'12:00'), /rango válido/);
    await assert.rejects(() => request(staffA,ids.collaborator,'2026-10-26','12:00','12:00'), /rango válido/);
    await assert.rejects(() => save(staffA,[shift('2026-10-26','12:00','12:00')]), /rango válido|iguales/);
  });

  const output = new URL('../output/study-availability-qa/',import.meta.url);
  await mkdir(output,{recursive:true});
  await writeFile(new URL('db-result.json',output),JSON.stringify({status:'PASS',passed,migration,scope:'Isolated PGlite with real schema, RLS and study/weekly/request SQL. No production connection.'},null,2)+'\n');
} finally { await db.close(); }
