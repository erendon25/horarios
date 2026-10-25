// Real projection component with isolated staff, sales and schedules. No remote access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeProjectionDemandQaFixture, seedProjectionDemandQaFixture } from './projection-demand-qa-fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.PROJECTION_STORE_QA_PORT || '5300', base = `http://127.0.0.1:${port}`;
const output = 'output/projection-labor';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-projection-store-qa.mjs'], {
  env: { ...process.env, PROJECTION_STORE_QA_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'],
});
const passed = [], observations = [], errors = [], unexpectedNetwork = [];
let browser, page;
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const poll = async (action, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await action()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};
const pass = message => { passed.push(message); console.log(`PASS: ${message}`); };
const state = async () => (await page.request.get(`${base}/qa-state`)).json();
const bag = () => page.getByText('Bolsa de Horas Disponibles', { exact: true }).locator('..');
const history = () => page.locator('p').filter({ hasText: '7 dias consolidados' }).first();
const expected = async (hours, historicalHours, vhl) => {
  await poll(async () => (await bag().textContent()).match(/(\d+) hrs/)?.[1] === String(hours)
    && (await history().textContent()).includes(`${historicalHours.toFixed(2)} HH`)
    && (await history().textContent()).includes(`VHL general S/. ${vhl.toFixed(2)}`),
  `Expected available ${hours}, historical ${historicalHours} HH and VHL ${vhl}`);
};
const makeFixture = () => {
  const fixture = makeProjectionDemandQaFixture();
  fixture.configuration.vestidoPositionId = 'cocina';
  const existing = fixture.data.staff[0], staffId = existing.id;
  existing.position = 'ENTRENADOR';
  const member = (id, extra = {}) => ({ ...existing, id, name: id, lastName: '', position: 'COLABORADOR', ...extra });
  fixture.data.staff.push(member('part-qa', { modality: 'Part-Time' }),
    member('trainee-qa', { modality: 'Part-Time', isTrainee: true, trainingEndDate: '2099-01-01' }),
    member('manager-qa', { position: '  gerente  ' }),
    member('assistant-qa', { position: '\tAsisténte ', modality: 'Part-Time' }),
    member('accented-manager-qa', { position: 'GÉRENTE' }),
    member('inactive-qa', { status: 'inactive' }),
    member('historic-qa', { reconstructed_from_history: true }),
    member('ceased-qa', { cessationDate: '2020-01-01' }),
    member('expired-trainee-qa', { isTrainee: true, trainingEndDate: '2020-01-01' }));
  const scheduled = (id, end, legacy = false) => ({
    ...fixture.data.schedules[0], id: `${id}_2026-10-19_to_2026-10-25`, staffId: legacy ? undefined : id,
    ...Object.fromEntries(weekdays.map(day => [day, { start: '10:00', end }])) });
  fixture.data.schedules = [scheduled(staffId, '14:00'), scheduled('part-qa', '13:00'),
    scheduled('trainee-qa', '11:00'), scheduled('manager-qa', '18:00'),
    scheduled('assistant-qa', '18:00', true), scheduled('accented-manager-qa', '18:00'),
    scheduled('historical-unknown-qa', '11:00', true)];
  return fixture;
};
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Projection labor QA startup timeout')), 30000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(Error(`QA server exited ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('Projection store QA:')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, timezoneId: 'America/Lima' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => { unexpectedNetwork.push(route.request().url()); return route.abort(); });
  const fixture = makeFixture(), original = structuredClone(fixture.data);
  await seedProjectionDemandQaFixture(page.request, base, fixture);
  await page.goto(base);
  await expected(96, 56, 250);
  assert.match(await bag().textContent(), /1 FT × 48/);
  assert.match(await bag().textContent(), /2 PT × 24/);
  assert.match(await bag().textContent(), /No incluye gerentes ni asistentes/);
  const originalHistory = await history().textContent();
  assert.ok(originalHistory.includes('14,000.00') && originalHistory.includes('280 transacciones'));
  const demand = await page.locator('tr[data-staff-total="all"] td[data-hour="12:00"]').textContent();
  assert.equal(Number(demand), 23, 'Manual VHL500 preserves existing demand23; no manager headcount is subtracted');
  pass('La bolsa suma trainer FT48 y dos PT24:96HH; gerenciales quedan fuera del histórico56HH/VHL250 sin cambiar ventas ni transacciones');

  await page.getByRole('button', { name: 'Ver desglose', exact: true }).click();
  const breakdown = page.getByRole('heading', { name: 'Desglose de Bolsa de Horas', exact: true }).locator('xpath=../../..');
  const managers = breakdown.getByText('Gerentes y asistentes (excluidos)', { exact: true }).locator('xpath=../..');
  assert.match(await managers.textContent(), /manager-qa/);
  assert.match(await managers.textContent(), /assistant-qa/);
  assert.match(await managers.textContent(), /accented-manager-qa/);
  const full = breakdown.getByText('Full Time', { exact: true }).locator('xpath=../..');
  assert.match(await full.textContent(), /Colaborador ficticio QA/);
  assert.doesNotMatch(await full.textContent(), /manager-qa|assistant-qa/);
  await breakdown.screenshot({ path: `${output}/desglose-gerenciales-excluidos.png` });
  await breakdown.getByRole('button', { name: 'x', exact: true }).click();
  pass('El desglose conserva al trainer operativo y muestra los tres puestos gerenciales normalizados en el grupo excluido');

  fixture.data.staff.find(member => member.id === 'manager-qa').position = 'TRAINER';
  await seedProjectionDemandQaFixture(page.request, base, fixture);
  await page.getByRole('button', { name: 'Actualizar datos', exact: true }).click();
  await expected(144, 112, 125);
  assert.equal(await page.locator('tr[data-staff-total="all"] td[data-hour="12:00"]').textContent(), demand,
    'Updating available labor must preserve manually configured sales demand');
  pass('Cambiar gerente a trainer y actualizar reincorpora48HH disponibles y56HH históricas; el VHL usa112HH sin alterar demanda manual');

  fixture.data = original;
  await seedProjectionDemandQaFixture(page.request, base, fixture);
  await page.reload(); await expected(96, 56, 250);
  await page.setViewportSize({ width: 390, height: 844 });
  await bag().scrollIntoViewIfNeeded();
  await bag().screenshot({ path: `${output}/bolsa-horas-mobile.png` });
  const fixtureB = makeProjectionDemandQaFixture({ storeId: 'store-b' });
  await seedProjectionDemandQaFixture(page.request, base, fixtureB);
  await page.getByLabel('Tienda de prueba', { exact: true }).selectOption('store-b');
  await expected(48, 28, 500);
  await page.getByLabel('Tienda de prueba', { exact: true }).selectOption('store-a');
  await expected(96, 56, 250);
  const final = await state();
  assert.deepEqual({ storeId: fixture.storeId, ...final.fixtures['store-a'] }, JSON.parse(JSON.stringify(original)),
    'Projection viewing does not change stored staff or schedules');
  assert.ok(final.writes.every(write => write.path.endsWith('/config/schedule_projection')));
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
  observations.push({ availableHours: 96, fullTime: 1, partTime: 2, excludedManagers: 3,
    historicalHours: 56, generalVhl: 250, totalSales: 14000, transactions: 280, manualDemand: Number(demand) });
  pass('Recargar y cambiar de tienda conserva cálculos aislados y cuotas48/24, sin escribir perfiles ni horarios ni acceder a producción');
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, observations, errors, unexpectedNetwork,
    scope: 'Real projection UI, isolated HTTP fixtures only; no production reads or writes' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${output}/fallo.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, observations, errors, unexpectedNetwork, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); server.kill(); }
