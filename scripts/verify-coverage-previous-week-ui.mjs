// Targeted preview regression. Start serve-buk-qa with FOCUS_PREVIEW=1 first.
// This script talks only to the local fictional transport, never production.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.COVERAGE_QA_BASE_URL||'http://127.0.0.1:5226';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'This QA is limited to the isolated localhost server');
const output='output/heatmap-coverage-qa';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
let page;const errors=[],external=[];
const previousPath='schedules/P12_2026-10-05_to_2026-10-11';
const currentPath='schedules/P12_2026-10-12_to_2026-10-18';
try{
 page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Lima'});
 page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>{external.push(route.request().url());return route.abort()});
 const control=async readErrors=>assert.equal((await page.request.post(`${base}/qa-control`,{data:{readErrors}})).ok(),true);
 const candidates=()=>page.getByRole('dialog',{name:'Colaboradores para cubrir el tramo',exact:true});
 const select=async()=>{
  await page.getByRole('button',{name:'Buscar cobertura',exact:true}).click();
  const region=page.getByRole('region',{name:'Matriz de cobertura por posición y horario',exact:true});
  const first=region.locator('td[data-position="VESTIDO"][data-missing="true"][data-range-hour="20"]').first();await first.click();
  const lane=await first.getAttribute('data-range-row');await region.locator(`td[data-range-row="${lane}"][data-range-hour="34"]`).click();await candidates().waitFor();
 };
 const original=await (await page.request.get(`${base}/qa-document?path=${encodeURIComponent(currentPath)}`)).json();
 await control([previousPath]);await page.goto(`${base}/?vista=cobertura`);await select();
 const alert=candidates().getByRole('alert').filter({hasText:/semana anterior/i});await alert.waitFor();
 assert.equal(await candidates().locator('[data-coverage-person-id]').count(),0,'Un fallo de lectura no equivale a una semana sin horarios');
 assert.equal(await candidates().getByRole('button',{name:'Ver en editor a Hugo Prueba Ficticio',exact:true}).count(),0);
 assert.deepEqual(await page.evaluate(()=>window.bukQaWrites),[]);
 await candidates().screenshot({path:`${output}/semana-anterior-error.png`});
 await control([]);await page.reload();await select();await candidates().getByRole('button',{name:'Ver en editor a Hugo Prueba Ficticio',exact:true}).waitFor();
 assert.equal(await candidates().getByRole('alert').count(),0);
 assert.deepEqual(await (await page.request.get(`${base}/qa-document?path=${encodeURIComponent(currentPath)}`)).json(),original);
 assert.deepEqual(await page.evaluate(()=>window.bukQaWrites),[]);assert.equal(await page.evaluate(()=>localStorage.getItem('schedule_draft_v2:qa-admin:qa-store:2026-10-12_to_2026-10-18')),null);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(`${output}/previous-week-readiness.json`,JSON.stringify({status:'PASS',failedPath:previousPath,errorBlocksCandidates:true,recoveryRestoresCandidate:'P12',noMutations:true,errors,external},null,2));
 console.log('PASS: fallo de semana anterior bloquea candidatos; recuperar y recargar restaura P12 sin modificar horarios');
}catch(error){await page?.screenshot({path:`${output}/previous-week-fallo.png`,fullPage:true}).catch(()=>{});await writeFile(`${output}/previous-week-readiness.json`,JSON.stringify({status:'FAIL',error:String(error),errors,external},null,2));throw error;
}finally{await page?.request.post(`${base}/qa-control`,{data:{readErrors:[]}}).catch(()=>{});await browser.close()}
