// Mouse, keyboard and touch movement in the real matrix, with fictional local data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port=process.env.BUK_QA_PORT||'4245',base=`http://127.0.0.1:${port}`,output='output/heatmap-move';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-buk-qa.mjs'],{env:{...process.env,BUK_QA_PORT:port,BUK_QA_FOCUS_PREVIEW:'1'},stdio:['ignore','pipe','inherit']});
let browser,page;const passed=[],errors=[],external=[];
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`);};
const poll=async(action,message)=>{for(let i=0;i<150;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message);};
const map=()=>page.getByRole('region',{name:'Matriz de cobertura por posición y horario',exact:true});
const status=()=>page.getByTestId('heatmap-move-status');
const panel=()=>page.getByTestId('focus-staff-panel');
const selected=()=>map().locator('td[data-move-selected="true"]');
const originalCell=()=>map().locator('td[data-occupant-id="T01"][data-range-hour="24"]').first();
const cell=(position,index)=>map().locator(`td[data-position="${position}"][data-range-hour="${index}"]`).first();
const draft=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18')||'null'));
const read=async path=>(await(await page.request.get(`${base}/qa-document?path=${encodeURIComponent(path)}`)).json()).data;
const seed=(path,data)=>page.request.post(`${base}/qa-document`,{data:{path,data}});
const undo=()=>page.getByRole('button',{name:'Deshacer cambio',exact:true}).click();
const cancel=async()=>{await page.keyboard.press('Escape');await status().waitFor({state:'hidden'});};
const begin=async()=>{
  await originalCell().scrollIntoViewIfNeeded();const b=await originalCell().boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await status().waitFor();
};
const over=async(position,index)=>{const b=await cell(position,index).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});};
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('QA startup timeout')),30000);server.once('error',reject);server.stdout.on('data',data=>{if(data.toString().includes('Editor BUK aislado:')){clearTimeout(timer);resolve();}});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
  page=await browser.newPage({viewport:{width:1600,height:1000},hasTouch:true,timezoneId:'America/Lima'});
  page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
  await page.goto(base);await originalCell().waitFor();
  const original=(await read('schedules/T01_2026-10-12_to_2026-10-18')).monday;
  if(!await panel().isVisible())await page.locator('button[aria-controls="focus-staff-panel"]').click();
  await panel().getByLabel('Buscar colaborador',{exact:true}).fill('Camila');
  const header=await page.getByTestId('heatmap-header').boundingBox();
  await page.getByRole('button',{name:'Mover colaborador',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Mover colaborador',exact:true}).getAttribute('aria-pressed'),'true');
  assert.ok(header.height<=136,'Movement action must fit in the compact header');
  await begin();await over('MASA',26);
  await poll(async()=>(await status().textContent()).includes('12:45–21:30'),'Move preview did not preserve the grabbed-cell offset');
  assert.equal(await selected().count(),33);
  assert.equal(await page.getByRole('dialog').count(),0,'Dragging within the heatmap must not open an extra panel or modal');
  assert.equal((await draft())?.changes.T01,undefined);
  await page.screenshot({path:`${output}/mouse-preview.png`});
  await page.mouse.up();await poll(async()=>(await draft())?.changes.T01?.monday?.position==='MASA','Movement was not applied');
  assert.equal((await draft()).changes.T01.monday.start,'12:45');assert.equal((await draft()).changes.T01.monday.end,'21:30');
  assert.equal((await draft()).changes.T01.monday.breakStart,'16:45');
  assert.equal(await page.getByRole('dialog').count(),0,'Releasing the shift applies directly without a confirmation modal');
  assert.equal(await panel().isVisible(),true);assert.equal(await panel().getByLabel('Buscar colaborador',{exact:true}).inputValue(),'Camila');
  assert.equal(await panel().getByTestId('focus-staff-editor').isVisible(),false);
  await undo();assert.equal((await draft())?.changes.T01,undefined);
  await page.getByRole('button',{name:'Rehacer cambio',exact:true}).click();assert.equal((await draft()).changes.T01.monday.position,'MASA');await undo();
  pass('Mover arrastra directamente una celda intermedia, previsualiza la jornada completa, conserva duración y break, mantiene el panel y permite deshacer/rehacer');

  await begin();await over('MASA',26);await poll(async()=>await selected().count()>0,'Preview missing');
  await seed('study_schedules/T01',{staffId:'T01',monday:{blocks:[{start:'00:00',end:'23:59'}]}});
  await page.mouse.up();await status().getByRole('alert').waitFor();assert.equal((await draft())?.changes.T01,undefined);
  await cancel();await seed('study_schedules/T01',{staffId:'T01'});
  pass('Un estudio cambiado después de previsualizar se consulta otra vez al soltar y bloquea el movimiento sin escribir al servidor');

  await seed('study_schedules/T01',{staffId:'T01',monday:{blocks:[{start:'14:00',end:'15:00'}]}});
  await begin();await over('MASA',26);
  await poll(async()=>await map().locator('td[data-move-conflict="true"]').count()===4,'The four conflicting quarters were not marked in the preview');
  assert.equal((await draft())?.changes.T01,undefined);await cancel();await page.mouse.up();
  await seed('study_schedules/T01',{staffId:'T01'});
  pass('La previsualización marca en rojo los cuatro cuartos del cruce académico y permite cancelar sin aplicar la propuesta');

  await originalCell().focus();await page.keyboard.press('Enter');await poll(async()=>await selected().count()>0,'Keyboard selection missing');
  await page.keyboard.press('ArrowRight');await poll(async()=>(await status().textContent()).includes('12:30–21:15'),'Keyboard did not move 15 minutes');
  await page.getByRole('button',{name:'Ajustar movimiento',exact:true}).click();
  const adjust=()=>page.getByRole('dialog',{name:/Ajustar movimiento ·/});await adjust().waitFor();
  assert.equal(await adjust().getByLabel('Desplazar horario en minutos').inputValue(),'15');
  await adjust().getByLabel('Puesto destino del movimiento').selectOption('MASA');
  await page.screenshot({path:`${output}/adjustments.png`});
  await page.keyboard.press('Escape');await adjust().waitFor({state:'hidden'});assert.equal(await status().isVisible(),true);
  await cancel();assert.equal((await draft())?.changes.T01,undefined);
  pass('Teclado selecciona y mueve por cuartos; Ajustar movimiento ofrece puesto y alcance; Escape cierra ajustes y luego cancela la propuesta');

  const delayed='**/qa-document?path=study_schedules%2FT01';let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
  await originalCell().focus();await page.keyboard.press('Enter');await poll(async()=>await selected().count()>0,'Selection not ready');
  await page.keyboard.press('ArrowRight');
  await page.route(delayed,async route=>{started();await gate;await route.continue();});
  await page.getByRole('button',{name:'Aplicar movimiento',exact:true}).click();await began;await cancel();
  const response=page.waitForResponse(value=>value.url().includes('study_schedules%2FT01'));release();await response;await page.unroute(delayed);
  await page.waitForTimeout(150);assert.equal((await draft())?.changes.T01,undefined);
  pass('Cancelar durante la comprobación de aplicación invalida la respuesta tardía y conserva el turno original');

  await page.getByRole('button',{name:'Maximizar mapa de cobertura',exact:true}).click();
  const fullscreen=page.getByRole('dialog',{name:/Mapa de Cobertura/});await fullscreen.waitFor();
  await originalCell().focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Ajustar movimiento',exact:true}).click();await adjust().waitFor();
  await adjust().getByLabel('Puesto destino del movimiento').selectOption('MASA');
  await adjust().getByRole('button',{name:'Aplicar al borrador',exact:true}).click();await adjust().waitFor({state:'hidden'});
  assert.equal(await fullscreen.isVisible(),true);assert.equal((await draft()).changes.T01.monday.start,original.start);
  await page.getByRole('button',{name:'Minimizar mapa de cobertura',exact:true}).click();await undo();
  pass('El movimiento y sus ajustes funcionan encima del mapa maximizado y conservan la vista al aplicar');

  if(await panel().isVisible())await page.getByRole('button',{name:'Cerrar panel de colaboradores',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await originalCell().scrollIntoViewIfNeeded();let b=await originalCell().boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
  await poll(async()=>await selected().count()>0,'Touch did not select the occupant');
  const touchTarget=map().locator('td[data-range-hour="26"]:not([data-occupant-id])').first();
  await touchTarget.scrollIntoViewIfNeeded();b=await touchTarget.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
  await poll(async()=>(await status().textContent()).includes('12:45–21:30'),'Touch destination did not preview the selected shift');
  await page.getByRole('button',{name:'Ajustar movimiento',exact:true}).click();await adjust().waitFor();
  assert.ok((await adjust().boundingBox()).width<=390);
  await adjust().getByLabel('Desplazar horario en minutos').fill('0');
  await adjust().getByRole('button',{name:'Mover 15 minutos después',exact:true}).click();
  await adjust().getByLabel('Puesto destino del movimiento').selectOption('MASA');
  await page.screenshot({path:`${output}/mobile-adjustments.png`});
  await adjust().getByRole('button',{name:'Aplicar al borrador',exact:true}).click();await adjust().waitFor({state:'hidden'});
  assert.equal((await draft()).changes.T01.monday.start,'12:30');assert.equal((await draft()).changes.T01.monday.position,'MASA');
  assert.deepEqual(await page.evaluate(()=>window.bukQaWrites),[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  pass('En móvil un toque selecciona al colaborador y los ajustes permiten moverlo sin arrastrar ni publicar el horario');
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,errors,external},null,2));
}catch(error){await page?.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,external,error:String(error)},null,2));throw error;}
finally{await browser?.close();server.kill();}
