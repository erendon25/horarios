// Real editor and HTTP persistence with fictitious people; no production access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { approvedBukShifts } from '../src/services/bukSchedule.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.BUK_QUOTA_QA_PORT || '4187';
const base = `http://127.0.0.1:${port}`;
const output = 'output/buk-weekly-quota';
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile('artifacts/buk/fixture.json', 'utf8'));
const server = spawn(process.execPath, ['scripts/serve-buk-qa.mjs'], { env: { ...process.env, BUK_QA_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page;
const errors = [], passed = [];
const pass = name => { passed.push(name); console.log(`PASS: ${name}`); };
const durationById = new Map(approvedBukShifts.map(option => [option.id, option.duration]));
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('QA server did not start in 30 seconds')), 30000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(Error(`QA server exited: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('Editor BUK aislado:')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Lima' });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base);
  const day = page.locator('select').filter({ has: page.locator('option[value="monday"]') });
  const rests = page.locator('select[aria-label="Descansos BUK de Prueba PT1"]:enabled');
  const approved = page.getByLabel('Horario aprobado BUK de Prueba PT1', { exact: true });
  const row = approved.locator('xpath=ancestor::tr[1]');
  const openPicker = async trigger => { await trigger.click(); const dialog = page.getByRole('dialog', { name: 'Seleccionar horario', exact: true }); await dialog.waitFor(); return dialog; };
  const closePicker = async dialog => { await dialog.getByRole('button', { name: 'Cerrar selector', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
  const chooseShift = async (trigger, id) => { const dialog = await openPicker(trigger); await dialog.locator('[data-shift-id="' + id + '"]').click(); await dialog.waitFor({ state: 'hidden' }); };
  const offeredDurations = async trigger => {
    if (await trigger.isDisabled()) return [];
    const dialog = await openPicker(trigger);
    const ids = await dialog.locator('[data-shift-id]:enabled').evaluateAll(cards => cards.map(card => card.dataset.shiftId));
    await closePicker(dialog);
    return [...new Set(ids.map(id => durationById.get(id)))].sort((a, b) => a - b);
  };
  await rests.waitFor();
  await day.selectOption('saturday');
  assert.deepEqual(await offeredDurations(approved), [225]);
  await row.locator('td').nth(1).screenshot({ path: `${output}/pt1-solo-3h45.png` });
  await day.selectOption('monday');
  assert.deepEqual(await offeredDurations(approved), [240]);
  pass('PT1: cinco jornadas de 4:00 dejan solo 3:45; los días largos siguen siendo editables');

  const third = page.getByLabel('Horario aprobado BUK de Prueba PT3', { exact: true });
  const fourth = page.getByLabel('Horario aprobado BUK de Prueba PT4', { exact: true });
  assert.deepEqual(await offeredDurations(third), [405]);
  assert.deepEqual(await offeredDurations(fourth), [525]);
  await day.selectOption('thursday');
  assert.deepEqual(await offeredDurations(third), [345]);
  await day.selectOption('wednesday');
  assert.deepEqual(await offeredDurations(fourth), [510]);
  pass('PT3 y PT4 reservan su jornada corta y conservan las largas en sus otros días');

  await day.selectOption('saturday');
  await row.getByTitle('Entrada', { exact: true }).fill('06:00');
  assert.equal(await row.getByTitle('Salida', { exact: true }).inputValue(), '10:00');
  assert.equal(await approved.getAttribute('data-selected-shift-id'), 'PT1-5');
  assert.match(await approved.innerText(), /06:00/);
  const overQuotaPicker = await openPicker(approved);
  assert.equal(await overQuotaPicker.locator('[data-shift-id="PT1-5"]').count(), 0, 'The current over-quota shift is shown on the trigger but is not offered');
  await closePicker(overQuotaPicker);
  assert.deepEqual(await offeredDurations(approved), [225]);
  await row.getByText('Este turno supera la distribución semanal. Elige uno de los turnos disponibles.', { exact: true }).waitFor();
  await row.getByTitle('Entrada', { exact: true }).fill('06:15');
  assert.equal(await approved.getAttribute('data-selected-shift-id'), 'PT1-6');
  assert.equal(await row.getByTitle('Salida', { exact: true }).inputValue(), '10:00');
  assert.equal(await row.locator('td').nth(6).innerText(), '3:45');
  pass('Un rango manual que excede el plan queda señalado; un ingreso aprobado disponible autocompleta 3:45');

  // Release the short day, assign it elsewhere, and complete the released day.
  await row.getByTitle('Entrada', { exact: true }).fill('');
  await row.getByTitle('Salida', { exact: true }).fill('');
  await day.selectOption('monday');
  assert.deepEqual(await offeredDurations(approved), [225, 240]);
  await chooseShift(approved, 'PT1-6');
  await day.selectOption('saturday');
  assert.deepEqual(await offeredDurations(approved), [240]);
  await chooseShift(approved, 'PT1-5');
  assert.match(await row.locator('td').nth(7).innerText(), /23:45/);
  pass('Liberar y redistribuir la jornada corta actualiza las opciones de los siete días y conserva 23:45');

  await page.getByRole('button', { name: /^Guardar/ }).click();
  await page.getByRole('button', { name: /^Guardado/ }).waitFor();
  const saved = (await (await page.request.get(`${base}/qa-document?path=schedules%2FPT1_2026-10-12_to_2026-10-18`)).json()).data;
  assert.equal(saved.monday.bukApprovedShiftId, 'PT1-6');
  assert.equal(saved.saturday.bukApprovedShiftId, 'PT1-5');
  for (const key of ['tuesday', 'wednesday', 'thursday', 'friday', 'sunday']) {
    const { bukRestDays: beforeRest, ...before } = fixture.schedules.PT1[key];
    const { bukRestDays: afterRest, ...after } = saved[key];
    assert.deepEqual(after, before, `Unedited ${key} is preserved`);
  }
  assert.equal(saved.monday.position, fixture.schedules.PT1.monday.position);
  assert.equal(saved.saturday.position, fixture.schedules.PT1.saturday.position);
  assert.equal(await page.evaluate(() => window.bukQaWrites.length), 1);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('schedule_draft_v2:')) localStorage.removeItem(key); });
  await page.reload();
  await rests.waitFor();
  await day.selectOption('monday');
  assert.equal(await approved.getAttribute('data-selected-shift-id'), 'PT1-6');
  assert.deepEqual(await offeredDurations(approved), [225]);
  await day.selectOption('saturday');
  assert.equal(await approved.getAttribute('data-selected-shift-id'), 'PT1-5');
  assert.deepEqual(await offeredDurations(approved), [240]);
  pass('Guardar y recargar mantiene la distribución y solo modifica al colaborador editado');

  const second = page.getByLabel('Horario aprobado BUK de Prueba PT2', { exact: true });
  const secondRow = second.locator('xpath=ancestor::tr[1]');
  const secondRests = page.getByLabel('Descansos BUK de Prueba PT2', { exact: true });
  const restColumn = await page.getByRole('columnheader', { name: 'Libre', exact: true }).evaluate(element => element.cellIndex);
  assert.equal(await second.isDisabled(), true);
  await secondRow.locator('td').nth(restColumn).getByRole('checkbox').uncheck();
  await secondRests.selectOption('2');
  assert.deepEqual(await offeredDurations(second), []);
  await secondRow.getByText('Los turnos del plan ya están asignados en los otros días. Revisa los descansos o modifica otro día.', { exact: true }).waitFor();
  await day.selectOption('monday');
  assert.deepEqual(await offeredDurations(second), [285]);
  pass('PT2 permite editar sus cinco jornadas y bloquea ofrecer una sexta jornada de 4:45');

  await day.selectOption('sunday');
  assert.equal(await approved.isDisabled(), true);
  assert.match(await approved.innerText(), /Día libre/);
  await page.setViewportSize({ width: 390, height: 844 });
  await day.selectOption('monday');
  assert.deepEqual(await offeredDurations(approved), [225]);
  await row.locator('td').nth(1).screenshot({ path: `${output}/selector-mobile.png` });
  pass('El bloqueo de días libres y el filtro semanal se conservan en móvil');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, errors, scope: 'Editor React real con datos ficticios y persistencia HTTP aislada; sin escrituras de producción' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${output}/fallo.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, errors, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); server.kill(); }
