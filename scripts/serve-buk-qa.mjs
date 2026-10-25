// Editor real con transporte aislado. No lee ni escribe Supabase.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
const fixture = JSON.parse(await readFile('artifacts/buk/fixture.json','utf8'));
const projectionHoursQa = process.env.BUK_QA_PROJECTION_HOURS === '1';
const studyAvailabilityQa = process.env.BUK_QA_STUDY_AVAILABILITY === '1';
const realtimeQa = projectionHoursQa || studyAvailabilityQa;
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
const query=new URLSearchParams(location.search),profile={...${JSON.stringify(fixture.staff[1])},storeId:'qa-store'};
if(['ASISTENTE','GERENTE'].includes(query.get('position'))){profile.position=query.get('position');profile.modality='Full-Time'}
createRoot(document.getElementById('root')).render(<BrowserRouter><div style={{padding:12,background:'#fff3cd',fontWeight:700}}>PRUEBA LOCAL BUK · 5 colaboradores ficticios · Guardar solo conserva datos de prueba · Semana 12 al 18 de octubre</div>{query.has('request')?<main style={{maxWidth:850,margin:'auto',padding:20}}><h1>Solicitud ficticia de Prueba PT1 BUK</h1><ScheduleRequestForm perfil={profile}/></main>:query.has('manager')?<ScheduleRequestsManager storeId="qa-store"/>:<WeeklyScheduleEditor/>}</BrowserRouter>);`;
const supabaseTransport=`export const supabase={from(table){let patch,filters={};const chain={update(value){patch=value;return chain},eq(key,value){filters[key]=value;return chain},select(){return chain},async maybeSingle(){const response=await fetch('/qa-approval',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,patch,filters})});return response.json()}};return chain}};`;
const result=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},plugins:[{name:'qa-no-production',setup(b){
 b.onLoad({filter:/lib[\\/]supabase[\\/]firestoreCompat\.js$/},()=>({contents:transport,loader:'js'}));
 b.onLoad({filter:/contexts[\\/]AuthContext\.jsx$/},()=>({contents:auth,loader:'js'}));
 b.onLoad({filter:/lib[\\/]supabase[\\/]client\.js$/},()=>({contents:supabaseTransport,loader:'js'}));
}}]});
const css=(await postcss([tailwind({content:['./src/**/*.{js,jsx}']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const js=result.outputFiles.find(file=>file.path.endsWith('.js'))?.text||result.outputFiles[0].text;
const savedDocuments=new Map();
const eventClients=new Set();
const qaControl={readErrors:[],rejectApprovals:false};
let nextRequestId=1;
const publish=path=>{if(realtimeQa)for(const client of eventClients)client.write('data: '+JSON.stringify({path})+'\n\n')};
const server=createServer(async(req,res)=>{
 if(req.url==='/qa-events'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
  res.write(': connected\n\n');eventClients.add(res);req.on('close',()=>eventClients.delete(res));
 }
 else if(req.url==='/qa-control'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;Object.assign(qaControl,JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
 }
 else if(req.url.startsWith('/qa-collection')){
  const path=new URL(req.url,'http://qa.local').searchParams.get('path');
  res.setHeader('Content-Type','application/json');
  if(qaControl.readErrors.includes(path)){res.statusCode=503;res.end(JSON.stringify({error:'Fallo de colección aislado'}));return}
  res.end(JSON.stringify([...savedDocuments].filter(([key,data])=>key.startsWith(path+'/')&&data!=null).map(([key,data])=>({id:key.slice(path.length+1),data}))));
 }
 else if(req.url==='/qa-add'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;const {path,data}=JSON.parse(body);
  res.setHeader('Content-Type','application/json');
  if(path!=='schedule_requests'){res.statusCode=400;res.end(JSON.stringify({error:'Colección no permitida en la prueba'}));return}
  const id=nextRequestId++,key=path+'/'+id;savedDocuments.set(key,data);res.end(JSON.stringify({id}));publish(key);
 }
 else if(req.url==='/qa-approval'&&req.method==='POST'){
  let body='';for await(const chunk of req)body+=chunk;const {table,patch,filters}=JSON.parse(body);
  res.setHeader('Content-Type','application/json');
  if(qaControl.rejectApprovals&&patch.status==='approved'){res.end(JSON.stringify({data:null,error:{message:'Conflicto con el horario de estudios actualizado.'}}));return}
  const key=table+'/'+filters.id,prior=savedDocuments.get(key);
  if(!prior||prior.status!==filters.status){res.end(JSON.stringify({data:null,error:null}));return}
  savedDocuments.set(key,{...prior,...patch});res.end(JSON.stringify({data:{id:filters.id,status:patch.status},error:null}));publish(key);
 }
 else if(req.url.startsWith('/qa-document')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const {path,data}=JSON.parse(body);savedDocuments.set(path,data);res.end(JSON.stringify({saved:true}));
   publish(path);
  }else{
   const path=new URL(req.url,'http://qa.local').searchParams.get('path');
   if(qaControl.readErrors.includes(path)){res.statusCode=503;res.end(JSON.stringify({error:'Fallo de lectura aislado'}));return}
   res.end(JSON.stringify({found:savedDocuments.has(path),data:savedDocuments.get(path)}));
  }
 }
 else if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prueba BUK local</title><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');}
});
const port=Number(process.env.BUK_QA_PORT || 4179);
server.listen(port,'127.0.0.1',()=>console.log('Editor BUK aislado: http://127.0.0.1:'+port+'/'));
