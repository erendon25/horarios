import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../components/AdminDashboard.jsx', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('    const handleExportStudyAvailability = async'), source.indexOf('    const fetchAllStaffProfiles = async'));
function harness(overrides = {}) {
  const calls = [], downloads = [], alerts = [], states = [];
  const context = { current: 'user:store' };
  const deps = {
    studyExportBusy: { current: false }, userData: { storeId: 'store' }, currentUser: { uid: 'user' },
    setExportingStudies: value => states.push(value), studyExportContext: context, db: {},
    query: (...args) => args, collection: (_db, name) => name, where: (...args) => args,
    doc: (_db, name, id) => ({ name, id }),
    getDocs: async () => ({ docs: [{ id: 'unlinked', data: () => ({ storeId: 'store', name: 'Ana' }) }, { id: 'other', data: () => ({ storeId: 'other' }) }] }),
    getDoc: async ref => { calls.push(ref); return { exists: () => true, data: () => ref.name === 'stores' ? { name: 'PORONGOCHE' } : { monday: { free: true } } }; },
    isStaffActive: () => true,
    buildStudyAvailabilityWorkbook: async data => { calls.push(data); return { xlsx: { writeBuffer: async () => new Uint8Array([1]) } }; },
    saveAs: (...args) => downloads.push(args), Blob, studyAvailabilityFilename: name => name + '.xlsx', alert: message => alerts.push(message),
    ...overrides,
  };
  const run = new Function('deps', `const { ${Object.keys(deps).join(',')} } = deps; ${handler}; return handleExportStudyAvailability;`)(deps);
  return { run, deps, calls, downloads, alerts, states, context };
}
test('botón conectado y exporta solo tienda actual, consulta perfil sin uid', async () => {
  assert.match(source, /onClick=\{handleExportStudyAvailability\}/);
  const h = harness(); await h.run();
  assert.ok(h.calls.some(ref => ref.name === 'study_schedules' && ref.id === 'unlinked'));
  assert.ok(!h.calls.some(ref => ref.id === 'other'));
  assert.equal(h.downloads.length, 1);
  assert.deepEqual(h.states, [true, false]);
});
test('doble clic solo descarga una vez', async () => {
  const h = harness(); await Promise.all([h.run(), h.run()]); assert.equal(h.downloads.length, 1);
});
test('no descarga archivo parcial si falla lectura', async () => {
  const h = harness({ getDoc: async () => { throw new Error('Sin permisos'); } }); await h.run();
  assert.equal(h.downloads.length, 0); assert.match(h.alerts[0], /Sin permisos/);
  assert.equal(h.deps.studyExportBusy.current, false);
});
test('cambiar cuenta durante lectura cancela descarga y recupera botón', async () => {
  const h = harness(); const original = h.deps.getDocs;
  // Build a harness whose async read switches the shared context before returning.
  const shared = { current: 'user:store' };
  const changed = harness({ studyExportContext: shared, getDocs: async () => { shared.current = 'other:store'; return original(); } });
  await changed.run(); assert.equal(changed.downloads.length, 0); assert.deepEqual(changed.states, [true, false]);
});
test('desmontar no descarga ni modifica estado al terminar', async () => {
  const shared = { current: 'user:store' };
  const h = harness({ studyExportContext: shared, getDocs: async () => { shared.current = ''; return { docs: [] }; } });
  await h.run(); assert.equal(h.downloads.length, 0); assert.deepEqual(h.states, [true]);
});
