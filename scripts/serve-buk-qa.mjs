// Editor real con transporte aislado. No lee ni escribe Supabase.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
const fixture = JSON.parse(await readFile('artifacts/buk/fixture.json','utf8'));
if (process.env.BUK_QA_MANAGEMENT === '1') {
  fixture.staff[0].position = 'GERENTE';
  fixture.staff[1].position = 'ASISTENTE';
}
const fixtureJson = JSON.stringify(fixture);
const transport = `
const db={};const fixture=${fixtureJson};window.bukQaWrites=[];
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
export async function getDoc(ref){const response=await fetch('/qa-document?path='+encodeURIComponent(ref.path));const saved=await response.json();return snap(ref.path.split('/').at(-1),saved.found?saved.data:value(ref))}
export async function getDocs(ref){const docs=ref.path==='staff_profiles'?fixture.staff.map(p=>snap(p.id,{...p,position:p.position||'COLABORADOR',storeId:'qa-store'})):[];return {docs,size:docs.length,forEach:fn=>docs.forEach(fn)}}
export function onSnapshot(ref,callback){let active=true;queueMicrotask(async()=>{if(active)callback(ref.filters?await getDocs(ref):await getDoc(ref))});return ()=>{active=false}}
export async function setDoc(ref,data){const response=await fetch('/qa-document',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:ref.path,data})});if(!response.ok)throw Error('No se pudo guardar la prueba');window.bukQaWrites.push({path:ref.path,data})}
export const writeBatch=()=>{const ops=[];return {set:(ref,data)=>ops.push([ref,data]),update:(ref,data)=>ops.push([ref,data]),commit:async()=>{for(const [ref,data] of ops)await setDoc(ref,data)}}};
`;
const auth=`const user={id:'qa-admin',uid:'qa-admin',email:'prueba@example.test'};export function useAuth(){return {currentUser:user,userRole:'admin',userData:{storeId:'qa-store'}}}`;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import WeeklyScheduleEditor from './src/components/WeeklyScheduleEditor.jsx';
localStorage.setItem('schedule_editor_week:qa-admin:qa-store','2026-10-12');
createRoot(document.getElementById('root')).render(<BrowserRouter><div style={{padding:12,background:'#fff3cd',fontWeight:700}}>PRUEBA LOCAL BUK · 5 colaboradores ficticios · Guardar solo conserva datos de prueba · Semana 12 al 18 de octubre</div><WeeklyScheduleEditor/></BrowserRouter>);`;
const result=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},plugins:[{name:'qa-no-production',setup(b){
 b.onLoad({filter:/lib\/supabase\/firestoreCompat\.js$/},()=>({contents:transport,loader:'js'}));
 b.onLoad({filter:/contexts\/AuthContext\.jsx$/},()=>({contents:auth,loader:'js'}));
 b.onLoad({filter:/lib\/supabase\/client\.js$/},()=>({contents:'export const supabase={};',loader:'js'}));
}}]});
const css=(await postcss([tailwind({content:['./src/**/*.{js,jsx}']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const js=result.outputFiles.find(file=>file.path.endsWith('.js'))?.text||result.outputFiles[0].text;
const savedDocuments=new Map();
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/qa-document')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const {path,data}=JSON.parse(body);savedDocuments.set(path,data);res.end(JSON.stringify({saved:true}));
  }else{
   const path=new URL(req.url,'http://qa.local').searchParams.get('path');
   res.end(JSON.stringify({found:savedDocuments.has(path),data:savedDocuments.get(path)}));
  }
 }
 else if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prueba BUK local</title><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');}
});
const port=Number(process.env.BUK_QA_PORT || 4179);
server.listen(port,'127.0.0.1',()=>console.log('Editor BUK aislado: http://127.0.0.1:'+port+'/'));
