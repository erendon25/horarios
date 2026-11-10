// Editor real con transporte aislado. No lee ni escribe Supabase.
import { build } from 'esbuild';
import { startBukQaHttpServer } from './buk-qa-http-server.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { makeScheduleFocusQaFixture } from './schedule-focus-qa-fixture.mjs';
const focusPreview = process.env.BUK_QA_FOCUS_PREVIEW === '1';
const baseFixture = JSON.parse(await readFile('artifacts/buk/fixture.json','utf8'));
const focusFixture = focusPreview ? makeScheduleFocusQaFixture(baseFixture) : null;
const fixture = focusFixture?.fixture || baseFixture;
const projectionHoursQa = process.env.BUK_QA_PROJECTION_HOURS === '1';
const studyAvailabilityQa = process.env.BUK_QA_STUDY_AVAILABILITY === '1';
const realtimeQa = projectionHoursQa || studyAvailabilityQa || focusPreview;
if (process.env.BUK_QA_MANAGEMENT === '1') {
  fixture.staff[0].position = 'GERENTE';
  fixture.staff[1].position = 'ASISTENTE';
}
const fixtureJson = JSON.stringify(fixture);
const transport = `
export const db={};const fixture=${fixtureJson};window.bukQaWrites=[];
const projectionHoursQa=${JSON.stringify(realtimeQa)};
const subscriptions=new Set();let eventSource;
window.bukQaRealtimeConnected=false;
const ensureEvents=()=>{
 if(!eventSource){
  eventSource=new EventSource('/qa-events');
  eventSource.onopen=()=>{window.bukQaRealtimeConnected=true};
  eventSource.onmessage=event=>{const {path}=JSON.parse(event.data);for(const subscription of subscriptions)if(subscription.path===path||(subscription.collection&&path.startsWith(subscription.path+'/')))subscription.notify()};
 }
};
export const getFirestore=()=>db;
export const doc=(db,...path)=>({path:path.join('/')});
export const collection=doc;
export const where=(...args)=>args;
export const query=(ref,...filters)=>({...ref,filters});
const snap=(id,value)=>({id,exists:()=>value!=null,data:()=>value});
function value(ref){
 if(ref.path==='users/qa-admin')return {storeId:'qa-store',name:'GERENTE',lastName:'DE PRUEBA'};
 if(ref.path==='stores/qa-store')return {name:'TIENDA DE PRUEBA'};
 if(ref.path==='stores/qa-store/config/buk_schedule')return {identities:fixture.identities,catalog:fixture.catalog};
 if(ref.path==='stores/qa-store/config/schedule_projection')return {positions:['LANDING','MASA','DRIVE THRU'],requirements:{}};
 if(ref.path.startsWith('schedules/')){const id=ref.path.split('/')[1];const person=id.split('_')[0];return fixture.schedules[person];}
 return null;
}
export async function getDoc(ref){const response=await fetch('/qa-document?path='+encodeURIComponent(ref.path));if(!response.ok)throw Error('No se pudo cargar el documento de prueba');const saved=await response.json();return snap(ref.path.split('/').at(-1),saved.found?saved.data:value(ref))}
export async function getDocs(ref){
 let docs;
 if(ref.path==='staff_profiles')docs=fixture.staff.map(p=>snap(p.id,{...p,position:p.position||'COLABORADOR',storeId:'qa-store'}));
 else{const response=await fetch('/qa-collection?path='+encodeURIComponent(ref.path));if(!response.ok)throw Error('No se pudo cargar la colección de prueba');const rows=await response.json();docs=rows.map(row=>snap(row.id,row.data))}
 docs=docs.filter(item=>(ref.filters||[]).every(([field,operator,value])=>operator!=='=='||item.data()[field]===value));
 return {docs,size:docs.length,forEach:fn=>docs.forEach(fn)}
}
export function onSnapshot(ref,callback,onError){
 let active=true;
 const isCollection=Boolean(ref.filters)||ref.path.split('/').length%2===1;
 const notify=async()=>{try{const result=isCollection?await getDocs(ref):await getDoc(ref);if(active)callback(result)}catch(error){if(active&&onError)onError(error)}};
 queueMicrotask(notify);
 const subscription={path:ref.path,notify,collection:isCollection};
 if(projectionHoursQa){subscriptions.add(subscription);ensureEvents()}
 return ()=>{active=false;subscriptions.delete(subscription);if(projectionHoursQa&&subscriptions.size===0&&eventSource){eventSource.close();eventSource=undefined;window.bukQaRealtimeConnected=false}};
}
export async function setDoc(ref,data){const response=await fetch('/qa-document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:ref.path,data})});if(!response.ok)throw Error('No se pudo guardar la prueba');window.bukQaWrites.push({path:ref.path,data})}
export async function addDoc(ref,data){const response=await fetch('/qa-add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:ref.path,data})});const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo guardar la solicitud de prueba');window.bukQaWrites.push({path:ref.path+'/'+result.id,data});return {id:String(result.id)}}
export const writeBatch=()=>{const ops=[];return {set:(ref,data)=>ops.push([ref,data]),update:(ref,data)=>ops.push([ref,data]),commit:async()=>{for(const [ref,data] of ops)await setDoc(ref,data)}}};
`;
const auth=`const user={id:'qa-admin',uid:'qa-admin',email:'prueba@example.test'};export function useAuth(){return {currentUser:user,userRole:'admin',userData:{storeId:'qa-store'}}}`;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import WeeklyScheduleEditor from './src/components/WeeklyScheduleEditor.jsx';import ScheduleRequestForm from './src/components/ScheduleRequestForm.jsx';import ScheduleRequestsManager from './src/components/ScheduleRequestsManager.jsx';
localStorage.setItem('schedule_editor_week:qa-admin:qa-store','2026-10-12');
if(!${JSON.stringify(focusPreview)}&&!new URLSearchParams(location.search).has('vista')){const url=new URL(location.href);url.searchParams.set('vista','clasica');history.replaceState(history.state,'',url)}
const query=new URLSearchParams(location.search),profile={...${JSON.stringify(fixture.staff[1])},storeId:'qa-store'};
if(['ASISTENTE','GERENTE'].includes(query.get('position'))){profile.position=query.get('position');profile.modality='Full-Time'}
function PreviewNotice(){const ref=React.useRef(null);React.useLayoutEffect(()=>{if(!${JSON.stringify(focusPreview)})return;const root=document.documentElement,previous=root.style.getPropertyValue('--schedule-preview-banner-height');const measure=()=>root.style.setProperty('--schedule-preview-banner-height',ref.current.getBoundingClientRect().height+'px');measure();const observer=new ResizeObserver(measure);observer.observe(ref.current);return()=>{observer.disconnect();if(previous)root.style.setProperty('--schedule-preview-banner-height',previous);else root.style.removeProperty('--schedule-preview-banner-height')}},[]);return <div ref={ref} style={{padding:12,background:'#fff3cd',fontWeight:700}}>${focusPreview ? 'Vista de prueba · Datos ficticios · Guardar solo afecta esta prueba' : 'PRUEBA LOCAL BUK · 5 colaboradores ficticios · Guardar solo conserva datos de prueba · Semana 12 al 18 de octubre'}</div>}
createRoot(document.getElementById('root')).render(<BrowserRouter><PreviewNotice/>{query.has('request')?<main style={{maxWidth:850,margin:'auto',padding:20}}><h1>Solicitud ficticia de Prueba PT1 BUK</h1><ScheduleRequestForm perfil={profile}/></main>:query.has('manager')?<ScheduleRequestsManager storeId="qa-store"/>:<WeeklyScheduleEditor/>}</BrowserRouter>);`;
const supabaseTransport=`export const supabase={from(table){let patch,filters={};const chain={update(value){patch=value;return chain},eq(key,value){filters[key]=value;return chain},select(){return chain},async maybeSingle(){const response=await fetch('/qa-approval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,patch,filters})});return response.json()}};return chain}};`;
const result=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},plugins:[{name:'qa-no-production',setup(b){
 b.onLoad({filter:/lib[\\/]supabase[\\/]firestoreCompat\.js$/},()=>({contents:transport,loader:'js'}));
 b.onLoad({filter:/contexts[\\/]AuthContext\.jsx$/},()=>({contents:auth,loader:'js'}));
 b.onLoad({filter:/lib[\\/]supabase[\\/]client\.js$/},()=>({contents:supabaseTransport,loader:'js'}));
}}]});
const css=(await postcss([tailwind({content:['./src/**/*.{js,jsx}']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const js=result.outputFiles.find(file=>file.path.endsWith('.js'))?.text||result.outputFiles[0].text;
const initialDocuments=[];
if (focusFixture) {
 for (const person of fixture.staff) initialDocuments.push([`schedules/${person.id}_2026-10-12_to_2026-10-18`,fixture.schedules[person.id]]);
 for (const [id,study] of Object.entries(focusFixture.studies)) initialDocuments.push([`study_schedules/${id}`,{staffId:id,...study}]);
 initialDocuments.push(['stores/qa-store/config/schedule_projection',focusFixture.projection]);
}
const extraHoursTemplate=focusPreview ? await readFile('public/templates/Plantilla_Horas_Extras.xlsx') : undefined;
if (focusPreview && process.env.BUK_QA_EXPORT_DIR) {
 const target=process.env.BUK_QA_EXPORT_DIR;
 await mkdir(`${target}/templates`,{recursive:true});
 const launch=`import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {startBukQaHttpServer} from './server.mjs';
const [js,css,initialDocuments]=await Promise.all(['app.js','style.css','initial-documents.json'].map(name=>readFile(new URL(name,import.meta.url),'utf8')));
const extraHoursTemplate=await readFile(new URL('./templates/Plantilla_Horas_Extras.xlsx',import.meta.url));\nconst port=Number(process.env.BUK_QA_PORT||5173);
const server=startBukQaHttpServer({js,css,initialDocuments:JSON.parse(initialDocuments),extraHoursTemplate,realtimeQa:true,restrictConnections:true,port,host:process.env.BUK_QA_HOST||'127.0.0.1'});
if(process.argv.includes('--abrir'))server.once('listening',()=>{const url='http://localhost:'+port+'/?vista=cobertura';const command=process.platform==='win32'?'cmd':process.platform==='darwin'?'open':'xdg-open';const args=process.platform==='win32'?['/c','start','',url]:[url];const child=spawn(command,args,{detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref()});
`;
 await Promise.all([
  writeFile(`${target}/app.js`,js),writeFile(`${target}/style.css`,css),
  writeFile(`${target}/initial-documents.json`,JSON.stringify(initialDocuments)),
  writeFile(`${target}/server.mjs`,await readFile(new URL('./buk-qa-http-server.mjs',import.meta.url),'utf8')),
  writeFile(`${target}/iniciar.mjs`,launch),writeFile(`${target}/templates/Plantilla_Horas_Extras.xlsx`,extraHoursTemplate),
 ]);
 console.log('Preview exportado: '+target);
}
const port=Number(process.env.BUK_QA_PORT || 4179);
const host=process.env.BUK_QA_HOST || (focusPreview ? '0.0.0.0' : '127.0.0.1');
startBukQaHttpServer({js,css,initialDocuments,realtimeQa,extraHoursTemplate,restrictConnections:focusPreview,port,host});
