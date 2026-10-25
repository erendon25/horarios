// Real WeeklyScheduleEditor + adjacent programmed/projected HH, with isolated document/SSE transport.
// Verifies only the selected day's source-hour total, with no weekly card.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port=process.env.BUK_QA_PORT||'4199',base=`http://127.0.0.1:${port}`;
const output='output/projection-hours';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-buk-qa.mjs'],{
 env:{...process.env,BUK_QA_PORT:port,BUK_QA_PROJECTION_HOURS:'1'},stdio:['ignore','pipe','inherit'],
});
const passed=[],errors=[],unexpectedNetwork=[],observations=[];
let browser,page;
const projectionPath='stores/qa-store/config/schedule_projection';
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`)};
const poll=async(action,message)=>{for(let i=0;i<100;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message)};
const summary=(scope=page)=>scope.getByTestId('projection-hours-summary');
const comparison=()=>page.getByTestId('heatmap-hours-comparison');
const heatmapRegion=(scope=page)=>scope.getByRole('region',{name:'Matriz de cobertura por posición y horario',exact:true});
const value=async(id,scope=page)=>(await scope.getByTestId(id).locator('dd').textContent()).replace(/\s+/g,' ').trim();
const expectHours=async(day,dayLabel='Lunes',scope=page)=>{
 await poll(async()=>await value('projection-hours-day',scope)===day
  &&(await scope.getByTestId('projection-hours-day').locator('dt').textContent()).trim()===`HH proyección · ${dayLabel}`,
  `Expected selected-day projection ${dayLabel}=${day}`);
 assert.equal(await scope.getByTestId('projection-hours-week').count(),0,'The weekly projection card must not appear');
 assert.equal(await summary(scope).getByText(/7\s*días|Parcial/i).count(),0,'The daily summary must not show a weekly label or partial-week badge');
 observations.push({day,dayLabel,weeklyCard:false});
};
const setProjection=async(data,path=projectionPath)=>{
 const response=await page.request.post(`${base}/qa-document`,{data:{path,data}});
 assert.equal(response.ok(),true);
};
const daySelect=()=>page.locator('select').filter({has:page.locator('option[value="monday"]')}).first();
const programmed=()=>page.getByTestId('heatmap-total-hours').textContent();
const checkAdjacentHours=async(label)=>{
 const pair=comparison();await pair.scrollIntoViewIfNeeded();
 assert.equal(await pair.getByTestId('heatmap-total-hours').count(),1);
 assert.equal(await summary(pair).count(),1,'La cabecera debe contener un solo resumen de proyección');
 assert.equal(await summary().count(),1,'El mapa normal no debe duplicar las HH de proyección');
 assert.equal(await summary(heatmapRegion().locator('xpath=..')).count(),0,'El bloque oscuro normal no debe repetir el resumen');
 const actual=await pair.getByTestId('heatmap-total-hours').boundingBox(),projected=await summary(pair).boundingBox(),bounds=await pair.boundingBox();
 assert.ok(actual&&projected&&bounds,`${label}: ambas HH deben ser visibles`);
 assert.ok(projected.x>=actual.x+actual.width-1,`${label}: la proyección debe estar a la derecha del Total HH`);
 assert.ok(Math.min(actual.y+actual.height,projected.y+projected.height)>Math.max(actual.y,projected.y),`${label}: ambas HH deben compartir la misma fila`);
 const viewport=page.viewportSize();
 assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=viewport.width+1,`${label}: ambas HH deben caber en el ancho visible`);
 assert.ok(await pair.evaluate(element=>element.scrollWidth<=element.clientWidth+1),`${label}: el par de HH no debe desbordarse horizontalmente`);
 observations.push({comparisonViewport:label,actual,projected,bounds});
};
const checkMapHeight=async(label,scope=page)=>{
 const bounds=await heatmapRegion(scope).evaluate(element=>{
  const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
 });
 observations.push({mapViewport:label,bounds});
 assert.ok(bounds.height>=80,`${label}: the heatmap scroll region needs at least80px, got${bounds.height}`);
};
const hourRow=(quantity,length)=>Object.fromEntries(Array.from({length},(_,index)=>[String(index),quantity]));
const initial={positions:[{id:'landing',name:'LANDING'}],requirements:{
 monday:{positions:['LANDING'],matrix:{'0':hourRow(3,4)}},
 tuesday:{positions:['LANDING'],matrix:[[2,2,2]]},
 wednesday:{positions:['LANDING'],matrix:{}},
}};
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Weekly HH QA server startup timeout')),30000);
  server.once('error',error=>{clearTimeout(timeout);reject(error)});
  server.once('exit',code=>{clearTimeout(timeout);reject(Error(`QA server exited ${code}`))});
  server.stdout.on('data',data=>{if(data.toString().includes('Editor BUK aislado:')){clearTimeout(timeout);resolve()}});
 });
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1500,height:1000},timezoneId:'America/Lima'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://**/*',route=>{unexpectedNetwork.push(route.request().url());return route.abort()});
 let releaseInitial,gateOpen=false,readFailure=false;
 const initialGate=new Promise(resolve=>{releaseInitial=resolve});
 const projectionRead=/\/qa-document\?path=stores%2Fqa-store%2Fconfig%2Fschedule_projection$/;
 await page.route(projectionRead,async route=>{
  if(!gateOpen)await initialGate;
  if(readFailure)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fallo de lectura aislado'})});
  else await route.continue();
 });
 await setProjection(initial);
 await page.goto(base);
 await summary().waitFor();
 await expectHours('Cargando…');
 gateOpen=true;releaseInitial();
 await expectHours('12 h');
 await checkAdjacentHours('1500x1000 escritorio');
 assert.ok(!/12\s*h/.test(await programmed()),'The programmed staff total must remain independent of the 12 projected hours');
 const originalProgrammed=await programmed();
 const region=page.getByRole('region',{name:'Matriz de cobertura por posición y horario',exact:true});
 assert.equal(await region.locator('thead th[scope="col"]').count(),73,'The heatmap retains its 73 quarter-hour labels including 25:00');
 assert.equal((await region.locator('thead th[scope="col"]').last().textContent()).trim(),'25:00');
 await comparison().screenshot({path:`${output}/resumen-desktop.png`});
 pass('La carga muestra pendiente y luego12h del lunes junto a Total HH, sin duplicado inferior ni tarjeta semanal; conserva las HH programadas y matriz de15min');

 await daySelect().selectOption('tuesday');await expectHours('6 h','Martes');
 await daySelect().selectOption('wednesday');await expectHours('0 h','Miércoles');
 await daySelect().selectOption('thursday');await expectHours('Sin proyección','Jueves');
 await daySelect().selectOption('monday');await expectHours('12 h');
 await page.getByPlaceholder('Buscar colaborador...',{exact:true}).fill('Ningún colaborador QA coincide');
 await expectHours('12 h');assert.equal(await programmed(),originalProgrammed);
 await page.getByPlaceholder('Buscar colaborador...',{exact:true}).fill('');
 const modality=page.locator('select').filter({has:page.locator('option[value="Full-Time"]')}).first();
 await modality.selectOption('Full-Time');await expectHours('12 h');assert.equal(await programmed(),originalProgrammed);
 await modality.selectOption('Todos');
 await page.getByRole('button',{name:'Ver Todos',exact:true}).click();await expectHours('12 h');
 await page.getByRole('button',{name:'Solo Tienda',exact:true}).click();
 pass('Cambiar de día actualiza etiqueta y HH, distinguiendo cero de ausencia; los filtros no modifican el total diario de proyección ni las HH programadas');

 await page.waitForFunction(()=>window.bukQaRealtimeConnected===true);
 await page.getByRole('button',{name:'Maximizar mapa de cobertura',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 assert.equal(await dialog.evaluate(element=>element.matches(':modal')),true);
 await checkMapHeight('1500x1000 fullscreen',dialog);
 await expectHours('12 h','Lunes',dialog);
 assert.equal(await summary(dialog).count(),1,'Fullscreen must share one summary rather than duplicating it');
 await setProjection({...initial,requirements:{monday:{positions:['LANDING'],matrix:{'0':hourRow(99,4)}}}},'stores/another-store/config/schedule_projection');
 await expectHours('12 h','Lunes',dialog);
 const updated=structuredClone(initial);updated.requirements.monday.matrix['0']=hourRow(4,4);
 await setProjection(updated);await expectHours('16 h','Lunes',dialog);
 await dialog.screenshot({path:`${output}/resumen-fullscreen-actualizado.png`});
 await dialog.getByRole('button',{name:'Minimizar mapa de cobertura',exact:true}).click();
 await expectHours('16 h');assert.equal(await programmed(),originalProgrammed);
 await checkAdjacentHours('1500x1000 al cerrar pantalla completa');
 pass('La vista ampliada comparte el resumen y recibe cambios en vivo de su tienda; un cambio de otra tienda no lo reemplaza');

 // The last visible heatmap column is one quarter-hour cell, but its source
 // requirement is a complete legacy hour; use the source instead of its pixels.
 const lastHour={positions:['LANDING'],requirements:{monday:{positions:['LANDING'],matrix:{'0':Object.fromEntries(Array.from({length:18},(_,index)=>[String(index),index===17?3:0]))}}}};
 await setProjection(lastHour);await expectHours('3 h');
 await setProjection(null);await expectHours('Sin proyección');
 await setProjection({positions:['LANDING'],requirements:{monday:{positions:['LANDING'],matrix:{}}}});
 await expectHours('0 h');
 pass('El cálculo usa horas fuente sin contar dos veces25:00 y distingue documento ausente de una proyección explícita de cero');

 readFailure=true;await setProjection(initial);await expectHours('No disponible');
 readFailure=false;await setProjection(initial);await expectHours('12 h');
 pass('Un error de lectura muestra No disponible y la suscripción recupera los valores al restablecerse');

 await page.setViewportSize({width:991,height:435});
 await checkAdjacentHours('991x435 horizontal');
 await checkMapHeight('991x435 embedded');
 await page.setViewportSize({width:390,height:844});
 await checkAdjacentHours('390x844 móvil');
 await checkMapHeight('390x844 embedded');
 await summary().scrollIntoViewIfNeeded();
 const bounds=await summary().boundingBox();
 assert.ok(bounds&&bounds.x>=-1&&bounds.width<=390&&bounds.x+bounds.width<=391,'The compact summary must fit the mobile viewport');
 const overflow=await summary().evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth}));
 assert.ok(overflow.scroll<=overflow.width+1,'Projection summary must not overflow horizontally');
 await comparison().screenshot({path:`${output}/resumen-mobile.png`});
 await page.getByRole('button',{name:'Maximizar mapa de cobertura',exact:true}).click();
 const mobileDialog=page.getByRole('dialog');await mobileDialog.waitFor();
 await checkMapHeight('390x844 fullscreen',mobileDialog);
 await expectHours('12 h','Lunes',mobileDialog);
 assert.equal(await summary(mobileDialog).count(),1,'El diálogo móvil debe contener un único resumen');
 const mobileBounds=await summary(mobileDialog).boundingBox();
 assert.ok(mobileBounds&&mobileBounds.x>=-1&&mobileBounds.x+mobileBounds.width<=391&&mobileBounds.y>=-1&&mobileBounds.y+mobileBounds.height<=845);
 await mobileDialog.screenshot({path:`${output}/resumen-mobile-fullscreen.png`});
 await page.keyboard.press('Escape');
 assert.deepEqual(await page.evaluate(()=>window.bukQaWrites),[],'Reading projection hours and using filters must not save staff schedules');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpectedNetwork,[]);
 pass('Total HH y proyección permanecen alineados en móvil; pantalla completa conserva un resumen y consultar/filtrar no escribe horarios');
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,observations,errors,unexpectedNetwork,
  scope:'Real WeeklyScheduleEditor and heatmap header with isolated HTTP documents and SSE; no production access'},null,2));
}catch(error){
 await page?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,observations,errors,unexpectedNetwork,error:String(error)},null,2));
 throw error;
}finally{await browser?.close();server.kill();}
