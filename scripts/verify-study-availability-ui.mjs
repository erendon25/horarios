// Real WeeklyScheduleEditor, ScheduleRequestForm and manager with local transport.
// Database approval-conflict enforcement is verified separately by the SQL suite;
// this browser suite checks that an API rejection leaves the pending UI intact.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {getApprovedBukOptions} from '../src/services/bukSchedule.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=process.env.BUK_QA_PORT||'4201',base=`http://127.0.0.1:${port}`,output='output/study-availability-ui';
await mkdir(output,{recursive:true});
const fixture=JSON.parse(await readFile('artifacts/buk/fixture.json','utf8'));
const server=spawn(process.execPath,['scripts/serve-buk-qa.mjs'],{env:{...process.env,BUK_QA_PORT:port,BUK_QA_STUDY_AVAILABILITY:'1'},stdio:['ignore','pipe','inherit']});
const passed=[],errors=[],unexpectedNetwork=[],alerts=[],observations=[];
let browser,context,editor,request,manager;
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`)};
const poll=async(action,message)=>{for(let i=0;i<100;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message)};
const document=async(path,data)=>{
 const response=await editor.request.post(`${base}/qa-document`,{data:{path,data}});assert.equal(response.ok(),true);
};
const control=async(data)=>{const response=await editor.request.post(`${base}/qa-control`,{data});assert.equal(response.ok(),true)};
const savedRequests=async()=>(await editor.request.get(`${base}/qa-collection?path=schedule_requests`)).json();
const studyPath='study_schedules/PT1',schedulePath='schedules/PT1_2026-10-12_to_2026-10-18';
const normalStudy={monday:{free:false,blocks:[{start:'10:00',end:'12:00'}]},tuesday:{free:false,blocks:[{start:'00:00',end:'02:00'}]}};
const editorSelect=()=>editor.getByLabel('Horario aprobado BUK de Prueba PT1',{exact:true});
const requestSelect=()=>request.getByLabel('Horario aprobado solicitado',{exact:true});
const editorDay=()=>editor.locator('select').filter({has:editor.locator('option[value="monday"]')}).first();
const optionIds=async(select)=>{
 if(await select.isDisabled())return [];
 if(await select.evaluate(element=>element.tagName)==='BUTTON'){
  await select.click();
  const picker=editor.getByRole('dialog',{name:'Seleccionar horario',exact:true});await picker.waitFor();
  const ids=await picker.locator('[data-shift-id]').evaluateAll(buttons=>buttons.filter(button=>!button.disabled).map(button=>button.dataset.shiftId).sort());
  await picker.getByRole('button',{name:'Cerrar selector',exact:true}).click();
  return ids;
 }
 return select.locator('option').evaluateAll(options=>options.filter(option=>option.value&&!option.disabled).map(option=>option.value).sort());
};
const longOptions=getApprovedBukOptions('Part-Time',1).filter(option=>option.duration===240);
const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
// Independent check of the two fixture blocks, including touching boundaries.
const expectedNormal=longOptions.filter(option=>{
 const start=minute(option.start);let end=minute(option.end);if(end<=start)end+=1440;
 return !(start<720&&end>600)&&!(start<1560&&end>1440);
}).map(option=>option.id).sort();
const clearDraft=page=>page.evaluate(()=>{if(location.origin==='null')return;for(const key of Object.keys(localStorage))if(key.startsWith('schedule_draft_v2:'))localStorage.removeItem(key)});
const loadEditor=async()=>{
 await clearDraft(editor);await editor.goto(base);await editorSelect().waitFor();
 await poll(()=>editorSelect().locator('xpath=ancestor::fieldset[1]').isEnabled(),'The editor draft has not finished loading');
};
const loadRequest=async(date='2026-10-12')=>{
 await request.goto(`${base}/?request`);
 await request.getByLabel('Fecha de la solicitud',{exact:true}).fill(date);
 await request.getByLabel('Turno solicitado',{exact:true}).selectOption('rango');
 await requestSelect().waitFor();
};
const compareOptions=async(expected,label)=>{
 await poll(async()=>JSON.stringify(await optionIds(editorSelect()))===JSON.stringify(expected)
  &&JSON.stringify(await optionIds(requestSelect()))===JSON.stringify(expected),`${label}: editor/request option sets differ`);
 observations.push({label,editor:await optionIds(editorSelect()),request:await optionIds(requestSelect())});
};
const watch=page=>{page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{alerts.push(dialog.message());dialog.accept()})};
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Study availability QA server startup timeout')),30000);
  server.once('error',error=>{clearTimeout(timeout);reject(error)});server.once('exit',code=>{clearTimeout(timeout);reject(Error(`QA server exited ${code}`))});
  server.stdout.on('data',data=>{if(data.toString().includes('Editor BUK aislado:')){clearTimeout(timeout);resolve()}});
 });
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Lima'});
 await context.addInitScript(()=>{
  const OriginalDate=Date;const fixed='2026-10-12T15:00:00Z';
  window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return OriginalDate.parse(fixed)}};
 });
 await context.route('https://**/*',route=>{unexpectedNetwork.push(route.request().url());return route.abort()});
 editor=await context.newPage();request=await context.newPage();watch(editor);watch(request);
 await document(studyPath,normalStudy);
 await loadEditor();await loadRequest();
 await compareOptions(expectedNormal,'Lunes con clases10–12 y martes00–02');
 assert.ok(expectedNormal.includes('PT1-5'),'06–10 touches the class start and must remain valid');
 assert.ok(expectedNormal.includes('PT1-29'),'12–16 touches the class end and must remain valid');
 assert.ok(expectedNormal.includes('PT1-61'),'20–00 touches the next-day block and must remain valid');
 assert.equal(expectedNormal.includes('PT1-65'),false,'21–01 overlaps next-day00–02 and must be excluded');
 assert.ok((await optionIds(editorSelect())).every(id=>longOptions.some(option=>option.id===id)),'Weekly quota must still exclude the already used3:45 slot');
 await request.screenshot({path:`${output}/solicitud-opciones-compatibles.png`,fullPage:true});
 pass('Editor y solicitudes ofrecen los mismos turnos compatibles: bordes coincidentes válidos, cruce nocturno al día siguiente bloqueado y cuota PT intacta');

 await editorDay().selectOption('saturday');
 await request.getByLabel('Fecha de la solicitud',{exact:true}).fill('2026-10-17');
 const short=getApprovedBukOptions('Part-Time',1).filter(option=>option.duration===225).map(option=>option.id).sort();
 await compareOptions(short,'Sábado deja solo cuota3:45');
 await editorDay().selectOption('sunday');
 assert.equal(await editorSelect().isDisabled(),true);
 assert.match(await editorSelect().textContent(),/Día libre/);
 await editorSelect().evaluate(button=>button.click());
 assert.equal(await editor.getByRole('dialog',{name:'Seleccionar horario',exact:true}).count(),0,'Un día libre no debe abrir el selector');
 const offRow=editorSelect().locator('xpath=ancestor::tr[1]');
 assert.equal(await offRow.getByTitle('Entrada',{exact:true}).inputValue(),'');
 pass('La cuota mantiene solo3:45 para el sexto día y un día Libre no puede reasignarse mediante el selector bloqueado');

 await document(studyPath,{monday:{free:true,blocks:[]}});
 await loadEditor();await loadRequest();
 await request.getByRole('status').filter({hasText:'No hay turnos aprobados compatibles'}).waitFor();
 await compareOptions([],'Día libre solicitado en disponibilidad');
 await request.getByLabel('Motivo de la solicitud',{exact:true}).fill('Prueba de día libre solicitado');
 await request.getByLabel('Turno solicitado',{exact:true}).selectOption('apertura');
 assert.equal(await request.getByRole('button',{name:'Enviar Solicitud',exact:true}).isDisabled(),true,'Generic work requests cannot bypass a requested day off');
 await document(studyPath,null);
 await loadEditor();await loadRequest();
 await compareOptions(longOptions.map(option=>option.id).sort(),'Sin horario de estudios registrado');
 pass('free:true bloquea cualquier solicitud de trabajo; la ausencia de estudios permite todos los turnos que quedan en el plan');

 await document(studyPath,normalStudy);await control({readErrors:[studyPath,'study_schedules']});
 await loadEditor();await loadRequest();
 await request.getByRole('alert').waitFor();
 assert.equal(await requestSelect().isDisabled(),true);
 assert.equal(await request.getByRole('button',{name:'Enviar Solicitud',exact:true}).isDisabled(),true);
 await poll(()=>editorSelect().isDisabled(),'Editor must fail closed when studies cannot be loaded');
 const unavailableRow=editorSelect().locator('xpath=ancestor::tr[1]');
 assert.equal(await unavailableRow.getByTitle('Entrada',{exact:true}).isDisabled(),true);
 assert.equal(await unavailableRow.getByTitle('Salida',{exact:true}).isDisabled(),true);
 for(const input of await unavailableRow.locator('input[type=number]').all())assert.equal(await input.isDisabled(),true,'Extra hours must remain locked while availability is unknown');
 await control({readErrors:[]});
 await request.getByRole('button',{name:'Reintentar disponibilidad',exact:true}).click();
 await loadEditor();await compareOptions(expectedNormal,'Disponibilidad recuperada después del fallo');
 pass('Un fallo de carga bloquea opciones y envío; reintentar recupera la disponibilidad sin tratar el error como ausencia de estudios');

 const invalid=structuredClone(fixture.schedules.PT1);
 const invalidOption=longOptions.find(option=>option.start==='08:00'&&option.end==='12:00');
 assert.ok(invalidOption);
 invalid.monday={...invalid.monday,start:'08:00',end:'12:00',bukApprovedShiftId:invalidOption.id};
 await document(schedulePath,invalid);await loadEditor();
 const savedRow=editorSelect().locator('xpath=ancestor::tr[1]');
 await poll(async()=>await savedRow.getByTitle('Entrada',{exact:true}).inputValue()==='08:00','The saved incompatible schedule did not finish loading');
 assert.equal(await savedRow.getByTitle('Entrada',{exact:true}).inputValue(),'08:00');
 assert.equal(await savedRow.getByTitle('Salida',{exact:true}).inputValue(),'12:00');
 assert.equal((await optionIds(editorSelect())).includes(invalidOption.id),false);
 assert.match(await savedRow.textContent(),/estudio|disponibilidad/i,'The preserved incompatible shift must carry a visible explanation');
 const stillSaved=(await (await editor.request.get(`${base}/qa-document?path=${encodeURIComponent(schedulePath)}`)).json()).data;
 assert.equal(stillSaved.monday.start,'08:00');assert.equal(stillSaved.monday.end,'12:00');
 await savedRow.screenshot({path:`${output}/guardado-incompatible-conservado.png`});
 pass('Un horario ya guardado incompatible permanece visible con aviso y no se elimina del documento ni se ofrece como opción válida');

 await document(schedulePath,fixture.schedules.PT1);await document(studyPath,normalStudy);
 await loadRequest();await poll(()=>requestSelect().isEnabled(),'Request selector did not finish loading');
 await requestSelect().selectOption('PT1-29');
 await request.getByLabel('Motivo de la solicitud',{exact:true}).fill('Prueba de cambio de estudios antes de enviar');
 await document(studyPath,{monday:{free:false,blocks:[{start:'12:00',end:'16:00'}]}});
 await request.getByRole('button',{name:'Enviar Solicitud',exact:true}).click();
 await request.getByRole('alert').filter({hasText:/disponibilidad|plan semanal/}).waitFor();
 assert.equal((await savedRequests()).length,0,'A stale compatible selection cannot be submitted after studies change');
 await document(studyPath,normalStudy);await loadRequest();
 await poll(()=>requestSelect().isEnabled(),'Request selector did not reload');
 await requestSelect().selectOption('PT1-5');
 await request.getByLabel('Motivo de la solicitud',{exact:true}).fill('Solicitud de prueba compatible');
 await request.getByRole('button',{name:'Enviar Solicitud',exact:true}).click();
 await poll(async()=>(await savedRequests()).length===1,'Compatible request was not saved');
 const created=(await savedRequests())[0];
 assert.equal(created.data.staffId,'PT1');assert.equal(created.data.storeId,'qa-store');
 assert.equal(created.data.startTime,'06:00');assert.equal(created.data.endTime,'10:00');assert.equal(created.data.status,'pending');
 pass('Antes de enviar se vuelve a comprobar estudio y plan: una selección antigua se rechaza y un rango vigente sí crea una solicitud pendiente');

 await document(studyPath,{monday:{free:false,blocks:[{start:'06:00',end:'10:00'}]}});
 await control({rejectApprovals:true});
 manager=await context.newPage();watch(manager);await manager.goto(`${base}/?manager`);
 await manager.getByRole('button',{name:'Aprobar',exact:true}).click();
 await poll(()=>alerts.some(message=>message.includes('horario de estudios actualizado')),'Manager did not disclose the approval API rejection');
 assert.equal((await savedRequests())[0].data.status,'pending','Rejected approval must not change pending status');
 await manager.getByRole('button',{name:'Aprobar',exact:true}).waitFor();
 observations.push({approvalScope:'API rejection simulated for UI; actual concurrent study-change database enforcement is tested separately in test-study-availability-db.mjs',alerts});
 pass('El gestor muestra un rechazo de aprobación del servidor y conserva la solicitud pendiente cuando cambió el estudio');

 await document(studyPath,normalStudy);
 await request.goto(`${base}/?request&position=ASISTENTE`);
 await request.getByLabel('Fecha de la solicitud',{exact:true}).fill('2026-10-12');
 await request.getByLabel('Turno solicitado',{exact:true}).selectOption('rango');
 const manualStart=request.getByLabel('Hora Inicio',{exact:true}),manualEnd=request.getByLabel('Hora Fin',{exact:true});
 await manualStart.fill('10:30');await manualEnd.fill('14:00');
 await request.getByLabel('Motivo de la solicitud',{exact:true}).fill('Rango de asistente fuera del catálogo');
 await request.getByRole('alert').waitFor();
 assert.equal(await request.getByRole('button',{name:'Enviar Solicitud',exact:true}).isDisabled(),true);
 await manualStart.fill('12:10');await manualEnd.fill('16:25');
 await poll(async()=>await request.getByRole('button',{name:'Enviar Solicitud',exact:true}).isEnabled(),'A compatible exempt role range should be allowed without requiring a catalog shift');
 assert.equal(await requestSelect().count(),0,'Exempt roles keep manual range controls');
 await request.getByRole('button',{name:'Enviar Solicitud',exact:true}).click();
 await poll(async()=>(await savedRequests()).length===2,'Compatible assistant request was not saved');
 const manualRequest=(await savedRequests()).find(row=>row.data.startTime==='12:10');
 assert.ok(manualRequest);assert.equal(manualRequest.data.endTime,'16:25');
 pass('Asistentes conservan rangos fuera del catálogo, con bloqueo por estudios y envío válido cuando son compatibles');

 // Previous-week documents are independent fixtures. Copy one valid empty day,
 // skip the study conflict, and preserve an already assigned destination day.
 await document(studyPath,normalStudy);
 const destination=structuredClone(fixture.schedules.PT1);
 destination.monday={};destination.friday={};
 const previous=structuredClone(fixture.schedules.PT1);
 previous.monday={...previous.monday,start:'08:00',end:'12:00',bukApprovedShiftId:invalidOption.id};
 previous.friday={...previous.friday,start:'12:00',end:'16:00',bukApprovedShiftId:'PT1-29'};
 previous.wednesday={...previous.wednesday,start:'12:00',end:'16:00',bukApprovedShiftId:'PT1-29'};
 await document(schedulePath,destination);
 const previousKey='2026-10-05_to_2026-10-11';
 await document(`schedules/PT1_${previousKey}`,previous);
 const previousResponses=new Map();
 const recordPrevious=response=>{
  const url=new URL(response.url());const path=url.searchParams.get('path')||'';
  if(path.startsWith('schedules/')&&path.endsWith(previousKey))previousResponses.set(path,response);
 };
 editor.on('response',recordPrevious);
 await loadEditor();
 await poll(()=>previousResponses.size>=5,'Previous-week schedule fixtures did not finish loading');
 await Promise.all([...previousResponses.values()].map(response=>response.finished()));
 editor.off('response',recordPrevious);
 await editor.getByRole('button',{name:'Replicar Horario',exact:true}).click();
 const replicate=editor.getByRole('heading',{name:'Replicar Horario (Semana Pasada)',exact:true}).locator('xpath=ancestor::div[contains(@class,"fixed")][1]');
 await replicate.getByLabel('Prueba PT1 BUK',{exact:true}).check();
 for(const day of ['Lunes','Miércoles','Viernes'])await replicate.getByLabel(day,{exact:true}).check();
 await replicate.getByRole('button',{name:'Confirmar Replicación',exact:true}).click();
 await poll(()=>alerts.some(message=>message.includes('Se omitieron 1 turnos')),'Replication did not disclose the skipped study-conflicting shift');
 let replicatedRow=editorSelect().locator('xpath=ancestor::tr[1]');
 assert.equal(await replicatedRow.getByTitle('Entrada',{exact:true}).inputValue(),'');
 await editorDay().selectOption('friday');
 assert.equal(await replicatedRow.getByTitle('Entrada',{exact:true}).inputValue(),'12:00');
 assert.equal(await replicatedRow.getByTitle('Salida',{exact:true}).inputValue(),'16:00');
 await replicatedRow.screenshot({path:`${output}/replicacion-compatible-en-borrador.png`});
 await editorDay().selectOption('wednesday');
 assert.equal(await replicatedRow.getByTitle('Entrada',{exact:true}).inputValue(),'06:00');
 assert.equal(await replicatedRow.getByTitle('Salida',{exact:true}).inputValue(),'10:00');
 const beforeSave=(await (await editor.request.get(`${base}/qa-document?path=${encodeURIComponent(schedulePath)}`)).json()).data;
 assert.deepEqual(beforeSave.friday,{},'Replication must remain a draft until the administrator saves');
 pass('Replicar copia el día compatible, omite el conflicto de estudios con contador y conserva el turno ya asignado sin guardar automáticamente');

 await loadRequest();await poll(()=>requestSelect().isEnabled(),'Mobile request selector did not load');
 await request.setViewportSize({width:390,height:844});
 const bounds=await requestSelect().boundingBox();assert.ok(bounds&&bounds.x>=-1&&bounds.x+bounds.width<=391);
 await request.screenshot({path:`${output}/solicitud-mobile.png`,fullPage:true});
 const editorWrites=await editor.evaluate(()=>window.bukQaWrites);
 assert.deepEqual(editorWrites,[],'Inspecting availability must not write staff schedules');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpectedNetwork,[]);
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,observations,errors,unexpectedNetwork,alerts,
  scope:'Real editor/request/manager React UI with local documents and request persistence; approval API failure simulated; no production access'},null,2));
}catch(error){
 await editor?.screenshot({path:`${output}/fallo-editor.png`,fullPage:true}).catch(()=>{});
 await (manager||request||editor)?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,observations,errors,unexpectedNetwork,error:String(error),alerts},null,2));
 throw error;
}finally{await browser?.close();server.kill();}
