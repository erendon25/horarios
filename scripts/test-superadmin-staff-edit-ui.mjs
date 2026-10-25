// Actual SuperAdminDashboard + StaffModal with isolated transport and fictitious staff.
// No production calls or accounts are used by this test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = 'output/staff-delete-store-qa';
await mkdir(output, { recursive: true });
const staff = [
  { id: 'staff-a', storeId: 'store-a', name: 'Persona', lastName: 'A', modality: 'Part-Time', position: 'COLABORADOR', dni: '12345678', status: 'pending' },
  { id: 'staff-b', storeId: 'store-b', name: 'Persona', lastName: 'B', modality: 'Full-Time', position: 'ENTRENADOR', dni: '87654321', status: 'pending' },
];
const stores = [{ id: 'store-a', name: 'Tienda A' }, { id: 'store-b', name: 'Tienda B' }];
const control = { failRead: false, failWrite: false };
const calls = [];
const transport = `
const db={};export const getFirestore=()=>db;
export const collection=(...parts)=>({path:parts.filter(part=>typeof part==='string').join('/')});
export const doc=collection,query=ref=>ref,where=()=>({});
const snap=item=>({id:item.id,data:()=>item});
export const onSnapshot=(_ref,callback)=>{callback({docs:${JSON.stringify(stores)}.map(snap)});return()=>{}};
export const getDocs=async ref=>{const res=await fetch('/qa-staff');if(!res.ok)throw Error('Read failed');return {docs:(await res.json()).map(snap)}};
export const addDoc=()=>{throw Error('Unexpected write')};
export const setDoc=addDoc,updateDoc=addDoc,deleteDoc=addDoc;
`;
const client = `export const supabase={rpc:async(name,args)=>{
 const response=await fetch('/qa-rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});
 return response.json();
}};`;
const auth = `export const useAuth=()=>({currentUser:{uid:'qa-superadmin',email:'qa@example.test'},userData:{storeId:'store-a'},userRole:'superadmin',logout:async()=>{}});`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import SuperAdminDashboard from './src/components/SuperAdminDashboard.jsx';window.__qaToast=[];createRoot(document.getElementById('root')).render(<MemoryRouter><SuperAdminDashboard/></MemoryRouter>);`;
const bundle = await build({
  stdin: { contents: entry, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false,
  format: 'iife', jsx: 'automatic', plugins: [{ name: 'qa-staff-edit-boundaries', setup(builder) {
    builder.onLoad({ filter: /lib\/supabase\/firestoreCompat\.js$/ }, () => ({ contents: transport, loader: 'js' }));
    builder.onLoad({ filter: /lib\/supabase\/client\.js$/ }, () => ({ contents: client, loader: 'js' }));
    builder.onLoad({ filter: /contexts\/AuthContext\.jsx$/ }, () => ({ contents: auth, loader: 'js' }));
    builder.onLoad({ filter: /components\/AdminAccountsPanel\.jsx$/ }, () => ({ contents: 'export default function UnrelatedAccounts(){return null}', loader: 'js' }));
    builder.onLoad({ filter: /react-toastify\/dist\/index\.mjs$/ }, () => ({ contents: "export const toast=Object.fromEntries(['success','error','info'].map(type=>[type,message=>window.__qaToast.push({type,message})]));", loader: 'js' }));
  } }],
});
const css = (await postcss([tailwind({ content: ['./src/components/SuperAdminDashboard.jsx', './src/components/StaffModal.jsx'] })])
  .process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
const json = (response, value) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
const readBody = async request => { let raw = ''; for await (const chunk of request) raw += chunk; return JSON.parse(raw || '{}'); };
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/qa-staff') {
      if (control.failRead) { response.statusCode = 503; return json(response, { error: 'Read failed' }); }
      return json(response, staff);
    }
    if (request.url === '/qa-control') { Object.assign(control, await readBody(request)); return json(response, { ok: true }); }
    if (request.url === '/qa-state') return json(response, { calls, staff });
    if (request.url === '/qa-rpc') {
      const { name, args } = await readBody(request);
      calls.push({ name, args });
      assert.equal(name, 'save_staff_profile');
      assert.equal(args.p_staff_id, 'staff-b');
      assert.equal(args.p_store_id, 'store-b', 'Editing another store must use staff.storeId, never caller store');
      if (control.failWrite) return json(response, { error: { message: 'Guardado rechazado en prueba' } });
      const item = staff.find(person => person.id === args.p_staff_id);
      Object.assign(item, { name: args.p_first_name, lastName: args.p_last_name, dni: args.p_dni, position: args.p_position, modality: args.p_modality });
      return json(response, { data: item.id, error: null });
    }
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bundle.outputFiles[0].text); }
    if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); return response.end(css); }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');
  } catch (error) { response.statusCode = 500; json(response, { error: String(error) }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const passed = [], errors = [], external = [], alerts = [];
let browser, page;
const pass = name => { passed.push(name); console.log(`PASS: ${name}`); };
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 980 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
  await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
  await page.goto(origin);
  const storeFilter = page.locator('select').filter({ has: page.getByRole('option', { name: 'Todas las tiendas', exact: true }) });
  const modalityFilter = page.locator('select').filter({ has: page.getByRole('option', { name: 'Todas las mods.', exact: true }) });
  await storeFilter.selectOption('store-b');
  await modalityFilter.selectOption('Full-Time');
  await page.getByPlaceholder('Buscar por nombre...').fill('Persona');
  await page.getByRole('button', { name: 'Editar información', exact: true }).click();
  await page.getByRole('heading', { name: 'Editar Colaborador', exact: true }).waitFor();
  assert.equal(await page.locator('input[name=lastName]').inputValue(), 'B');
  assert.equal(await page.locator('input[name=dni]').inputValue(), '87654321');
  assert.equal(await page.locator('select[name=position]').inputValue(), 'ENTRENADOR');
  await page.locator('input[name=lastName]').fill('Actualizado');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('heading', { name: 'Persona Actualizado', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Editar Colaborador', exact: true }).count(), 0);
  assert.equal(await storeFilter.inputValue(), 'store-b');
  assert.equal(await modalityFilter.inputValue(), 'Full-Time');
  assert.equal(await page.getByPlaceholder('Buscar por nombre...').inputValue(), 'Persona');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.p_store_id, 'store-b');
  assert.equal(staff[0].lastName, 'A');
  assert.equal(await page.evaluate(() => window.__qaToast.at(-1)?.type), 'success');
  pass('Superadmin edita otra tienda con el modal real, conserva tienda del perfil y filtros, cierra y actualiza el listado');

  await page.request.post(`${origin}/qa-control`, { data: { failWrite: true } });
  await page.getByRole('button', { name: 'Editar información', exact: true }).click();
  await page.locator('input[name=lastName]').fill('No guardado');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button[type=submit]')?.textContent.trim() === 'Guardar');
  assert.equal(alerts.at(-1), 'Guardado rechazado en prueba');
  assert.equal(await page.getByRole('heading', { name: 'Editar Colaborador', exact: true }).count(), 1);
  assert.equal(staff[1].lastName, 'Actualizado');
  assert.equal(await page.evaluate(() => window.__qaToast.length), 1);
  pass('El rechazo del servidor mantiene el modal y los cambios para reintentar, sin modificar el listado confirmado');

  await page.request.post(`${origin}/qa-control`, { data: { failWrite: false, failRead: true } });
  await page.locator('input[name=lastName]').fill('Actualizado de nuevo');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Editar Colaborador', exact: true }).count(), 0);
  assert.equal(staff[1].lastName, 'Actualizado de nuevo');
  assert.equal(await storeFilter.inputValue(), 'store-b');
  assert.equal(await modalityFilter.inputValue(), 'Full-Time');
  assert.equal(await page.evaluate(() => window.__qaToast.at(-1)?.type), 'info');
  await page.request.post(`${origin}/qa-control`, { data: { failRead: false } });
  await page.getByRole('button', { name: 'Actualizar colaboradores', exact: true }).click();
  await page.getByRole('heading', { name: 'Persona Actualizado de nuevo', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  pass('Guardar seguido de fallo al refrescar muestra aviso y reintento; recupera el listado sin perder los filtros');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Editar información', exact: true }).click();
  await page.getByRole('heading', { name: 'Editar Colaborador', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/superadmin-editar-mobile.png` });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(`${output}/superadmin-edit-ui.json`, JSON.stringify({ status: 'PASS', passed, errors, external, calls, scope: 'Real SuperAdminDashboard/StaffModal; isolated HTTP transport with fictitious staff, no production writes.' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: `${output}/superadmin-edit-fallo.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
