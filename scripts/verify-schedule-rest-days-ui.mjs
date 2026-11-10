// Real editor, fictional local documents only. No production access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=process.env.BUK_QA_PORT||'4226',base=`http://127.0.0.1:${port}`,output='output/schedule-rest-days';
await mkdir(output,{recursive:true});
const server=spawn(process.execPath,['scripts/serve-buk-qa.mjs'],{env:{...process.env,BUK_QA_PORT:port,BUK_QA_FOCUS_PREVIEW:'1'},stdio:['ignore','pipe','inherit']});
const passed=[],errors=[],external=[];let browser,page;
const poll=async(action,message)=>{for(let i=0;i<150;i++){if(await action())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(message);};
const value=()=>page.getByTestId('schedule-rest-day-count').textContent();
const pass=message=>{passed.push(message);console.log(`PASS: ${message}`);};
const expect=async text=>poll(async()=>(await value()).trim()===text,`Expected rest count: ${text}`);
try{
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('QA startup timeout')),30000);server.once('error',reject);server.once('exit',code=>reject(Error(`QA server exited ${code}`)));server.stdout.on('data',data=>{if(data.toString().includes('Editor BUK aislado:')){clearTimeout(timeout);resolve();}});});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
 page=await browser.newPage({viewport:{width:1600,height:1000},timezoneId:'America/Lima'});
 page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort();});
 await page.goto(base);await expect('1 persona');
 assert.equal(await page.getByText('Más métricas',{exact:true}).count(),0);
 assert.equal(await page.getByTestId('heatmap-extra-metrics').isVisible(),true);
 assert.match(await page.getByTestId('schedule-rest-day-metric').getAttribute('title'),/No incluye feriados compensados/);
 pass('Lunes cuenta el libre asignado y excluye el feriado compensado; la métrica queda visible junto a Ventas/TRX, VHL y THL');
 const toolbar=page.getByTestId('focus-toolbar');
 await toolbar.getByRole('button',{name:'Mar',exact:true}).click();await expect('0 personas');
 await toolbar.getByRole('button',{name:'Lun',exact:true}).click();await expect('1 persona');
 pass('Cambiar de día muestra su propio conteo y distingue cero de un dato pendiente de cargar');

 await page.locator('button[aria-controls="focus-staff-panel"]').click();
 await page.getByLabel('Buscar colaborador',{exact:true}).fill('Camila');await expect('1 persona');
 await page.locator('[data-focus-person-id="F01"]').click();await page.getByTestId('focus-shift-editor').waitFor();
 await page.getByLabel('Libre',{exact:true}).check();await expect('2 personas');
 const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18')));
 assert.equal(draft.changes.F01.monday.off,true);
 assert.deepEqual(await page.evaluate(()=>window.bukQaWrites),[]);
 await page.getByRole('button',{name:'Cerrar panel de colaboradores',exact:true}).click();
 await page.reload();await expect('2 personas');
 const filter=toolbar.locator('summary').filter({hasText:'Filtros'});await filter.click();
 await page.getByLabel('Filtro de modalidad',{exact:true}).selectOption('Part-Time');await expect('2 personas');await filter.click();
 pass('El conteo sigue el borrador y su recarga, incluye toda la tienda con filtros activos y no escribe en servidor hasta Guardar');

 await toolbar.locator('summary').filter({hasText:'Más'}).click();await page.getByRole('button',{name:'Vista clásica',exact:true}).click();await expect('2 personas');
 await page.getByRole('button',{name:'Vista cobertura',exact:true}).click();await expect('2 personas');
 await page.setViewportSize({width:390,height:844});
 const metric=page.getByTestId('schedule-rest-day-metric');await metric.scrollIntoViewIfNeeded();
 const bounds=await metric.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=391,JSON.stringify(bounds));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:`${output}/metric-mobile.png`});
 await page.setViewportSize({width:1600,height:1000});await page.screenshot({path:`${output}/metric-desktop.png`});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 pass('La métrica aparece en vista clásica y cobertura y cabe en el ancho móvil');
 await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',passed,errors,external},null,2));
}catch(error){await page?.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,external,error:String(error)},null,2));throw error;}
finally{await browser?.close();server.kill();}
