// Exercise the real page with isolated HTTP persistence, without a remote client.
// Usage: node scripts/verify-suggestive-settings-persistence-ui.mjs report.xlsx report.xls
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { PROTECTED_SUGGESTIVE_PRODUCTS } from '../src/services/suggestiveSalesDefaults.js';
import { suggestiveSalesDraftCacheKey } from '../src/services/suggestiveSalesConfiguration.js';

const attachments = 'F:/Codex/Datos/codex-remote-attachments/01a1557e-408d-72c3-9b26-b79241fc01e5/5E80430A-7FAC-42FF-ACC7-73C8E7CD9AD3';
const files = [process.env.REPORT_XLSX_PATH || process.argv[2] || `${attachments}/1-reporte_Little_Caesars_Ventas_del_2026-10-01_al_2026-10-18.xlsx`,
    process.env.REPORT_XLS_PATH || process.argv[3] || `${attachments}/2-51c9.xls`];
for (const file of files) await access(file);
const playwright = process.env.PLAYWRIGHT_MODULE || resolve('tmp/competition-test-runtime/node_modules/playwright/index.mjs');
const { chromium } = await import(isAbsolute(playwright) ? pathToFileURL(playwright).href : playwright);
const output = resolve('output/suggestive-settings-persistence');
await mkdir(output, { recursive: true });
const port = Number(process.env.SUGGESTIVE_SETTINGS_QA_PORT || 4185), base = `http://127.0.0.1:${port}`;
const state = { documents: new Map(), history: new Map(), archives: new Map(), events: [], failWrites: false,
    holdReadPaths: new Set(), heldReads: [], holdWritePaths: new Set(), heldWrites: [] };
const copy = value => value === undefined ? null : structuredClone(value);
const configPath = (month, store = 'qa-store') => `stores/${store}/config/suggestive_sales_goals:${month}`;
const saved = (month, store = 'qa-store') => state.documents.get(configPath(month, store));
const target = configuration => configuration?.products.find(product => product.id === PROTECTED_SUGGESTIVE_PRODUCTS[0].id);
const eventually = async (predicate, message, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
    assert.fail(message);
};
const transport = `export const db={};export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=(...value)=>value;export const query=(ref,...filters)=>({...ref,filters});
const snap=(id,data)=>({id,exists:()=>data!=null,data:()=>data});export async function getDocs(){return{docs:[]}};
export async function getDoc(ref){const response=await fetch('/qa/document?path='+encodeURIComponent(ref.path));if(!response.ok)throw Error('Read failed');return snap(ref.path.split('/').at(-1),await response.json())}
export async function setDoc(ref,data){const response=await fetch('/qa/document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:ref.path,data})});if(!response.ok)throw Error('Simulated settings save failure')}`;
const client = `export const supabase={from(table){const filters=[];let sort=null,limit=null;return{select(){return this},eq(key,value){filters.push(row=>row[key]===value);return this},in(key,value){filters.push(row=>value.includes(row[key]));return this},order(key,options={}){sort={key,options};return this},limit(value){limit=value;return this},upsert(rows,options){return fetch('/qa/archives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows,options})}).then(response=>response.json())},then(resolve,reject){return fetch(table==='sales_month_configs'?'/qa/archives':'/qa/history').then(response=>response.json()).then(source=>{let rows=['sales_daily_history','sales_month_configs'].includes(table)?source:[];rows=rows.filter(row=>filters.every(test=>test(row)));if(sort)rows.sort((a,b)=>String(a[sort.key]).localeCompare(String(b[sort.key]))*(sort.options.ascending===false?-1:1));if(limit!==null)rows=rows.slice(0,limit);return{data:rows,error:null}}).then(resolve,reject)}}},async rpc(name,args){return(await fetch('/qa/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})).json()}};`;
const auth = `export const useAuth=()=>{const params=new URLSearchParams(location.search);return{userData:{storeId:params.get('store')||'qa-store'},currentUser:{uid:params.get('user')||'qa-admin'},userRole:'admin'}};`;
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router-dom';import Page from'./src/components/SuggestiveSalesGoalsPage.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/admin/suggestive-sales' element={<Page/>}/><Route path='/admin' element={<Link to='/admin/suggestive-sales'>Abrir venta sugestiva</Link>}/></Routes></BrowserRouter>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false,
    format: 'iife', jsx: 'automatic', plugins: [{ name: 'isolated-settings', setup(builder) {
        builder.onLoad({ filter: /lib[\\/]supabase[\\/]firestoreCompat\.js$/ }, () => ({ contents: transport, loader: 'js' }));
        builder.onLoad({ filter: /lib[\\/]supabase[\\/]client\.js$/ }, () => ({ contents: client, loader: 'js' }));
        builder.onLoad({ filter: /contexts[\\/]AuthContext\.jsx$/ }, () => ({ contents: auth, loader: 'js' }));
        builder.onLoad({ filter: /src[\\/]supabase\.js$/ }, () => ({ contents: 'export const db={};', loader: 'js' }));
    } }] });
const css = (await postcss([tailwind({ content: ['./src/components/SuggestiveSalesGoalsPage.jsx', './src/components/WeeklySuggestiveSalesReport.jsx'] })])
    .process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
const server = createServer(async (request, response) => {
    const url = new URL(request.url, base);
    const json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    const body = async () => { let text = ''; for await (const chunk of request) text += chunk; return JSON.parse(text); };
    if (url.pathname === '/qa/document' && request.method === 'GET') {
        const path = url.searchParams.get('path');
        const value = copy(state.documents.get(path) ?? (path.includes('/sales_config/') ? { monthlyData: {} } : null));
        state.events.push({ type: 'configuration-read', path });
        if (state.holdReadPaths.delete(path)) { state.heldReads.push({ path, value, release: () => {
            if (!response.destroyed && !response.writableEnded) json(value);
        } }); return; }
        return json(value);
    }
    if (url.pathname === '/qa/document' && request.method === 'POST') {
        const { path, data } = await body();
        state.events.push({ type: state.failWrites ? 'configuration-save-failed' : 'configuration-save', path, data: copy(data) });
        if (state.failWrites) { response.statusCode = 503; return json({ error: 'Simulated offline configuration write' }); }
        const commit = () => {
            state.documents.set(path, copy(data));
            if (!response.destroyed && !response.writableEnded) json({ saved: true });
        };
        if (state.holdWritePaths.delete(path)) { state.heldWrites.push({ path, release: commit }); return; }
        return commit();
    }
    if (url.pathname === '/qa/history') return json([...state.history.values()]);
    if (url.pathname === '/qa/archives' && request.method === 'GET') return json([...state.archives.values()]);
    if (url.pathname === '/qa/archives' && request.method === 'POST') {
        const { rows, options } = await body(); assert.deepEqual(options, { onConflict: 'store_id,month_start' });
        for (const row of rows) {
            assert.deepEqual(Object.keys(row).sort(), ['month_start', 'real_sales_data', 'store_id']);
            const key = `${row.store_id}|${row.month_start}`; state.archives.set(key, { ...state.archives.get(key), ...row });
        }
        return json({ data: [], error: null });
    }
    if (url.pathname === '/qa/rpc') {
        const { name, args } = await body(); state.events.push({ type: 'rpc', name });
        if (name !== 'save_sales_history_batch') return json({ data: null, error: { message: 'No publication in isolated persistence test' } });
        for (const day of args.p_days) state.history.set(`${args.p_store_id}|${day.date}`, {
            store_id: args.p_store_id, sales_date: day.date, sales_amount: day.totalSales, transactions: day.totalTxs,
            hourly_data: day.hourlyData, hourly_transactions: day.hourlyTxs, suggestive_products: day.suggestiveProducts,
            updated_at: '2026-10-19T18:00:00.000Z', source_data: { businessDateVersion: day.businessDateVersion,
                salesDayBasis: day.salesDayBasis, productSales: day.productSales, productSalesRecorded: day.productSalesRecorded,
                productRevenueRecorded: day.productRevenueRecorded },
        });
        return json({ data: args.p_days.length, error: null });
    }
    if (url.pathname === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bundle.outputFiles[0].text); }
    if (url.pathname === '/style.css') { response.setHeader('Content-Type', 'text/css'); return response.end(css); }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
let browser, page;
const passed = [], errors = [], blockedRequests = [];
const pass = message => { passed.push(message); console.log(`PASS: ${message}`); };
const first = PROTECTED_SUGGESTIVE_PRODUCTS[0];
const customName = 'QA PRODUCTO PERSISTENTE';
const reportNameInputs = () => page.locator('input[aria-label^="Nombre exacto en el reporte de "]');
const meta = label => page.getByLabel(`Meta de participación de ${label}`, { exact: true });
const price = label => page.getByLabel(`Precio de ${label}`, { exact: true });
const waitMeta = async (label, expected) => {
    const input = meta(label); await input.waitFor();
    await eventually(async () => await input.isEnabled() && await input.inputValue() === String(expected), `Expected enabled ${label} goal ${expected}`);
};
const waitSaved = async (month, expected, store = 'qa-store') => {
    await eventually(() => target(saved(month, store))?.participation === expected
        && target(saved('defaults', store))?.participation === expected, `Expected saved ${month}/global target ${expected}`);
    await page.getByRole('status').filter({ hasText: 'Configuración guardada automáticamente.' }).waitFor();
};
const setMonth = async month => { await page.getByLabel('Mes objetivo', { exact: true }).fill(month); };
const cache = async (month, user = 'qa-admin', store = 'qa-store') => page.evaluate(key => JSON.parse(localStorage.getItem(key)),
    suggestiveSalesDraftCacheKey({ userId: user, storeId: store, month }));
const assertCatalog = async () => {
    for (const product of PROTECTED_SUGGESTIVE_PRODUCTS) {
        const name = page.getByLabel(`Nombre exacto en el reporte de ${product.label}`, { exact: true });
        assert.equal(await name.inputValue(), product.reportName);
        assert.equal(await name.evaluate(input => input.readOnly), false, 'Initial product names must remain editable');
        assert.equal(await page.getByRole('button', { name: `Quitar producto ${product.label}`, exact: true }).isEnabled(), true);
        assert.equal(await meta(product.label).inputValue(), '30');
    }
};
try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const chrome = process.env.CHROMIUM_PATH || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Lima' });
    await context.addInitScript(() => {
        const NativeDate = Date; window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : ['2026-10-19T17:00:00Z'])); }
            static now() { return new NativeDate('2026-10-19T17:00:00Z').getTime(); }
        };
    });
    await context.route('**/*', route => {
        const url = new URL(route.request().url()); if (url.origin === base) return route.continue();
        blockedRequests.push(url.origin); return route.abort();
    });
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/admin/suggestive-sales`);
    await waitMeta(first.label, 30); await assertCatalog();
    assert.equal(await reportNameInputs().count(), PROTECTED_SUGGESTIVE_PRODUCTS.length);
    assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 2, 'Only Salón and Módulo should be selected by default');
    assert.equal(await page.getByLabel('SALÓN', { exact: true }).isChecked(), true);
    const moduleCheckbox = page.getByLabel('SERV. FILA', { exact: true });
    assert.equal(await moduleCheckbox.isChecked(), true);
    assert.equal(await page.getByLabel('DRIVE THRU', { exact: true }).isChecked(), false);
    assert.equal(await page.getByLabel('SERV. AUTO', { exact: true }).isChecked(), false);
    assert.ok((await moduleCheckbox.locator('..').innerText()).includes('Módulo (Serv. Fila)'));
    assert.equal(await moduleCheckbox.locator('..').isVisible(), true);
    const moduleRows = page.getByRole('table', { name: 'Participación semanal por producto y canal', exact: true })
        .locator('tbody tr[data-channel="SERV. FILA"]');
    assert.equal(await moduleRows.count(), PROTECTED_SUGGESTIVE_PRODUCTS.length);
    for (const row of await moduleRows.all()) {
        const cells = await row.locator('td').allTextContents();
        assert.equal(cells[1], 'Módulo (Serv. Fila)');
        assert.equal(cells[7], '30%');
    }
    pass('Sin lista guardada se ofrecen cinco productos editables y eliminables al 30%, con sólo Salón y Módulo seleccionados');

    await meta(first.label).fill('35'); await price(first.label).fill('29.90');
    await page.getByLabel('SALÓN', { exact: true }).check();
    await page.getByLabel('SERV. FILA', { exact: true }).check();
    await page.getByLabel('DRIVE THRU', { exact: true }).uncheck();
    await page.getByLabel('Nombre exacto del nuevo producto', { exact: true }).fill(customName);
    await page.getByRole('button', { name: 'Agregar producto', exact: true }).click();
    await meta(customName).fill('12');
    await waitSaved('2026-10', .35);
    await eventually(() => saved('2026-10')?.products.find(product => product.reportName === customName)?.participation === .12
        && Number(target(saved('2026-10'))?.price) === 29.9, 'Custom product and price should autosave');
    pass('Editar metas, precio y canales y agregar un producto guarda automáticamente los documentos global y mensual');

    state.holdWritePaths = new Set([configPath('defaults'), configPath('2026-10')]);
    await meta(first.label).fill('36');
    await eventually(() => state.heldWrites.length === 2, 'Both in-flight saves should be delayed');
    assert.equal(await meta(first.label).isEnabled(), true, 'Autosaving must allow continued editing');
    const previousSaveRequests = state.events.filter(event => event.type === 'configuration-save').length;
    await meta(first.label).fill('35');
    await new Promise(resolve => setTimeout(resolve, 750));
    assert.equal(state.events.filter(event => event.type === 'configuration-save').length, previousSaveRequests,
        'A newer save must wait for the delayed server commits so old writes cannot overwrite newer ones');
    for (const request of state.heldWrites) request.release(); state.heldWrites = [];
    await waitSaved('2026-10', .35);
    const configBeforeUpload = JSON.stringify([...state.documents]);
    pass('Editar mientras un guardado sigue en vuelo conserva la última meta y la guarda después de la respuesta anterior');

    for (const [index, file] of files.entries()) {
        await page.getByRole('button', { name: 'Cargar reporte de ventas', exact: true }).waitFor();
        await page.getByLabel('Cargar reporte de ventas', { exact: true }).setInputFiles(file);
        await eventually(() => state.history.size === (index ? 18 : 17), `Expected ${index ? 18 : 17} imported days`, 120000);
        await eventually(async () => await page.getByRole('button', { name: 'Cargar reporte de ventas', exact: true }).isEnabled(), 'Import should finish', 120000);
        await waitMeta(first.label, 35); assert.equal(await meta(customName).inputValue(), '12');
    }
    assert.equal(JSON.stringify([...state.documents]), configBeforeUpload, 'Uploading sales must not reset product configuration');
    assert.ok(Math.abs([...state.history.values()].reduce((sum, row) => sum + row.sales_amount, 0) - 416079.50) < .011);
    pass('Cargar los originales .xlsx y .xls conserva productos, metas, precio y canales; el historial conserva 18 jornadas');

    await page.getByRole('button', { name: 'Volver al panel admin', exact: true }).click();
    await page.getByRole('link', { name: 'Abrir venta sugestiva', exact: true }).click();
    await waitMeta(first.label, 35); assert.equal(await meta(customName).inputValue(), '12');
    await page.reload(); await waitMeta(first.label, 35);
    assert.equal(Number(await price(first.label).inputValue()), 29.9);
    assert.equal(await page.getByLabel('SALÓN', { exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('SERV. FILA', { exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('DRIVE THRU', { exact: true }).isChecked(), false);
    assert.equal(await reportNameInputs().count(), PROTECTED_SUGGESTIVE_PRODUCTS.length + 1);
    assert.equal(state.history.size, 18);
    pass('Salir al panel, volver y recargar recupera la configuración y los reportes sin volver a publicarlos');

    await setMonth('2026-11'); await waitMeta(first.label, 35);
    assert.equal(await meta(customName).inputValue(), '12');
    await meta(first.label).fill('40'); await waitSaved('2026-11', .40);
    await setMonth('2026-10'); await waitMeta(first.label, 35);
    await setMonth('2026-11'); await waitMeta(first.label, 40);
    pass('Un mes nuevo hereda los últimos valores globales; los meses ya guardados mantienen su propia meta');

    state.failWrites = true;
    await meta(first.label).fill('37');
    await page.getByRole('alert').filter({ hasText: /No se pudo guardar/ }).first().waitFor();
    await eventually(async () => (await cache('2026-11'))?.dirty === true, 'Failed save should leave a dirty local cache');
    assert.equal(target(saved('2026-11')).participation, .4);
    await page.reload(); await setMonth('2026-11'); await waitMeta(first.label, 37);
    assert.equal((await cache('2026-11')).dirty, true);
    await page.screenshot({ path: `${output}/borrador-conservado.png`, fullPage: true });
    pass('Un guardado fallido muestra el error y conserva el borrador y su caché al recargar, sin sustituirlo por el remoto anterior');

    // The failed draft belongs to this user and store, not every session on this origin.
    await page.goto(`${base}/admin/suggestive-sales?user=qa-other-user`);
    await setMonth('2026-11'); await waitMeta(first.label, 40);
    await page.goto(`${base}/admin/suggestive-sales?store=qa-other-store`);
    await waitMeta(first.label, 30); await assertCatalog();
    assert.equal(await reportNameInputs().count(), PROTECTED_SUGGESTIVE_PRODUCTS.length);
    await page.goto(`${base}/admin/suggestive-sales`);
    await setMonth('2026-11'); await waitMeta(first.label, 37);
    state.failWrites = false;
    await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
    await eventually(() => target(saved('2026-11'))?.participation === .37 && target(saved('defaults'))?.participation === .37,
        'Retry must persist the retained draft');
    await eventually(async () => (await cache('2026-11'))?.dirty === false, 'Successful retry should clear dirty cache');
    pass('La caché se aísla por usuario y tienda; reintentar guarda el borrador retenido cuando vuelve la conexión');

    state.holdReadPaths = new Set([configPath('defaults'), configPath('2026-11')]);
    await page.getByRole('button', { name: 'Actualizar datos', exact: true }).click();
    await eventually(() => state.heldReads.length === 2, 'The old month reads must be delayed');
    await setMonth('2026-12'); await waitMeta(first.label, 37);
    await meta(first.label).fill('35'); await waitSaved('2026-12', .35);
    const delayedResponses = state.heldReads.map(request => page.waitForResponse(response => {
        const url = new URL(response.url()); return url.pathname === '/qa/document' && url.searchParams.get('path') === request.path;
    }));
    for (const request of state.heldReads) request.release();
    await Promise.all(delayedResponses);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    state.heldReads = [];
    await eventually(async () => (await cache('2026-12'))?.dirty === false, 'New month should remain saved');
    assert.equal(await page.getByLabel('Mes objetivo', { exact: true }).inputValue(), '2026-12');
    assert.equal(await meta(first.label).inputValue(), '35');
    assert.equal(target(saved('2026-11')).participation, .37);
    await page.reload(); await setMonth('2026-12'); await waitMeta(first.label, 35);
    await page.screenshot({ path: `${output}/configuracion-recuperada.png`, fullPage: true });
    pass('Una lectura tardía del mes anterior no pisa los cambios ni la caché del nuevo mes, también después de recargar');

    const waitProductsSaved = async (month, check) => {
        await eventually(() => Boolean(saved(month) && saved('defaults')
            && check(saved(month).products) && check(saved('defaults').products)), `Expected product selection to persist for ${month} and defaults`);
        await page.getByRole('status').filter({ hasText: 'Configuración guardada automáticamente.' }).waitFor();
    };
    const waitProductCount = async count => eventually(async () => await reportNameInputs().count() === count
        && await page.getByRole('button', { name: 'Guardar configuración', exact: true }).isEnabled(), `Expected loaded product count ${count}`);
    await setMonth('2026-10'); await waitMeta(first.label, 35);
    await page.getByRole('button', { name: `Quitar producto ${first.label}`, exact: true }).click();
    await waitProductsSaved('2026-10', products => products.length === PROTECTED_SUGGESTIVE_PRODUCTS.length
        && !products.some(product => product.id === first.id));
    await page.reload(); await waitProductCount(PROTECTED_SUGGESTIVE_PRODUCTS.length);
    assert.equal(await page.getByLabel(`Nombre exacto en el reporte de ${first.label}`, { exact: true }).count(), 0);
    const removedPresetConfiguration = copy(saved('2026-10'));
    for (const file of files) {
        const beforeUploads = state.events.filter(event => event.type === 'rpc' && event.name === 'save_sales_history_batch').length;
        await page.getByLabel('Cargar reporte de ventas', { exact: true }).setInputFiles(file);
        await eventually(() => state.events.filter(event => event.type === 'rpc' && event.name === 'save_sales_history_batch').length === beforeUploads + 1,
            'Report upload should finish', 120000);
        await eventually(async () => await page.getByRole('button', { name: 'Cargar reporte de ventas', exact: true }).isEnabled(),
            'Import should re-enable the upload control', 120000);
        assert.equal(await page.getByLabel(`Nombre exacto en el reporte de ${first.label}`, { exact: true }).count(), 0);
        assert.deepEqual(saved('2026-10'), removedPresetConfiguration, 'Neither report format may resurrect a removed initial product');
    }
    await page.reload(); await waitProductCount(PROTECTED_SUGGESTIVE_PRODUCTS.length);
    assert.equal(await page.getByLabel(`Nombre exacto en el reporte de ${first.label}`, { exact: true }).count(), 0);
    assert.equal(state.history.size, 18);
    pass('Quitar un producto inicial se guarda y resiste recargas y la importación de ambos reportes sin reaparecer');

    const removeButtons = page.getByRole('button', { name: /^Quitar producto / });
    while (await removeButtons.count()) await removeButtons.first().click();
    await waitProductsSaved('2026-10', products => products.length === 0);
    await page.reload(); await waitProductCount(0);
    assert.deepEqual(saved('2026-10').products, []);
    assert.deepEqual(saved('defaults').products, []);
    assert.equal(await page.getByRole('button', { name: 'Publicar metas del mes', exact: true }).isDisabled(), true);
    await page.screenshot({ path: `${output}/catalogo-vacio-conservado.png`, fullPage: true });
    await setMonth('2027-01'); await waitProductCount(0);
    assert.equal(saved('2027-01'), undefined, 'Merely opening a new month should not save or re-seed products');
    pass('Quitar todos guarda un array vacío intencional; recargar y abrir un mes nuevo conserva la lista vacía');

    const afterEmptyName = 'QA PRODUCTO DESPUÉS DE VACIAR';
    await page.getByLabel('Nombre exacto del nuevo producto', { exact: true }).fill(afterEmptyName);
    await page.getByRole('button', { name: 'Agregar producto', exact: true }).click();
    await waitProductsSaved('2027-01', products => products.length === 1 && products[0].reportName === afterEmptyName);
    await page.reload(); await waitProductCount(0); // October's explicit [] overrides the new global selection.
    assert.deepEqual(saved('2026-10').products, []);
    await setMonth('2027-01'); await waitProductCount(1);
    assert.equal(await page.getByLabel(`Nombre exacto en el reporte de ${afterEmptyName}`, { exact: true }).inputValue(), afterEmptyName);
    assert.equal(await meta(afterEmptyName).inputValue(), '30');
    assert.equal(await price(afterEmptyName).inputValue(), '');
    await page.screenshot({ path: `${output}/producto-agregado-tras-vaciar.png`, fullPage: true });
    pass('Se puede agregar y guardar un producto tras vaciar; el mes vacío conserva [] frente a la nueva selección global');

    assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []);
    assert.equal(state.events.filter(event => event.type === 'rpc' && event.name !== 'save_sales_history_batch').length, 0,
        'Opening, editing, saving, uploading and navigating must never publish collaborator goals');
    await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'PASS', passed, errors, blockedRequests,
        initialProducts: PROTECTED_SUGGESTIVE_PRODUCTS.map(({ id, reportName }) => ({ id, reportName })), historyDays: state.history.size,
        documents: Object.fromEntries(state.documents), events: state.events,
        scope: 'Real React page; uploads and JSON documents stay in isolated loopback HTTP memory. No remote writes or publication.' }, null, 2));
} catch (error) {
    await page?.screenshot({ path: `${output}/fallo.png`, fullPage: true }).catch(() => {});
    await writeFile(`${output}/resultado.json`, JSON.stringify({ status: 'FAIL', passed, errors, blockedRequests, error: String(error),
        documents: Object.fromEntries(state.documents), events: state.events }, null, 2));
    throw error;
} finally {
    for (const request of state.heldReads) request.release();
    for (const request of state.heldWrites) request.release();
    await browser?.close(); await new Promise(resolve => server.close(resolve));
}
