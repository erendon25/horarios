// Credentials-free harness for real schedule-access components and dashboard.
// Only auth/transport and unrelated dashboard panels are replaced.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import {normalizeScheduleAccessPolicy} from '../src/services/scheduleAccessPolicy.js';

const buk=JSON.parse(await readFile('artifacts/buk/fixture.json','utf8'));
const storeId='qa-store',uid='qa-collab',staffId='PT1';
const profile={id:staffId,uid,storeId,name:'Persona QA',lastName:'Local',dni:'00000002',modality:'Part-Time',position:'COLABORADOR',status:'active',sanitaryCardDate:'2030-12-31',sanitaryCardExpiry:'2030-12-31',sanitaryCardUnlock:false,skills:[]};
const study={monday:{free:false,blocks:[{start:'10:00',end:'12:00'}]}};
const docs=new Map([
 ['stores/qa-store',{name:'Tienda QA A',active:true}],['stores/qa-other',{name:'Tienda QA B',active:true}],
 ['staff_profiles/PT1',profile],['users/qa-collab',{role:'collaborator',storeId,staffProfileId:staffId}],
 ['stores/qa-store/config/schedule_lock',{restrictionsEnabled:false,reenableDate:''}],
 ['study_schedules/PT1',study],['study_schedules/qa-collab',study],
 ['schedules/PT1_2026-10-26_to_2026-11-01',buk.schedules.PT1],
]);
for(const [id,status,date] of [['1','pending','2026-10-30'],['2','pending','2026-10-29'],['3','approved','2026-10-28'],['4','rejected','2026-10-27'],['5','pending','2026-10-30'],['6','pending','2026-10-30']]){
 docs.set(`schedule_requests/${id}`,{uid:id==='5'?'qa-another':uid,staffId,storeId:id==='6'?'qa-other':storeId,date,status,shiftType:'rango',startTime:'06:00',endTime:'10:00',reason:`Solicitud ficticia ${id}`,createdAt:'2026-10-25T15:00:00Z'});
}
const writes=[],deletes=[],reads=[];
const control={readErrors:[],writeErrors:[],deleteMode:'success'};
const eventClients=new Set();let nextId=100;
const publish=path=>{for(const client of eventClients)client.write(`data: ${JSON.stringify({path})}\n\n`)};
const clone=value=>value===undefined?undefined:structuredClone(value);
const textJson=(response,value,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value))};
const body=async request=>{let raw='';for await(const chunk of request)raw+=chunk;return JSON.parse(raw||'{}')};
const allCollection=path=>[...docs].filter(([key,value])=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')&&value!==null).map(([key,data])=>({id:key.slice(path.length+1),data:clone(data)}));
const matches=(item,constraints)=>constraints.every(c=>{
 if(c.kind!=='where')return true;const value=c.field==='__name__'?item.id:item.data[c.field];
 if(c.operator==='==')return value===c.value;if(c.operator==='in')return c.value.includes(value);
 if(c.operator==='>=')return value>=c.value;if(c.operator==='<=')return value<=c.value;
 throw Error(`Unsupported QA filter ${c.operator}`);
});
const transport=`
export const db={};export const getFirestore=()=>db;
const path=(base,...parts)=>[base?.path,...parts].filter(value=>typeof value==='string').join('/');
export const doc=(base,...parts)=>({path:path(base,...parts),kind:'doc'});
export const collection=(base,...parts)=>({path:path(base,...parts),kind:'collection'});
export const where=(field,operator,value)=>({kind:'where',field,operator,value});
export const orderBy=(field,direction)=>({kind:'orderBy',field,direction});
export const query=(ref,...constraints)=>({...ref,constraints});
const actor=()=>(new URLSearchParams(location.search).get('mode')||location.pathname)==='/admin'?'qa-admin':'qa-collab';
async function call(op,value){const response=await fetch('/qa/operation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,actor:actor(),...value})});const result=await response.json();if(!response.ok)throw Error(result.error||'Fallo de transporte QA');return result}
const snap=(id,data)=>({id,exists:()=>data!==undefined&&data!==null,data:()=>data});
export const getDoc=async ref=>{const value=await call('getDoc',{ref});return snap(ref.path.split('/').at(-1),value.found?value.data:undefined)};
export const getDocs=async ref=>{const docs=(await call('getDocs',{ref})).map(item=>snap(item.id,item.data));return {docs,size:docs.length,empty:docs.length===0,forEach:fn=>docs.forEach(fn)}};
const listeners=new Set();let source;window.scheduleQaConnected=false;
function connect(){if(source)return;source=new EventSource('/qa/events');source.onopen=()=>{window.scheduleQaConnected=true};source.onmessage=event=>{const {path}=JSON.parse(event.data);for(const listener of listeners)if(listener.path===path||(listener.collection&&path.startsWith(listener.path+'/')))listener.notify()}}
export function onSnapshot(ref,callback,onError){let active=true;const isCollection=ref.kind==='collection';const notify=async()=>{try{const result=isCollection?await getDocs(ref):await getDoc(ref);if(active)callback(result)}catch(error){if(active&&onError)onError(error)}};const listener={path:ref.path,collection:isCollection,notify};listeners.add(listener);connect();queueMicrotask(notify);return()=>{active=false;listeners.delete(listener);if(!listeners.size&&source){source.close();source=undefined;window.scheduleQaConnected=false}}}
export const setDoc=(ref,data,options)=>call('setDoc',{ref,data,options});
export const updateDoc=(ref,data)=>call('updateDoc',{ref,data});
export const addDoc=async(ref,data)=>call('addDoc',{ref,data});
export const serverTimestamp=()=>new Date().toISOString();
`;
const auth=`const admin=(new URLSearchParams(location.search).get('mode')||location.pathname)==='/admin';const currentUser={id:admin?'qa-admin':'qa-collab',uid:admin?'qa-admin':'qa-collab',email:admin?'admin@example.test':'colaborador@example.test'};export const useAuth=()=>({currentUser,userRole:admin?'admin':'collaborator',userData:{storeId:'qa-store',staffProfileId:'PT1'},logout:async()=>{},updatePassword:async()=>{}});`;
const client=`export const supabase={from(table){let filters={},kind;const q={delete(){kind='delete';return q},eq(field,value){filters[field]=value;return q},select(){return q},async maybeSingle(){const response=await fetch('/qa/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,kind,filters,actor:'qa-collab'})});return response.json()}};return q},async rpc(name,args){const mode=new URLSearchParams(location.search).get('mode')||location.pathname;const response=await fetch('/qa/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,actor:mode==='/admin'?'qa-admin':'qa-collab'})});return response.json()}};`;
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import CollaboratorDashboard from './src/components/CollaboratorDashboard.jsx';import ScheduleAccessSettings from './src/components/ScheduleAccessSettings.jsx';import StudyScheduleForm from './src/components/StudyScheduleForm.jsx';import ScheduleRequestForm from './src/components/ScheduleRequestForm.jsx';import MyScheduleRequests from './src/components/MyScheduleRequests.jsx';
const profile=${JSON.stringify(profile)};const mode=new URLSearchParams(location.search).get('mode')||location.pathname;
const content=mode==='/admin'?<main className="mx-auto max-w-4xl p-3"><ScheduleAccessSettings storeId="qa-store"/></main>:mode==='/study'?<main className="mx-auto max-w-3xl p-4"><StudyScheduleForm storeId="qa-store"/></main>:mode==='/request'?<main className="mx-auto max-w-3xl p-4"><ScheduleRequestForm perfil={profile}/></main>:mode==='/requests'?<main className="mx-auto max-w-3xl p-4"><MyScheduleRequests perfil={profile}/></main>:<CollaboratorDashboard/>;
createRoot(document.getElementById('root')).render(<BrowserRouter><div className="bg-amber-100 p-3 font-semibold">PRUEBA LOCAL · datos ficticios · sin acceso a producción</div>{content}</BrowserRouter>);`;
const unrelated=/components\/(WeeklyView|CollaboratorSuggestiveGoals|HolidayBalancePanel|HolidayForm|ProfilePhotoEditor|ModalSelectorDePosiciones)\.jsx$/;
const bundle=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},plugins:[{name:'isolated-schedule-access',setup(builder){
 builder.onLoad({filter:/lib\/supabase\/firestoreCompat\.js$/},()=>({contents:transport,loader:'js'}));
 builder.onLoad({filter:/contexts\/AuthContext\.jsx$/},()=>({contents:auth,loader:'js'}));
 builder.onLoad({filter:/lib\/supabase\/client\.js$/},()=>({contents:client,loader:'js'}));
 builder.onLoad({filter:unrelated},()=>({contents:'export default function UnrelatedPanel(){return null}',loader:'jsx'}));
 builder.onLoad({filter:/services\/competition\.js$/},()=>({contents:'export async function hasPublishedCompetition(){return false}',loader:'js'}));
}}]});
const css=(await postcss([tailwind({content:['./src/**/*.{js,jsx}']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const server=createServer(async(request,response)=>{
 try{
  if(request.url==='/qa/events'){response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});response.write(': ready\n\n');eventClients.add(response);request.on('close',()=>eventClients.delete(response));return}
  if(request.url==='/qa/state')return textJson(response,{documents:Object.fromEntries(docs),writes,deletes,reads,control});
  if(request.url==='/qa/control'&&request.method==='POST'){Object.assign(control,await body(request));return textJson(response,{ok:true})}
  if(request.url==='/qa/document'&&request.method==='POST'){
   const {path,data,publish:shouldPublish=true}=await body(request);docs.set(path,clone(data));if(shouldPublish)publish(path);return textJson(response,{ok:true});
  }
  if(request.url==='/qa/publish'&&request.method==='POST'){const {path}=await body(request);publish(path);return textJson(response,{ok:true})}
  if(request.url==='/qa/operation'&&request.method==='POST'){
   const {op,actor,ref,data}=await body(request);const path=ref.path;
   if(op==='getDoc'||op==='getDocs'){
    reads.push({op,actor,path,constraints:ref.constraints||[]});
    if(control.readErrors.includes(path))return textJson(response,{error:'No se pudo leer la configuración local de prueba.'},503);
    if(op==='getDoc')return textJson(response,{found:docs.has(path)&&docs.get(path)!==null,data:clone(docs.get(path))});
    return textJson(response,allCollection(path).filter(item=>matches(item,ref.constraints||[])));
   }
   if(control.writeErrors.includes(path))return textJson(response,{error:'Fallo de guardado local de prueba.'},503);
   if(op==='setDoc'||op==='updateDoc'){
    writes.push({op,actor,path,data:clone(data)});docs.set(path,op==='updateDoc'?{...docs.get(path),...clone(data)}:clone(data));
    if(path==='study_schedules/PT1'||path==='study_schedules/qa-collab')for(const alias of ['study_schedules/PT1','study_schedules/qa-collab']){docs.set(alias,clone(data));publish(alias)}
    else publish(path);return textJson(response,{ok:true});
   }
   if(op==='addDoc'){
    if(path!=='schedule_requests')throw Error('Unexpected local add collection');
    const id=String(nextId++);docs.set(`${path}/${id}`,{...clone(data),createdAt:new Date().toISOString()});writes.push({op,actor,path:`${path}/${id}`,data:clone(data)});publish(`${path}/${id}`);return textJson(response,{id});
   }
   throw Error(`Unexpected operation ${op}`);
  }
  if(request.url==='/qa/delete'&&request.method==='POST'){
   const {table,kind,filters,actor}=await body(request);deletes.push({table,kind,filters,actor});
   if(control.deleteMode==='error')return textJson(response,{data:null,error:{message:'Fallo local al eliminar; la solicitud se conserva.'}});
   const id=String(filters.id),path=`${table}/${id}`;let item=docs.get(path);
   if(control.deleteMode==='approve_before_delete'&&item){item={...item,status:'approved'};docs.set(path,item)}
   if(table!=='schedule_requests'||kind!=='delete'||filters.user_id!==actor||!item||item.uid!==filters.user_id||item.staffId!==filters.staff_id||item.storeId!==filters.store_id||item.status!==filters.status||filters.status!=='pending')return textJson(response,{data:null,error:null});
   docs.delete(path);publish(path);return textJson(response,{data:{id},error:null});
  }
  if(request.url==='/qa/rpc'&&request.method==='POST'){
   const {name,args,actor}=await body(request);
   if(name!=='update_schedule_access'||actor!=='qa-admin')return textJson(response,{data:null,error:{message:'RPC no autorizado en esta prueba local.'}});
   const path=`stores/${args.p_store_id}/config/schedule_access`;
   if(control.writeErrors.includes(path))return textJson(response,{data:null,error:{message:'Fallo RPC local de prueba.'}});
   try{
    const raw=docs.get(path),current=normalizeScheduleAccessPolicy(raw===null?undefined:raw);
    const original=normalizeScheduleAccessPolicy(args.p_original),draft=normalizeScheduleAccessPolicy(args.p_draft),next={...current};
    for(const key of ['adminOnlyStudyEditing','requestsEnabled'])if(draft[key]!==original[key])next[key]=draft[key];
    for(const key of ['blockedWeeks','blockedDates']){
     const removed=new Set(original[key].filter(value=>!draft[key].includes(value))),added=draft[key].filter(value=>!original[key].includes(value));
     next[key]=[...new Set([...current[key].filter(value=>!removed.has(value)),...added])].sort();
    }
    const value={...(raw||{}),...normalizeScheduleAccessPolicy(next)};
    docs.set(path,value);writes.push({op:'rpc',name,actor,path,args:clone(args),data:clone(value)});publish(path);
    return textJson(response,{data:clone(value),error:null});
   }catch(error){return textJson(response,{data:null,error:{message:error.message}})}
  }
  if(request.url==='/app.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(bundle.outputFiles[0].text);return}
  if(request.url==='/style.css'){response.writeHead(200,{'Content-Type':'text/css'});response.end(css);return}
  response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Permisos de horario · QA local</title><link rel="stylesheet" href="/style.css"><body class="bg-slate-50"><div id="root"></div><script src="/app.js"></script></body></html>');
 }catch(error){textJson(response,{error:error.message},500)}
});
const port=Number(process.env.SCHEDULE_ACCESS_QA_PORT||4204),host=process.env.SCHEDULE_ACCESS_QA_HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Schedule access QA: http://${host}:${port}/`));
