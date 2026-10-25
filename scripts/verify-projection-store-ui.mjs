// Browser regression for independent projection configurations in two stores.
// Real React Page/Dashboard; isolated HTTP store, no production writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=process.env.PROJECTION_STORE_QA_PORT||'4194',base=`http://127.0.0.1:${port}`,output='output/projection-store-qa';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-projection-store-qa.mjs'],{env:{...process.env,PROJECTION_STORE_QA_PORT:port},stdio:['ignore','pipe','inherit']});
const passed=[],errors=[],unexpectedNetwork=[];
let browser,page;
const pass=name=>{passed.push(name);console.log(`PASS: ${name}`);};
const poll=async(fn,message)=>{for(let attempt=0;attempt<80;attempt++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message);};
const state=async()=>(await page.request.get(`${base}/qa-state`)).json();
const control=async value=>{const response=await page.request.post(`${base}/qa-control`,{data:value});assert.equal(response.ok(),true);};
const open=async()=>{await page.getByRole('button',{name:'Configurar Posiciones',exact:true}).click();return page.locator('div.fixed').filter({has:page.getByRole('heading',{name:'Configurar Posiciones de la Tienda',exact:true})});};
const rows=modal=>modal.locator('tbody tr');
const names=async modal=>rows(modal).locator('input[type=text]').evaluateAll(inputs=>inputs.map(input=>input.value));
const row= (modal,name)=>rows(modal).filter({has:page.locator(`input[type=text][value="${name}"]`)});
const close=async modal=>{await modal.getByRole('button',{name:'x',exact:true}).click();};
try{
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('QA server startup timeout')),30000);server.once('error',reject);server.stdout.on('data',data=>{if(data.toString().includes('Projection store QA:')){clearTimeout(timeout);resolve();}});server.once('exit',code=>reject(Error(`QA server exit ${code}`)));});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Lima'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://**/*',route=>{unexpectedNetwork.push(route.request().url());return route.abort();});
 await page.goto(base);
 let modal=await open();
 assert.deepEqual(await names(modal),['Área exclusiva A','Salón'],'Saved arrays must be used exactly; do not append default positions');
 await rows(modal).first().locator('input[type=text]').fill('Área A editada');
 await row(modal,'Salón').getByRole('button',{name:'Remover',exact:true}).click();
 await modal.getByPlaceholder('Ej. Drivethru o Modulo',{exact:true}).fill('Nueva A');
 await modal.getByRole('button',{name:'Agregar',exact:true}).click();
 await close(modal);
 // Refresh while the 700ms autosave is pending: the Page must not unmount it.
 await page.getByRole('button',{name:'Actualizar datos',exact:true}).click();
 await poll(async()=>JSON.stringify((await state()).configurations['store-a']?.positions?.map(item=>item.name))===JSON.stringify(['Área A editada','Nueva A']),'Store A changes were not persisted without sales/VHL');
 await page.reload();modal=await open();
 assert.deepEqual(await names(modal),['Área A editada','Nueva A']);
 let snapshot=await state();
 assert.deepEqual(snapshot.configurations['store-a'].requirements,{proof:'keep prior requirements until a valid recalculation exists'},'Saving positions without metrics must preserve existing requirements');
 assert.equal(snapshot.configurations['store-a'].preservedMetadata,'existing store metadata');
 await close(modal);
 pass('Editar, quitar y agregar posiciones se guarda sin ventas; Actualizar datos inmediato y recarga conservan la configuración exacta');

 await control({readDelay:{'store-b':1200}});
 const beforeB=(await state()).writes.filter(item=>item.storeId==='store-b').length;
 await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-b');
 // Wait until the delayed load has finished rather than treating defaults as loaded.
 await poll(async()=>{
  const button=page.getByRole('button',{name:'Configurar Posiciones',exact:true});
  return await button.count()&&await button.isEnabled();
 },'Store B configuration never became editable');
 modal=await open();
 assert.equal((await names(modal)).includes('Área A editada'),false);
 assert.equal((await names(modal)).includes('Nueva A'),false);
 assert.equal((await names(modal)).includes('Cocina'),true);
 assert.equal((await state()).writes.filter(item=>item.storeId==='store-b').length,beforeB,'Loading a new store must not save the prior store configuration');
 await row(modal,'Cocina').locator('input[type=text]').fill('Zona B');
 await row(modal,'Drivethru').getByRole('button',{name:'Remover',exact:true}).click();
 await close(modal);
 await poll(async()=>(await state()).configurations['store-b']?.positions?.some(item=>item.name==='Zona B'),'Store B changes were not persisted');
 await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-a');
 modal=await open();assert.deepEqual(await names(modal),['Área A editada','Nueva A']);await close(modal);
 await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-b');
 modal=await open();assert.equal((await names(modal)).includes('Zona B'),true);assert.equal((await names(modal)).includes('Drivethru'),false);await close(modal);
 snapshot=await state();
 assert.deepEqual(snapshot.configurations['store-a'].positions.map(item=>item.name),['Área A editada','Nueva A']);
 assert.equal(snapshot.writes.filter(item=>item.storeId==='store-b').every(item=>!item.data.positions.some(position=>['Área A editada','Nueva A'].includes(position.name))),true);
 pass('Cambiar a una tienda sin configuración no hereda ni escribe posiciones de otra tienda; ambas conservan sus propios nombres y eliminaciones');

 await control({readErrors:['store-c'],readDelay:{}});
 await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-c');
 await page.getByRole('alert').waitFor();
 const failedReadWrites=(await state()).writes.filter(item=>item.storeId==='store-c').length;
 assert.equal(failedReadWrites,0);
 assert.equal(await page.getByText('Guardado',{exact:true}).count(),0,'A failed load cannot be labelled as saved');
 const configure=page.getByRole('button',{name:'Configurar Posiciones',exact:true});
 assert.equal(!await configure.count()||await configure.isDisabled(),true,'A failed load cannot enable changes to defaults');
 await control({readErrors:[]});
 await page.getByRole('button',{name:/Reintentar.*carga|Volver a cargar|Reintentar carga/i}).click();
 modal=await open();assert.equal((await names(modal)).includes('Zona B'),false);await close(modal);
 pass('Un fallo de carga muestra error, bloquea escritura de valores por defecto y permite reintentar sin mezclar tiendas');

 modal=await open();
 while(await rows(modal).count())await rows(modal).first().getByRole('button',{name:'Remover',exact:true}).click();
 await close(modal);
 await poll(async()=>(await state()).configurations['store-c']?.positions?.length===0,'An intentionally empty configuration was not persisted');
 await page.reload();modal=await open();assert.deepEqual(await names(modal),[]);await close(modal);
 pass('Quitar todas las posiciones conserva una lista vacía intencional después de recargar');

 await page.getByLabel('Tienda de prueba',{exact:true}).selectOption('store-a');
 await control({writeErrors:['store-a']});
 modal=await open();await rows(modal).first().locator('input[type=text]').fill('Área A recuperada');await close(modal);
 await page.getByText('Error al guardar',{exact:true}).waitFor();
 snapshot=await state();assert.equal(snapshot.configurations['store-a'].positions[0].name,'Área A editada');
 await control({writeErrors:[]});
 await page.getByRole('button',{name:/Reintentar.*guard|Guardar cambios|Reintentar$/i}).click();
 await poll(async()=>(await state()).configurations['store-a']?.positions?.[0]?.name==='Área A recuperada','Retry did not save pending changes');
 await page.reload();modal=await open();assert.deepEqual(await names(modal),['Área A recuperada','Nueva A']);await close(modal);
 pass('Un fallo al guardar queda visible y Reintentar guarda los cambios pendientes sin reemplazar la otra tienda');

 await control({writeDelay:{'store-a':1200}});
 modal=await open();await rows(modal).first().locator('input[type=text]').fill('Área A lenta');
 await poll(async()=>(await state()).writes.some(item=>item.storeId==='store-a'&&item.data.positions[0]?.name==='Área A lenta'),'The slow write did not begin');
 await rows(modal).first().locator('input[type=text]').fill('Área A más reciente');await close(modal);
 await poll(async()=>(await state()).configurations['store-a']?.positions?.[0]?.name==='Área A más reciente','A slow older write replaced the newest edit');
 await page.getByText('Guardado',{exact:true}).waitFor();
 await control({writeDelay:{}});
 await page.reload();modal=await open();assert.deepEqual(await names(modal),['Área A más reciente','Nueva A']);await close(modal);
 pass('Una escritura lenta anterior no reemplaza una edición posterior: el último cambio queda guardado');

 await page.getByText('Guardado',{exact:true}).waitFor();
 modal=await open();await modal.screenshot({path:`${output}/posiciones-guardadas-desktop.png`});await close(modal);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:`${output}/configuracion-guardada-mobile.png`,fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(unexpectedNetwork,[]);
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,errors,unexpectedNetwork,writes:(await state()).writes,scope:'Real projection Page/Dashboard, isolated HTTP persistence; no production access'},null,2));
}catch(error){await page?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,unexpectedNetwork,error:String(error)},null,2));throw error;
}finally{await browser?.close();server.kill();}
