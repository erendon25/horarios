// Real PostgreSQL/RLS/migration execution in PGlite; no production connection.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createStaffImportTestDb, setStaffImportActor, STAFF_IMPORT_TEST_IDS as ids } from './staff-planilla-test-db.mjs';

const db = await createStaffImportTestDb();
const passed = [];
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const row = (dni, patch = {}) => ({ dni, name: 'Persona', lastName: 'De Prueba', modality: 'Part-Time', position: 'COLABORADOR', area: 'Porongoche', ...patch });
const call = async (rows, store = ids.storeA, file = 'Planilla_prueba.xls') => scalar(
  'select public.import_staff_planilla($1::uuid,$2::jsonb,$3::text)', [store, JSON.stringify(rows), file]);
const count = () => scalar('select count(*) from public.staff_profiles');
const snapshot = async table => (await db.query(`select to_jsonb(t) as value from public.${table} t order by id`)).rows.map(record => record.value);
const check = async (name, action) => { await action(); passed.push(name); console.log(`PASS: ${name}`); };
let cohortEvidence;
let lockObservation;
try {
  await check('sesión y rol activos, RLS y separación de tiendas', async () => {
    for (const actor of [null, ids.collaborator, ids.trainer, ids.inactiveAdmin]) {
      await setStaffImportActor(db, actor);
      await assert.rejects(() => call([row('00000001')]), /Sesión no válida|sin permiso/);
    }
    await db.exec('reset role; set role anon');
    await assert.rejects(() => call([row('00000001')]), /permission denied/);
    await setStaffImportActor(db, ids.admin);
    await assert.rejects(() => call([row('00000001', { area: 'La Salle' })], ids.storeB), /otra tienda/);
    await assert.rejects(() => db.query('select private.import_staff_planilla($1,$2::jsonb,$3)', [ids.storeB, JSON.stringify([row('00000001', { area: 'La Salle' })]), 'prueba.xls']), /otra tienda/);
    await assert.rejects(() => db.query('insert into public.staff_profiles(store_id,first_name,last_name,dni) values($1,$2,$3,$4)', [ids.storeB, 'No', 'Permitido', '00000001']), /row-level security/);
    assert.equal(await count(), 0);
  });

  await check('superadmin puede elegir otra tienda activa, nunca una tienda inactiva', async () => {
    await setStaffImportActor(db, ids.superadmin);
    const imported = await call([row('00000002', { area: '  LA   SALLE ' })], ids.storeB);
    assert.equal(imported.createdCount, 1);
    assert.equal(await scalar('select store_id from public.staff_profiles where id=$1', [imported.created[0].id]), ids.storeB);
    await assert.rejects(() => call([row('00000003', { area: 'Tienda cerrada' })], ids.inactiveStore), /inactiva/);
    await setStaffImportActor(db, ids.admin);
    assert.equal(await count(), 0, 'RLS does not expose other-store staff');
  });

  await check('áreas normalizadas como el parser; otra área se rechaza antes de escribir', async () => {
    await setStaffImportActor(db, ids.superadmin);
    const imported = await call([row('00000004', { area: 'san-jeronimo' })], ids.storeD);
    assert.equal(imported.createdCount, 1);
    await setStaffImportActor(db, ids.admin);
    const before = await count();
    await assert.rejects(() => call([row('00000005'), row('00000006', { area: 'Misti' })]), /área no coincide/);
    assert.equal(await count(), before);
    assert.equal(await scalar("select count(*) from public.staff_profiles where dni='00000005'"), 0);
  });

  await check('validación atómica de campos, DNI, duplicados, límites y campos no permitidos', async () => {
    const invalid = [
      [{ ...row('00000010'), dni: 10 }, /deben ser texto/],
      [row('1234567'), /8 dígitos/],
      [row('00000010', { name: '' }), /nombre o apellidos/],
      [row('00000010', { lastName: '' }), /nombre o apellidos/],
      [row('00000010', { name: 'a'.repeat(161) }), /nombre o apellidos/],
      [row('00000010', { modality: 'Full' }), /modalidad o cargo/],
      [row('00000010', { position: 'superadmin' }), /modalidad o cargo/],
      [row('00000010', { user_id: ids.collaborator }), /campos no permitidos/],
      [row('00000010', { status: 'active' }), /campos no permitidos/],
      [row('00000010', { area: 'Porongoche'.repeat(30) }), /área no coincide/],
      [null, /formato no válido/],
    ];
    for (const [bad, expected] of invalid) {
      const before = await snapshot('staff_profiles');
      await assert.rejects(() => call([row('00000009'), bad]), expected);
      assert.deepEqual(await snapshot('staff_profiles'), before);
    }
    await assert.rejects(() => call([row('00000009'), row('00000009')]), /repite el DNI/);
    await assert.rejects(() => call([]), /entre 1 y 500/);
    await assert.rejects(() => call({}), /lista de colaboradores/);
    await assert.rejects(() => call(Array.from({ length: 501 }, (_, i) => row(String(70000000 + i)))), /entre 1 y 500/);
    await assert.rejects(() => call([row('00000009', { name: 'a'.repeat(530000) })]), /512 KB/);
    await assert.rejects(() => call([row('00000009')], ids.storeA, ''), /archivo de origen/);
    assert.equal(await count(), 0);
  });

  await check('DNI existente o cesado se omite sin modificar datos, cuentas o vínculos', async () => {
    await db.exec('reset role');
    const linked = '30000000-0000-4000-8000-000000000001';
    await db.query('insert into auth.users(id,email) values($1,$2)', [linked, 'cuenta-existente@example.test']);
    const existingId = await scalar(`insert into public.staff_profiles(store_id,user_id,first_name,last_name,email,dni,modality,position,status,
      join_date,sanitary_card_expiry,legacy_data) values($1,$2,'Nombre original','Apellido original',$3,'00.000.020','Full-Time','ENTRENADOR','active',
      '2024-01-01','2027-01-01','{"protected":"original"}') returning id`, [ids.storeA, linked, 'cuenta-existente@example.test']);
    await db.query("insert into public.user_profiles(id,email,first_name,last_name,role,status,store_id,staff_profile_id) values($1,$2,'Nombre original','Apellido original','trainer','active',$3,$4)", [linked, 'cuenta-existente@example.test', ids.storeA, existingId]);
    await db.query("insert into public.staff_profiles(store_id,first_name,last_name,dni,modality,status,cessation_date) values($1,'Cesado','Prueba','00000021','Part-Time','inactive','2000-01-01')", [ids.storeA]);
    await db.query("insert into public.staff_profiles(store_id,first_name,last_name,dni,modality,status,cessation_date) values($1,'Cese pendiente','Prueba','00000022','Part-Time','pending','2000-01-01')", [ids.storeA]);
    await db.query("insert into public.staff_profiles(store_id,first_name,last_name,dni,modality,status,is_trainee,training_end_date) values($1,'Entrenamiento finalizado','Prueba','00000023','Part-Time','pending',true,'2000-01-01')", [ids.storeA]);
    const before = await snapshot('staff_profiles');
    const users = await snapshot('user_profiles');
    const auth = (await db.query('select * from auth.users order by id')).rows;
    await setStaffImportActor(db, ids.admin);
    const result = await call(['00000020','00000021','00000022','00000023'].map(dni => row(dni, { name: 'No reemplazar', position: 'GERENTE' })));
    assert.equal(result.createdCount, 0); assert.equal(result.skippedCount, 4);
    assert.deepEqual(result.skipped.map(record => record.reason), ['existing','inactive','inactive','inactive']);
    await db.exec('reset role');
    assert.deepEqual(await snapshot('staff_profiles'), before);
    assert.deepEqual(await snapshot('user_profiles'), users);
    assert.deepEqual((await db.query('select * from auth.users order by id')).rows, auth);
    await setStaffImportActor(db, ids.admin);
  });

  await check('crear perfiles mínimos conserva DNI con ceros, fuentes y cargo sin crear acceso Auth', async () => {
    const result = await call([row('00000030', { name: '  Nombre  compuesto  ', lastName: 'Apellido  Paterno Materno', position: 'ENTRENADOR', modality: 'Full-Time' })]);
    assert.equal(result.createdCount, 1);
    const profile = (await db.query('select * from public.staff_profiles where id=$1', [result.created[0].id])).rows[0];
    assert.equal(profile.dni, '00000030');
    assert.equal(profile.first_name, 'Nombre compuesto'); assert.equal(profile.last_name, 'Apellido Paterno Materno');
    assert.equal(profile.position, 'ENTRENADOR'); assert.equal(profile.modality, 'Full-Time');
    assert.equal(profile.user_id, null); assert.equal(profile.email, null); assert.equal(profile.gender, null);
    assert.equal(profile.join_date, null); assert.equal(profile.sanitary_card_expiry, null);
    assert.equal(profile.needs_completion, true); assert.equal(profile.status, 'pending'); assert.equal(profile.is_trainee, false);
    assert.equal(profile.import_source, 'planilla'); assert.equal(profile.import_source_file, 'Planilla_prueba.xls');
    assert.equal(profile.legacy_data.importedFrom, 'planilla');
    const repeated = await call([row('00000030', { name: 'Nunca sobrescribir' })]);
    assert.equal(repeated.createdCount, 0); assert.equal(repeated.skippedCount, 1);
    assert.deepEqual((await db.query('select * from public.staff_profiles where id=$1', [profile.id])).rows[0], profile);
  });

  await check('llamadas repetidas y simultáneas no duplican; RPC invoker mantiene bloqueo transaccional', async () => {
    const concurrent = await Promise.all([call([row('00000040')]), call([row('00000040')])]);
    assert.equal(concurrent.reduce((sum, result) => sum + result.createdCount, 0), 1);
    assert.equal(concurrent.reduce((sum, result) => sum + result.skippedCount, 0), 1);
    assert.equal(await scalar("select count(*) from public.staff_profiles where dni='00000040'"), 1);
    await db.exec('begin');
    try {
      await call([row('00000041')]);
      const locks = (await db.query("select mode from pg_locks where relation='public.staff_profiles'::regclass and (pid=pg_backend_pid() or pid is null)")).rows;
      // PGlite reports a null lock PID in single-user mode. Its queued client
      // calls do not constitute a real multi-session contention test.
      lockObservation = { visibleModes: locks.map(lock => lock.mode), multiSessionLockBehaviorTested: false };
      assert.ok(locks.some(lock => lock.mode === 'ShareRowExclusiveLock'));
      const definition = await scalar("select pg_get_functiondef('private.import_staff_planilla(uuid,jsonb,text)'::regprocedure)");
      assert.match(definition, /lock\s+table\s+public\.staff_profiles\s+in\s+share\s+row\s+exclusive\s+mode/i);
      assert.equal(await scalar("select prosecdef from pg_proc where oid='private.import_staff_planilla(uuid,jsonb,text)'::regprocedure"), false);
    } finally { await db.exec('rollback'); }
    assert.equal(await scalar("select count(*) from public.staff_profiles where dni='00000041'"), 0);
  });

  await check('mismo DNI en otra tienda no impide el alta autorizada en esta tienda', async () => {
    await db.exec('reset role');
    await db.query("insert into public.staff_profiles(store_id,first_name,last_name,dni,modality,status) values($1,'Otra','Tienda','00000050','Full-Time','active')", [ids.storeB]);
    await setStaffImportActor(db, ids.admin);
    const result = await call([row('00000050')]);
    assert.equal(result.createdCount, 1);
    assert.equal(await scalar('select store_id from public.staff_profiles where id=$1', [result.created[0].id]), ids.storeA);
    await db.exec('reset role');
    assert.equal(await scalar("select count(*) from public.staff_profiles where dni='00000050'"), 2);
    await setStaffImportActor(db, ids.admin);
  });

  await check('completar ingreso y carnet mediante la RPC del modal cierra el estado pendiente de datos', async () => {
    const imported = await call([row('00000060')]);
    const id = imported.created[0].id;
    const total = await count();
    const save = expiry => scalar(`select public.save_staff_profile(p_staff_id=>$1,p_store_id=>$2,
      p_first_name=>'Nombre completo',p_last_name=>'Apellidos completos',p_dni=>'00000060',
      p_modality=>'Part-Time',p_position=>'COLABORADOR',p_status=>'pending',
      p_join_date=>'2026-10-01',p_sanitary_card_expiry=>$3::date)`, [id, ids.storeA, expiry]);
    assert.equal(await save(null), id);
    assert.equal(await scalar('select needs_completion from public.staff_profiles where id=$1', [id]), true);
    assert.equal(await save('2027-10-01'), id);
    const complete = (await db.query('select * from public.staff_profiles where id=$1', [id])).rows[0];
    assert.equal(complete.needs_completion, false);
    assert.equal(complete.user_id, null); assert.equal(complete.email, null); assert.equal(complete.gender, null); assert.equal(complete.birth_date, null);
    assert.equal(complete.first_name, 'Nombre completo'); assert.equal(complete.last_name, 'Apellidos completos');
    assert.equal(await count(), total);
    await db.exec('reset role');
    const nonPlanillaId = await scalar("insert into public.staff_profiles(store_id,first_name,last_name,dni,modality,position,status,needs_completion,import_source) values($1,'Otro','Origen','00000061','Part-Time','COLABORADOR','pending',true,'geovictoria') returning id", [ids.storeA]);
    await db.query("update public.staff_profiles set join_date='2026-10-01',sanitary_card_expiry='2027-10-01' where id=$1", [nonPlanillaId]);
    assert.equal(await scalar('select needs_completion from public.staff_profiles where id=$1', [nonPlanillaId]), true);
    await setStaffImportActor(db, ids.admin);
  });

  await check('las 32 filas reales del Excel se crean completas en SQL, sobreviven lectura y no se duplican', async () => {
    const source = JSON.parse(await readFile(process.env.STAFF_PLANILLA_COHORT_FILE
      || new URL('../output/staff-planilla-qa/parsed-source.json', import.meta.url), 'utf8'));
    const rows = source.rows.map(({ dni, name, lastName, modality, position, area }) => ({ dni, name, lastName, modality, position, area }));
    assert.equal(rows.length, 32); assert.equal(source.errors.length, 0);
    const isolated = await createStaffImportTestDb();
    try {
      const usersBefore = (await isolated.query('select to_jsonb(p) as value from public.user_profiles p order by id')).rows;
      const authBefore = (await isolated.query('select * from auth.users order by id')).rows;
      await setStaffImportActor(isolated, ids.admin);
      const realCall = async () => Object.values((await isolated.query('select public.import_staff_planilla($1,$2::jsonb,$3)', [ids.storeA, JSON.stringify(rows), 'Planilla_24-10-2026.xls'])).rows[0])[0];
      const result = await realCall();
      assert.equal(result.createdCount, 32); assert.equal(result.skippedCount, 0);
      const stored = (await isolated.query('select * from public.staff_profiles order by dni')).rows;
      assert.equal(stored.length, 32);
      for (const input of rows) {
        const profile = stored.find(staff => staff.dni === input.dni);
        assert.ok(profile);
        assert.equal(profile.first_name, input.name); assert.equal(profile.last_name, input.lastName);
        assert.equal(profile.modality, input.modality); assert.equal(profile.position, input.position);
        assert.equal(profile.status, 'pending'); assert.equal(profile.needs_completion, true);
        assert.equal(profile.user_id, null); assert.equal(profile.email, null); assert.equal(profile.join_date, null); assert.equal(profile.sanitary_card_expiry, null);
      }
      const repeated = await realCall();
      assert.equal(repeated.createdCount, 0); assert.equal(repeated.skippedCount, 32);
      assert.deepEqual((await isolated.query('select * from public.staff_profiles order by dni')).rows, stored);
      await isolated.exec('reset role');
      assert.deepEqual((await isolated.query('select to_jsonb(p) as value from public.user_profiles p order by id')).rows, usersBefore);
      assert.deepEqual((await isolated.query('select * from auth.users order by id')).rows, authBefore);
      cohortEvidence = { rowsRead: 32, rowsCreated: result.createdCount, repeatedRowsCreated: repeated.createdCount,
        fullTime: stored.filter(staff => staff.modality === 'Full-Time').length,
        partTime: stored.filter(staff => staff.modality === 'Part-Time').length, authAccountsChanged: 0, existingAccountsChanged: 0 };
      assert.equal(cohortEvidence.fullTime, 12); assert.equal(cohortEvidence.partTime, 20);
    } finally { await isolated.close(); }
  });
  await mkdir(new URL('../output/staff-planilla-qa/', import.meta.url), { recursive: true });
  await writeFile(new URL('../output/staff-planilla-qa/db-result.json', import.meta.url), JSON.stringify({ status: 'PASS', passed, cohortEvidence, lockObservation,
    scope: 'PGlite PostgreSQL with real migration/RLS and real parser cohort; fixture Auth only; no production connections. The transactional table-lock mode is observed in PostgreSQL; PGlite queues client calls, so real multi-session contention is not exercised.' }, null, 2));
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally { await db.close(); }
