import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '../tmp/competition-test-runtime/node_modules/playwright/index.mjs');
const client = `
const admins=[{id:'admin-one',email:'manager@example.test',status:'active',stores:{name:'Tienda Centro',is_active:true}},{id:'admin-two',email:'inactive@example.test',status:'inactive',stores:{name:'Tienda Norte',is_active:false}}];
window.qa={calls:[],fail:false};
export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'superadmin'}}}})},functions:{async invoke(name,{body}){
 window.qa.calls.push(body);
 if(window.qa.fail)return {error:{context:new Response(JSON.stringify({error:body.operation==='update_admin'?'email_already_registered':'account_link_conflict'}))}};
 if(body.operation==='list_admins')return {data:{admins:admins.map(a=>({...a}))}};
 if(body.operation==='create_admin'){admins.push({id:'admin-new',email:body.email,status:'active',stores:{name:'Tienda Centro',is_active:true}});return {data:{created:true}}}
 if(body.operation==='update_admin'){admins.find(a=>a.id===body.userId).email=body.email;return {data:{updated:true,email:body.email}}}
 if(body.operation==='delete_admin'){admins.splice(admins.findIndex(a=>a.id===body.userId),1);return {data:{deleted:true}}}
 return {data:{deleted:true}};
}}};`;
const firestore = `
const db={};export const getFirestore=()=>db;
export const collection=(_db,name)=>({name});export const query=value=>value;export const where=()=>({});
const snapshot=rows=>({docs:rows.map(row=>({id:row.id,data:()=>row}))});
export const onSnapshot=(_query,callback)=>{callback(snapshot([{id:'store-one',name:'Tienda Centro',ciudad:'Lima'}]));return()=>{}};
export const getDocs=async()=>snapshot([{id:'staff-one',name:'Colaborador',lastName:'Prueba',email:'staff@example.test',uid:'staff-user',storeId:'store-one',modality:'Full-Time'}]);
export const addDoc=async()=>({});export const doc=()=>({});export const setDoc=async()=>({});export const deleteDoc=async()=>({});export const updateDoc=async()=>({});`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {ToastContainer,toast} from 'react-toastify';window.qaDismiss=()=>toast.dismiss();import Dashboard from './src/components/SuperAdminDashboard.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Dashboard/><ToastContainer autoClose={false}/></BrowserRouter>);`, loader: 'jsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'isolated-account-transport', setup(b) {
    b.onLoad({ filter: /lib[\\/]supabase[\\/]client\.js$/ }, () => ({ contents: client, loader: 'js' }));
    b.onLoad({ filter: /lib[\\/]supabase[\\/]firestoreCompat\.js$/ }, () => ({ contents: firestore, loader: 'js' }));
    b.onLoad({ filter: /contexts[\\/]AuthContext\.jsx$/ }, () => ({ contents: "export const useAuth=()=>({currentUser:{email:'superadmin@example.test'},logout:async()=>{}});", loader: 'js' }));
  } }],
});
const index = await readFile('build/index.html', 'utf8');
const cssPath = index.match(/href="(\/assets\/[^" ]+\.css)"/)[1];
const css = await readFile(`build${cssPath}`, 'utf8');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css : '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
await mkdir('output/superadmin-accounts-qa', { recursive: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading', { name: 'Administradores registrados (2)' }).waitFor();
    const panel = page.getByRole('region', { name: 'Administradores registrados (2)' });
    await panel.getByLabel('Buscar por correo, nombre o tienda').fill('Norte');
    assert.equal(await panel.getByRole('article').count(), 1);
    await panel.getByLabel('Buscar por correo, nombre o tienda').fill('');
    await panel.getByRole('button', { name: 'Editar acceso' }).first().click();
    await panel.getByLabel('Correo electrónico').fill('edited@example.test');
    await panel.getByRole('button', { name: 'Guardar acceso' }).click();
    await panel.getByRole('heading', { name: 'edited@example.test' }).waitFor();
    let writes = await page.evaluate(() => window.qa.calls.filter(c => c.operation === 'update_admin'));
    assert.equal(Object.hasOwn(writes[0], 'password'), false);
    await panel.getByRole('button', { name: 'Editar acceso' }).first().click();
    await panel.getByLabel('Nueva contraseña').fill('Synthetic-New-Password-123!');
    await panel.getByRole('button', { name: 'Guardar acceso' }).click();
    await page.waitForFunction(() => window.qa.calls.filter(c => c.operation === 'update_admin').length === 2);
    writes = await page.evaluate(() => window.qa.calls.filter(c => c.operation === 'update_admin'));
    assert.equal(writes[1].password, 'Synthetic-New-Password-123!');
    await panel.getByRole('button', { name: 'Actualizar lista' }).click();
    await panel.getByRole('heading', { name: 'edited@example.test' }).waitFor();
    await panel.getByRole('button', { name: 'Editar acceso' }).first().click();
    assert.equal(await panel.getByLabel('Nueva contraseña').inputValue(), '');
    await page.evaluate(() => { window.qa.fail = true; });
    await panel.getByLabel('Correo electrónico').fill('duplicate@example.test');
    await panel.getByRole('button', { name: 'Guardar acceso' }).click();
    await page.getByText('Este correo ya pertenece a otra cuenta.', { exact: true }).waitFor();
    assert.equal(await panel.getByLabel('Correo electrónico').inputValue(), 'duplicate@example.test');
    await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Eliminar definitivo', exact: true }).click();
    await page.getByText(/No se pudo eliminar el usuario por completo: La cuenta tiene vínculos inconsistentes/).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Colaborador Prueba' }).count(), 1);
    await page.evaluate(() => { window.qa.fail = false; });
    await page.getByRole('button', { name: 'Desvincular Correo' }).click();
    await page.getByText('Correo y acceso desvinculados', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Desvincular Correo' }).count(), 0);
    await page.getByRole('button', { name: 'Eliminar definitivo', exact: true }).click();
    await page.getByText('No se encontraron colaboradores', { exact: true }).waitFor();
    await page.evaluate(() => window.qaDismiss());
    await page.waitForTimeout(700);
    await page.getByPlaceholder('admin@empresa.com').fill('created@example.test');
    await page.getByPlaceholder('Min. 6 caracteres').fill('Synthetic-Creation-123!');
    await page.getByRole('combobox').first().selectOption('store-one');
    await page.getByRole('button', { name: 'Confirmar Creación de Administrador' }).click();
    await page.getByRole('heading', { name: 'Administradores registrados (3)' }).waitFor();
    await page.getByRole('heading', { name: 'created@example.test' }).waitFor();
    const updatedPanel = page.getByRole('region', { name: 'Administradores registrados (3)' });
    await page.evaluate(() => { window.qa.fail = true; });
    await updatedPanel.getByRole('button', { name: 'Actualizar lista' }).click();
    await updatedPanel.getByRole('alert').waitFor();
    await page.evaluate(() => { window.qa.fail = false; });
    await updatedPanel.getByRole('button', { name: 'Actualizar lista' }).click();
    await updatedPanel.getByRole('heading', { name: 'created@example.test' }).waitFor();
    await updatedPanel.getByLabel('Buscar por correo, nombre o tienda').fill('created@example.test');
    const beforeDelete = await page.evaluate(() => window.qa.calls.filter(c => c.operation === 'delete_admin').length);
    page.removeAllListeners('dialog');
    page.once('dialog', (dialog) => dialog.dismiss());
    await updatedPanel.getByRole('button', { name: 'Eliminar administrador' }).click();
    assert.equal(await page.evaluate(() => window.qa.calls.filter(c => c.operation === 'delete_admin').length), beforeDelete);
    page.on('dialog', (dialog) => dialog.accept());
    await page.evaluate(() => { window.qa.fail = true; });
    await updatedPanel.getByRole('button', { name: 'Eliminar administrador' }).click();
    await page.getByText('La cuenta tiene vínculos inconsistentes con otros perfiles. No se realizó ningún cambio.', { exact: true }).waitFor();
    assert.equal(await updatedPanel.getByRole('heading', { name: 'created@example.test' }).count(), 1);
    await page.evaluate(() => { window.qa.fail = false; });
    await updatedPanel.getByRole('button', { name: 'Eliminar administrador' }).click();
    await page.getByRole('heading', { name: 'Administradores registrados (2)' }).waitFor();
    const finalPanel = page.getByRole('region', { name: 'Administradores registrados (2)' });
    assert.equal(await finalPanel.getByRole('heading', { name: 'created@example.test' }).count(), 0);
    await finalPanel.getByLabel('Buscar por correo, nombre o tienda').fill('');
    await page.evaluate(() => window.qaDismiss());
    await finalPanel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await finalPanel.screenshot({ path: `output/superadmin-accounts-qa/${width}.png` });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: desktop/mobile admin list, search, email/password edits, preserved password, refresh, duplicate errors, unlinking and deletion with actual dashboard components');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
