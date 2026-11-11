// Real heatmap hover/focus, using fictional documents and no production access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.BUK_QA_PORT || '4243', base = `http://127.0.0.1:${port}`, output = 'output/heatmap-hover';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-buk-qa.mjs'], { env: { ...process.env, BUK_QA_PORT: port, BUK_QA_FOCUS_PREVIEW: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page;
const passed = [], errors = [], external = [];
const pass = message => { passed.push(message); console.log(`PASS: ${message}`); };
const map = () => page.getByRole('region', { name: 'Matriz de cobertura por posición y horario', exact: true });
const tooltip = () => page.getByRole('tooltip');
const occupied = () => map().locator('td[data-occupant-id]:not([data-exit-marker])');
const checkTooltip = async cell => {
    await tooltip().waitFor();
    assert.ok((await tooltip().textContent()).includes(await cell.getAttribute('data-occupant-name')));
    const bounds = await tooltip().boundingBox(), anchor = await cell.boundingBox(), viewport = page.viewportSize();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    assert.ok(Math.abs(bounds.y + bounds.height - anchor.y) < 12 || Math.abs(bounds.y - anchor.y - anchor.height) < 12, 'Tooltip must remain next to the inspected cell');
    assert.equal(await cell.getAttribute('aria-describedby'), await tooltip().getAttribute('id'));
};
try {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Local QA startup timeout')), 30000);
        server.once('error', reject);
        server.stdout.on('data', data => { if (data.toString().includes('Editor BUK aislado:')) { clearTimeout(timer); resolve(); } });
    });
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, timezoneId: 'America/Lima' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
    await page.goto(base); await occupied().first().waitFor();
    const draft = await page.evaluate(() => localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18'));
    const first = occupied().first(); await first.scrollIntoViewIfNeeded();
    const header = await page.getByTestId('heatmap-header').boundingBox(), matrix = await map().boundingBox();
    await first.hover(); await checkTooltip(first);
    assert.deepEqual(await page.getByTestId('heatmap-header').boundingBox(), header);
    assert.deepEqual(await map().boundingBox(), matrix);
    await page.screenshot({ path: `${output}/hover-desktop.png` });
    await tooltip().hover(); assert.equal(await tooltip().isVisible(), true);
    const firstId = await first.getAttribute('data-occupant-id');
    const second = map().locator(`td[data-occupant-id]:not([data-occupant-id="${firstId}"]):not([data-exit-marker])`).first();
    await second.hover(); await checkTooltip(second);
    pass('Hover muestra de inmediato nombre, puesto y tramo junto a cada celda; cambia de colaborador y permite mover el puntero a la ficha sin agrandar la cabecera');

    await map().locator('td[data-missing="true"]').first().hover(); await tooltip().waitFor({ state: 'hidden' });
    await first.focus(); await checkTooltip(first); await page.keyboard.press('Escape'); await tooltip().waitFor({ state: 'hidden' });
    await second.focus(); await checkTooltip(second); await second.evaluate(element => element.blur()); await tooltip().waitFor({ state: 'hidden' });
    pass('Foco de teclado muestra la misma información; Escape, desenfocar y una celda vacía retiran la ficha');

    const exit = map().locator('td[data-exit-marker="true"]').first(); await exit.hover(); await checkTooltip(exit);
    assert.match(await tooltip().textContent(), /Salida \(sin duración\)/);
    await map().evaluate(element => { element.scrollLeft += 20; }); await tooltip().waitFor({ state: 'hidden' });
    pass('Las marcas de salida identifican al colaborador sin sumar duración; el scroll retira la ficha anterior');

    await page.getByRole('button', { name: 'Maximizar mapa de cobertura', exact: true }).click();
    const fullscreen = page.getByRole('dialog', { name: /Mapa de Cobertura/ }); await fullscreen.waitFor();
    await occupied().first().hover(); await checkTooltip(occupied().first());
    assert.equal(await tooltip().evaluate(element => Boolean(element.closest('dialog[open]'))), true);
    await page.screenshot({ path: `${output}/hover-fullscreen.png` });
    await page.keyboard.press('Escape'); await tooltip().waitFor({ state: 'hidden' });
    assert.equal(await fullscreen.isVisible(), true, 'Escape dismisses the tooltip before closing the fullscreen map');
    await page.getByRole('button', { name: 'Minimizar mapa de cobertura', exact: true }).click();
    pass('La ficha se muestra sobre el mapa maximizado y Escape permite cerrarla conservando el mapa abierto');

    const panel = page.getByTestId('focus-staff-panel');
    if (await panel.isVisible()) await page.getByRole('button', { name: 'Cerrar panel de colaboradores', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await occupied().first().scrollIntoViewIfNeeded(); await occupied().first().focus(); await checkTooltip(occupied().first());
    await page.screenshot({ path: `${output}/hover-mobile.png` });
    await page.setViewportSize({ width: 1600, height: 1000 }); await tooltip().waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18')), draft);
    assert.deepEqual(await page.evaluate(() => window.bukQaWrites), []);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    pass('En móvil la ficha cabe dentro de la pantalla; consultar nombres no modifica horarios ni borradores ni escribe al servidor');
    await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, errors, external }, null, 2));
} catch (error) {
    await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, errors, external, error: String(error) }, null, 2));
    throw error;
} finally { await browser?.close(); server.kill(); }
