import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = JSON.parse(await readFile('artifacts/buk/fixture.json', 'utf8'));
const initial = JSON.stringify(fixture);
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import BukScheduleTools from './src/components/BukScheduleTools.jsx';import BukApprovedShiftControl from './src/components/BukApprovedShiftControl.jsx';
const initial=${initial};window.fixture=initial;window.savedConfigs=[];window.currentSchedule=initial.schedules;
function Demo(){const [schedules,setSchedules]=useState(initial.schedules);window.currentSchedule=schedules;return <main><h1>Prueba aislada de planificación BUK</h1><p>Semana: {initial.weekStart}</p><BukApprovedShiftControl person={{...initial.staff[0],studyAvailabilityStatus:'ready',study_schedule:{}}} date={initial.weekStart} shift={schedules.FT1.monday} schedule={schedules.FT1} day='monday' onApply={patch=>setSchedules(prev=>({...prev,FT1:{...prev.FT1,monday:{...prev.FT1.monday,...patch}}}))}/><BukScheduleTools storeId='test-store' staff={initial.staff} schedules={schedules} weekStart={initial.weekStart}/><pre id='current'>{JSON.stringify(schedules.FT1.monday)}</pre></main>};createRoot(document.getElementById('root')).render(<Demo/>);`;
const transport = `export function getFirestore(){return {}};export function doc(...args){return args.slice(1)};export async function getDoc(ref){return {exists:()=>true,data:()=>ref[0]==='stores'?{name:'TIENDA DE PRUEBA'}:{name:'GERENTE',lastName:'DE PRUEBA'}}};export async function setDoc(ref,data){window.savedConfigs.push({ref,data})}`;
const bundle = await build({ stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'isolated-store',setup(b){b.onLoad({filter:/lib\/supabase\/firestoreCompat\.js$/},()=>({contents:transport,loader:'js'}));b.onLoad({filter:/contexts\/AuthContext\.jsx$/},()=>({contents:"export function useAuth(){return {currentUser:{uid:'qa-user'}}}",loader:'js'}));}}] });
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const output='output/approved-shift-modal-qa/schedule-ui';await mkdir(output,{recursive:true});
try{
 const context=await browser.newContext({acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});const page=await context.newPage({viewport:{width:1100,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Excel BUK',exact:true}).waitFor();
 assert.equal(await page.getByText('Copiar filas BUK',{exact:true}).count(),0);
 assert.equal(await page.locator('input[type=file]').count(),0);
 for(const [label,file] of [['Excel BUK','BUK_UI_PRUEBA.xls'],['Excel planificación','PLANIFICACION_UI_PRUEBA.xls'],['PDF','PLANIFICACION_UI_PRUEBA.pdf']]){
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await pending;await download.saveAs(`${output}/${file}`);
 }
 const selector=page.getByLabel('Horario aprobado BUK de Prueba FT1',{exact:true});await selector.click();
 const picker=page.getByRole('dialog',{name:'Seleccionar horario',exact:true});await picker.waitFor();
 await picker.locator('[data-shift-id="FT1-6"]').click();await picker.waitFor({state:'hidden'});
 assert.equal(await selector.getAttribute('data-selected-shift-id'),'FT1-6');assert.match(await selector.innerText(),/06:45/);
 const actual=await page.evaluate(()=>window.currentSchedule);
 assert.equal(actual.FT1.monday.start,'06:45');assert.equal(actual.FT1.monday.end,'15:30');assert.equal(actual.FT1.monday.position,'LANDING');assert.equal(actual.FT1.monday.extraHoursPost,0);assert.deepEqual(actual.PT1,fixture.schedules.PT1);
 await page.screenshot({path:`${output}/editor-buk-prueba.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>window.savedConfigs.length),0);
 assert.deepEqual(errors,[]);
 await mkdir('output/approved-shift-modal-qa',{recursive:true});
 await writeFile('output/approved-shift-modal-qa/schedule-ui.json',JSON.stringify({status:'PASS',passed:['Selector modal calcula salida y conserva posiciones, extras y otros días; exportaciones XLS/PDF reales sin escrituras de horarios'],errors,scope:'React real, identidades ficticias y transporte aislado; sin producción'},null,2));
 console.log('PASS: selector calcula salida; conserva posiciones/extras/otros días; genera BUK desde el sistema y descarga XLS/PDF reales sin escrituras de horarios');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
