// Isolated regression test: real editor, fake backend and fictional staff only.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'schedule-drafts-qa-'));
const root = process.cwd();
const mock = `
const db = {};
export const getFirestore = () => db;
export const doc = (_, ...path) => ({path});
export const collection = doc;
export const where = (...args) => args;
export const query = (ref, ...filters) => ({...ref, filters});
const delay = () => new Promise(resolve => setTimeout(resolve, 250));
const staff = {id:'alice',name:'Alicia',lastName:'Prueba',status:'active',modality:'Full-Time',position:'COLABORADOR',skills:['Servicio']};
const read = () => JSON.parse(sessionStorage.getItem('mock_server') || '{}');
const snap = (id, data) => ({id, exists:()=>!!data, data:()=>data});
const list = docs => ({docs, size:docs.length, forEach: fn=>docs.forEach(fn)});
export async function getDoc(ref) {
 const [type,id] = ref.path;
 if(type === 'users') return snap(id,{storeId:'store-1'});
 if(type === 'schedules') {
   const value = read()[id] || {monday:{start:'10:00',end:'18:45',position:'Servicio'}};
   await delay(); return snap(id,value);
 }
 return snap(id,null);
}
export async function getDocs(ref) {
 if(ref.path[0] === 'staff_profiles') return list([snap('alice',staff)]);
 if(ref.path[0] === 'schedules') await delay();
 return list([]);
}
export const onSnapshot = (ref, next) => {
 if(ref.path[0] === 'schedule_requests') next(list([]));
 else next(snap('projection',{positions:['Servicio'],requirements:{}}));
 return ()=>{};
};
export const setDoc = async()=>{};
export const writeBatch = () => {
 const pending = {};
 return {set:(ref,value)=>{pending[ref.path[1]]=value},commit:async()=>{
  await new Promise(resolve=>setTimeout(resolve,600));
  if(sessionStorage.getItem('mock_fail')) throw new Error('Simulated save failure');
  sessionStorage.setItem('mock_server',JSON.stringify({...read(),...pending}));
 }};
};
`;
const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom'; import Editor from './src/components/WeeklyScheduleEditor.jsx'; createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter><Editor/></MemoryRouter></React.StrictMode>);`, loader: 'jsx', resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    plugins: [{ name: 'isolated-backend', setup(builder) {
        builder.onResolve({ filter: /(?:firestoreCompat|AuthContext)$/ }, args => ({ path: args.path.includes('AuthContext') ? 'auth' : 'database', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'auth' ? `const user={uid:'manager-1'}; export const useAuth=()=>({currentUser:user,userRole:'admin'});` : mock, loader: 'js' }));
    } }],
});
const component = await readFile(path.join(root, 'src/components/WeeklyScheduleEditor.jsx'), 'utf8');
const css = await postcss([tailwind({ content: [{ raw: component }, './src/components/ScheduleHeatmapMatrix.jsx', './src/components/WeeklyScheduleExcelButton.jsx'], theme: {}, plugins: [] })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
const server = createServer((req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const date = page.locator('input[type=date]').first();
    await date.fill('2026-09-21');
    const day = page.locator('select').filter({ has: page.locator('option[value=saturday]') });
    await day.selectOption('saturday');
    await page.getByTitle('Entrada 1', { exact: true }).fill('09:15');
    await page.getByTitle('Salida 1', { exact: true }).fill('19:00');
    await day.selectOption('sunday');
    await page.getByTitle('Entrada 1', { exact: true }).fill('16:15');
    await page.getByTitle('Salida 1', { exact: true }).fill('01:00');
    // No debounce wait: reload directly after the input event.
    await page.reload();
    await page.getByText('Borrador recuperado en este navegador', { exact: true }).waitFor();
    assert.equal(await date.inputValue(), '2026-09-21');
    await day.selectOption('saturday');
    assert.equal(await page.getByTitle('Entrada 1', { exact: true }).inputValue(), '09:15');
    await day.selectOption('sunday');
    assert.equal(await page.getByTitle('Salida 1', { exact: true }).inputValue(), '01:00');
    // Wait for the slow remote load to finish; it must not overwrite the draft.
    await page.getByRole('button', { name: /^Guardar/ }).click();
    await page.getByTitle('Entrada 1', { exact: true }).fill('17:15');
    await page.getByRole('button', { name: /^Guardar/ }).waitFor();
    await page.getByText(/1 colaborador\(es\) con cambios pendientes/).waitFor();
    await page.reload();
    await day.selectOption('sunday');
    await page.getByRole('button', { name: /^Guardar/ }).waitFor();
    assert.equal(await page.getByTitle('Entrada 1', { exact: true }).inputValue(), '17:15');
    await day.selectOption('saturday');
    // The first save included Saturday; the second draft includes only Sunday.
    await page.getByTitle('Entrada 1', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('input[title="Entrada 1"]').value === '09:15');
    await page.getByRole('button', { name: /^Guardar/ }).click();
    await page.getByRole('button', { name: 'Guardado', exact: true }).waitFor();
    await page.getByText('Sin cambios pendientes de sincronizar', { exact: true }).waitFor();
    // Failed save leaves the persisted local copy recoverable.
    await day.selectOption('sunday');
    await page.getByTitle('Entrada 1', { exact: true }).fill('18:15');
    await page.evaluate(() => sessionStorage.setItem('mock_fail', '1'));
    await page.getByRole('button', { name: /^Guardar/ }).click();
    await page.getByText(/Error al guardar en el servidor/).waitFor();
    await page.reload();
    await day.selectOption('sunday');
    assert.equal(await page.getByTitle('Entrada 1', { exact: true }).inputValue(), '18:15');
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.screenshot({ path: path.join(output, 'borrador-recuperado.png'), fullPage: true });
    // An old unscoped draft is not silently applied, and can be recovered safely.
    const recovery = await browser.newPage({ viewport: { width: 390, height: 844 } });
    recovery.on('pageerror', error => errors.push(error.message));
    await recovery.addInitScript(() => {
        localStorage.setItem('schedule_editor_week:manager-1:store-1', '2026-09-21');
        localStorage.setItem('draft_schedule_2026-09-21_to_2026-09-27', JSON.stringify({
            alice: { saturday: { start: '09:15', end: '19:00', position: 'Servicio' }, sunday: { start: '16:15', end: '01:00', position: 'Servicio' } },
            unauthorized: { saturday: { start: '07:00', end: '12:00' } },
        }));
    });
    await recovery.goto(`http://127.0.0.1:${server.address().port}`);
    await recovery.getByText(/Revisar borrador de la versión anterior/).click();
    assert.equal(await recovery.locator('details li').count(), 2);
    await recovery.getByRole('button', { name: 'Recuperar esta copia como borrador' }).click();
    await recovery.locator('select').filter({ has: recovery.locator('option[value=saturday]') }).selectOption('saturday');
    assert.equal(await recovery.getByTitle('Entrada 1', { exact: true }).inputValue(), '09:15');
    await recovery.screenshot({ path: path.join(output, 'recuperacion-movil.png'), fullPage: true });
    // A browser that rejects storage must visibly warn, not claim protection.
    const blocked = await browser.newPage();
    blocked.on('pageerror', error => errors.push(error.message));
    await blocked.addInitScript(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (key.startsWith('schedule_draft_v2:')) throw new DOMException('Test quota', 'QuotaExceededError');
            return original.call(this, key, value);
        };
    });
    await blocked.goto(`http://127.0.0.1:${server.address().port}`);
    await blocked.getByTitle('Entrada 1', { exact: true }).fill('09:00');
    await blocked.getByRole('alert').filter({ hasText: 'No se pudo proteger el último cambio' }).waitFor();
    assert.equal(await blocked.getByText('Borrador pendiente de proteger', { exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, checks: ['editor real en StrictMode', 'recarga inmediata sábado/domingo', 'semana recordada', 'servidor tardío', 'edición durante guardado', 'guardado fallido', 'recuperación legado en móvil', 'alerta de almacenamiento bloqueado', 'sin errores de render'], output }, null, 2));
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
