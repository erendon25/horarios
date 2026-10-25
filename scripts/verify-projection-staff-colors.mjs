// Real projection table colors, edit controls, autosave and reload.
// Only HTTP persistence/auth are isolated; no production access is performed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.PROJECTION_STORE_QA_PORT || '4196';
const base = `http://127.0.0.1:${port}`, output = 'output/projection-staff-colors';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-projection-store-qa.mjs'], {
  env: { ...process.env, PROJECTION_STORE_QA_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'],
});
const errors = [], unexpectedNetwork = [], passed = [], observations = [];
let browser, page;
const state = async () => (await page.request.get(`${base}/qa-state`)).json();
const poll = async (action, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await action()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};
const row = id => page.locator(`tr[data-position-id="${id}"]`);
const cell = (id, hour = '10:00') => row(id).locator(`td[data-hour="${hour}"]`);
const background = async locator => locator.evaluate(async element => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  const style = getComputedStyle(element);
  return { background: style.backgroundColor, color: style.color, title: element.title, text: element.textContent.trim() };
});
const setCount = async (id, target, hour = '10:00') => {
  const locator = cell(id, hour);
  const before = Number((await locator.textContent()).trim()) || 0;
  for (let value = before; value < target; value++) await locator.click();
  for (let value = before; value > target; value--) await locator.click({ modifiers: ['Control'] });
  await poll(async () => Number((await locator.textContent()).trim()) === target, `Manual count did not reach ${target}`);
  await page.mouse.move(1, 1);
  const result = await background(locator);
  observations.push({ id, hour, target, ...result });
  return result;
};
const pass = message => { passed.push(message); console.log(`PASS: ${message}`); };
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Colors QA server startup timeout')), 30000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`QA server exited: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('Projection store QA:')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, timezoneId: 'America/Lima' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => { unexpectedNetwork.push(route.request().url()); return route.abort(); });
  const fixture = {
    positions: [
      { id: 'max5', name: 'Límite cinco', logic: 'sales', maxStaff: 5, factor: 1 },
      { id: 'max3', name: 'Límite tres', logic: 'sales', maxStaff: 3, factor: 1 },
      { id: 'unlimited', name: 'Sin máximo', logic: 'sales', maxStaff: '', factor: 1 },
      { id: 'fixed-zero', name: 'Fijo cero', logic: 'fixed', fixedStaff: 0 },
    ],
    manualStaffByDay: {}, generalVhl: null, generalVhlMode: 'historical',
  };
  const seeded = await page.request.post(`${base}/qa-configuration`, { data: { storeId: 'store-a', value: fixture } });
  assert.equal(seeded.ok(), true);
  await page.goto(base);
  await row('max5').waitFor();
  const colors5 = [];
  for (let count = 0; count <= 6; count++) colors5.push(await setCount('max5', count));
  assert.notEqual(colors5[0].background, colors5[1].background, 'Zero and one must have distinct neutral/blue backgrounds');
  assert.notEqual(colors5[1].background, colors5[2].background, 'Two must transition from blue to warm');
  assert.equal(new Set(colors5.slice(2, 5).map(value => value.background)).size, 3, 'Two, three, and four must have different gradual colors before maximum five');
  assert.notEqual(colors5[4].background, colors5[5].background, 'Maximum five must turn red');
  assert.equal(colors5[5].background, colors5[6].background, 'At and above maximum must have the same red state');
  assert.match(colors5[5].title, /5/, 'The limit must be present in the tooltip');
  const rgb = value => value.match(/[\d.]+/g).map(Number).slice(0, 3);
  const neutral = rgb(colors5[0].background), blue = rgb(colors5[1].background), red = rgb(colors5[5].background);
  assert.ok(Math.max(...neutral) - Math.min(...neutral) < 8, 'Zero should be a neutral background');
  assert.ok(blue[2] > blue[0] && blue[2] > blue[1], 'One should be blue');
  assert.ok(red[0] > red[1] && red[0] > red[2] && Math.abs(red[1] - red[2]) < 2, 'Maximum should be red');
  assert.ok(rgb(colors5[2].background)[1] > rgb(colors5[3].background)[1]
    && rgb(colors5[3].background)[1] > rgb(colors5[4].background)[1], 'Intermediate colors should move from yellow toward orange/red');
  const decrement = await setCount('max5', 4);
  assert.equal(decrement.background, colors5[4].background, 'Ctrl-click must restore the lower level color');
  pass('Con límite cinco, 0/1 son distintos, 2/3/4 progresan, 5/6 están en rojo y Ctrl-clic vuelve al nivel anterior');

  await setCount('max3', 1);
  const two3 = await setCount('max3', 2), red3 = await setCount('max3', 3);
  assert.notEqual(two3.background, red3.background);
  assert.notEqual(red3.background, colors5[3].background, 'Three must be red only for the position whose configured limit is three');
  assert.equal(red3.background, colors5[5].background, 'Configured maxima must share the red state regardless of numeric limit');
  const noLimit3 = await setCount('unlimited', 3);
  assert.match(noLimit3.title, /sin l[ií]mite/i, 'No maximum must be explained in the tooltip');
  assert.notEqual(noLimit3.background, red3.background, 'Three in an unlimited position must not be red');
  const noLimit6 = await setCount('unlimited', 6);
  assert.equal(noLimit6.background, noLimit3.background, 'Without a limit, higher counts remain informational amber');
  const fixed0 = await setCount('fixed-zero', 1);
  assert.equal(fixed0.background, red3.background, 'A fixed target of zero marks a positive assignment red');
  pass('Cada fila usa su propio máximo; sin máximo permanece ámbar y Fijo cero marca rojo al asignar personal');

  // Populate adjacent hours to make the full color scale visible in the evidence.
  for (let count = 0; count <= 6; count++) await setCount('max5', count, `${String(10 + count).padStart(2, '0')}:00`);
  const distribution = page.getByRole('heading', { name: 'Distribucion de Personal e Ingresos por Hora', exact: true }).locator('xpath=../..');
  await distribution.screenshot({ path: `${output}/escala-limite-cinco.png` });

  await page.getByRole('button', { name: 'Configurar Posiciones', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Configurar Posiciones de la Tienda', exact: true });
  await modal.locator('[data-position-id="max5"]').getByLabel('Tope de personal', { exact: true }).fill('8');
  await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
  // The saved count at 15:00 is five; the new maximum eight must recolor it immediately.
  const fiveAtEight = await background(cell('max5', '15:00'));
  assert.notEqual(fiveAtEight.background, colors5[5].background, 'Changing maximum must recolor existing counts immediately');
  assert.match(fiveAtEight.title, /8/);
  const seven8 = await setCount('max5', 7), eight8 = await setCount('max5', 8);
  assert.notEqual(seven8.background, eight8.background);
  assert.equal(eight8.background, colors5[5].background, 'The new maximum eight must be red');
  await poll(async () => {
    const configuration = (await state()).configurations['store-a'];
    return String(configuration.positions.find(position => position.id === 'max5')?.maxStaff) === '8'
      && configuration.manualStaffByDay?.lunes?.max5?.['10:00'] === 8;
  }, 'Maximum or manual assignment did not persist');
  await page.reload();
  await row('max5').waitFor();
  assert.equal(Number((await cell('max5').textContent()).trim()), 8);
  assert.equal((await background(cell('max5'))).background, colors5[5].background);
  assert.notEqual((await background(cell('max5', '15:00'))).background, colors5[5].background);
  await distribution.screenshot({ path: `${output}/escala-limite-ocho.png` });
  pass('Editar el máximo de cinco a ocho recolorea de inmediato y conserva límite, conteos y colores después de recargar');
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, observations, errors, unexpectedNetwork,
    scope: 'Real projection Page/Dashboard with isolated HTTP persistence; no production access' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${output}/fallo.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, observations, errors, unexpectedNetwork, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); server.kill(); }
