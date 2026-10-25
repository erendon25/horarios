// Real production/service projection subtotals, classification controls and persistence.
// Auth and HTTP storage are isolated; this script never accesses production.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.PROJECTION_STORE_QA_PORT || '4197', base = `http://127.0.0.1:${port}`;
const output = 'output/projection-staff-groups';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-projection-store-qa.mjs'], {
  env: { ...process.env, PROJECTION_STORE_QA_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'],
});
const passed = [], observations = [], errors = [], unexpectedNetwork = [];
let browser, page;
const state = async () => (await page.request.get(`${base}/qa-state`)).json();
const poll = async (action, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await action()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};
const pass = message => { passed.push(message); console.log(`PASS: ${message}`); };
const area = id => page.locator(`tr[data-position-id="${id}"]`);
const cell = (id, hour = '10:00') => area(id).locator(`td[data-hour="${hour}"]`);
const total = async (group, hour = '10:00') => {
  const row = page.locator(`tr[data-staff-total="${group}"]`);
  if (!await row.count()) return 0; // The unclassified row disappears after classification.
  return Number((await row.locator(`td[data-hour="${hour}"]`).textContent()).trim());
};
const checkTotals = async (hour, expected) => {
  const actual = Object.fromEntries(await Promise.all(['production', 'service', 'unclassified', 'all'].map(async group => [group, await total(group, hour)])));
  observations.push({ hour, ...actual });
  assert.deepEqual(actual, expected, `Wrong group subtotals at ${hour}`);
  assert.equal(actual.production + actual.service + actual.unclassified, actual.all, 'Group subtotals must reconcile with the overall count');
};
const visuals = async () => {
  const result = [];
  for (const id of ['oven', 'production-service-logic', 'service-sales-logic', 'historical']) {
    result.push(await cell(id).evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
      return { count: element.textContent.trim(), background: getComputedStyle(element).backgroundColor, title: element.title };
    }));
  }
  return result;
};
const open = async () => {
  await page.getByRole('button', { name: 'Configurar Posiciones', exact: true }).click();
  return page.getByRole('dialog', { name: 'Configurar Posiciones de la Tienda', exact: true });
};
const seed = async (storeId, value) => {
  const response = await page.request.post(`${base}/qa-configuration`, { data: { storeId, value } });
  assert.equal(response.ok(), true);
};
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Groups QA server startup timeout')), 30000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`QA server exited: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('Projection store QA:')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, timezoneId: 'America/Lima' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => { unexpectedNetwork.push(route.request().url()); return route.abort(); });
  const fixtureA = {
    positions: [
      { id: 'oven', name: 'Horno', logic: 'fixed', fixedStaff: 2, department: 'production' },
      { id: 'production-service-logic', name: 'Área técnica', logic: 'service', maxStaff: 4, factor: 1, department: 'production' },
      { id: 'service-sales-logic', name: 'Atención', logic: 'sales', maxStaff: 5, factor: 1, department: 'service' },
      { id: 'historical', name: 'Área histórica', logic: 'fixed', fixedStaff: 0 },
    ],
    manualStaffByDay: { lunes: {
      oven: { '10:00': 2, '11:00': 0 },
      'production-service-logic': { '10:00': 1, '11:00': 2 },
      'service-sales-logic': { '10:00': 3, '11:00': 1 },
      historical: { '10:00': 4, '11:00': 0 },
    } }, generalVhl: null, generalVhlMode: 'historical',
  };
  const fixtureB = {
    positions: [{ id: 'only-b', name: 'Área propia B', logic: 'fixed', fixedStaff: 1, department: 'service' }],
    manualStaffByDay: { lunes: { 'only-b': { '10:00': 9 } } }, generalVhl: null, generalVhlMode: 'historical',
  };
  await seed('store-a', fixtureA); await seed('store-b', fixtureB);
  await page.goto(base); await area('oven').waitFor();
  await checkTotals('10:00', { production: 3, service: 3, unclassified: 4, all: 10 });
  await checkTotals('11:00', { production: 2, service: 1, unclassified: 0, all: 3 });
  assert.equal(await page.locator('tr[data-staff-total="unclassified"]').count(), 1);
  await page.getByTestId('projection-unclassified-notice').waitFor();
  const distribution = page.getByRole('heading', { name: 'Distribucion de Personal e Ingresos por Hora', exact: true }).locator('xpath=../..');
  await distribution.screenshot({ path: `${output}/con-sin-clasificar.png` });
  pass('Producción y Servicio suman por grupo explícito, independientemente de la lógica; los antiguos quedan Sin clasificar y todos los subtotales concilian');

  const before = await visuals();
  await page.getByRole('button', { name: 'Clasificar áreas', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Configurar Posiciones de la Tienda', exact: true });
  assert.equal(await modal.locator('[data-position-id="historical"]').getByLabel('Grupo del área').inputValue(), '',
    'Historical positions must keep the explicit unclassified placeholder');
  assert.equal(await modal.locator('[data-position-id="production-service-logic"]').getByLabel('Grupo del área').inputValue(), 'production',
    'The production group must remain independent of service calculation logic');
  await modal.locator('[data-position-id="historical"]').getByLabel('Grupo del área').selectOption('service');
  await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await checkTotals('10:00', { production: 3, service: 7, unclassified: 0, all: 10 });
  await checkTotals('11:00', { production: 2, service: 1, unclassified: 0, all: 3 });
  assert.equal(await page.locator('tr[data-staff-total="unclassified"]').count(), 0);
  assert.equal(await page.getByTestId('projection-unclassified-notice').count(), 0);
  assert.deepEqual(await visuals(), before, 'Changing a group must not change assigned counts, limits, tooltips or colors');
  await poll(async () => (await state()).configurations['store-a'].positions.find(position => position.id === 'historical')?.department === 'service', 'Area classification did not persist');
  await page.reload(); await area('oven').waitFor();
  await checkTotals('10:00', { production: 3, service: 7, unclassified: 0, all: 10 });
  assert.deepEqual(await visuals(), before);
  await distribution.screenshot({ path: `${output}/produccion-servicio-clasificados.png` });
  pass('Clasificar un área recalcula inmediatamente, conserva conteos y colores, elimina Sin clasificar cuando corresponde y persiste al recargar');

  modal = await open();
  await modal.getByRole('button', { name: 'Nueva posición', exact: true }).click();
  await modal.getByLabel('Nombre de nueva posición', { exact: true }).fill('Área nueva producción');
  const add = modal.getByRole('button', { name: 'Agregar', exact: true });
  assert.equal(await add.isDisabled(), true, 'A name alone cannot create an unclassified new area');
  await modal.locator('form').getByLabel('Grupo del área').selectOption('production');
  assert.equal(await add.isEnabled(), true);
  await add.click();
  await modal.getByRole('button', { name: 'Nueva posición', exact: true }).click();
  assert.equal(await modal.locator('form').getByLabel('Grupo del área').inputValue(), '',
    'A second new area must require a fresh group choice instead of inheriting the previous group');
  assert.equal(await modal.getByLabel('Nombre de nueva posición', { exact: true }).inputValue(), '');
  assert.equal(await modal.getByRole('button', { name: 'Agregar', exact: true }).isDisabled(), true);
  await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await poll(async () => {
    const saved = (await state()).configurations['store-a'].positions.find(position => position.name === 'Área nueva producción');
    return saved || false;
  }, 'New grouped area did not persist');
  // Retrieve its generated id after persistence rather than guessing timestamp ids.
  const newArea = (await state()).configurations['store-a'].positions.find(position => position.name === 'Área nueva producción');
  assert.equal(newArea.department, 'production');
  await cell(newArea.id).click(); await cell(newArea.id).click();
  await checkTotals('10:00', { production: 5, service: 7, unclassified: 0, all: 12 });
  await poll(async () => (await state()).configurations['store-a'].manualStaffByDay?.lunes?.[newArea.id]?.['10:00'] === 2, 'New area count did not persist');
  pass('Una nueva área exige seleccionar grupo y sus asignaciones aumentan únicamente el subtotal correspondiente y el total');

  const savedA = (await state()).configurations['store-a'];
  await page.getByLabel('Tienda de prueba', { exact: true }).selectOption('store-b');
  await area('only-b').waitFor();
  await checkTotals('10:00', { production: 0, service: 9, unclassified: 0, all: 9 });
  assert.equal(await area('oven').count(), 0);
  await page.getByLabel('Tienda de prueba', { exact: true }).selectOption('store-a');
  await area('oven').waitFor();
  await checkTotals('10:00', { production: 5, service: 7, unclassified: 0, all: 12 });
  const reloadedA = (await state()).configurations['store-a'];
  assert.deepEqual(reloadedA.positions, savedA.positions); assert.deepEqual(reloadedA.manualStaffByDay, savedA.manualStaffByDay);
  const groupSummary = positions => positions.map(({ id, name, department }) => ({ id, name, department }));
  assert.deepEqual(groupSummary((await state()).configurations['store-b'].positions), groupSummary(fixtureB.positions));
  pass('Cambiar de tienda conserva grupos, conteos y subtotales propios sin mezclar configuraciones');
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, observations, errors, unexpectedNetwork,
    scope: 'Real projection Page/Dashboard and group selection with isolated HTTP persistence; no production access' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${output}/fallo.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, observations, errors, unexpectedNetwork, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); server.kill(); }
