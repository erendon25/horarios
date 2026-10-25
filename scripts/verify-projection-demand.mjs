// Real projection demand flow: controlled sales/schedules -> automatic staffing,
// Vestido reference/factors -> manual edits -> isolated persistence -> reload.
// No production access is performed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeProjectionDemandQaFixture, seedProjectionDemandQaFixture } from './projection-demand-qa-fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.PROJECTION_STORE_QA_PORT || '4198', base = `http://127.0.0.1:${port}`;
const output = 'output/projection-demand';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/serve-projection-store-qa.mjs'], {
  env: { ...process.env, PROJECTION_STORE_QA_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'],
});
const passed = [], observations = [], errors = [], unexpectedNetwork = [];
let browser, page;
const ids = ['cocina','custom-qa-1','sheetout-qa','landing-qa','service-qa','driver-qa','fixed-qa'];
const state = async () => (await page.request.get(`${base}/qa-state`)).json();
const poll = async (action, message) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await action()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
};
const pass = message => { passed.push(message); console.log(`PASS: ${message}`); };
const row = id => page.locator(`tr[data-position-id="${id}"]`);
const cell = (id, hour='12:00') => row(id).locator(`td[data-hour="${hour}"]`);
const counts = async (hour='12:00', selectedIds=ids) => Object.fromEntries(await Promise.all(selectedIds.map(async id => [id, Number((await cell(id,hour).textContent()).trim())])));
const checkCounts = async (label, expected, hour='12:00', selectedIds=ids) => {
  await poll(async () => JSON.stringify(await counts(hour,selectedIds)) === JSON.stringify(expected), `${label}: counts did not match ${JSON.stringify(expected)}`);
  const actual = await counts(hour,selectedIds);
  observations.push({label,hour,counts:actual});
  return actual;
};
const open = async () => {
  await page.getByRole('button',{name:'Configurar Posiciones',exact:true}).click();
  return page.getByRole('dialog',{name:'Configurar Posiciones de la Tienda',exact:true});
};
const close = modal => modal.getByRole('button',{name:'Cerrar',exact:true}).click();
const edit = async (id,label,value) => {
  const modal=await open();
  await modal.locator(`[data-position-id="${id}"]`).getByLabel(label,{exact:true}).fill(String(value));
  await close(modal);
};
const vhl = value => page.getByLabel('VHL General (S/.)',{exact:true}).fill(String(value));
const manual = async (id,target,hour='12:00') => {
  const locator=cell(id,hour),before=Number((await locator.textContent()).trim());
  for(let count=before;count<target;count++)await locator.click();
  for(let count=before;count>target;count--)await locator.click({modifiers:['Control']});
  await poll(async()=>Number((await locator.textContent()).trim())===target,`Manual count ${id} did not reach ${target}`);
};
const visuals = async (selectedIds=ids) => {
  const result={};
  for(const id of selectedIds)result[id]=await cell(id).evaluate(async element=>{
    await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})));
    return {count:element.textContent.trim(),background:getComputedStyle(element).backgroundColor,title:element.title};
  });
  return result;
};
const checkGroups = async (production,service,all,hour='12:00') => {
  const read=async group=>Number((await page.locator(`tr[data-staff-total="${group}"] td[data-hour="${hour}"]`).textContent()).trim());
  assert.equal(await read('production'),production);assert.equal(await read('service'),service);assert.equal(await read('all'),all);
  assert.equal(production+service,all);
};
try{
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Demand QA server startup timeout')),30000);
    server.once('error',error=>{clearTimeout(timeout);reject(error)});
    server.once('exit',code=>{clearTimeout(timeout);reject(Error(`QA server exited ${code}`))});
    server.stdout.on('data',data=>{if(data.toString().includes('Projection store QA:')){clearTimeout(timeout);resolve()}});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  page=await browser.newPage({viewport:{width:1500,height:1100},timezoneId:'America/Lima'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>{unexpectedNetwork.push(route.request().url());return route.abort()});
  const fixture=makeProjectionDemandQaFixture();
  fixture.configuration.vestidoPositionId='cocina';
  await seedProjectionDemandQaFixture(page.request,base,fixture);
  await page.goto(base);await row('cocina').waitFor();
  await checkCounts('Venta 2000 / VHL 500',{'cocina':4,'custom-qa-1':4,'sheetout-qa':8,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await checkGroups(18,6,24);
  const independent=await counts('12:00',['service-qa','driver-qa','fixed-qa']);
  await vhl(1000);
  await checkCounts('VHL 1000 modifica Vestido y derivados',{'cocina':2,'custom-qa-1':2,'sheetout-qa':4,'landing-qa':1,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  assert.deepEqual(await counts('12:00',['service-qa','driver-qa','fixed-qa']),independent);
  await vhl(500);
  await checkCounts('Restaurar VHL',{'cocina':4,'custom-qa-1':4,'sheetout-qa':8,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  pass('Venta 2000/VHL500 asigna cuatro a Vestido; factores2/.5 generan8/2, mientras Servicio/Driver/Fijo no dependen del VHL');

  await edit('sheetout-qa','Factor',0.75);
  await checkCounts('Factor propio .75',{'cocina':4,'custom-qa-1':4,'sheetout-qa':3,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await edit('sheetout-qa','Factor',2);
  await edit('cocina','Tope de personal',5);
  await vhl(250);
  await checkCounts('Base ocho, Vestido limitado a cinco',{'cocina':5,'custom-qa-1':5,'sheetout-qa':10,'landing-qa':3,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await checkGroups(23,6,29);
  const distribution=page.getByRole('heading',{name:'Distribucion de Personal e Ingresos por Hora',exact:true}).locator('xpath=../..');
  await distribution.screenshot({path:`${output}/vestido-tope-cinco-derivados.png`});
  await edit('sheetout-qa','Tope de personal',7);
  await edit('landing-qa','Mínimo',4);
  await edit('custom-qa-1','Tope de personal',2);
  await checkCounts('Topes y mínimo propios',{'cocina':5,'custom-qa-1':2,'sheetout-qa':7,'landing-qa':4,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await checkGroups(18,6,24);
  const limited=await visuals();
  assert.equal(limited['cocina'].background,limited['sheetout-qa'].background,'Both assigned limits must retain the red limit color');
  await edit('sheetout-qa','Tope de personal','');
  await edit('landing-qa','Mínimo','');
  await edit('custom-qa-1','Tope de personal','');
  pass('Otras áreas usan el Vestido final limitado a cinco y respetan sus factores, redondeo, topes, mínimos y colores propios');

  await manual('cocina',3);
  await checkCounts('Vestido manual tres',{'cocina':3,'custom-qa-1':3,'sheetout-qa':6,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await manual('cocina',6);
  await checkCounts('Vestido manual superior al tope',{'cocina':6,'custom-qa-1':6,'sheetout-qa':12,'landing-qa':3,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await manual('cocina',3);
  await manual('cocina',3,'11:00');
  await checkCounts('Hora sin ventas con Vestido manual',{'cocina':3,'custom-qa-1':3,'sheetout-qa':6,'landing-qa':2,'service-qa':0,'driver-qa':0,'fixed-qa':2},'11:00');
  await checkGroups(14,2,16,'11:00');
  await manual('sheetout-qa',1);
  await checkCounts('Override manual del área derivada',{'cocina':3,'custom-qa-1':3,'sheetout-qa':1,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await manual('sheetout-qa',6);
  await checkCounts('Restaurar asignación derivada manualmente',{'cocina':3,'custom-qa-1':3,'sheetout-qa':6,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  pass('Los derivados siguen la asignación manual real de Vestido, incluso sin ventas o por encima de su tope; sus propios ajustes manuales conservan prioridad');

  await edit('cocina','Nombre de posición','Zona principal renombrada');
  let modal=await open();
  assert.equal(await modal.getByLabel('Área Vestido',{exact:true}).inputValue(),'cocina','Renaming the selected source must retain its stable id');
  await close(modal);
  await checkCounts('Fuente renombrada conserva referencia',{'cocina':3,'custom-qa-1':3,'sheetout-qa':6,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await poll(async()=>{
    const saved=(await state()).configurations['store-a'];
    return saved.vestidoPositionId==='cocina'&&saved.manualStaffByDay?.lunes?.cocina?.['12:00']===3
      &&saved.requirements?.monday?.matrix?.['0']?.['1']===3&&saved.requirements?.monday?.matrix?.['2']?.['0']===6;
  },'Reference, manual allocations, or derived weekly requirements were not persisted');
  const beforeReload=await visuals();
  await page.reload();await row('cocina').waitFor();
  await checkCounts('Recarga conserva fórmula y manuales',{'cocina':3,'custom-qa-1':3,'sheetout-qa':6,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  assert.deepEqual(await visuals(),beforeReload);
  modal=await open();assert.equal(await modal.getByLabel('Área Vestido',{exact:true}).inputValue(),'cocina');await close(modal);
  pass('Renombrar Vestido conserva su id; la recarga mantiene referencia, configuraciones, requisitos, grupos, asignaciones y colores');

  // A non-sales area can explicitly become the Vestido reference. Its usual
  // service formula and configured factor must then yield to sale/VHL.
  await edit('service-qa','Factor',9);
  assert.equal(Number((await cell('service-qa').textContent()).trim()),18);
  modal=await open();
  await modal.getByLabel('Área Vestido',{exact:true}).selectOption('service-qa');
  await close(modal);
  await checkCounts('Referencia elegida de lógica Servicio',{'cocina':3,'custom-qa-1':8,'sheetout-qa':6,'landing-qa':4,'service-qa':8,'driver-qa':2,'fixed-qa':2});
  await poll(async()=>(await state()).configurations['store-a'].vestidoPositionId==='service-qa','Selected source id did not persist');
  await page.reload();await row('service-qa').waitFor();
  assert.equal(Number((await cell('service-qa').textContent()).trim()),8);
  pass('El selector puede convertir otra área en Vestido por id, independientemente de su nombre, lógica o factor, y conserva la elección');

  const fixtureB=makeProjectionDemandQaFixture({storeId:'store-b'});
  fixtureB.configuration.positions=fixtureB.configuration.positions.filter(position=>position.id!=='cocina');
  await seedProjectionDemandQaFixture(page.request,base,fixtureB);
  await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-b');
  await row('custom-qa-1').waitFor();
  const bIds=ids.filter(id=>id!=='cocina');
  await checkCounts('Vestido personalizado legado único',{'custom-qa-1':4,'sheetout-qa':8,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2},'12:00',bIds);
  modal=await open();assert.equal(await modal.getByLabel('Área Vestido',{exact:true}).inputValue(),'custom-qa-1');await close(modal);
  await edit('custom-qa-1','Nombre de posición','Referencia personalizada B');
  await poll(async()=>(await state()).configurations['store-b'].vestidoPositionId==='custom-qa-1','Legacy custom source was not made explicit for persistence');
  await page.reload();await row('custom-qa-1').waitFor();
  await checkCounts('Vestido personalizado renombrado',{'custom-qa-1':4,'sheetout-qa':8,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2},'12:00',bIds);
  await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-a');
  await row('cocina').waitFor();
  modal=await open();assert.equal(await modal.getByLabel('Área Vestido',{exact:true}).inputValue(),'service-qa');await close(modal);
  await distribution.screenshot({path:`${output}/referencia-explicita-servicio.png`});
  pass('Una tienda con Vestido personalizado único lo reconoce inicialmente, conserva su id al renombrar y queda aislada de la referencia de otra tienda');

  // Preserve the existing special handling of an explicit zero production cap.
  // Isolate this edge case so earlier manual assignments cannot hide the result.
  const zeroFixture=makeProjectionDemandQaFixture({storeId:'store-c'});
  zeroFixture.configuration.vestidoPositionId='cocina';
  zeroFixture.configuration.positions.find(position=>position.id==='fixed-qa').maxStaff=0;
  await seedProjectionDemandQaFixture(page.request,base,zeroFixture);
  await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-c');
  await row('cocina').waitFor();
  await checkCounts('Configuración limpia para tope cero',{'cocina':4,'custom-qa-1':4,'sheetout-qa':8,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await edit('sheetout-qa','Tope de personal',0);
  await checkCounts('Área por factor con tope explícito cero',{'cocina':4,'custom-qa-1':4,'sheetout-qa':0,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await edit('sheetout-qa','Mínimo',2);
  await edit('service-qa','Tope de personal',0);
  await edit('driver-qa','Tope de personal',0);
  await checkCounts('Mínimo histórico sobre tope cero y otras lógicas',{'cocina':4,'custom-qa-1':4,'sheetout-qa':2,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await edit('cocina','Tope de personal',0);
  await checkCounts('Vestido con tope cero sin asignación manual',{'cocina':0,'custom-qa-1':0,'sheetout-qa':2,'landing-qa':0,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await edit('sheetout-qa','Tope de personal','');
  await edit('sheetout-qa','Mínimo','');
  await checkCounts('Vestido cero no genera personas por factor',{'cocina':0,'custom-qa-1':0,'sheetout-qa':0,'landing-qa':0,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  await manual('cocina',3);
  await checkCounts('Manual Vestido conserva prioridad sobre tope cero',{'cocina':3,'custom-qa-1':3,'sheetout-qa':6,'landing-qa':2,'service-qa':2,'driver-qa':2,'fixed-qa':2});
  pass('El tope cero conserva la regla histórica de producción y su mínimo; Servicio/Driver/Fijo no cambian y una asignación manual de Vestido sigue propagándose');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedNetwork,[]);
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,observations,errors,unexpectedNetwork,
    scope:'Real React projection with controlled sales, staff and schedules in isolated HTTP storage; no production access'},null,2));
}catch(error){
  await page?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,observations,errors,unexpectedNetwork,error:String(error)},null,2));
  throw error;
}finally{await browser?.close();server.kill();}
