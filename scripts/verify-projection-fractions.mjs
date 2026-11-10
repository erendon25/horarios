// Local-only checks: whole-number presentation with precise fractional data.
// Real React projection, controlled HTTP fixtures; no production reads/writes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeProjectionDemandQaFixture,seedProjectionDemandQaFixture} from './projection-demand-qa-fixture.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=process.env.PROJECTION_STORE_QA_PORT||'4202',base=`http://127.0.0.1:${port}`,output='output/projection-fractions';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-projection-store-qa.mjs'],{env:{...process.env,PROJECTION_STORE_QA_PORT:port},stdio:['ignore','pipe','inherit']});
const passed=[],errors=[],unexpectedNetwork=[],observations=[];
let browser,page;
const closeTo=(actual,expected,message='Cantidad decimal')=>assert.ok(Math.abs(actual-expected)<=1e-10*Math.max(1,Math.abs(expected)),`${message}: esperado${expected}, recibido${actual}`);
const near=(actual,expected)=>Math.abs(actual-expected)<=1e-10*Math.max(1,Math.abs(expected));
const poll=async(action,message)=>{for(let i=0;i<100;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message)};
const state=async()=>(await page.request.get(`${base}/qa-state`)).json();
const cell=id=>page.locator(`tr[data-position-id="${id}"] td[data-hour="12:00"]`);
const count=async id=>Number((await cell(id).textContent()).trim());
const total=async group=>Number((await page.locator(`tr[data-staff-total="${group}"] td[data-hour="12:00"]`).textContent()).trim());
const open=async()=>{await page.getByRole('button',{name:'Configurar Posiciones',exact:true}).click();return page.getByRole('dialog',{name:'Configurar Posiciones de la Tienda',exact:true})};
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`)};
const distributionTable=()=>cell('cocina').locator('xpath=ancestor::table');
const assertWholeDistribution=async()=>{
 const quantities=await distributionTable().locator('tbody td').evaluateAll(elements=>elements.map(element=>({text:element.textContent.trim(),title:element.getAttribute('title')||''})));
 for(const {text,title}of quantities){
  assert.doesNotMatch(text,/\d[.,]\d/,`La tabla no debe mostrar cantidades decimales: ${text}`);
  assert.doesNotMatch(title,/\d[.,]\d/,`El tooltip no debe mostrar cantidades decimales: ${title}`);
 }
};
const check=async({vestido,factor,production,all,day,week})=>{
 await poll(async()=>await count('cocina')===Math.round(vestido)&&await count('fraction')===Math.round(factor)&&await total('all')===Math.round(all),'Whole-number staffing presentation did not finish updating');
 assert.equal(await count('fixed'),Math.round(1.25));
 assert.equal(await total('production'),Math.round(production));assert.equal(await total('service'),Math.round(1.25));assert.equal(await total('all'),Math.round(all));
 await assertWholeDistribution();
 assert.match(await cell('fixed').getAttribute('title'),/1 persona · Límite: 1\./,'El contador y el límite del tooltip deben mostrarse sin decimales');
 const weekDisplay=Number.parseFloat(await page.getByTestId('projection-required-week-hours').textContent());
 assert.equal(weekDisplay,Math.round(week),'La tarjeta semanal debe presentar horas enteras');
 const balanceText=(await page.getByText('Balance semanal de horas',{exact:true}).locator('xpath=..').textContent()).replace(/\s+/g,' ');
 const balance=balanceText.match(/(\d+) hrs disponibles\s*−\s*(\d+) hrs requeridas\s*=\s*([+-]?\d+) hrs/);
 assert.ok(balance,`El balance debe presentar valores enteros: ${balanceText}`);
 assert.equal(Number(balance[1]),48);assert.equal(Number(balance[2]),Math.round(week));
 assert.equal(Number(balance[3]),Math.round(48-week));
 const requiredCard=await page.getByTestId('projection-required-week-hours').locator('xpath=..').textContent();
 assert.match(requiredCard,new RegExp(`${week>48?'Faltan':'Quedan'} ${Math.round(Math.abs(48-week))} hrs`),'El déficit o excedente visible debe redondearse');
 const modal=await open();
 const dayDisplay=Number.parseFloat(await modal.getByTestId('projection-required-day-hours').textContent());
 assert.equal(dayDisplay,Math.round(day),'La tarjeta diaria del modal debe presentar horas enteras');
 for(const badge of await modal.locator('fieldset[data-position-id] span').allTextContents())assert.doesNotMatch(badge,/\d[.,]\d/,`Las estadísticas por área deben mostrarse sin decimales: ${badge}`);
 await modal.getByRole('button',{name:'Cerrar',exact:true}).click();
 observations.push({vestido:await count('cocina'),factor:await count('fraction'),production:await total('production'),service:await total('service'),all:await total('all'),dayRaw:day,weekRaw:week,dayDisplay,weekDisplay,balanceDisplay:Number(balance[3])});
};
const rawSavedHours=requirements=>{
 const day=source=>Object.values(source?.matrix||{}).reduce((sum,row)=>sum+Object.values(row||{}).reduce((total,value)=>total+Number(value),0),0);
 return {day:day(requirements.monday),week:Object.values(requirements).reduce((sum,source)=>sum+day(source),0)};
};
try{
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Fractional projection QA startup timeout')),30000);server.once('error',error=>{clearTimeout(timeout);reject(error)});server.once('exit',code=>{clearTimeout(timeout);reject(Error(`QA server exited${code}`))});server.stdout.on('data',data=>{if(data.toString().includes('Projection store QA:')){clearTimeout(timeout);resolve()}})});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1500,height:1000},timezoneId:'America/Lima'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://**/*',route=>{unexpectedNetwork.push(route.request().url());return route.abort()});
 const fixture=makeProjectionDemandQaFixture({hourlySale:1100,generalVhl:500});
 fixture.configuration.vestidoPositionId='cocina';
 fixture.configuration.positions=[
  {id:'cocina',name:'Vestido',logic:'sales',department:'production'},
  {id:'fraction',name:'Área por factor',logic:'sales',factor:0.4,department:'production'},
  {id:'fixed',name:'Servicio fijo',logic:'fixed',fixedStaff:1.25,department:'service'},
 ];
 await seedProjectionDemandQaFixture(page.request,base,fixture);
 await page.goto(base);await cell('cocina').waitFor();
 await check({vestido:2.2,factor:0.88,production:3.08,all:4.33,day:6.83,week:47.81});
 const distribution=page.getByRole('heading',{name:'Distribucion de Personal e Ingresos por Hora',exact:true}).locator('xpath=../..');
 await distribution.screenshot({path:`${output}/distribucion-personal-sin-decimales.png`});
 await poll(async()=>{
  const saved=(await state()).configurations['store-a'];
  return near(saved.requirements?.monday?.matrix?.['0']?.['1'],2.2)&&near(saved.requirements?.monday?.matrix?.['1']?.['1'],0.88);
 },'Saved projection requirements must retain the fractional staffing');
 const initialHours=rawSavedHours((await state()).configurations['store-a'].requirements);
 closeTo(initialHours.day,6.83);closeTo(initialHours.week,47.81);
 pass('La distribución muestra personal y totales enteros, conserva2.2/.88/1.25 en datos y HH6.83/47.81; las tarjetas muestran7/48');

 await cell('cocina').click();
 await check({vestido:3.2,factor:1.28,production:4.48,all:5.73,day:8.23,week:49.21});
 await poll(async()=>near((await state()).configurations['store-a'].manualStaffByDay?.lunes?.cocina?.['12:00'],3.2),'Manual source3.2 must persist without rounding');
 await cell('cocina').click({modifiers:['Control']});
 await check({vestido:2.2,factor:0.88,production:3.08,all:4.33,day:6.83,week:47.81});
 await cell('fraction').click();
 await check({vestido:2.2,factor:1.88,production:4.08,all:5.33,day:7.83,week:48.81});
 await poll(async()=>{
  const saved=(await state()).configurations['store-a'];
  return near(saved.manualStaffByDay?.lunes?.cocina?.['12:00'],2.2)&&near(saved.manualStaffByDay?.lunes?.fraction?.['12:00'],1.88);
 },'Manual decimal values must be persisted without rounding');
 await page.reload();await cell('cocina').waitFor();
 await check({vestido:2.2,factor:1.88,production:4.08,all:5.33,day:7.83,week:48.81});
 pass('Los clics manuales guardan3.2/1.88 sin redondear, propagan fracciones y sobreviven a la recarga con presentación entera');

 const saved=(await state()).configurations['store-a'];
 closeTo(saved.requirements.monday.matrix['0']['1'],2.2);
 closeTo(saved.requirements.monday.matrix['1']['1'],1.88);
 closeTo(saved.requirements.monday.matrix['2']['1'],1.25);
 const manualHours=rawSavedHours(saved.requirements);closeTo(manualHours.day,7.83);closeTo(manualHours.week,48.81);

 const fractionalIncome=makeProjectionDemandQaFixture({storeId:'store-b',hourlySale:1100.25,generalVhl:500});
 fractionalIncome.configuration.vestidoPositionId='cocina';
 fractionalIncome.configuration.positions=structuredClone(fixture.configuration.positions);
 await seedProjectionDemandQaFixture(page.request,base,fractionalIncome);
 await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-b');
 await cell('cocina').waitFor();
 await check({vestido:2.2005,factor:0.8802,production:3.0807,all:4.3307,day:6.8307,week:47.8149});
 const table=distributionTable();
 const hours=(await table.locator('thead th').allTextContents()).map(text=>text.trim());
 const incomeText=(await table.locator('tbody tr').first().locator('td').nth(hours.indexOf('12:00')).textContent()).trim();
 assert.equal(incomeText.replace(/\s+/g,' '),'S/. 1100','El ingreso por hora debe mostrarse sin decimales');
 await poll(async()=>near((await state()).configurations['store-b'].requirements?.monday?.matrix?.['0']?.['1'],2.2005),'Fractional income projection did not persist');
 const incomeSaved=(await state()).configurations['store-b'];
 const incomeHours=rawSavedHours(incomeSaved.requirements);closeTo(incomeHours.day,6.8307);closeTo(incomeHours.week,47.8149);
 assert.equal(incomeSaved.salesByDay.lunes['12:00'],1100.25);
 await distribution.screenshot({path:`${output}/ingresos-personal-enteros-datos-precisos.png`});
 await page.setViewportSize({width:390,height:844});
 await distribution.scrollIntoViewIfNeeded();
 await cell('cocina').evaluate(element=>{
  const table=element.closest('table'),scroller=table.parentElement;
  const stickyWidth=table.querySelector('thead th').getBoundingClientRect().width;
  scroller.scrollLeft=Math.max(0,element.offsetLeft-stickyWidth);
 });
 await assertWholeDistribution();
 await distribution.screenshot({path:`${output}/distribucion-mobile-sin-decimales.png`});
 observations.push({incomeText,dayRaw:incomeHours.day,weekRaw:incomeHours.week});
 pass('El ingreso1100.25 se presentaS/.1100 y la tabla móvil no muestra decimales; datos2.2005/.8802 y HH6.8307/47.8149 se conservan precisos');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpectedNetwork,[]);
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,observations,errors,unexpectedNetwork,
  scope:'Local-only real React projection with isolated HTTP fixtures; no production access, deployment, or commit'},null,2));
}catch(error){await page?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,observations,errors,unexpectedNetwork,error:String(error)},null,2));throw error;
}finally{await browser?.close();server.kill();}
