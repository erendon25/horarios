// Preview-only two-endpoint coverage flow, using real editor/map/candidate UI.
// Fictional schedules and studies use the isolated HTTP/SSE transport.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=process.env.BUK_QA_PORT||'5224',base=`http://127.0.0.1:${port}`,output='output/heatmap-coverage-qa';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-buk-qa.mjs'],{env:{...process.env,BUK_QA_PORT:port,BUK_QA_FOCUS_PREVIEW:'1'},stdio:['ignore','pipe','inherit']});
const passed=[],errors=[],external=[],observations=[];let browser,page;
const name='Hugo Prueba Ficticio',schedulePath='schedules/P12_2026-10-12_to_2026-10-18',studyPath='study_schedules/P12',projectionPath='stores/qa-store/config/schedule_projection';
const poll=async(action,message)=>{for(let i=0;i<120;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message)};
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`)};
const map=(scope=page)=>scope.getByRole('region',{name:'Matriz de cobertura por posición y horario',exact:true});
const candidates=()=>page.getByRole('dialog',{name:'Colaboradores para cubrir el tramo',exact:true});
const candidateAction=()=>candidates().getByRole('button',{name:`Ver en editor a ${name}`,exact:true});
const writes=()=>page.evaluate(()=>window.bukQaWrites);
const draft=()=>page.evaluate(()=>localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18'));
const read=async path=>(await (await page.request.get(`${base}/qa-document?path=${encodeURIComponent(path)}`)).json()).data;
const seed=async(path,data)=>assert.equal((await page.request.post(`${base}/qa-document`,{data:{path,data}})).ok(),true);
const digest=()=>map().locator('td[data-range-hour]').evaluateAll(elements=>elements.map(e=>[e.dataset.rangeRow,e.dataset.rangeHour,e.title,[...e.classList].find(c=>c.startsWith('bg-'))]));
const mode=async(scope=page)=>{const button=scope.getByRole('button',{name:'Buscar cobertura',exact:true});if(await button.getAttribute('aria-pressed')!=='true')await button.click()};
const clear=async(scope=page)=>{const button=scope.getByRole('button',{name:'Limpiar selección de cobertura',exact:true});if(await button.isVisible())await button.click()};
const selectGap=async(scope=page,reverse=false,touch=false)=>{
 await mode(scope);await clear(scope);const first=map(scope).locator('td[data-position="VESTIDO"][data-missing="true"][data-range-hour="20"]').first();await first.waitFor();
 const lane=await first.getAttribute('data-range-row'),last=map(scope).locator(`td[data-range-row="${lane}"][data-range-hour="34"]`);assert.equal(await last.getAttribute('data-missing'),'true');
 for(const cell of reverse?[last,first]:[first,last]){await cell.scrollIntoViewIfNeeded();if(touch){const b=await cell.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2)}else await cell.click()}
 await candidates().waitFor();
 await candidates().getByLabel('Buscar candidato para cobertura',{exact:true}).waitFor();
 return {lane,first,last};
};
const closeCandidates=async()=>{await candidates().getByRole('button',{name:'Cerrar búsqueda de cobertura',exact:true}).click();await candidates().waitFor({state:'detached'})};
const assertRange=async()=>{const text=await candidates().getByTestId('coverage-selected-range').textContent();assert.match(text,/12:00/);assert.match(text,/15:45/);assert.match(text,/3\s*(?:h|:)\s*45/);return text};
try{
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Coverage UI QA startup timeout')),30000);server.once('error',reject);server.once('exit',code=>reject(Error(`QA server exit${code}`)));server.stdout.on('data',data=>{if(data.toString().includes('Editor BUK aislado:')){clearTimeout(timeout);resolve()}})});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1600,height:1000},hasTouch:true,timezoneId:'America/Lima'});page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort()});
 await page.goto(`${base}/?vista=cobertura`);await page.getByTestId('schedule-focus-workspace').waitFor();await map().waitFor();await poll(async()=>(await map().locator('td[data-missing="true"]').count())>0,'La proyección no terminó de cargar');
 const originalProjection=await read(projectionPath),originalSchedule=await read(schedulePath),originalMap=await digest(),originalDraft=await draft();
 await selectGap();const range=await assertRange();await candidateAction().waitFor();
 assert.deepEqual(await candidates().locator('[data-coverage-person-id]').evaluateAll(elements=>elements.map(e=>e.dataset.coveragePersonId)),['P12'],'Solo debe ofrecer personal sin turno ese día, aunque haya personal ya asignado en exceso');
 assert.equal(await candidates().getByRole('region',{name:'En turno · traslado posible',exact:true}).count(),0);
 assert.deepEqual(await digest(),originalMap,'Seleccionar faltantes no debe cambiar los colores');assert.equal(await draft(),originalDraft);assert.deepEqual(await writes(),[]);assert.deepEqual(await read(schedulePath),originalSchedule);
 await candidates().screenshot({path:`${output}/candidatos-desktop.png`});await closeCandidates();observations.push({range});
 pass('Dos extremos amarillos12:00 y15:30 producen12:00–15:45(3:45) y ofrecen solo personal sin turno ese día, sin modificar colores, horarios ni borrador');

 await selectGap(page,true);await assertRange();await closeCandidates();await mode();await clear();
 const start=map().locator('td[data-position="VESTIDO"][data-missing="true"][data-range-hour="20"]').first();await start.click();
 await map().locator('td[data-missing="true"][data-range-hour="34"]:not([data-position="VESTIDO"])').first().click();
 assert.equal(await candidates().count(),0);await page.getByRole('alert').filter({hasText:/carril|fila|posición/i}).waitFor();
 const broken=structuredClone(originalProjection);broken.requirements.monday.matrix['0']['6']=1;await seed(projectionPath,broken);await clear();
 const lane=await start.getAttribute('data-range-row');await poll(async()=>await map().locator(`td[data-range-row="${lane}"][data-range-hour="28"]`).getAttribute('data-missing')==='false','El hueco de la selección no se actualizó');
 await start.click();await map().locator(`td[data-range-row="${lane}"][data-range-hour="34"]`).click();assert.equal(await candidates().count(),0);await page.getByRole('alert').filter({hasText:/continu|amarill|faltant/i}).waitFor();
 await seed(projectionPath,originalProjection);await poll(async()=>await map().locator(`td[data-range-row="${lane}"][data-range-hour="28"]`).getAttribute('data-missing')==='true','No se recuperó el tramo continuo');
 pass('Los extremos invertidos se normalizan; cambiar de carril o atravesar una celda sin faltante rechaza la selección');

 await selectGap();await candidateAction().waitFor();await seed(studyPath,{staffId:'P12',monday:{free:false,blocks:[{start:'12:00',end:'16:00'}]}});
 await poll(async()=>await candidateAction().count()===0,'Un estudio nuevo debe retirar al candidato en vivo');
 await seed(studyPath,null);await candidateAction().waitFor();await candidateAction().click();await candidates().waitFor({state:'detached'});const panel=page.getByTestId('focus-staff-panel');await panel.waitFor();assert.equal(await panel.getByLabel('Entrada',{exact:true}).inputValue(),'');assert.equal(await panel.getByLabel('Salida',{exact:true}).inputValue(),'');assert.equal(await draft(),originalDraft,'Ver el editor no debe preasignar el turno sugerido');await panel.getByRole('button',{name:'Cerrar panel de colaboradores',exact:true}).click();
 const fullQuota=structuredClone(originalSchedule);fullQuota.thursday={...fullQuota.tuesday};
 // Preserve an explicit four-rest-day plan while the incomplete week is edited;
 // otherwise the legacy fallback correctly infers a different plan from off days.
 for(const value of Object.values(fullQuota))value.bukRestDays=4;
 await seed(schedulePath,fullQuota);await page.reload();await mode();await selectGap();assert.equal(await candidateAction().count(),0,'La cuota semanal agotada debe excluir al candidato');await closeCandidates();
 await seed(schedulePath,originalSchedule);await page.reload();await mode();
 pass('Los estudios se revalidan en vivo, la cuota agotada excluye al candidato y Ver en editor conserva el turno vacío sin preasignarlo');

 const columns=map().locator('thead th[scope="col"]');assert.equal(await columns.count(),73);assert.equal((await columns.first().textContent()).trim(),'07:00');assert.equal((await columns.last().textContent()).trim(),'25:00');
 const cellBounds=await map().locator('td[data-range-hour]').first().boundingBox();assert.ok(Math.abs(cellBounds.width-20)<1&&Math.abs(cellBounds.height-20)<1);
 await page.getByRole('button',{name:'Seleccionar tramo',exact:true}).click();await map().locator('td[data-excess="true"]').first().click();await page.getByText(/Mover desde/).waitFor();await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.deepEqual(await writes(),[]);
 pass('La selección roja de traslados conserva su formulario y el mapa mantiene73 columnas y celdas cuadradas20px');

 await page.getByRole('button',{name:'Maximizar mapa de cobertura',exact:true}).click();const fullscreen=page.getByRole('dialog',{name:/Mapa de Cobertura/});await fullscreen.waitFor();await selectGap(fullscreen);assert.equal(await candidates().evaluate(e=>e.matches(':modal')),true);await closeCandidates();assert.equal(await fullscreen.evaluate(e=>e.matches(':modal')),true);
 await selectGap(fullscreen);await candidateAction().click();await candidates().waitFor({state:'detached'});await fullscreen.waitFor({state:'detached'});await panel.waitFor();assert.equal(await panel.getByLabel('Entrada',{exact:true}).inputValue(),'');await panel.getByRole('button',{name:'Cerrar panel de colaboradores',exact:true}).click();assert.equal(await draft(),originalDraft);
 pass('La búsqueda abre encima del mapa ampliado; cerrar conserva fullscreen y Ver en editor sale de él sin cambiar el horario');

 await page.setViewportSize({width:390,height:844});await mode();await clear();await map().scrollIntoViewIfNeeded();await map().evaluate(e=>{e.scrollLeft=0});
 const box=await map().boundingBox(),session=await page.context().newCDPSession(page),y=Math.max(box.y+70,Math.min(box.y+box.height-30,790));
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y}]});for(const x of [300,260,210,160,110])await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await poll(async()=>await map().evaluate(e=>e.scrollLeft)>0,'Buscar cobertura debe permitir el desplazamiento táctil del mapa');assert.equal(await candidates().count(),0);
 await selectGap(page,false,true);await assertRange();const bounds=await candidates().boundingBox();assert.ok(bounds&&bounds.x>=-1&&bounds.x+bounds.width<=391&&bounds.y>=-1&&bounds.y+bounds.height<=845);
 assert.equal(await candidates().evaluate(element=>element.contains(document.activeElement)),true,'El diálogo debe recibir el foco');await page.keyboard.press('Tab');assert.equal(await candidates().evaluate(element=>element.contains(document.activeElement)),true);
 const discarded=candidates().locator('summary').filter({hasText:'Por qué otros colaboradores'});if(await discarded.count())await discarded.click();
 const scroller=candidates().getByTestId('coverage-candidates-scroll');const scrollSize=await scroller.evaluate(element=>({height:element.clientHeight,scroll:element.scrollHeight}));assert.ok(scrollSize.scroll>scrollSize.height,'La lista ampliada debe desplazarse dentro del diálogo');await scroller.evaluate(element=>{element.scrollTop=element.scrollHeight});
 for(const control of [candidates().getByRole('button',{name:'Cerrar búsqueda de cobertura',exact:true}),candidates().getByRole('button',{name:'Cerrar',exact:true})]){const r=await control.boundingBox();assert.ok(r&&r.y>=-1&&r.y+r.height<=845,'Cabecera y pie deben permanecer visibles al desplazar candidatos')}
 await candidates().screenshot({path:`${output}/candidatos-mobile.png`});await page.keyboard.press('Escape');await candidates().waitFor({state:'detached'});assert.equal(await map().evaluate(element=>element.contains(document.activeElement)),true,'Cerrar debe restaurar el foco al mapa');assert.equal(await draft(),originalDraft);assert.deepEqual(await writes(),[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 observations.push({mobile:bounds,cellBounds});pass('En móvil los taps seleccionan extremos, el swipe desplaza el mapa y el diálogo cabe y se cierra sin modificar datos');
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,observations,errors,external,scope:'Preview-only real editor/map/candidates with fictional staff and local HTTP/SSE; no production access'},null,2));
}catch(error){await page?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,external,error:String(error)},null,2));throw error;
}finally{await browser?.close();server.kill();}
