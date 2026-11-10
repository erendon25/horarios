// Real suggestion page, exact report names, isolated storage and loopback-only transport.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { PROTECTED_SUGGESTIVE_PRODUCTS } from '../src/services/suggestiveSalesDefaults.js';
const moduleName = process.env.PLAYWRIGHT_MODULE || resolve('tmp/competition-test-runtime/node_modules/playwright/index.mjs');
const { chromium } = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const output = resolve('output/suggestive-revenue');
await mkdir(output, { recursive: true });
const channels = ['SALÓN', 'DRIVE THRU', 'SERV. FILA', 'SERV. AUTO'];
const exactName = 'VS BORDE EXACTO';
const port = Number(process.env.SUGGESTIVE_QA_PORT || 4182);
const base = `http://127.0.0.1:${port}`;
const bootstrap = `
const key='qa_suggestive_editable_v4';
const productSales=[
 {name:'VS BORDE EXACTO',hour:9,channel:'SERV. FILA',quantity:5},
 {name:'VS BORDE EXACTO',hour:9,channel:'SERV. AUTO',quantity:7},
 {name:'VS BORDE EXACTO',hour:9,channel:'DRIVE THRU',quantity:3},
 {name:'VS BORDE EXACTO',hour:9,channel:'SALÓN',quantity:2},
 {name:'VS BORDE EXACTO EXTRA',hour:9,channel:'SERV. FILA',quantity:99},
 {name:'vs borde exacto',hour:9,channel:'SERV. FILA',quantity:8},
 {name:'VS BORDE EXACTO.',hour:9,channel:'SERV. FILA',quantity:9},
 {name:'VS BORDE EXACTO',hour:9,channel:'DELIVERY',quantity:100},
 {name:'VS BORDE EXACTO',hour:9,channel:'CANAL NUEVO',quantity:200}
];
const day=(date,extra={})=>({store_id:'qa-store',sales_date:date,sales_amount:10000,transactions:999999,hourly_data:{9:{'SERV. FILA':1000,'SALÓN':8500,'DRIVE THRU':500,DELIVERY:0,'CANAL NUEVO':0}},suggestive_products:{chosen:{9:{'SERV. FILA':999}}},...extra});
const configuration={calculationVersion:'revenue-v1',participation:.3,products:[...${JSON.stringify(PROTECTED_SUGGESTIVE_PRODUCTS.map(product => ({ ...product, locked: true })))},{id:'chosen',label:'Producto ejemplo',price:29.9,enabled:true}],channels:[{id:'SERV. FILA',enabled:true,positions:['CAJA']},{id:'SALÓN',enabled:false,positions:[]},{id:'DELIVERY',enabled:true,positions:[]},{id:'CANAL NUEVO',enabled:true,positions:[]}]};
const initial={writes:[],configurations:{'suggestive_sales_goals:2026-10':configuration},history:[day('2026-10-17'),day('2026-10-18',{source_data:{productSales,productSalesRecorded:true}}),day('2026-10-19',{source_data:{productSales:[],productSalesRecorded:true}})]};
window.__suggestiveQA={get state(){return JSON.parse(localStorage.getItem(key)||JSON.stringify(initial))},save(value){localStorage.setItem(key,JSON.stringify(value))}};
`;
const transport = `export const db={};export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=(...values)=>values;export const query=(ref,...filters)=>({...ref,filters});
const snap=(id,data)=>({id,exists:()=>data!=null,data:()=>data});
const people=[{id:'a',name:'Ana',position:'TEAM MEMBER',status:'active',storeId:'qa-store'},{id:'b',name:'Bruno',position:'TEAM MEMBER',status:'active',storeId:'qa-store'}];
const schedules=people.map(person=>({id:person.id+'_2026-10-12_to_2026-10-18',staffId:person.id,storeId:'qa-store',weekKey:'2026-10-12_to_2026-10-18',sunday:{start:'09:00',end:'10:00',position:'SERV. FILA'}}));
export async function getDocs(ref){return {docs:(ref.path==='staff_profiles'?people:ref.path==='schedules'?schedules:[]).map(value=>snap(value.id,value))}}
export async function getDoc(ref){let value=null;if(ref.path.includes('/sales_config/'))value={monthlyData:Object.fromEntries(Array.from({length:31},(_,index)=>[index+1,{vta:index===17?32399.83:0}]))};if(ref.path.includes('/config/'))value=window.__suggestiveQA.state.configurations[ref.path.split('/').at(-1)];return snap(ref.path.split('/').at(-1),value)}
export async function setDoc(ref,data){const state=window.__suggestiveQA.state;state.configurations[ref.path.split('/').at(-1)]=data;state.writes.push({type:'configuration',path:ref.path,data});window.__suggestiveQA.save(state)}
`;
const client = `export const supabase={from(table){let rows=table==='sales_daily_history'?window.__suggestiveQA.state.history:[];return {select(){return this},eq(key,value){rows=rows.filter(row=>row[key]===value);return this},in(key,values){rows=rows.filter(row=>values.includes(row[key]));return this},order(key,options={}){rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key]))*(options.ascending===false?-1:1));return this},limit(count){rows=rows.slice(0,count);return this},then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject)}}},async rpc(name,args){const state=window.__suggestiveQA.state;if(name==='save_sales_history_batch'){for(const value of args.p_days){const row={store_id:args.p_store_id,sales_date:value.date,sales_amount:value.totalSales,transactions:value.totalTxs,hourly_data:value.hourlyData,suggestive_products:value.suggestiveProducts,source_data:{...value},updated_at:new Date().toISOString()};state.history=state.history.filter(previous=>previous.sales_date!==row.sales_date);state.history.push(row)}state.writes.push({type:'import',name,args});window.__suggestiveQA.save(state);return {data:args.p_days.length,error:null}}if(name!=='publish_suggestive_sales_goals')throw Error('Unexpected local RPC: '+name);state.writes.push({type:'publication',name,args});window.__suggestiveQA.save(state);return {data:args.p_rows.length,error:null}}};`;
const auth = `export const useAuth=()=>({userData:{storeId:'qa-store'},currentUser:{uid:'qa-admin'},userRole:'admin'});`;
const entry = `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Page from'./src/components/SuggestiveSalesGoalsPage.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', plugins: [{ name: 'isolated-exact-products', setup(builder) {
    builder.onLoad({ filter: /lib[\\/]supabase[\\/]firestoreCompat\.js$/ }, () => ({ contents: transport, loader: 'js' }));
    builder.onLoad({ filter: /lib[\\/]supabase[\\/]client\.js$/ }, () => ({ contents: client, loader: 'js' }));
    builder.onLoad({ filter: /contexts[\\/]AuthContext\.jsx$/ }, () => ({ contents: auth, loader: 'js' }));
    builder.onLoad({ filter: /src[\\/]supabase\.js$/ }, () => ({ contents: 'export const db={};', loader: 'js' }));
} }] });
const css = (await postcss([tailwind({ content: ['./src/components/SuggestiveSalesGoalsPage.jsx', './src/components/WeeklySuggestiveSalesReport.jsx'] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
const server = createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); }
    else if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
    else { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script>${bootstrap}</script><script src="/app.js"></script></body></html>`); }
});
let browser, page;
const errors = [], passed = [], blockedRequests = [];
const pass = name => { passed.push(name); console.log('PASS: ' + name); };
const results = { status: 'RUNNING', passed, errors, blockedRequests };
try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const chrome = process.env.CHROMIUM_PATH || (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
    browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Lima' });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base) return route.continue(); blockedRequests.push(url.origin); return route.abort(); });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const state = () => page.evaluate(() => window.__suggestiveQA.state);
    const writes = async type => (await state()).writes.filter(row => !type || row.type === type);
    const waitUntil = async (check, message) => {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
            if (await check()) return;
            await new Promise(resolve => setTimeout(resolve, 80));
        }
        throw Error(message);
    };
    const configuration = async (month = '2026-10') => (await state()).configurations[`suggestive_sales_goals:${month}`];
    const customName = () => page.locator('input[aria-label^="Nombre exacto en el reporte de "]'
        + PROTECTED_SUGGESTIVE_PRODUCTS.map(product => `:not([aria-label="Nombre exacto en el reporte de ${product.label}"])`).join(''));
    const customCard = async () => page.getByRole('article', { name: `Resultado diario de ${await customName().inputValue()}`, exact: true });
    const dailySection = () => page.getByRole('heading', { name: '3. Revisa la meta diaria', exact: true }).locator('xpath=ancestor::section');
    const channelRow = channel => dailySection().getByRole('row').filter({ has: page.getByRole('cell', {
        name: channel === 'SERV. FILA' ? 'Módulo (Serv. Fila)' : channel, exact: true }) }).first();
    const ready = async () => {
        await page.getByRole('button', { name: 'Guardar configuración', exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelector('fieldset') && !document.querySelector('fieldset').disabled);
    };
    const setDate = async date => page.getByLabel('Fecha de evaluación', { exact: true }).fill(date);
    const productCell = async (table, row, name) => {
        const headers = await table.getByRole('columnheader').evaluateAll(nodes => nodes.map(node => [...node.childNodes]
            .filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('').trim()));
        const index = headers.indexOf(name);
        assert.notEqual(index, -1, `Product column ${name} must exist`);
        return row.getByRole('cell').nth(index);
    };
    const dailyValue = async label => (await customCard()).locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText();
    const checkActual = async (count, missing = false) => waitUntil(async () => {
        const text = await dailyValue('Vendidos registrados');
        return missing ? /Sin registro|Sin detalle/i.test(text) : text === String(count);
    }, `Expected ${missing ? 'missing report detail' : count + ' exact recorded units'}`);
    const checkTarget = async count => waitUntil(async () => await dailyValue('Meta del día') === String(count), `Expected custom daily goal ${count}`);
    const checkDefaults = async () => {
        for (const product of PROTECTED_SUGGESTIVE_PRODUCTS) {
            const input = page.getByLabel(`Nombre exacto en el reporte de ${product.label}`, { exact: true });
            assert.equal(await input.inputValue(), product.reportName);
            assert.equal(await input.evaluate(node => node.readOnly), false, 'Saved legacy locks must not prevent editing');
            assert.equal(await page.getByRole('button', { name: `Quitar producto ${product.label}`, exact: true }).isEnabled(), true);
        }
    };
    const waitSaved = async (check, month = '2026-10') => waitUntil(async () => {
        const current = await state();
        const monthly = current.configurations[`suggestive_sales_goals:${month}`];
        const defaults = current.configurations['suggestive_sales_goals:defaults'];
        return Boolean(monthly && defaults && check(monthly) && check(defaults));
    }, 'Expected automatic configuration writes to both the month and defaults');
    const noPublication = async () => assert.equal((await writes('publication')).length, 0, 'No publication RPC before an explicit click');

    await page.goto(base); await ready();
    await page.getByLabel('Mes objetivo', { exact: true }).fill('2026-10'); await ready();
    await checkDefaults();
    for (const product of PROTECTED_SUGGESTIVE_PRODUCTS) assert.equal(await page.getByLabel(`Meta de participación de ${product.label}`, { exact: true }).inputValue(), '30');
    assert.equal(await page.locator('input[aria-label^="Nombre exacto en el reporte de "]').count(), 6);
    assert.equal(await customName().inputValue(), '', 'A legacy custom label is not guessed as a literal report name');
    assert.equal(await page.locator('input[type="checkbox"]').count(), 4);
    assert.equal(await page.locator('select[aria-label^="Posición de "]').count(), 0);
    assert.equal(await page.getByLabel('Semana del reporte de venta sugestiva', { exact: true }).count(), 1);
    assert.deepEqual(await page.locator('input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => input.getAttribute('aria-label'))), channels);
    assert.equal((await writes()).length, 0);
    await noPublication();
    pass('Los cinco productos iniciales guardados son editables y eliminables aunque tengan lock legado; hay sólo cuatro canales evaluables');

    await customName().fill(exactName);
    for (const product of PROTECTED_SUGGESTIVE_PRODUCTS) await page.getByLabel(`Precio de ${product.label}`, { exact: true }).fill('29.90');
    await setDate('2026-10-18'); await checkTarget(33); await checkActual(5);
    const channelTable = dailySection().locator('table').first();
    const chosenCell = await productCell(channelTable, channelRow('SERV. FILA'), exactName);
    assert.equal(await chosenCell.locator('strong').innerText(), '33');
    const assignedTable = dailySection().locator('table').last();
    for (const [person, expected] of [['Ana', 17], ['Bruno', 16]]) {
        const row = assignedTable.getByRole('row').filter({ has: page.getByRole('cell', { name: person, exact: true }) });
        assert.equal(await (await productCell(assignedTable, row, exactName)).innerText(), String(expected));
    }
    await waitSaved(config => config.products.length === 6 && config.products.find(product => product.id === 'chosen')?.reportName === exactName);
    await noPublication();
    pass('El producto custom elegido conserva meta 33 y reparto 17+16 junto a los cinco defaults, sin publicación automática');

    await customName().fill('VS BORDE EXACT'); await checkActual(0);
    await customName().fill('vs borde exacto'); await checkActual(8);
    await customName().fill('VS BORDE EXACTO.'); await checkActual(9);
    await customName().fill(exactName); await checkActual(5);
    await noPublication();
    pass('El empalme literal distingue nombres parecidos, mayúsculas y puntuación sin sumar las 99 unidades del nombre parecido');

    for (const channel of ['DRIVE THRU', 'SERV. AUTO', 'SALÓN']) await page.getByLabel(channel, { exact: true }).check();
    await checkActual(17);
    for (const [channel, quantity] of [['DRIVE THRU', 3], ['SERV. FILA', 5], ['SERV. AUTO', 7], ['SALÓN', 2]]) {
        const cell = await productCell(dailySection().locator('table').first(), channelRow(channel), exactName);
        assert.match(await cell.innerText(), new RegExp('Vendido:\\s*' + quantity + '(?:\\s|$)'));
    }
    for (const channel of ['DRIVE THRU', 'SERV. AUTO', 'SALÓN']) await page.getByLabel(channel, { exact: true }).uncheck();
    await setDate('2026-10-19'); await checkActual(0);
    await setDate('2026-10-17'); await checkActual(0, true);
    await setDate('2026-10-18'); await checkActual(5);
    await noPublication();
    pass('Auto, Drive, Fila y Salón permanecen separados; una venta cero verificada se distingue de un día sin registro');

    const protectedName = PROTECTED_SUGGESTIVE_PRODUCTS[0].label;
    await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).fill('35');
    await customName().fill('vs borde exacto');
    await page.getByLabel('Meta de participación de vs borde exacto', { exact: true }).fill('20');
    await checkActual(8); await checkTarget(22);
    await waitSaved(config => config.products.find(product => product.id === 'chosen')?.participation === .20
        && config.products.find(product => product.id === PROTECTED_SUGGESTIVE_PRODUCTS[0].id)?.participation === .35);
    await noPublication();
    await page.reload(); await ready(); await setDate('2026-10-18');
    await checkDefaults(); assert.equal(await customName().inputValue(), 'vs borde exacto');
    assert.equal(await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).inputValue(), '35');
    await checkActual(8); await checkTarget(22);
    await customName().fill(exactName); await page.getByLabel(`Meta de participación de ${exactName}`, { exact: true }).fill('30');
    await checkTarget(33); await checkActual(5);
    await waitSaved(config => config.products.find(product => product.id === 'chosen')?.reportName === exactName
        && config.products.find(product => product.id === 'chosen')?.participation === .30);
    pass('El guardado automático persiste ambos documentos, nombre literal y metas individuales; recargar conserva 35%/20% y el reparto recalculado');

    const beforeUpload = await configuration();
    const csv = 'Pedido;FechaPedido;Documento;Producto;Cantidad;Total;CANAL\r\np20;2026-10-20 10:00:00;B001-20;VS BORDE EXACTO;2;20;EN LOCAL\r\n';
    await page.locator('input[type="file"]').setInputFiles({ name: 'reporte-nuevo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByText(/reporte-nuevo\.csv: 1 jornadas cargadas/).waitFor();
    assert.equal((await writes('import')).length, 1);
    await checkDefaults(); assert.equal(await customName().inputValue(), exactName);
    assert.equal(await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).inputValue(), '35');
    assert.deepEqual((await configuration()).products, beforeUpload.products);
    assert.deepEqual((await configuration()).channels, beforeUpload.channels);
    assert.ok((await state()).history.some(day => day.sales_date === '2026-10-20'));
    assert.ok((await state()).history.some(day => day.sales_date === '2026-10-18'));
    await page.reload(); await ready(); await setDate('2026-10-18'); await checkActual(5); await checkTarget(33);
    await noPublication();
    pass('Cargar un nuevo reporte real CSV y recargar conserva cinco defaults, custom, metas, precios, canales y jornadas anteriores');

    await page.getByLabel('Mes objetivo', { exact: true }).fill('2026-11'); await ready();
    await checkDefaults(); assert.equal(await customName().inputValue(), exactName);
    assert.equal(await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).inputValue(), '35');
    await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).fill('');
    assert.equal(await page.getByRole('button', { name: 'Guardar configuración', exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).inputValue(), '');
    const incompleteDraftBeforeReload = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
        .filter(([key]) => key.startsWith('suggestive_sales_draft_v1:') && key.endsWith(':2026-11')).map(([key, value]) => [key, JSON.parse(value)])));
    assert.equal(Object.values(incompleteDraftBeforeReload)[0].dirty, true);
    assert.equal(Object.values(incompleteDraftBeforeReload)[0].draft.products[0].participation, '');
    await page.reload(); await ready();
    await page.getByLabel('Mes objetivo', { exact: true }).fill('2026-11'); await ready();
    assert.equal(await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'Publicar metas del mes', exact: true }).isDisabled(), true);
    await page.getByLabel(`Meta de participación de ${protectedName}`, { exact: true }).fill('35');
    await waitSaved(config => config.products.find(product => product.id === PROTECTED_SUGGESTIVE_PRODUCTS[0].id)?.participation === .35, '2026-11');
    await page.getByLabel('Mes objetivo', { exact: true }).fill('2026-10'); await ready(); await setDate('2026-10-18');
    await checkDefaults(); await checkActual(5); await checkTarget(33); await noPublication();
    pass('Un mes nuevo hereda la configuración; un porcentaje temporalmente vacío sobrevive en el borrador y bloquea publicar hasta completarlo');

    await page.screenshot({ path: resolve(output, 'nombre-exacto-desktop.png'), fullPage: true });
    await noPublication();
    await page.getByRole('button', { name: 'Publicar metas del mes', exact: true }).click();
    await page.getByText('2 asignaciones publicadas.', { exact: true }).waitFor();
    const publication = (await writes('publication'))[0].args;
    assert.equal((await writes('publication')).length, 1);
    assert.equal(publication.p_rows.length, 2);
    assert.equal(publication.p_rows.reduce((sum, row) => sum + row.goals.chosen, 0), 33);
    assert.deepEqual(publication.p_rows.map(row => row.goals.chosen).sort((a, b) => a - b), [16, 17]);
    assert.ok(publication.p_rows.every(row => row.channel === 'SERV. FILA'));
    assert.equal(publication.p_targets.calculation.products.find(product => product.id === 'chosen').reportName, exactName);
    assert.equal(publication.p_targets.calculation.products.find(product => product.id === PROTECTED_SUGGESTIVE_PRODUCTS[0].id).participation, .35);
    pass('Sólo el clic explícito publica en el transporte ficticio: custom chosen=33, reparto17+16 y metas individuales serializadas');

    await page.getByRole('button', { name: `Quitar producto ${exactName}`, exact: true }).click();
    await waitSaved(config => config.products.length === 5 && !config.products.some(product => product.id === 'chosen'));
    await page.reload(); await ready(); await checkDefaults();
    assert.equal(await customName().count(), 0);
    await page.getByLabel('Nombre exacto del nuevo producto', { exact: true }).fill(exactName);
    await page.getByLabel('Precio del nuevo producto', { exact: true }).fill('29.90');
    await page.getByRole('button', { name: 'Agregar producto', exact: true }).click();
    await waitSaved(config => config.products.length === 6 && config.products.some(product => product.reportName === exactName));
    await setDate('2026-10-18'); await checkActual(5); await checkTarget(33);
    assert.equal((await writes('publication')).length, 1, 'Removing/adding custom rows must never republish');
    assert.ok((await configuration()).channels.every(channel => !channel.positions?.length));
    pass('Quitar y volver a agregar el custom se guarda automáticamente sin modificar los demás productos ni volver a publicar');
    await page.getByRole('button', { name: `Quitar producto ${protectedName}`, exact: true }).click();
    await waitSaved(config => config.products.length === 5 && !config.products.some(product => product.id === PROTECTED_SUGGESTIVE_PRODUCTS[0].id));
    await page.reload(); await ready(); await setDate('2026-10-18');
    assert.equal(await page.getByLabel(`Nombre exacto en el reporte de ${protectedName}`, { exact: true }).count(), 0);
    await checkActual(5); await checkTarget(33);
    assert.equal((await writes('publication')).length, 1, 'Removing an initial product must never republish');
    pass('Quitar un producto inicial persiste al recargar y conserva el cálculo33 y los vendidos5 del producto elegido');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, 'nombre-exacto-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []);
    results.status = 'PASS'; results.verified = { exactSold: 5, similarNotIncluded: 99, caseSensitiveSold: 8,
        punctuationSold: 9, exactAcrossEligibleChannels: 17, target: 33, split: [17, 16], channels,
        initialProducts: PROTECTED_SUGGESTIVE_PRODUCTS.map(product => product.reportName), defaultTargets: .30,
        individualTargetsPersist: true, automaticSaveBothDocuments: true, uploadPreservesConfiguration: true,
        incompleteDraftSurvivesReload: true, noPositionSelectors: true, customRemovalPreservesDefaults: true,
        initialProductRemovalPersists: true, publicationRequiresExplicitClick: true };
} catch (error) {
    results.status = 'FAIL'; results.error = String(error);
    results.cachedDraftsAtFailure = await page?.evaluate(() => Object.fromEntries(Object.entries(localStorage)
        .filter(([key]) => key.startsWith('suggestive_sales_draft_v1:')).map(([key, value]) => [key, JSON.parse(value)]))).catch(() => null);
    await page?.screenshot({ path: resolve(output, 'fallo.png'), fullPage: true }).catch(() => {});
    throw error;
} finally {
    await writeFile(resolve(output, 'resultado.json'), JSON.stringify(results, null, 2));
    await browser?.close(); await new Promise(resolve => server.close(resolve));
}
