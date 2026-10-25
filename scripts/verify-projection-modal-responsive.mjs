// Real projection modal at mobile/tablet/desktop sizes with isolated HTTP storage.
// No Supabase credentials, production reads, or production writes are involved.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.PROJECTION_STORE_QA_PORT || '4195';
const base = `http://127.0.0.1:${port}`;
const output = 'output/projection-modal-responsive';
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 600 },
  { width: 991, height: 435 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-projection-store-qa.mjs'], {
  env: { ...process.env, PROJECTION_STORE_QA_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'],
});
const passed = [], errors = [], unexpectedNetwork = [], measurements = [];
let browser, page;
const state = async () => (await page.request.get(`${base}/qa-state`)).json();
const poll = async (fn, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};
const open = async () => {
  await page.getByRole('button', { name: 'Configurar Posiciones', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Configurar Posiciones de la Tienda', exact: true });
  await modal.waitFor();
  return modal;
};
const cards = modal => modal.locator('[data-position-id]');
const names = async modal => cards(modal).locator('input[type=text]').evaluateAll(inputs => inputs.map(input => input.value));
const fullyInViewport = async (locator, description) => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `${description} must be completely inside the viewport: ${JSON.stringify(box)}`);
  assert.equal(await locator.isVisible(), true, `${description} must be visible`);
};
const checkLayout = async (modal, label) => {
  const metrics = await modal.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const issues = [];
    for (const node of [element, ...element.querySelectorAll('input,select,button,fieldset,[data-position-id],form')]) {
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const name = node.getAttribute('aria-label') || node.getAttribute('name') || node.tagName;
      if (node.scrollWidth > node.clientWidth + 1) issues.push({ name, reason: 'horizontal overflow', width: node.clientWidth, scrollWidth: node.scrollWidth });
      if (box.left < rect.left - 1 || box.right > rect.right + 1) issues.push({ name, reason: 'outside dialog horizontally', left: box.left, right: box.right });
    }
    const scrollable = [...element.querySelectorAll('*')].filter(node => node.scrollHeight > node.clientHeight + 10 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
    return { viewport: { width: innerWidth, height: innerHeight }, dialog: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, verticalScrollContainers: scrollable.length, issues };
  });
  measurements.push({ label, ...metrics });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'The background must stay locked while the modal is open');
  assert.deepEqual(metrics.issues, [], `${label}: modal and controls must fit horizontally`);
  assert.ok(metrics.dialog.x >= -1 && metrics.dialog.y >= -1);
  assert.ok(metrics.dialog.x + metrics.dialog.width <= metrics.viewport.width + 1);
  assert.ok(metrics.dialog.y + metrics.dialog.height <= metrics.viewport.height + 1);
  assert.ok(metrics.verticalScrollContainers >= 1, 'Long contents must have a vertical scroll container');
  await fullyInViewport(modal.getByRole('button', { name: 'Cerrar', exact: true }), 'Footer Cerrar');
  const adding = await modal.getByLabel('Nombre de nueva posición', { exact: true }).count() > 0;
  await fullyInViewport(modal.getByRole('button', { name: adding ? 'Agregar' : 'Nueva posición', exact: true }), adding ? 'Footer Agregar' : 'Footer Nueva posición');
  await fullyInViewport(modal.getByRole('button', { name: 'Cerrar configuración de posiciones', exact: true }), 'Header close');
};
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Responsive QA server startup timed out')), 30000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`QA server exited: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('Projection store QA:')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: viewports[0], timezoneId: 'America/Lima' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => { unexpectedNetwork.push(route.request().url()); return route.abort(); });
  await page.goto(base);
  await page.getByLabel('Tienda de prueba', { exact: true }).selectOption('store-b');
  // Wait for actual autosave rather than measuring the pending loading state.
  await page.getByText('Guardado', { exact: true }).waitFor();
  const original = (await state()).configurations['store-b'].positions.map(position => position.name);
  assert.equal(original.length, 12, 'Use all initial positions so the modal needs vertical scrolling');

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const size = `${viewport.width}x${viewport.height}`;
    let modal = await open();
    assert.deepEqual(await names(modal), original);
    await checkLayout(modal, `${size}: posiciones`);
    await modal.screenshot({ path: `${output}/posiciones-${size}.png` });

    const firstRemove = cards(modal).first().getByRole('button', { name: /Remover/ });
    await firstRemove.scrollIntoViewIfNeeded();
    await fullyInViewport(firstRemove, 'Remover within a visible card');
    await fullyInViewport(modal.getByRole('button', { name: 'Cerrar', exact: true }), 'Cerrar after content scrolling');
    await fullyInViewport(modal.getByRole('button', { name: 'Nueva posición', exact: true }), 'Nueva posición after content scrolling');

    await modal.getByRole('button', { name: 'Nueva posición', exact: true }).click();
    assert.deepEqual((await state()).configurations['store-b'].positions.map(position => position.name), original,
      'Opening the add form must not commit a new position');
    const field = modal.getByLabel('Nombre de nueva posición', { exact: true });
    await poll(() => field.evaluate(element => element === document.activeElement), 'Opening the add form must focus its name input');
    await checkLayout(modal, `${size}: formulario`);
    await field.fill(`QA ${size}`);
    if (viewport.width === 1440) {
      const form = modal.locator('form');
      await form.getByRole('combobox').selectOption('fixed');
      assert.equal(await form.getByLabel('Mínimo', { exact: true }).isDisabled(), true);
      assert.equal(await form.getByLabel('Personal fijo', { exact: true }).isEnabled(), true);
      assert.equal(await form.getByLabel('Ticket', { exact: true }).isDisabled(), true);
      assert.equal(await form.getByLabel('Trx/colaborador', { exact: true }).isDisabled(), true);
      assert.equal(await form.getByLabel('Factor', { exact: true }).isDisabled(), true);
      await form.getByRole('combobox').selectOption('driver');
      assert.equal(await form.getByLabel('Ticket', { exact: true }).isEnabled(), true);
      assert.equal(await form.getByLabel('Trx/colaborador', { exact: true }).isDisabled(), true);
      await form.getByRole('combobox').selectOption('service');
      assert.equal(await form.getByLabel('Trx/colaborador', { exact: true }).isEnabled(), true);
      await form.getByLabel('Ticket', { exact: true }).fill('35.5');
      await form.getByLabel('Trx/colaborador', { exact: true }).fill('45');
      await form.getByLabel('Factor', { exact: true }).fill('1.03');
      await form.getByLabel('Mínimo', { exact: true }).fill('1');
      await form.getByLabel('Tope de personal', { exact: true }).fill('4');
    }
    const add = modal.getByRole('button', { name: 'Agregar', exact: true });
    await add.scrollIntoViewIfNeeded();
    await fullyInViewport(add, 'Agregar');
    await modal.screenshot({ path: `${output}/agregar-${size}.png` });
    await add.click();
    await poll(async () => (await state()).configurations['store-b'].positions.some(position => position.name === `QA ${size}`),
      `Added position did not persist at ${size}`);
    if (viewport.width === 1440) {
      const saved = (await state()).configurations['store-b'].positions.find(position => position.name === `QA ${size}`);
      assert.equal(saved.logic, 'service');
      assert.equal(saved.ticketAverage, '35.5');
      assert.equal(saved.transactionsPerCollaborator, '45');
      assert.equal(saved.factor, '1.03');
      assert.equal(saved.minStaff, '1');
      assert.equal(saved.maxStaff, '4');
      assert.equal(saved.capacity, 780);
      passed.push('Servicio admite Ticket 35.5 y Factor 1.03 y conserva mínimo, máximo y capacidad; campos deshabilitados según lógica');
      console.log('PASS: Servicio con decimales y reglas de campos conserva sus valores al guardar');
    }
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.reload();
    modal = await open();
    assert.equal((await names(modal)).includes(`QA ${size}`), true, 'New position must remain after reload');
    const added = cards(modal).filter({ has: page.locator(`input[type=text][value="QA ${size}"]`) });
    const remove = added.getByRole('button', { name: /Remover/ });
    await remove.scrollIntoViewIfNeeded();
    await fullyInViewport(remove, 'Remover new position');
    await remove.click();
    await poll(async () => !(await state()).configurations['store-b'].positions.some(position => position.name === `QA ${size}`),
      `Removed position did not persist at ${size}`);
    assert.deepEqual(await names(modal), original);
    await checkLayout(modal, `${size}: después de quitar`);
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'Closing the modal restores background scrolling');
    const title = `${size}: modal sin desborde horizontal, cierre fijo, formulario accesible y altas/bajas persistentes`;
    passed.push(title); console.log(`PASS: ${title}`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, measurements, errors, unexpectedNetwork,
    scope: 'Real projection Page/Dashboard and responsive modal with isolated HTTP storage; no production access' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${output}/fallo.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, measurements, errors, unexpectedNetwork, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); server.kill(); }
