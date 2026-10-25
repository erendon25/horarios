// End-to-end: real XLS -> real React feature -> HTTP -> real migration in PGlite.
// Nothing in this script reads or writes a production Supabase project.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import XLSX from 'xlsx';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sourcePath = process.argv[2] || '/workspace/attachments/2343c055-485a-495e-b348-4f8176d138a9/Planilla_24-10-2026.xls';
const port = process.env.STAFF_PLANILLA_QA_PORT || '4191';
const base = `http://127.0.0.1:${port}`;
const output = 'output/staff-planilla-qa';
await mkdir(output, { recursive: true });
const source = XLSX.read(await readFile(sourcePath), { type: 'buffer' });
const sourceRows = XLSX.utils.sheet_to_json(source.Sheets.Trabajador, { header: 1, defval: '' });
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const expected = sourceRows.slice(5).filter(row => row[12]).map(row => {
  const specialty = clean(row[5]).toUpperCase();
  return { dni: clean(row[12]), name: clean(row[13]), lastName: [clean(row[14]), clean(row[15])].filter(Boolean).join(' '),
    modality: specialty.includes('PART') ? 'Part-Time' : 'Full-Time',
    position: specialty.includes('ENTRENADOR') ? 'ENTRENADOR' : specialty.includes('ASISTENTE') ? 'ASISTENTE' : specialty.includes('GERENTE') ? 'GERENTE' : 'COLABORADOR' };
});
assert.equal(expected.length, 32);
const wrongArea = XLSX.read(await readFile(sourcePath), { type: 'buffer' });
for (let row = 5; row < sourceRows.length; row++) if (sourceRows[row][12]) wrongArea.Sheets.Trabajador[XLSX.utils.encode_cell({ r: row, c: 51 })] = { t: 's', v: 'MISTI' };
const wrongAreaPath = `${output}/planilla-otra-tienda.xls`;
await writeFile(wrongAreaPath, XLSX.write(wrongArea, { type: 'buffer', bookType: 'biff8' }));

const server = spawn(process.execPath, ['scripts/serve-staff-planilla-qa.mjs'], { env: { ...process.env, STAFF_PLANILLA_QA_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page;
const errors = [], unexpectedNetwork = [], passed = [];
const pass = name => { passed.push(name); console.log(`PASS: ${name}`); };
const database = async () => (await (await page.request.get(`${base}/qa-database`)).json());
const closeDialog = async () => {
  const dialog = page.getByRole('dialog', { name: 'Importar colaboradores', exact: true });
  if (!await dialog.count()) return;
  const close = dialog.getByRole('button', { name: /Cancelar|Cerrar/ }).last();
  if (await close.count()) await close.click(); else await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
};
const open = async (file = sourcePath) => {
  await page.getByRole('button', { name: 'Importar planilla BUK', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar colaboradores', exact: true });
  await dialog.waitFor();
  await dialog.getByLabel('Planilla de colaboradores', { exact: true }).setInputFiles(file);
  return dialog;
};
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('QA server did not start in 30 seconds')), 30000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(Error(`QA server exited: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('Planilla QA aislada:')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Lima' });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route(/https:\/\/[^/]*supabase\.co\//, route => { unexpectedNetwork.push(new URL(route.request().url()).hostname); return route.abort(); });
  await page.goto(base);
  await page.getByTestId('stored-count').filter({ hasText: /^0$/ }).waitFor();
  const initialAccounts = await database();
  let dialog = await open();
  await dialog.getByRole('button', { name: 'Agregar 32 colaboradores', exact: true }).waitFor();
  await dialog.getByText(`${expected[0].name} ${expected[0].lastName}`, { exact: true }).first().waitFor();
  assert.equal((await database()).rows.length, 0, 'Preview must not write profiles');
  await dialog.screenshot({ path: `${output}/vista-previa-desktop.png` });
  pass('La planilla real muestra 32 nombres completos con DNI, modalidad y cargo antes de guardar');

  await dialog.getByRole('button', { name: 'Agregar 32 colaboradores', exact: true }).click();
  await page.getByTestId('stored-count').filter({ hasText: /^32$/ }).waitFor();
  let snapshot = await database();
  assert.equal(snapshot.rows.length, 32);
  assert.equal(snapshot.rpcCalls, 1);
  assert.equal(snapshot.authAccounts, initialAccounts.authAccounts, 'Import must not create access accounts');
  assert.equal(snapshot.accessProfiles, initialAccounts.accessProfiles, 'Import must not create administrative or collaborator logins');
  assert.equal(new Set(snapshot.rows.map(person => person.dni)).size, 32);
  for (const person of expected) {
    const saved = snapshot.rows.find(row => row.dni === person.dni);
    assert.ok(saved);
    assert.equal(saved.first_name, person.name);
    assert.equal(saved.last_name, person.lastName);
    assert.equal(saved.modality, person.modality);
    assert.equal(saved.position, person.position);
    assert.equal(saved.user_id, null);
    assert.equal(saved.status, 'pending');
    assert.equal(saved.needs_completion, true);
    assert.equal(saved.is_trainee, false, 'An ENTRENADOR is not an unfinished trainee');
    for (const field of ['email', 'join_date', 'sanitary_card_expiry', 'birth_date']) assert.equal(saved[field], null, field);
  }
  assert.equal(snapshot.rows.filter(row => row.modality === 'Part-Time').length, 20);
  assert.equal(snapshot.rows.filter(row => row.modality === 'Full-Time').length, 12);
  assert.equal(snapshot.rows.filter(row => row.position === 'ENTRENADOR').length, 2);
  assert.equal(snapshot.rows.filter(row => row.position === 'ASISTENTE').length, 2);
  await dialog.getByRole('status').screenshot({ path: `${output}/creados-32-perfiles.png` });
  pass('La RPC real creó y devolvió 32 perfiles en Postgres con 20 PT, 12 FT y los cargos correctos');

  await closeDialog();
  await page.reload();
  await page.getByTestId('stored-count').filter({ hasText: /^32$/ }).waitFor();
  dialog = await open();
  const zero = dialog.getByRole('button', { name: 'Agregar 0 colaboradores', exact: true });
  await zero.waitFor(); assert.equal(await zero.isDisabled(), true);
  assert.equal((await database()).rows.length, 32);
  assert.equal((await database()).rpcCalls, 1);
  await closeDialog();
  pass('Recargar conserva lo guardado y volver a cargar la misma planilla no crea duplicados');

  await page.request.post(`${base}/qa-reset`, { data: {} });
  await page.reload(); await page.getByTestId('stored-count').filter({ hasText: /^0$/ }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 120));
  dialog = await open();
  await dialog.getByRole('button', { name: 'Agregar 32 colaboradores', exact: true }).waitFor();
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.width <= 391 && box.height <= 845);
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'The background must not scroll while the modal is open');
  const scroll = await dialog.evaluate(element => {
    const scrollable = [element, ...element.querySelectorAll('*')].find(node => node.scrollHeight > node.clientHeight + 20 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
    if (!scrollable) return { found: false };
    const previous = scrollable.scrollTop; scrollable.scrollTop += 180;
    return { found: true, changed: scrollable.scrollTop > previous };
  });
  assert.equal(scroll.found, true); assert.equal(scroll.changed, true);
  await dialog.screenshot({ path: `${output}/vista-previa-mobile.png` });
  await closeDialog();
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden', 'Closing restores page scrolling');
  assert.equal((await database()).rows.length, 0);
  assert.equal((await database()).rpcCalls, 0);
  pass('El modal cabe en móvil, desplaza su contenido y Cancelar no guarda datos');

  dialog = await open({ name: 'archivo-invalido.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('contenido que no es una planilla') });
  await dialog.getByRole('alert').waitFor();
  assert.equal((await database()).rows.length, 0);
  await closeDialog();
  dialog = await open(wrongAreaPath);
  await dialog.getByRole('button', { name: 'Agregar 0 colaboradores', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Agregar 0 colaboradores', exact: true }).isDisabled(), true);
  assert.equal((await database()).rows.length, 0);
  await closeDialog();
  pass('Un archivo inválido o personal de otra tienda no produce altas');

  await page.request.post(`${base}/qa-reset`, { data: { inactiveDni: expected[0].dni } });
  await page.reload(); await page.getByTestId('stored-count').filter({ hasText: /^1$/ }).waitFor();
  const originalInactive = (await database()).rows[0];
  dialog = await open();
  await dialog.getByRole('button', { name: 'Agregar 31 colaboradores', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Agregar 31 colaboradores', exact: true }).click();
  await page.getByTestId('stored-count').filter({ hasText: /^32$/ }).waitFor();
  snapshot = await database();
  assert.equal(snapshot.rows.length, 32);
  assert.deepEqual(snapshot.rows.find(row => row.dni === originalInactive.dni), originalInactive);
  assert.equal(snapshot.rows.filter(row => row.status === 'pending').length, 31);
  assert.equal(new Set(snapshot.rows.map(row => row.dni)).size, 32);
  pass('Un DNI con perfil inactivo se omite sin reactivarlo ni modificarlo; solo se crean los 31 nuevos');
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, errors, unexpectedNetwork, verifiedProfiles: 32,
    scope: 'Planilla XLS real y componente React real con la migración Postgres ejecutada en PGlite; sin lecturas ni escrituras de producción' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${output}/fallo.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, errors, unexpectedNetwork, error: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); server.kill(); }
