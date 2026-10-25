// React hook regression with controlled transport. No backend or production access.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output = 'output/schedule-access-policy-qa';
await mkdir(output, { recursive: true });
const transport = `
export const db = {kind:'isolated-hook-transport'};
export const doc = (...parts) => ({path:parts.slice(1).join('/')});
export const getDoc = async ref => {
  const model = window.__policyHookQA;
  model.reads.push(ref.path);
  const reply = model.replies[ref.path] || {exists:false};
  if(reply.error) throw Error(reply.error);
  return {exists:()=>reply.exists, data:()=>reply.data};
};
export const onSnapshot = (ref,next,error) => {
  const subscription = {path:ref.path,next,error,active:true,unsubscribed:0};
  window.__policyHookQA.subscriptions.push(subscription);
  return () => {subscription.active=false;subscription.unsubscribed+=1;};
};
`;
const bundle = await build({
  stdin: {
    contents: `
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import useScheduleAccessPolicy,{readScheduleAccessPolicy} from './src/hooks/useScheduleAccessPolicy.js';
const model=window.__policyHookQA={subscriptions:[],reads:[],replies:{},snapshots:[],current:null};
function Harness(){
 const [storeId,setStoreId]=useState(undefined);
 const access=useScheduleAccessPolicy(storeId);
 const latest=useRef(access);latest.current=access;
 const view={storeId:storeId??null,policy:access.policy,status:access.status,error:access.error?.message??null};
 model.current=view;model.snapshots.push(JSON.parse(JSON.stringify(view)));
 model.setStore=value=>flushSync(()=>setStoreId(value));
 model.retry=()=>flushSync(()=>latest.current.retry());
 return <pre id="state">{JSON.stringify(view)}</pre>;
}
model.read=readScheduleAccessPolicy;
model.emit=(index,data,exists=true)=>model.subscriptions[index].next({exists:()=>exists,data:()=>data});
model.fail=(index,message)=>model.subscriptions[index].error(Error(message));
flushSync(()=>createRoot(document.getElementById('root')).render(<Harness/>));
`,
    resolveDir: process.cwd(), loader: 'jsx',
  },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  plugins: [{ name: 'policy-hook-isolated-transport', setup(b) {
    b.onLoad({ filter: /lib\/supabase\/firestoreCompat\.js$/ }, () => ({ contents: transport, loader: 'js' }));
  } }],
});
const defaults = { adminOnlyStudyEditing: false, requestsEnabled: true, blockedWeeks: [], blockedDates: [] };
const policyA = { ...defaults, adminOnlyStudyEditing: true, requestsEnabled: false };
const policyB = { ...defaults, blockedDates: ['2026-10-27'] };
const path = id => `stores/${id}/config/schedule_access`;
const passed = [], errors = [], requests = [];
const pass = name => { passed.push(name); console.log(`PASS: ${name}`); };
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const state = () => page.evaluate(() => window.__policyHookQA.current);
  const waitStatus = status => page.waitForFunction(expected => window.__policyHookQA.current.status === expected, status);
  const reply = (storeId, value) => page.evaluate(({key,value}) => { window.__policyHookQA.replies[key]=value; }, {key:path(storeId),value});
  const read = storeId => page.evaluate(async id => {
    try { return { value: await window.__policyHookQA.read(id) }; }
    catch(error){ return { error:error.message,code:error.code }; }
  }, storeId);
  const setStore = storeId => page.evaluate(id => window.__policyHookQA.setStore(id), storeId);
  const emit = (index, value, exists = true) => page.evaluate(({index,value,exists}) => window.__policyHookQA.emit(index,value,exists), {index,value,exists});
  const fail = (index, message) => page.evaluate(({index,message}) => window.__policyHookQA.fail(index,message), {index,message});

  assert.deepEqual(await state(), { storeId:null, policy:null, status:'idle', error:null });
  assert.equal(await page.evaluate(() => window.__policyHookQA.subscriptions.length), 0);
  const missingStore = await read('');
  assert.equal(missingStore.code, 'schedule_store_required');
  pass('Sin tienda: estado idle sin permisos ni suscripción; la lectura directa exige tienda');

  assert.deepEqual(await read('store-a'), { value: defaults });
  await reply('store-a', { exists:true, data:policyA });
  assert.deepEqual(await read('store-a'), { value: policyA });
  await reply('store-a', { exists:true, data:policyB });
  assert.deepEqual(await read('store-a'), { value: policyB });
  assert.deepEqual(await page.evaluate(() => window.__policyHookQA.reads), [path('store-a'),path('store-a'),path('store-a')]);
  pass('Lecturas frescas por tienda: ausencia usa valores iniciales y una actualización se vuelve a consultar');

  for (const data of [undefined, null, {}, { requestsEnabled:false }]) {
    await reply('store-a', { exists:true, data });
    assert.ok((await read('store-a')).error, 'Una configuración presente inválida no puede habilitar permisos por defecto');
  }
  await reply('store-a', { error:'fallo de transporte aislado' });
  assert.equal((await read('store-a')).error, 'fallo de transporte aislado');
  pass('Documento corrupto o lectura fallida rechaza la operación y no devuelve permisos iniciales');

  await setStore('store-a');
  await waitStatus('loading');
  assert.equal((await state()).policy, null);
  assert.equal(await page.evaluate(() => window.__policyHookQA.subscriptions[0].path), path('store-a'));
  await emit(0, policyA);
  await waitStatus('ready');
  assert.deepEqual((await state()).policy, policyA);
  pass('La suscripción usa stores/tienda/config/schedule_access y solo expone la política tras cargarla');

  const snapshotStart = await page.evaluate(() => window.__policyHookQA.snapshots.length);
  await setStore('store-b');
  await waitStatus('loading');
  const switched = await page.evaluate(start => window.__policyHookQA.snapshots.slice(start), snapshotStart);
  assert.ok(switched.length > 0);
  assert.ok(switched.every(item => item.policy === null && item.status !== 'ready'), 'Ningún render de la tienda nueva puede reutilizar permisos de la anterior');
  assert.equal(await page.evaluate(() => window.__policyHookQA.subscriptions[0].unsubscribed), 1);
  await emit(0, defaults);
  await fail(0, 'error viejo de A');
  assert.equal((await state()).status, 'loading');
  assert.equal((await state()).policy, null);
  await emit(1, policyB);
  await waitStatus('ready');
  assert.deepEqual((await state()).policy, policyB);
  pass('Cambiar de tienda elimina permisos anteriores de inmediato e ignora respuestas y errores de la suscripción cancelada');

  await fail(1, 'error actual de B');
  await waitStatus('error');
  assert.deepEqual(await state(), { storeId:'store-b', policy:null, status:'error', error:'error actual de B' });
  await page.evaluate(() => window.__policyHookQA.retry());
  await waitStatus('loading');
  assert.equal((await state()).policy, null);
  assert.equal(await page.evaluate(() => window.__policyHookQA.subscriptions[1].unsubscribed), 1);
  assert.equal(await page.evaluate(() => window.__policyHookQA.subscriptions[2].path), path('store-b'));
  await emit(1, defaults);
  assert.equal((await state()).status, 'loading');
  await emit(2, policyB);
  await waitStatus('ready');
  assert.deepEqual((await state()).policy, policyB);
  pass('Error actual borra permisos y Reintentar crea una nueva suscripción que no acepta respuestas antiguas');

  await emit(2, undefined);
  await waitStatus('error');
  assert.equal((await state()).policy, null, 'exists=true con data undefined no equivale a documento ausente');
  await emit(2, {});
  await waitStatus('error');
  assert.equal((await state()).policy, null);
  assert.ok((await state()).error);
  await page.evaluate(() => window.__policyHookQA.retry());
  await waitStatus('loading');
  await emit(3, null, false);
  await waitStatus('ready');
  assert.deepEqual((await state()).policy, defaults);
  await setStore(null);
  await waitStatus('idle');
  assert.equal((await state()).policy, null);
  assert.equal((await state()).error, null);
  assert.equal(await page.evaluate(() => window.__policyHookQA.subscriptions[3].unsubscribed), 1);
  pass('Configuración corrupta recibida en vivo falla cerrada; un documento ausente aplica valores iniciales y quitar la tienda limpia el estado');

  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await writeFile(`${output}/hook-result.json`, JSON.stringify({ status:'PASS', passed, errors, requests,
    scope:'Actual React hook and pure normalizer; controlled getDoc/onSnapshot transport; no network or production access' }, null, 2)+'\n');
} catch(error) {
  await writeFile(`${output}/hook-result.json`, JSON.stringify({status:'FAIL',passed,errors,requests,error:String(error)},null,2)+'\n');
  throw error;
} finally { await browser?.close(); }
