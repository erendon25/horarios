// Real sales components, synthetic browser storage, and loopback-only transport.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

const runtime = process.env.PLAYWRIGHT_MODULE || resolve('tmp/competition-test-runtime/node_modules/playwright/index.mjs');
const { chromium } = await import(isAbsolute(runtime) ? pathToFileURL(runtime).href : runtime);
const port = Number(process.env.SALES_QA_PORT || 4181);
const base = `http://127.0.0.1:${port}`;
const output = resolve('output/sales-business-day-ui');
await mkdir(output, { recursive: true });
const passed = [], errors = [], dialogs = [], blockedRequests = [];
const pass = label => { passed.push(label); console.log(`PASS: ${label}`); };
const bootstrap = `
const key='sales_business_day_qa_v1';
const initial={history:{},configs:{'2026-10':{monthlyData:{'12':{vta:'1500',txs:'150'}},dailyHourlyParts:{},realSalesData:{'2026-10-01':{vta:70,txs:7}}}},writes:[]};
window.__salesQA={get state(){return JSON.parse(localStorage.getItem(key)||JSON.stringify(initial))},save(value){localStorage.setItem(key,JSON.stringify(value))},reset(){this.save(initial)}};
`;
const firestore = `
export const getFirestore=()=>({});
export const doc=(...parts)=>({path:parts.filter(part=>typeof part==='string').join('/')});
export async function getDoc(ref){
 const state=window.__salesQA.state;const id=ref.path.split('/').at(-1);
 const value=ref.path==='users/qa-admin'?{storeId:'qa-store'}:ref.path.includes('/sales_config/')?state.configs[id]:null;
 return {id,exists:()=>value!=null,data:()=>value};
}
export async function setDoc(ref,value){const state=window.__salesQA.state;state.configs[ref.path.split('/').at(-1)]=value;window.__salesQA.save(state)}
`;
const client = `
export const supabase={
 from(table){let filters=[],sorting=null,count=null;return {
  select(){return this},eq(field,value){filters.push(row=>row[field]===value);return this},in(field,values){filters.push(row=>values.includes(row[field]));return this},
  order(field,options={}){sorting={field,ascending:options.ascending!==false};return this},limit(value){count=value;return this},
  then(resolve,reject){const state=window.__salesQA.state;let rows=table==='sales_daily_history'?Object.values(state.history):table==='sales_month_configs'?Object.entries(state.configs).map(([month,value])=>({store_id:'qa-store',month_start:month+'-01',real_sales_data:value.realSalesData||{},daily_hourly_parts:value.dailyHourlyParts||{}})):[];
   rows=rows.filter(row=>filters.every(filter=>filter(row)));if(sorting)rows.sort((a,b)=>String(a[sorting.field]).localeCompare(String(b[sorting.field]))*(sorting.ascending?1:-1));rows=rows.slice(0,count??1000);
   return Promise.resolve({data:rows,error:null}).then(resolve,reject)}
 }},
 async rpc(name,args){if(name!=='save_sales_history_batch')throw Error('Unexpected local RPC '+name);
  const state=window.__salesQA.state;for(const day of args.p_days)state.history[day.date]={store_id:args.p_store_id,sales_date:day.date,sales_amount:day.totalSales,transactions:day.totalTxs,hourly_data:day.hourlyData,hourly_transactions:day.hourlyTxs,suggestive_products:day.suggestiveProducts,source_data:{...day},updated_at:'2026-10-19T12:00:00Z'};
  state.writes.push({name,dates:args.p_days.map(day=>day.date)});window.__salesQA.save(state);return {data:args.p_days.length,error:null};
 }
};`;
const auth = `export const useAuth=()=>({currentUser:{uid:'qa-admin'}});`;
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route,Link}from'react-router-dom';import SalesConfig from'./src/components/SalesConfig.jsx';import SalesAnalysis from'./src/components/SalesAnalysis.jsx';import'./src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><nav style={{padding:10}}>PRUEBA LOCAL SIN DATOS REMOTOS · <Link to='/config'>Ventas</Link> · <Link to='/analysis'>Comparativo</Link></nav><Routes><Route path='/analysis' element={<SalesAnalysis/>}/><Route path='*' element={<SalesConfig/>}/></Routes></BrowserRouter>);`;
const bundle = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, outdir: 'qa', format: 'iife', jsx: 'automatic', plugins: [{ name: 'sales-local-only', setup(builder) {
    builder.onLoad({ filter: /lib[\\/]supabase[\\/]firestoreCompat\.js$/ }, () => ({ contents: firestore, loader: 'js' }));
    builder.onLoad({ filter: /lib[\\/]supabase[\\/]client\.js$/ }, () => ({ contents: client, loader: 'js' }));
    builder.onLoad({ filter: /contexts[\\/]AuthContext\.jsx$/ }, () => ({ contents: auth, loader: 'js' }));
} }] });
const styles = (await postcss([tailwind({ content: ['./src/components/SalesConfig.jsx', './src/components/SalesAnalysis.jsx'] })]).process(await readFile('src/index.css', 'utf8'), { from: undefined })).css;
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = styles + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const server = createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); }
    else if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
    else { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script>${bootstrap}</script><script src="/app.js"></script></body></html>`); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });

const salesRow = (pedido, fecha, total, document = `B-${pedido}`) => ({ Pedido: pedido, FechaPedido: fecha, Documento: document, EstadoPedido: 'FACTURADO', EstadoItem: 'Pagado', CANAL: 'EN LOCAL', Item: 1, Producto: 'Pizza', Cantidad: 1, Total: total });
const workbookFile = async (name, rows) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Reporte');
    const path = resolve(output, name);
    await writeFile(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    return path;
};
const reportA = await workbookFile('reporte-a.xlsx', [salesRow('a1', '2026-10-05 10:00:00', 100), salesRow('a2', '2026-10-06 10:00:00', 200), salesRow('a3', '2026-10-07 10:00:00', 300), salesRow('ay', '2025-10-13 10:00:00', 250)]);
const reportB = await workbookFile('reporte-b-madrugada.xlsx', [salesRow('b1', '2026-10-12 23:00:00', 400), salesRow('b2', '2026-10-13 00:30:00', 100), salesRow('b3', '2026-10-13 05:59:00', 50), salesRow('b4', '2026-10-13 06:00:00', 600)]);
let browser, page;
const result = { status: 'RUNNING', passed, errors, blockedRequests, observations: {} };
try {
    const defaultChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const executablePath = process.env.CHROMIUM_PATH || (existsSync(defaultChrome) ? defaultChrome : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Lima' });
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        blockedRequests.push(url.origin); return route.abort();
    });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    const snapshot = () => page.evaluate(() => window.__salesQA.state);
    const readyConfig = async () => {
        await page.getByRole('heading', { name: 'Configuración de Ventas', exact: true }).waitFor();
        const month = page.locator('input[type="month"]');
        if (await month.inputValue() !== '2026-10') { await month.fill('2026-10'); await page.getByRole('heading', { name: 'Configuración de Ventas', exact: true }).waitFor(); }
        await page.getByRole('heading', { name: 'Promedios por Día de la Semana', exact: true }).waitFor();
    };
    const upload = async path => {
        const before = (await snapshot()).writes.length;
        await page.locator('input[type="file"]').setInputFiles(path);
        await page.waitForFunction(before => window.__salesQA.state.writes.length > before, before);
        await page.getByText('Guardando cambios...', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByText('Procesando Historial...', { exact: true }).waitFor({ state: 'hidden' });
    };
    const average = weekday => page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Promedio VTA', exact: true }) }).getByRole('row').filter({ has: page.getByRole('cell', { name: new RegExp(`^${weekday}`) }) });
    const selectDates = async (start, end = start) => {
        await page.locator('input[type="date"]').nth(0).fill(start);
        await page.locator('input[type="date"]').nth(1).fill(end);
        await page.getByRole('button', { name: /Consultar|Cargando/ }).filter({ hasText: 'Consultar' }).waitFor();
        await page.getByRole('button', { name: 'Consultar', exact: true }).click();
        await page.getByRole('button', { name: 'Consultar', exact: true }).waitFor();
        await page.getByRole('heading', { name: /^VS / }).waitFor();
    };

    await page.goto(`${base}/config`); await readyConfig();
    await upload(reportA); await readyConfig();
    const editedMeta = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Lunes 12', exact: true }) }).locator('input').first();
    await editedMeta.fill('1777');
    await upload(reportB); await readyConfig();
    assert.equal(await editedMeta.inputValue(), '1777', 'Uploading sales preserves an unsaved local goal');
    let state = await snapshot();
    assert.deepEqual(Object.keys(state.history).sort(), ['2025-10-13', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-13']);
    assert.equal(state.history['2026-10-12'].sales_amount, 550);
    assert.equal(state.history['2026-10-12'].transactions, 3);
    assert.equal(state.history['2026-10-13'].sales_amount, 600);
    assert.deepEqual(Object.keys(state.history['2026-10-12'].hourly_data), ['0', '5', '23']);
    assert.equal(state.history['2026-10-12'].source_data.productSalesRecorded, true);
    assert.deepEqual([...new Set(state.history['2026-10-12'].source_data.productSales.map(product => product.name))], ['Pizza']);
    assert.equal(state.history['2026-10-12'].source_data.productSales.reduce((sum, product) => sum + product.quantity, 0), 3);
    assert.equal(state.configs['2026-10'].monthlyData['12'].vta, '1500');
    await page.reload(); await readyConfig();
    assert.match(await average('Lunes').innerText(), /2 días registrados/);
    assert.match(await average('Lunes').innerText(), /325[.,]00/);
    assert.match(await average('Martes').innerText(), /400[.,]00/);
    assert.match(await average('Miércoles').innerText(), /300[.,]00/);
    assert.match(await average('Jueves').innerText(), /70[.,]00/);
    result.observations.synthetic = { monday: { sales: 550, txs: 3, hours: [23, 0, 5] }, tuesday: { sales: 600, txs: 1 }, mondayAverage: 325, tuesdayAverage: 400, previousDaysPreserved: true };
    pass('Ventas conserva reportes A y B, días previos y archivo mensual tras recargar; madrugada pertenece a la jornada anterior');
    await page.getByRole('heading', { name: 'Promedios por Día de la Semana', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'promedios-conservados.png') });

    await page.goto(`${base}/analysis`);
    await page.getByRole('heading', { name: 'COMPARATIVO VENTAS', exact: true }).waitFor();
    const beforeAnalysis = structuredClone((await snapshot()).history);
    await upload(reportB);
    await page.waitForFunction(() => [...document.querySelectorAll('input[type="date"]')].map(input => input.value).join(',') === '2026-10-12,2026-10-13');
    assert.deepEqual((await snapshot()).history, beforeAnalysis, 'Both import screens write the same canonical daily data');
    pass('Ambos importadores producen el mismo historial y el comparativo adopta el rango de jornadas del archivo');
    await selectDates('2026-10-12');
    await page.getByRole('button', { name: 'Semana Anterior', exact: true }).click();
    assert.match(await page.getByText(/^Comparación:/).first().innerText(), /2026-10-05/);
    assert.equal(await page.getByRole('button', { name: 'Mes Anterior', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Transacciones', exact: true }).click();
    const trend = page.getByLabel('Fecha de la tendencia de transacciones', { exact: true });
    assert.equal(await trend.isDisabled(), true);
    assert.equal(await trend.inputValue(), '2026-10-12');
    assert.deepEqual(await trend.locator('option').evaluateAll(options => options.map(option => option.value)), ['2026-10-12']);
    const section = page.getByRole('heading', { name: /^VS / }).locator('xpath=..');
    assert.match(await section.locator('.bg-black').nth(0).innerText(), /1\s*$/);
    assert.match(await section.locator('.bg-black').nth(1).innerText(), /3\s*$/);
    await page.getByRole('button', { name: 'Año Anterior', exact: true }).click();
    assert.match(await page.getByText(/^Comparación:/).first().innerText(), /2025-10-13/);
    assert.match(await section.locator('.bg-black').nth(0).innerText(), /1\s*$/);
    await page.screenshot({ path: resolve(output, 'comparativo-dia-homologo.png') });
    pass('Lunes 12 compara con lunes 5 y lunes 13 de 2025; mes bloqueado y tendencia de fecha única fijada');
    await selectDates('2026-10-12', '2026-10-13');
    assert.equal(await trend.isDisabled(), false);
    assert.deepEqual(await trend.locator('option').evaluateAll(options => options.map(option => option.value)), ['all', '2026-10-12', '2026-10-13']);
    await trend.selectOption('2026-10-13');
    assert.equal(await trend.inputValue(), '2026-10-13');
    pass('La tendencia permite exclusivamente fechas dentro del rango activo');

    if (process.env.SALES_IMPORT_FIXTURE) {
        await page.goto(`${base}/config`); await readyConfig();
        await upload(resolve(process.env.SALES_IMPORT_FIXTURE)); await readyConfig();
        state = await snapshot();
        assert.ok(Math.abs(state.history['2026-10-12'].sales_amount - 17615.30) < 0.005);
        assert.equal(state.history['2026-10-12'].transactions, 641);
        assert.ok(Math.abs(state.history['2026-10-13'].sales_amount - 4050.60) < 0.005);
        assert.equal(state.history['2026-10-13'].transactions, 160);
        assert.equal(state.history['2026-10-05'].sales_amount, 100);
        const realConfigHistory = structuredClone(state.history);
        await page.reload(); await readyConfig();
        assert.match(await average('Lunes').innerText(), /8[,.\s]?857[,.]65/);
        await page.goto(`${base}/analysis`); await page.getByRole('heading', { name: 'COMPARATIVO VENTAS', exact: true }).waitFor();
        await upload(resolve(process.env.SALES_IMPORT_FIXTURE));
        assert.deepEqual((await snapshot()).history, realConfigHistory);
        result.observations.realReport = { monday: { sales: 17615.30, txs: 641 }, tuesday: { sales: 4050.60, txs: 160 }, earlierMondayPreserved: true, mondayAverageIncludingEarlierReport: 8857.65 };
        pass('Excel proporcionado reconcilia 12 y 13, conserva días anteriores al recargar y ambos importadores guardan lo mismo');
    }
    await page.evaluate(() => {
        const state = window.__salesQA.state;
        state.history['2026-10-08'] = { store_id: 'qa-store', sales_date: '2026-10-08', sales_amount: 100, transactions: 10, hourly_data: { 10: { SALÓN: 100 } }, hourly_transactions: { 10: { SALÓN: 10 } }, updated_at: '2026-10-17T12:00:00Z' };
        state.configs['2026-10'].realSalesData['2026-10-08'] = { vta: 300, txs: 30, importedAt: '2026-10-18T12:00:00Z' };
        state.configs['2026-10'].dailyHourlyParts['2026-10-08'] = { '10:00': 100 };
        window.__salesQA.save(state);
    });
    await page.goto(`${base}/config`); await readyConfig();
    const averageTable = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Promedio VTA', exact: true }) });
    const hour10Index = await averageTable.locator('thead th').evaluateAll(cells => cells.findIndex(cell => cell.textContent.trim() === '10:00'));
    assert.ok(hour10Index > 2);
    const assertNewerArchive = async () => {
        assert.match(await average('Jueves').locator('td').nth(1).innerText(), /185[.,]00/);
        assert.match(await average('Jueves').locator('td').nth(2).innerText(), /18[.,]5/);
        assert.equal(await average('Jueves').locator('td').nth(hour10Index).innerText(), '100.0%');
    };
    await assertNewerArchive();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText('Guardando cambios...', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await snapshot()).configs['2026-10'].realSalesData['2026-10-08'].importedAt, '2026-10-18T12:00:00Z');
    await page.reload(); await readyConfig(); await assertNewerArchive();
    result.observations.newerArchive = { sales: 300, txs: 30, hourlyParticipation10: 100, persistedAfterGoalSave: true, unsavedGoalSurvivedImport: true };
    pass('El archivo mensual más reciente conserva total, 100% horario y procedencia al guardar metas y recargar');
    assert.deepEqual(errors, []);
    assert.deepEqual(blockedRequests, []);
    result.status = 'PASS';
} catch (error) {
    result.status = 'FAIL'; result.error = String(error);
    await page?.screenshot({ path: resolve(output, 'fallo.png'), fullPage: true }).catch(() => {});
    throw error;
} finally {
    await writeFile(resolve(output, 'resultado.json'), JSON.stringify(result, null, 2));
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
