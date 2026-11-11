// Real native drag held over the matrix. All documents and writes are local fixtures.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {makeScheduleFocusQaFixture} from './schedule-focus-qa-fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=process.env.BUK_QA_PORT||'4241',base=`http://127.0.0.1:${port}`,output='output/coverage-drag';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-buk-qa.mjs'],{env:{...process.env,BUK_QA_PORT:port,BUK_QA_FOCUS_PREVIEW:'1'},stdio:['ignore','pipe','inherit']});
let browser,page;const passed=[],errors=[],external=[];
const poll=async(action,message)=>{for(let i=0;i<150;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message);};
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`);};
const map=()=>page.getByRole('region',{name:'Matriz de cobertura por posición y horario',exact:true});
const status=()=>page.getByTestId('heatmap-card-drag-status');
const selected=()=>map().locator('td[data-card-placement-selected="true"]');
const draft=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18')||'null'));
const read=async path=>(await (await page.request.get(`${base}/qa-document?path=${encodeURIComponent(path)}`)).json()).data;
const seed=(path,data)=>page.request.post(`${base}/qa-document`,{data:{path,data}});
const source=async name=>{
  const panel=page.getByTestId('focus-staff-panel');if(!await panel.isVisible())await page.locator('button[aria-controls="focus-staff-panel"]').click();
  await panel.getByLabel('Buscar colaborador',{exact:true}).fill(name);
};
const begin=async(id,name)=>{
  await source(name);const card=page.locator(`[data-focus-person-id="${id}"]`);await card.scrollIntoViewIfNeeded();
  const bounds=await card.boundingBox();await page.mouse.move(bounds.x+25,bounds.y+bounds.height/2);await page.mouse.down();
  await page.mouse.move(bounds.x+40,bounds.y+bounds.height/2+5,{steps:4});await status().waitFor();
};
const hover=async(index,position='VESTIDO')=>{
  const cell=map().locator(`td[data-position="${position}"][data-range-hour="${index}"]`).first();await cell.scrollIntoViewIfNeeded();
  const bounds=await cell.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2,{steps:8});
  await page.mouse.move(bounds.x+bounds.width/2+1,bounds.y+bounds.height/2);
};
const noMutation=async(id)=>{assert.equal((await draft())?.changes[id],undefined);assert.deepEqual(await page.evaluate(()=>window.bukQaWrites),[]);};
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('QA startup timeout')),30000);server.once('error',reject);server.stdout.on('data',data=>{if(data.toString().includes('Editor BUK aislado:')){clearTimeout(timer);resolve();}});});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
  page=await browser.newPage({viewport:{width:1600,height:1000},timezoneId:'America/Lima'});
  await page.addInitScript(()=>{
    window.dragImages=[];
    document.addEventListener('dragstart',event=>{
      const transfer=event.dataTransfer,original=transfer.setDragImage.bind(transfer);
      transfer.setDragImage=(image,x,y)=>{const data=image instanceof HTMLCanvasElement?image.getContext('2d').getImageData(0,0,image.width,image.height).data:[];
        window.dragImages.push({tag:image.tagName,width:image.width,height:image.height,transparent:data.length>0&&Array.from(data).every(value=>value===0)});original(image,x,y);};
    },true);
  });
  page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
  const ftPath='schedules/F01_2026-10-12_to_2026-10-18',ft={...await read(ftPath),monday:{}};await seed(ftPath,ft);
  await page.goto(base);await page.getByRole('button',{name:'Buscar cobertura',exact:true}).waitFor();
  await source('Camila');
  const header=await page.getByTestId('heatmap-header').boundingBox();
  const legend=await page.getByTestId('heatmap-legend-actions').getByText('Faltante',{exact:true}).boundingBox();
  const rangeButton=await page.getByRole('button',{name:'Seleccionar tramo',exact:true}).boundingBox();
  assert.ok(header.height<=136,`Header takes too much matrix space: ${header.height}`);
  assert.ok(Math.abs((legend.y+legend.height/2)-(rangeButton.y+rangeButton.height/2))<5,'Legend and selection action must share a row');
  const help=page.getByTestId('heatmap-legend-actions').locator('details');
  const instructions=help.getByText('Arrastra una tarjeta desde Equipo para previsualizar su jornada. Suelta para aplicarla al borrador y usa Guardar para publicarla.',{exact:true});
  assert.equal(await instructions.isVisible(),false);await help.locator('summary').click();assert.equal(await instructions.isVisible(),true);await help.locator('summary').click();
  await page.screenshot({path:`${output}/compact-header.png`});
  pass('Cabecera compacta: acciones junto a la leyenda, instrucciones en Ayuda y más espacio para el mapa');

  const profilePath='staff_profiles/F01',originalProfile=await read(profilePath)
    || makeScheduleFocusQaFixture(JSON.parse(await readFile('artifacts/buk/fixture.json','utf8'))).fixture.staff.find(person=>person.id==='F01');
  const grey=position=>map().locator(`td[data-position="${position}"][data-placement-disabled="true"]`);
  const digest=()=>map().locator('td[data-range-hour]').evaluateAll(elements=>elements.map(element=>[element.dataset.rangeRow,element.dataset.rangeHour,[...element.classList].find(value=>value.startsWith('bg-'))]));
  const originalColors=await digest();
  await seed(profilePath,{...originalProfile,workCategory:'production'});
  await begin('F01','Camila');await poll(async()=>await grey('SALÓN').count()>0,'Service areas were not disabled for Production');
  assert.equal(await grey('VESTIDO').count(),0);
  assert.ok(await map().locator('td[data-position="VESTIDO"][data-missing="true"]').evaluateAll(elements=>elements.every(element=>element.classList.contains('bg-yellow-300'))));
  assert.ok(await grey('SALÓN').evaluateAll(elements=>elements.every(element=>element.classList.contains('bg-slate-200')&&element.getAttribute('aria-disabled')==='true')));
  await hover(21);await poll(async()=>await selected().count()===33,'Compatible area did not paint the full approved shift');
  await hover(21,'SALÓN');await poll(async()=>await selected().count()===0,'Disabled area retained the prior placement preview');
  await page.screenshot({path:`${output}/category-production.png`});await page.mouse.up();
  await poll(async()=>await status().count()===0,'Dropping over a disabled area did not cancel the drag');await noMutation('F01');
  assert.deepEqual(await digest(),originalColors);assert.equal(await map().locator('td[data-placement-disabled]').count(),0);
  pass('Producción conserva los faltantes amarillos compatibles, pinta Servicio en gris y rechaza soltar allí sin editar horarios; al terminar recupera los colores originales');

  await seed(profilePath,{...originalProfile,workCategory:'service'});
  await begin('F01','Camila');await poll(async()=>await grey('VESTIDO').count()>0,'Production areas were not disabled for Service');
  assert.equal(await grey('SALÓN').count(),0);assert.equal(await grey('DRIVE THRU').count(),0);
  assert.ok(await map().locator('td[data-position="SALÓN"][data-missing="true"]').evaluateAll(elements=>elements.every(element=>element.classList.contains('bg-yellow-300'))));
  await page.keyboard.press('Escape');await page.mouse.up();await noMutation('F01');assert.deepEqual(await digest(),originalColors);
  pass('Servicio habilita su área y desactiva Producción; Escape retira el gris y conserva la cobertura original');

  await seed(profilePath,{...originalProfile,workCategory:'multifunctional'});
  await begin('F01','Camila');await hover(21);await poll(async()=>await selected().count()===33,'Multifunctional preview missing');
  assert.equal(await map().locator('td[data-placement-disabled]').count(),0);
  await page.keyboard.press('Escape');await page.mouse.up();
  await seed(profilePath,{...originalProfile,workCategory:''});
  await begin('F01','Camila');await poll(async()=>(await status().textContent()).includes('Sin áreas compatibles'),'Missing category was not explained');
  assert.equal(await map().locator('td[data-placement-disabled="true"]').count(),await map().locator('td[data-range-hour]').count());
  await page.keyboard.press('Escape');await page.mouse.up();await noMutation('F01');
  pass('Multifuncional habilita ambas áreas; sin categoría todas se desactivan y se indica revisar la ficha, sin asignar horas');

  await seed(profilePath,{...originalProfile,workCategory:'production'});
  await begin('F01','Camila');await hover(21);await poll(async()=>await selected().count()===33,'No category-recheck preview');
  await seed(profilePath,{...originalProfile,workCategory:'service'});await page.mouse.up();
  await status().getByRole('alert').filter({hasText:/categoría/}).waitFor();await noMutation('F01');
  assert.ok(await grey('VESTIDO').count()>0);assert.equal(await grey('SALÓN').count(),0);
  await page.getByRole('button',{name:'Buscar cobertura',exact:true}).click();
  await poll(async()=>await status().count()===0,'Changing tools did not clear the placement session');
  assert.equal(await map().locator('td[data-placement-disabled]').count(),0,'Changing tools must restore the matrix colors');
  await seed(profilePath,originalProfile);await page.reload();
  pass('Una categoría modificada durante el arrastre se verifica al soltar, bloquea la asignación y actualiza las áreas grises con el perfil recién leído');

  await begin('F01','Camila');await hover(21);
  await poll(async()=>await selected().count()===33,'Full-Time preview did not paint 8 net hours plus exit marker');
  assert.match(await status().textContent(),/12:15–21:00/);await noMutation('F01');
  assert.equal(await page.getByRole('dialog',{name:/Colocar en cobertura/}).count(),0);
  assert.deepEqual(await page.evaluate(()=>window.dragImages.at(-1)),{tag:'CANVAS',width:1,height:1,transparent:true});
  await hover(23);await poll(async()=>(await status().textContent()).includes('12:45–21:30'),'Preview did not follow the cursor');
  assert.equal(await selected().count(),33);await noMutation('F01');await page.screenshot({path:`output/coverage-drag/preview-full-time.png`});
  await page.mouse.up();await poll(async()=>(await draft())?.changes.F01?.monday?.start==='12:45','Drop did not apply the full shift');
  assert.equal((await draft()).changes.F01.monday.end,'21:30');assert.deepEqual(await page.evaluate(()=>window.bukQaWrites),[]);
  assert.equal(await page.getByTestId('focus-staff-panel').isVisible(),true,'Dropping a shift must keep the collaborators panel open');
  assert.equal(await page.getByTestId('focus-staff-panel').getByLabel('Buscar colaborador',{exact:true}).inputValue(),'Camila');
  assert.equal(await map().locator('td[data-placement-disabled]').count(),0,'Successful placement must restore the normal matrix colors');
  const afterDropHeader=await page.getByTestId('heatmap-header').boundingBox();
  assert.ok(Math.abs(afterDropHeader.width-header.width)<1,'Placement must preserve the matrix width');
  await page.getByRole('button',{name:'Deshacer cambio',exact:true}).click();await noMutation('F01');
  pass('Arrastre nativo pinta la jornada completa sin tarjeta flotante ni modal y conserva el panel y su búsqueda al soltar');

  await begin('F01','Camila');await hover(21);await poll(async()=>await selected().count()>0,'No cancellation preview');
  await page.keyboard.press('Escape');await page.mouse.up();await poll(async()=>await status().count()===0,'Escape did not cancel');
  assert.equal(await selected().count(),0);await noMutation('F01');
  pass('Escape elimina la previsualización y conserva intacto el borrador');

  await begin('F01','Camila');await hover(21);await poll(async()=>await selected().count()>0,'No study-recheck preview');
  await seed('study_schedules/F01',{staffId:'F01',monday:{blocks:[{start:'19:00',end:'20:00'}]}});await page.mouse.up();
  await status().getByRole('alert').filter({hasText:/estudio/}).waitFor();assert.equal(await selected().count(),0);await noMutation('F01');
  assert.equal(await page.getByRole('dialog',{name:/Colocar en cobertura/}).count(),0);
  await status().getByRole('button',{name:'Cancelar arrastre'}).click();await seed('study_schedules/F01',null);
  pass('Un estudio cambiado después de pintar bloquea el drop, muestra el conflicto dentro del mapa y no aplica el turno');

  await seed('study_schedules/F01',{staffId:'F01',monday:{blocks:[{start:'19:00',end:'20:00'}]}});
  await begin('F01','Camila');await hover(21);await status().getByRole('alert').filter({hasText:/estudio/}).waitFor();
  assert.equal(await selected().count(),33);assert.equal(await map().locator('td[data-card-placement-conflict="true"]').count(),4);await noMutation('F01');
  await page.screenshot({path:`${output}/academic-conflict-preview.png`});await page.keyboard.press('Escape');await page.mouse.up();await seed('study_schedules/F01',null);
  pass('La jornada completa se previsualiza y los cuatro cuartos del cruce académico quedan marcados en rojo, sin aplicar datos');

  await begin('F01','Camila');await hover(21);await poll(async()=>await selected().count()>0,'No remote-rest preview');
  await seed(ftPath,{...ft,tuesday:{off:true}});await page.mouse.up();
  await status().getByRole('alert').filter({hasText:/otra sesión/}).waitFor();await noMutation('F01');
  await status().getByRole('button',{name:'Cancelar arrastre'}).click();await seed(ftPath,ft);await page.reload();
  pass('Días libres modificados en otra sesión invalidan la colocación al volver a leer la semana');

  await begin('P12','Hugo');await hover(20);await status().getByRole('alert').filter({hasText:/exactamente/}).waitFor();assert.equal(await selected().count(),0);
  await hover(21);await poll(async()=>await selected().count()>0,'Part-Time plan did not paint');
  assert.match(await status().textContent(),/Part-Time.*4 descanso.*12:15–21:00/);await noMutation('P12');
  await page.mouse.up();await poll(async()=>(await draft())?.changes.P12?.monday?.bukApprovedShiftId==='PT4-29','Wrong Part-Time quota/shift');
  await page.getByRole('button',{name:'Deshacer cambio',exact:true}).click();await noMutation('P12');
  pass('Part-Time con cuatro descansos pinta la duración del cupo disponible y rechaza el ingreso de una duración ya agotada');

  const managerPath='schedules/G01_2026-10-12_to_2026-10-18',manager={...await read(managerPath),monday:{}};await seed(managerPath,manager);await page.reload();
  await begin('G01','Martina');await hover(31);await status().getByRole('alert').filter({hasText:/Define primero su jornada completa/}).waitFor();
  assert.equal(await selected().count(),0);await page.mouse.up();await status().getByRole('alert').waitFor();await noMutation('G01');
  await page.screenshot({path:`${output}/manual-shift-protection.png`});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  pass('Un gerente sin jornada definida no recibe quince minutos inventados ni un modal de colocación');
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,errors,external},null,2));
}catch(error){await page?.mouse.up().catch(()=>{});await page?.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,external,error:String(error)},null,2));throw error;}
finally{await browser?.close();server.kill();}
