// Real projection UI and persistence with fictional local HTTP fixtures only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeProjectionDemandQaFixture, seedProjectionDemandQaFixture } from './projection-demand-qa-fixture.mjs';
import { summarizeProjectionHours } from '../src/services/projectionHours.js';
import { getProjectionForDay } from '../src/services/scheduleExportData.js';
import { buildHeatmapRows, HOURS } from '../src/services/heatmapModel.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = process.env.PROJECTION_STORE_QA_PORT || '5315';
const base = `http://127.0.0.1:${port}`, output = 'output/projection-quarter-hour';
await mkdir(output,{recursive:true});
const server = spawn(process.execPath,['scripts/serve-projection-store-qa.mjs'],{env:{...process.env,PROJECTION_STORE_QA_PORT:port},stdio:['ignore','pipe','inherit']});
const passed=[],errors=[],external=[],observations=[];
let browser,page;
const poll = async (action,message) => { for(let i=0;i<150;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message); };
const pass = message => {passed.push(message);console.log(`PASS: ${message}`);};
const state = async () => (await page.request.get(`${base}/qa-state`)).json();
const cell = hour => page.locator(`tr[data-position-id="cocina"] td[data-hour="${hour}"]`);
const saved = async store => (await state()).configurations[store];
const near = (a,b) => Math.abs(a-b)<1e-8;
try {
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('QA startup timeout')),30000);server.once('error',reject);server.once('exit',code=>reject(Error(`QA server exited ${code}`)));server.stdout.on('data',data=>{if(data.toString().includes('Projection store QA:')){clearTimeout(timeout);resolve();}});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
  page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Lima'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
  const fixture=makeProjectionDemandQaFixture({hourlySale:1200,generalVhl:600});
  fixture.configuration.vestidoPositionId='cocina';
  fixture.configuration.positions=[{id:'cocina',name:'Vestido',logic:'sales',department:'production'},{id:'fixed',name:'Servicio fijo',logic:'fixed',fixedStaff:1,department:'service'}];
  fixture.configuration.manualStaffByDay={lunes:{cocina:{'12:00':3}}};
  await seedProjectionDemandQaFixture(page.request,base,fixture);
  await page.goto(base);await cell('12:00').waitFor();
  const region=page.getByRole('region',{name:'Proyección por tramos de 15 minutos',exact:true});
  const table=region.locator('table');
  assert.deepEqual(await table.locator('thead th[data-slot]').allTextContents(),['11:00','11:15','11:30','11:45','12:00','12:15','12:30','12:45','13:00','13:15','13:30','13:45']);
  for(const hour of ['12:00','12:15','12:30','12:45'])assert.equal((await cell(hour).textContent()).trim(),'3');
  assert.deepEqual(await table.locator('td[data-sale-slot^="12:"]').allTextContents(),['300','300','300','300']);
  await poll(async()=>{const value=await saved('store-a');return value.manualStaffIntervalMinutes===15&&value.requirements?.monday?.intervalMinutes===15;},'Quarter-hour persistence missing');
  let config=await saved('store-a');
  assert.equal(config.requirements.monday.startMinutes,660);
  assert.equal(summarizeProjectionHours(config.requirements,config.positions,'monday').dayHours,6);
  pass('Histórico horario repartido sin duplicar ventas; ajustes antiguos cubren los cuatro cuartos y las HH se ponderan por 0,25');

  await cell('12:15').click();
  await poll(async()=> (await saved('store-a')).manualStaffByDay.lunes.cocina['12:15']===4,'Quarter edit was not saved');
  assert.equal((await cell('12:00').textContent()).trim(),'3');
  assert.equal((await cell('12:30').textContent()).trim(),'3');
  config=await saved('store-a');
  assert.equal(summarizeProjectionHours(config.requirements,config.positions,'monday').dayHours,6.25);
  const projection=getProjectionForDay(config.requirements,config.positions,'monday');
  const rows=buildHeatmapRows([],projection).filter(row=>row.name==='Vestido');
  assert.equal(rows.filter(row=>row.cells[HOURS.indexOf('12:15')].color==='bg-yellow-300').length,4);
  assert.equal(rows.filter(row=>row.cells[HOURS.indexOf('12:30')].color==='bg-yellow-300').length,3);
  assert.equal(rows.filter(row=>row.cells[HOURS.indexOf('08:00')].color==='bg-yellow-300').length,0);
  await page.reload();await cell('12:15').waitFor();assert.equal((await cell('12:15').textContent()).trim(),'4');
  await cell('12:15').focus();await page.keyboard.press('Control+Enter');
  await poll(async()=>(await saved('store-a')).manualStaffByDay.lunes.cocina['12:15']===3,'Keyboard decrement was not saved');
  pass('Editar un cuarto cambia solo 0,25 HH, persiste al recargar y actualiza el mapa en su hora real; teclado permite restar');

  const compact=await table.evaluate(element=>{const first=element.querySelector('thead th').getBoundingClientRect(),number=element.querySelector('tbody tr[data-position-id] td[data-hour]').getBoundingClientRect();return {areaWidth:first.width,cellWidth:number.width,cellHeight:number.height};});
  assert.ok(compact.areaWidth<=161&&compact.cellWidth<=41&&compact.cellHeight<=45,JSON.stringify(compact));observations.push(compact);
  await region.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/desktop.png`});
  await page.getByRole('button',{name:'Configurar Posiciones',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Configurar Posiciones de la Tienda',exact:true});
  assert.ok((await modal.getByLabel('Factor',{exact:true}).first().boundingBox()).height<=33);
  await modal.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await region.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await region.evaluate(element=>{element.scrollLeft=300;});
  const sticky=await table.locator('thead th').first().boundingBox(),bounds=await region.boundingBox();
  assert.ok(Math.abs(sticky.x-bounds.x)<=2);
  await page.screenshot({path:`${output}/mobile.png`});
  pass('Columna fija de 160 px, celdas de 40 px y controles de 32 px; el scroll queda dentro de la tabla en móvil');

  const second=makeProjectionDemandQaFixture({storeId:'store-b',hourlySale:1200,generalVhl:600});
  second.configuration.positions=fixture.configuration.positions;second.configuration.vestidoPositionId='cocina';
  await seedProjectionDemandQaFixture(page.request,base,second);
  await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-b');await cell('12:15').waitFor();
  await poll(async()=>(await cell('12:15').textContent()).trim()==='2','Other store inherited manual overrides');
  await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-a');await cell('12:15').waitFor();
  await poll(async()=>(await cell('12:15').textContent()).trim()==='3','Store edits were not restored');
  pass('Cada tienda conserva su configuración y sus ajustes por cuarto sin heredarlos de otra tienda');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,observations,errors,external},null,2));
}catch(error){await page?.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,external,error:String(error)},null,2));throw error;}
finally{await browser?.close();server.kill();}
