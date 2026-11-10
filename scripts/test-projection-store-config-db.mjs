// Real store-config table and RLS in isolated PostgreSQL. No production access.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  createStaffImportTestDb,
  setStaffImportActor,
  STAFF_IMPORT_TEST_IDS as ids,
} from './staff-planilla-test-db.mjs';

const db = await createStaffImportTestDb();
const passed = [];
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const definition = schema.match(/create table public\.store_configs \([\s\S]*?\n\);/)?.[0];
assert.ok(definition, 'Missing actual store_configs table definition');
const policies = ['store_configs_access', 'store_configs_admin_write'].map(name => {
  const sql = schema.match(new RegExp(`create policy ${name} on public\\.store_configs[\\s\\S]*?;`))?.[0];
  assert.ok(sql, `Missing actual RLS policy ${name}`);
  return sql;
});
const upsert = (storeId, value, key = 'schedule_projection') => db.query(`
  insert into public.store_configs(store_id,config_key,value)
  values($1,$2,$3::jsonb)
  on conflict(store_id,config_key) do update set value=excluded.value
  returning store_id,config_key,value
`, [storeId, key, JSON.stringify(value)]);
const load = async storeId => (await db.query(`
  select value from public.store_configs where store_id=$1 and config_key='schedule_projection'
`, [storeId])).rows[0]?.value;
const snapshot = async () => (await db.query(`
  select store_id,config_key,value from public.store_configs order by store_id,config_key
`)).rows;
const check = async (name, run) => {
  await run();
  passed.push(name);
  console.log(`PASS: ${name}`);
};

const storeBConfig = {
  positions: [{ id: 'counter', name: 'Caja de tienda B', logic: 'fixed', fixedStaff: 2 }],
  manualStaffByDay: { lunes: { counter: { '12:00': 3 } } },
  generalVhl: 350,
  requirements: { monday: { positions: ['Caja de tienda B'], matrix: { 0: { 0: 2 } } } },
  futureSchemaField: { preserve: true },
};
const storeAConfig = {
  positions: [{ id: 'custom-kitchen', name: 'Cocina propia de A', logic: 'sales', factor: 0.75 }],
  manualStaffByDay: {},
  generalVhl: null,
  generalVhlMode: 'historical',
};

try {
  await db.exec(`${definition}
    alter table public.store_configs enable row level security;
    grant select,insert,update,delete on public.store_configs to authenticated;
    ${policies.join('\n')}
  `);

  await check('tabla y políticas reales: conflicto compuesto y RLS habilitado', async () => {
    const flags = (await db.query(`select relrowsecurity from pg_class
      where oid='public.store_configs'::regclass`)).rows[0];
    assert.equal(flags.relrowsecurity, true);
    assert.deepEqual((await db.query(`select policyname from pg_policies
      where schemaname='public' and tablename='store_configs' order by policyname`)).rows,
    [{ policyname: 'store_configs_access' }, { policyname: 'store_configs_admin_write' }]);
    assert.match(definition, /unique \(store_id, config_key\)/);
  });

  await check('admin de A guarda posiciones sin ventas, históricos ni VHL', async () => {
    await setStaffImportActor(db, ids.superadmin);
    await upsert(ids.storeB, storeBConfig);
    await setStaffImportActor(db, ids.admin);
    const result = await upsert(ids.storeA, storeAConfig);
    assert.equal(result.rows[0].store_id, ids.storeA);
    assert.deepEqual(await load(ids.storeA), storeAConfig);
    // The fixture does not even contain sales-history or schedule tables.
    assert.equal((await db.query(`select to_regclass('public.sales_daily_history') as relation`)).rows[0].relation, null);
  });

  await check('recargar conserva exactamente nombres, factores y eliminación de todas las posiciones', async () => {
    const edited = { ...storeAConfig, positions: [{ ...storeAConfig.positions[0], name: 'Nombre cambiado', factor: 1.3 }] };
    await upsert(ids.storeA, edited);
    await setStaffImportActor(db, ids.admin);
    assert.deepEqual(await load(ids.storeA), edited);
    await upsert(ids.storeA, { ...edited, positions: [] });
    assert.deepEqual((await load(ids.storeA)).positions, []);
    await upsert(ids.storeA, storeAConfig);
    assert.equal((await db.query(`select count(*)::int as count from public.store_configs
      where store_id=$1 and config_key='schedule_projection'`, [ids.storeA])).rows[0].count, 1);
  });

  await check('payload completo conserva requisitos y campos adicionales ya guardados', async () => {
    await setStaffImportActor(db, ids.otherAdmin);
    const loaded = await load(ids.storeB);
    await upsert(ids.storeB, { ...loaded, positions: [{ ...loaded.positions[0], name: 'Caja B renombrada' }] });
    const result = await load(ids.storeB);
    assert.deepEqual(result.requirements, storeBConfig.requirements);
    assert.deepEqual(result.futureSchemaField, storeBConfig.futureSchemaField);
    assert.deepEqual(result.manualStaffByDay, storeBConfig.manualStaffByDay);
    await upsert(ids.storeB, storeBConfig);
  });

  await check('admin de A no puede leer ni modificar la proyección de B', async () => {
    await setStaffImportActor(db, ids.admin);
    assert.equal(await load(ids.storeB), undefined);
    await assert.rejects(() => upsert(ids.storeB, { positions: [] }), /row-level security/);
    const update = await db.query(`update public.store_configs set value='{}'::jsonb
      where store_id=$1 returning id`, [ids.storeB]);
    assert.deepEqual(update.rows, []);
    await setStaffImportActor(db, ids.otherAdmin);
    assert.deepEqual(await load(ids.storeB), storeBConfig);
    assert.equal(await load(ids.storeA), undefined);
    await assert.rejects(() => upsert(ids.storeA, { positions: [] }), /row-level security/);
  });

  await check('superadmin alterna tiendas sin sobrescribir las configuraciones de las demás', async () => {
    await setStaffImportActor(db, ids.superadmin);
    const before = await snapshot();
    const storeCConfig = { positions: [], manualStaffByDay: {}, generalVhl: null };
    await upsert(ids.storeC, storeCConfig);
    assert.deepEqual(await load(ids.storeC), storeCConfig);
    assert.deepEqual(await load(ids.storeA), storeAConfig);
    assert.deepEqual(await load(ids.storeB), storeBConfig);
    assert.deepEqual((await snapshot()).filter(row => row.store_id !== ids.storeC), before);
  });

  await check('colaborador y sesión anónima no pueden escribir la configuración', async () => {
    await setStaffImportActor(db, ids.collaborator);
    assert.deepEqual(await load(ids.storeA), storeAConfig);
    await assert.rejects(() => upsert(ids.storeA, { positions: [] }), /row-level security/);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => upsert(ids.storeA, { positions: [] }), /permission denied/);
    await setStaffImportActor(db, ids.superadmin);
    assert.deepEqual(await load(ids.storeA), storeAConfig);
    assert.deepEqual(await load(ids.storeB), storeBConfig);
  });

  const output = new URL('../output/projection-store-qa/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('db-result.json', output), JSON.stringify({
    status: 'PASS', passed,
    scope: 'PGlite PostgreSQL; actual store_configs schema and policies; fixture Auth and stores only. No production connection, no browser or HTTP transport exercised by this script.',
    storeCount: 3,
  }, null, 2) + '\n');
} catch (error) {
  console.error(`FAIL: ${error.stack}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
