// The user's 08:00–14:00 example, using fictional local documents only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.BUK_QA_PORT || '4244', base = `http://127.0.0.1:${port}`, output = 'output/coverage-partial';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-buk-qa.mjs'], { env: { ...process.env, BUK_QA_PORT: port, BUK_QA_FOCUS_PREVIEW: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page;
const passed = [], errors = [], external = [];
const pass = message => { passed.push(message); console.log(`PASS: ${message}`); };
const poll = async (action, message) => { for (let i = 0; i < 150; i++) { if (await action()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(message); };
const read = async path => (await (await page.request.get(`${base}/qa-document?path=${encodeURIComponent(path)}`)).json()).data;
const seed = (path, data) => page.request.post(`${base}/qa-document`, { data: { path, data } });
const map = () => page.getByRole('region', { name: 'Matriz de cobertura por posición y horario', exact: true });
const candidates = () => page.getByRole('dialog', { name: 'Colaboradores para cubrir el tramo', exact: true });
const option = () => candidates().locator('[data-coverage-person-id="P01"] [data-coverage-option-id="PT1-17"]');
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18') || 'null'));
const search = async () => {
    const button = page.getByRole('button', { name: 'Buscar cobertura', exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    await map().locator('td[data-range-row="vestido-3"][data-range-hour="4"]').click();
    await map().locator('td[data-range-row="vestido-3"][data-range-hour="27"]').click();
    await candidates().waitFor();
    await candidates().getByLabel('Buscar candidato para cobertura', { exact: true }).fill('Sofía');
    const article = candidates().locator('[data-coverage-person-id="P01"]'); await article.waitFor();
    const details = article.locator('details'); if (await details.count()) await details.locator('summary').click();
    await option().waitFor();
};
try {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('QA startup timeout')), 30000);
        server.once('error', reject); server.stdout.on('data', data => { if (data.toString().includes('Editor BUK aislado:')) { clearTimeout(timer); resolve(); } });
    });
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, timezoneId: 'America/Lima' });
    page.on('pageerror', error => errors.push(error.message)); await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
    const projection = await read('stores/qa-store/config/schedule_projection');
    for (let hour = 0; hour < 18; hour++) projection.requirements.monday.matrix['0'][hour] = 4;
    await seed('stores/qa-store/config/schedule_projection', projection);
    await seed('schedules/P01_2026-10-12_to_2026-10-18', { monday: {}, tuesday: {}, wednesday: {}, thursday: {}, friday: {}, saturday: {}, sunday: { off: true } });
    await seed('study_schedules/P01', { staffId: 'P01', monday: { blocks: [{ start: '00:00', end: '09:00' }, { start: '13:00', end: '23:59' }] } });
    await page.goto(base); await map().locator('td').first().waitFor();
    const panel = page.getByTestId('focus-staff-panel'); if (await panel.isVisible()) await page.getByRole('button', { name: 'Cerrar panel de colaboradores', exact: true }).click();
    await search();
    assert.match(await candidates().getByTestId('coverage-selected-range').textContent(), /08:00–14:00/);
    assert.match(await option().textContent(), /Cobertura parcial · Cubre 4 h de 6 h/);
    assert.match(await option().textContent(), /08:00–09:00, 13:00–14:00 · 2 h/);
    await page.screenshot({ path: `${output}/partial-suggestion.png` });
    assert.deepEqual(await page.evaluate(() => window.bukQaWrites), []);
    pass('Buscar 08:00–14:00 ofrece 09:00–13:00 y muestra cuatro horas cubiertas y dos pendientes, respetando los estudios');

    // Change availability after the click starts, before the fresh read completes.
    let release, started;
    const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
    const delayed = '**/qa-document?path=study_schedules%2FP01';
    await page.route(delayed, async route => { started(); await gate; await route.continue(); });
    await option().getByRole('button', { name: /Agregar turno/ }).click(); await began;
    await seed('study_schedules/P01', { staffId: 'P01', monday: { blocks: [{ start: '00:00', end: '23:59' }] } });
    release(); await page.unroute(delayed);
    await candidates().getByRole('alert').waitFor();
    assert.equal((await draft())?.changes.P01, undefined);
    assert.deepEqual(await page.evaluate(() => window.bukQaWrites), []);
    await candidates().getByRole('button', { name: 'Cerrar búsqueda de cobertura', exact: true }).click();
    pass('Agregar una cobertura parcial vuelve a verificar estudios y cancela si cambiaron antes de aplicar');

    await seed('study_schedules/P01', { staffId: 'P01', monday: { blocks: [{ start: '00:00', end: '09:00' }, { start: '13:00', end: '23:59' }] } });
    await search(); await option().getByRole('button', { name: /Agregar turno/ }).click(); await candidates().waitFor({ state: 'hidden' });
    await poll(async () => (await draft())?.changes.P01?.monday?.start === '09:00', 'The partial shift was not drafted');
    assert.equal((await draft()).changes.P01.monday.end, '13:00');
    assert.equal((await draft()).changes.P01.monday.bukApprovedShiftId, 'PT1-17');
    assert.equal(await map().locator('td[data-occupant-id="P01"]:not([data-exit-marker])').count(), 16);
    assert.equal(await map().locator('td[data-range-row="vestido-3"][data-range-hour="4"]').getAttribute('data-missing'), 'true');
    assert.equal(await map().locator('td[data-range-row="vestido-3"][data-range-hour="27"]').getAttribute('data-missing'), 'true');
    await page.getByRole('button', { name: 'Deshacer cambio', exact: true }).click();
    assert.equal((await draft())?.changes.P01, undefined);
    assert.deepEqual(await page.evaluate(() => window.bukQaWrites), []);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    pass('Agregar conserva exactamente el turno aprobado 09:00–13:00, pinta sus 16 cuartos y permite deshacer sin publicar al servidor');
    await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, errors, external }, null, 2));
} catch (error) {
    await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, errors, external, error: String(error) }, null, 2)); throw error;
} finally { await browser?.close(); server.kill(); }
