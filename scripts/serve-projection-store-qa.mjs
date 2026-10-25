// Real projection Page + Dashboard; only transport and auth are isolated.
// This harness has no credentials and cannot contact Supabase or production.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

const configurations = new Map([
  ['store-a', {
    positions: [
      { id: 'exclusive-a', name: 'Área exclusiva A', logic: 'fixed', fixedStaff: 2 },
      { id: 'salon', name: 'Salón', logic: 'service', ticketAverage: 35, transactionsPerCollaborator: 23, factor: 1 },
    ],
    manualStaffByDay: {}, generalVhl: 1000, generalVhlMode: 'manual',
    requirements: { proof: 'keep prior requirements until a valid recalculation exists' },
    preservedMetadata: 'existing store metadata',
  }],
]);
const control = { readErrors: [], writeErrors: [], readDelay: {}, writeDelay: {} };
const dataFixtures = new Map();
const writes = [], reads = [];
const transport = `
export const db={};
export const collection=(...parts)=>({path:parts.filter(x=>typeof x==='string').join('/'),constraints:[]});
export const doc=collection;
export const where=(field,operator,value)=>({field,operator,value});
export const orderBy=(...args)=>({orderBy:args});
export const query=(ref,...constraints)=>({...ref,constraints});
async function operation(op,ref,data){
 const response=await fetch('/qa-operation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,ref,data})});
 const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
const snap=(item)=>({id:item.id,exists:()=>item.data!==null,data:()=>item.data});
export const getDoc=async ref=>snap(await operation('getDoc',ref));
export const getDocs=async ref=>({docs:(await operation('getDocs',ref)).map(snap)});
export const setDoc=async(ref,data)=>operation('setDoc',ref,data);
`;
const auth = `import React,{useContext} from 'react'; export const QAAuthContext=React.createContext({}); export const useAuth=()=>useContext(QAAuthContext);`;
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {QAAuthContext} from './src/contexts/AuthContext.jsx';
import ScheduleProjectionPage from './src/components/ScheduleProjectionPage.jsx';
function App(){
 const [storeId,setStoreId]=useState(sessionStorage.getItem('projection-qa-store')||'store-a');
 const change=value=>{sessionStorage.setItem('projection-qa-store',value);setStoreId(value)};
 return <MemoryRouter><QAAuthContext.Provider value={{userData:{storeId}}}>
  <div className="p-3 bg-amber-100 flex gap-3"><strong>Prueba aislada · sin acceso a producción</strong>
  <label>Tienda de prueba <select aria-label="Tienda de prueba" value={storeId} onChange={event=>change(event.target.value)}>
   <option value="store-a">Tienda A</option><option value="store-b">Tienda B</option><option value="store-c">Tienda C</option>
  </select></label></div><ScheduleProjectionPage/>
 </QAAuthContext.Provider></MemoryRouter>
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'isolated-projection-store-transport', setup(builder) {
    builder.onLoad({ filter: /lib\/supabase\/firestoreCompat\.js$/ }, () => ({ contents: transport, loader: 'js' }));
    builder.onLoad({ filter: /contexts\/AuthContext\.jsx$/ }, () => ({ contents: auth, loader: 'jsx' }));
    builder.onLoad({ filter: /src\/supabase\.js$/ }, () => ({ contents: 'export const db={};', loader: 'js' }));
  } }],
});
const css = (await postcss([tailwind({ content: ['./src/**/*.{js,jsx}'] })])
  .process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
const json = (response,value) => { response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value)); };
const body = async request => { let raw='';for await(const chunk of request)raw+=chunk;return JSON.parse(raw||'{}'); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms || 0));
const validStore = storeId => ['store-a','store-b','store-c'].includes(storeId);
const documents = rows => rows.map(row => ({ id: row.id, data: structuredClone(row) }));
const filtered = (rows, constraints = []) => rows.filter(row => constraints.every(constraint => {
 if(!constraint.field)return true;
 const value = constraint.field === '__name__' ? row.id : row[constraint.field];
 if(constraint.operator==='==')return value===constraint.value;
 if(constraint.operator==='in')return constraint.value.includes(value);
 throw Error(`Unsupported isolated fixture filter: ${constraint.operator}`);
}));
const server = createServer(async(request,response)=>{
 try {
  if(request.url==='/qa-state')return json(response,{ configurations:Object.fromEntries(configurations),fixtures:Object.fromEntries(dataFixtures),writes,reads,control });
  if(request.url==='/qa-control'&&request.method==='POST'){Object.assign(control,await body(request));return json(response,{ok:true});}
  if(request.url==='/qa-configuration'&&request.method==='POST'){
   const {storeId,value}=await body(request);
   if(!validStore(storeId)||!value||typeof value!=='object'||Array.isArray(value)){
    response.statusCode=400;return json(response,{error:'Invalid isolated configuration fixture'});
   }
   configurations.set(storeId,structuredClone(value));return json(response,{ok:true});
  }
  if(request.url==='/qa-data'&&request.method==='POST'){
   const {storeId,salesHistory=[],staff=[],schedules=[],salesConfigs={}}=await body(request);
   if(!validStore(storeId)||![salesHistory,staff,schedules].every(Array.isArray)||!salesConfigs||typeof salesConfigs!=='object'||Array.isArray(salesConfigs)){
    response.statusCode=400;return json(response,{error:'Invalid isolated sales/staff/schedules fixture'});
   }
   dataFixtures.set(storeId,structuredClone({salesHistory,staff,schedules,salesConfigs}));
   return json(response,{ok:true});
  }
  if(request.url==='/qa-operation'&&request.method==='POST'){
   const {op,ref,data}=await body(request),parts=ref.path.split('/'),storeId=parts[1];
   if(op==='getDoc'){
    reads.push({path:ref.path,storeId,time:Date.now()});
    if(parts[2]==='config'&&parts[3]==='schedule_projection'){
     await delay(control.readDelay[storeId]);
     if(control.readErrors.includes(storeId)){response.statusCode=503;return json(response,{error:'Fallo de lectura simulado'});}
     return json(response,{id:parts.at(-1),data:configurations.get(storeId)||null});
    }
    if(parts[2]==='sales_config')return json(response,{id:parts.at(-1),data:dataFixtures.get(storeId)?.salesConfigs?.[parts.at(-1)]||null});
    return json(response,{id:parts.at(-1),data:null});
   }
   if(op==='getDocs'){
    if(parts[0]==='stores'&&parts[2]==='sales_history')return json(response,documents(dataFixtures.get(storeId)?.salesHistory||[]));
    if(parts[0]==='staff_profiles'||parts[0]==='schedules'){
     const field=parts[0]==='staff_profiles'?'staff':'schedules';
     const rows=[...dataFixtures.values()].flatMap(value=>value[field]);
     return json(response,documents(filtered(rows,ref.constraints)));
    }
    return json(response,[]); // Existing tests leave optional sales/staff fixtures empty.
   }
   if(op==='setDoc'){
    if(parts[2]!=='config'||parts[3]!=='schedule_projection')throw Error('Unexpected write path');
    writes.push({path:ref.path,storeId,data,time:Date.now(),failed:control.writeErrors.includes(storeId)});
    await delay(control.writeDelay[storeId]);
    if(control.writeErrors.includes(storeId)){response.statusCode=503;return json(response,{error:'Fallo de guardado simulado'});}
    configurations.set(storeId,structuredClone(data));return json(response,{ok:true});
   }
   throw Error('Unexpected operation');
  }
  if(request.url==='/app.js'){response.setHeader('Content-Type','text/javascript');return response.end(bundle.outputFiles[0].text);}
  if(request.url==='/style.css'){response.setHeader('Content-Type','text/css');return response.end(css);}
  response.setHeader('Content-Type','text/html');
  response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proyección multi-tienda QA</title><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');
 } catch(error){response.statusCode=500;json(response,{error:error.message});}
});
const port=Number(process.env.PROJECTION_STORE_QA_PORT||4194);
server.listen(port,'127.0.0.1',()=>console.log(`Projection store QA: http://127.0.0.1:${port}/`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));process.on('SIGINT',()=>server.close(()=>process.exit(0)));
