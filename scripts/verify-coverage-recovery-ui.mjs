// Real UI with isolated fictional documents; this never contacts production.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=process.env.BUK_QA_PORT||'4233',base=`http://127.0.0.1:${port}`,output='output/coverage-recovery';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-buk-qa.mjs'],{env:{...process.env,BUK_QA_PORT:port,BUK_QA_FOCUS_PREVIEW:'1'},stdio:['ignore','pipe','inherit']});
const passed=[],errors=[],external=[];let browser,page;
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`);};
const poll=async(action,message)=>{for(let i=0;i<150;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message);};
const card=id=>page.locator(`[data-focus-person-id="${id}"]`);
const panel=()=>page.getByTestId('focus-staff-panel');
const map=()=>page.getByRole('region',{name:'Matriz de cobertura por posición y horario',exact:true});
const writes=()=>page.evaluate(()=>window.bukQaWrites);
const draft=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18')||'null'));
const showStaff=async()=>{if(!await panel().isVisible())await page.locator('button[aria-controls="focus-staff-panel"]').click();};
const search=async(name)=>{await showStaff();await panel().getByLabel('Buscar colaborador',{exact:true}).fill(name);};
const undo=()=>page.getByRole('button',{name:'Deshacer cambio',exact:true}).click();
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Local QA startup timeout')),30000);server.once('error',reject);server.stdout.on('data',data=>{if(data.toString().includes('Editor BUK aislado:')){clearTimeout(timer);resolve();}});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
  page=await browser.newPage({viewport:{width:1600,height:1000},timezoneId:'America/Lima'});
  page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
  await page.goto(base);await map().locator('td').first().waitFor();
  assert.equal(await map().locator('th[scope="col"]').count(),77);
  await search('Camila');await card('F01').waitFor();assert.match(await card('F01').textContent(),/Ayer:.*Cumpleaños/);
  const off=card('F01').getByRole('checkbox',{name:/Día libre/});
  page.once('dialog',dialog=>dialog.dismiss());await off.click();assert.equal(await off.isChecked(),false);
  page.once('dialog',dialog=>dialog.accept());await off.check();await poll(async()=>(await draft())?.changes.F01.monday.off,'Quick rest not drafted');
  await undo();assert.equal(await off.isChecked(),false);
  await page.getByRole('button',{name:'Rehacer cambio',exact:true}).click();assert.equal(await off.isChecked(),true);
  await undo();assert.deepEqual(await writes(),[]);
  pass('Libre rápido confirma reemplazos y deshacer/rehacer recuperan el turno completo; ayer y cumpleaños son visibles sin escribir al servidor');

  await search('Hugo');const target=map().locator('td[data-position="VESTIDO"][data-missing="true"][data-range-hour="20"]').first();
  await card('P12').dragTo(target);
  const placement=()=>page.getByRole('dialog',{name:/Colocar en cobertura/});
  await placement().getByTestId('coverage-placement-preview').waitFor();assert.deepEqual(await writes(),[]);
  await placement().getByRole('button',{name:'Confirmar colocación',exact:true}).click();await placement().waitFor({state:'hidden'});
  assert.ok((await draft()).changes.P12.monday.bukApprovedShiftId);assert.equal((await draft()).changes.P12.monday.position,'VESTIDO');
  await undo();assert.equal((await draft()).changes.P12,undefined);
  pass('Arrastrar tarjeta al mapa propone un turno aprobado, confirma al borrador y se puede deshacer sin publicar');

  await search('Hugo');await card('P12').getByRole('button',{name:'Elegir destino sin arrastrar',exact:true}).click();
  await placement().getByLabel('Posición de colocación').selectOption('VESTIDO');await placement().getByLabel('Hora de colocación').selectOption('720');
  await placement().getByRole('button',{name:'Ver propuesta',exact:true}).click();await placement().getByTestId('coverage-placement-preview').waitFor();
  await page.request.post(`${base}/qa-document`,{data:{path:'study_schedules/P12',data:{staffId:'P12',monday:{blocks:[{start:'00:00',end:'23:59'}]}}}});
  await placement().getByRole('button',{name:'Confirmar colocación',exact:true}).click();await placement().getByRole('alert').waitFor();
  assert.equal((await draft()).changes.P12,undefined);assert.deepEqual(await writes(),[]);
  await placement().getByRole('button',{name:'Cancelar',exact:true}).click();await page.request.post(`${base}/qa-document`,{data:{path:'study_schedules/P12',data:{staffId:'P12'}}});
  pass('Alternativa al arrastre funciona con controles de teclado y vuelve a consultar estudios antes de aplicar; un cambio externo cancela la asignación');

  await search('Hugo');await card('P12').getByRole('button',{name:'Elegir destino sin arrastrar',exact:true}).click();
  let releaseRead,readStarted;
  const gate=new Promise(resolve=>{releaseRead=resolve;}),started=new Promise(resolve=>{readStarted=resolve;});
  const delayed='**/qa-document?path=staff_profiles%2FP12';
  await page.route(delayed,async route=>{readStarted();await gate;await route.continue();});
  await placement().getByLabel('Posición de colocación').selectOption('VESTIDO');await placement().getByLabel('Hora de colocación').selectOption('720');
  await placement().getByRole('button',{name:'Ver propuesta',exact:true}).click();await started;
  await placement().getByRole('button',{name:'Cancelar',exact:true}).click();
  const resumed=page.waitForResponse(response=>response.url().includes('staff_profiles%2FP12'));releaseRead();await resumed;await page.unroute(delayed);await page.waitForTimeout(150);
  assert.equal(await placement().count(),0);assert.equal((await draft()).changes.P12,undefined);
  pass('Cancelar mientras se consulta disponibilidad invalida la sesión y no aplica respuestas tardías');

  await search('Lucía');const original=(await (await page.request.get(`${base}/qa-document?path=schedules%2FT01_2026-10-12_to_2026-10-18`)).json()).data.monday;
  await card('T01').getByRole('button',{name:'Mover turno',exact:true}).click();await placement().getByLabel('Posición de colocación').selectOption('MASA');
  await placement().getByLabel('Hora de colocación').selectOption(String(Number(original.start.slice(0,2))*60+Number(original.start.slice(3))));
  await placement().getByRole('button',{name:'Ver propuesta',exact:true}).click();await placement().getByTestId('coverage-placement-preview').waitFor();
  await placement().getByRole('button',{name:'Confirmar colocación',exact:true}).click();await placement().waitFor({state:'hidden'});
  assert.equal((await draft()).changes.T01.monday.position,'MASA');assert.equal((await draft()).changes.T01.monday.start,original.start);assert.equal((await draft()).changes.T01.monday.end,original.end);await undo();
  pass('Mover un turno existente cambia su posición con vista previa y conserva el rango aprobado; deshacer recupera sus datos');

  await page.getByRole('button',{name:'Ver horario semanal',exact:true}).click();const weekly=page.getByRole('dialog',{name:'Horario semanal',exact:true});
  await weekly.getByRole('button',{name:'Ver breaks',exact:true}).click();assert.match(await weekly.textContent(),/Break:/);await weekly.getByRole('button',{name:'Cerrar Horario semanal',exact:true}).click();
  await search('Camila');await card('F01').getByRole('button',{name:/Información de/}).click();const info=page.getByRole('dialog',{name:/Ficha de Camila/});
  assert.match(await info.textContent(),/Estudios/);await info.getByLabel('Categoría de trabajo').selectOption('production');await info.getByRole('button',{name:'Guardar categoría',exact:true}).click();
  await poll(async()=>(await (await page.request.get(`${base}/qa-document?path=staff_profiles/F01`)).json()).data?.workCategory==='production','Category not saved');
  await info.getByRole('button',{name:/Cerrar Ficha/}).click();
  await panel().getByText('Modalidad y categoría',{exact:false}).click();await panel().getByLabel('Categoría del listado').selectOption('uncategorized');assert.equal(await panel().locator('[data-focus-person-id]').count(),0);
  await panel().getByLabel('Categoría del listado').selectOption('all');
  pass('Vista semanal alterna turnos/breaks; ficha muestra contexto y permite asignar categoría sin afectar horarios; filtro del listado usa la categoría');

  await page.getByRole('button',{name:'Cerrar panel de colaboradores',exact:true}).click();
  await page.getByRole('button',{name:'Buscar cobertura',exact:true}).click();
  const first=map().locator('td[data-position="VESTIDO"][data-missing="true"][data-range-hour="20"]').first(),lane=await first.getAttribute('data-range-row');
  await first.click();await map().locator(`td[data-range-row="${lane}"][data-range-hour="21"]`).click();
  const candidates=page.getByRole('dialog',{name:'Colaboradores para cubrir el tramo',exact:true});await candidates.waitFor();
  await candidates.locator('[data-coverage-person-id="P12"]').getByRole('button',{name:/Agregar turno/}).first().click();await candidates.waitFor({state:'hidden'});
  assert.ok((await draft()).changes.P12.monday.bukApprovedShiftId);await undo();
  pass('Buscar cobertura informa categoría y necesidad restante, y agrega el turno seleccionado tras una nueva validación');

  const insight=page.getByTestId('coverage-insights');await insight.getByText('Personas por hora',{exact:true}).click();await insight.getByRole('button',{name:'Personas a las 12:00',exact:true}).click();
  await insight.getByRole('region',{name:'Personas por cuarto de hora'}).waitFor();
  await search('Hugo');await card('P12').getByRole('checkbox',{name:/Día libre/}).check();
  await panel().getByRole('button',{name:'Guardar desde panel',exact:true}).click();await poll(async()=>(await writes()).some(item=>item.path.startsWith('schedules/P12_') && item.data.monday.off),'Panel save not sent');
  await poll(async()=>await page.getByRole('button',{name:'Deshacer cambio',exact:true}).isDisabled(),'Save was not acknowledged');
  await page.reload();await search('Hugo');await poll(async()=>await card('P12').getByRole('checkbox',{name:/Día libre/}).isChecked(),'Reload did not recover the saved rest day');
  await page.setViewportSize({width:390,height:844});await panel().waitFor();assert.ok((await panel().boundingBox()).width<=390);await panel().getByRole('button',{name:'Guardar desde panel',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/mobile.png`});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  pass('Personas por hora desglosa cuartos; Guardar desde el panel persiste y la recarga conserva el descanso en móvil');
  await page.getByRole('button',{name:'Cerrar panel de colaboradores',exact:true}).click();
  await page.getByLabel('Semana comenzando el',{exact:true}).fill('2026-12-07');await page.getByRole('combobox',{name:'Día del horario',exact:true}).waitFor();
  assert.match(await page.getByRole('combobox',{name:'Día del horario',exact:true}).locator('option[value="tuesday"]').textContent(),/Feriado/);
  pass('El selector identifica feriados nacionales de la semana también en móvil');
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,errors,external},null,2));
}catch(error){await page?.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,external,error:String(error)},null,2));throw error;}
finally{await browser?.close();server.kill();}
