// Real import component + real Postgres migration in isolated PGlite.
// This server has no Supabase credentials and never contacts production.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { createStaffImportTestDb, STAFF_IMPORT_TEST_IDS as ids } from './staff-planilla-test-db.mjs';

const db = await createStaffImportTestDb().catch(error => {
  console.error(`DB QA setup failed (${error.code || 'unknown'}): ${error.message}`);
  process.exit(1);
});
let rpcCalls = 0;
let pending = Promise.resolve();
function isolated(action) {
  const result = pending.then(async () => {
    await db.exec('reset role');
    try { return await action(); }
    finally { await db.exec('reset role'); }
  });
  pending = result.catch(() => {});
  return result;
}
const transport = `
export const supabase={rpc:async(name,args)=>{
 const response=await fetch('/qa-rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});
 return response.json();
}};
`;
const entry = `
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import StaffPlanillaImport from './src/components/StaffPlanillaImport.jsx';
function App(){
 const [staff,setStaff]=useState([]),[ready,setReady]=useState(false);
 const load=async()=>{const response=await fetch('/qa-staff');setStaff(await response.json());setReady(true)};
 useEffect(()=>{load()},[]);
 return <main className="mx-auto max-w-6xl p-4">
  <div className="mb-4 rounded bg-amber-100 p-3 font-bold">Prueba aislada de planilla BUK · sin acceso a producción</div>
  <h1 className="mb-3 text-xl font-bold">Personal de Porongoche</h1>
  {ready&&<StaffPlanillaImport storeId="${ids.storeA}" storeName="Porongoche" staff={staff} onImported={load}/>}
  <p className="my-4">Colaboradores guardados: <strong data-testid="stored-count">{staff.length}</strong></p>
  <ul data-testid="saved-staff" className="divide-y">{staff.map(person=><li key={person.id} className="py-2">{person.name} {person.lastName} · {person.modality} · {person.position}</li>)}</ul>
  <div aria-hidden="true" style={{height:1800}}/>
 </main>
}
createRoot(document.getElementById('root')).render(<App/>);
`;
const result = await build({
  stdin: { contents: entry, loader: 'jsx', resolveDir: process.cwd() }, bundle: true,
  write: false, format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'isolated-staff-import-transport', setup(builder) {
    builder.onLoad({ filter: /lib\/supabase\/client\.js$/ }, () => ({ contents: transport, loader: 'js' }));
  } }],
});
const js = result.outputFiles[0].text;
const css = (await postcss([tailwind({ content: ['./src/**/*.{js,jsx}'] })])
  .process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
const responseJson = (response, value) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/qa-staff') {
      const people = await isolated(async () => (await db.query(`select id,store_id as "storeId",first_name as name,last_name as "lastName",dni,modality,position,status,needs_completion as "needsCompletion",cessation_date as "cessationDate",is_trainee as "isTrainee",training_end_date as "trainingEndDate" from public.staff_profiles where store_id=$1 order by first_name,last_name`, [ids.storeA])).rows);
      return responseJson(response, people);
    }
    if (request.url === '/qa-database') {
      const snapshot = await isolated(async () => ({
        rows: (await db.query('select to_jsonb(s) as profile from public.staff_profiles s order by dni')).rows.map(row => row.profile),
        authAccounts: Number((await db.query('select count(*) as count from auth.users')).rows[0].count),
        accessProfiles: Number((await db.query('select count(*) as count from public.user_profiles')).rows[0].count),
      }));
      return responseJson(response, { ...snapshot, rpcCalls, scope: 'Isolated PGlite only' });
    }
    if (request.url === '/qa-rpc' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk;
      const { name, args } = JSON.parse(text);
      if (name !== 'import_staff_planilla') return responseJson(response, { data: null, error: { message: 'RPC no disponible en esta prueba aislada.' } });
      rpcCalls++;
      const value = await isolated(async () => {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.admin]);
        await db.exec('set role authenticated');
        try {
          const result = await db.query('select public.import_staff_planilla($1::uuid,$2::jsonb,$3::text) as value', [args.p_store_id, JSON.stringify(args.p_rows), args.p_source_file]);
          return { data: result.rows[0].value, error: null };
        } catch (error) { return { data: null, error: { message: error.message } }; }
      });
      return responseJson(response, value);
    }
    if (request.url === '/qa-reset' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk;
      const { inactiveDni } = JSON.parse(text || '{}');
      await isolated(async () => {
        await db.exec('delete from public.staff_profiles');
        rpcCalls = 0;
        if (inactiveDni) await db.query(`insert into public.staff_profiles(store_id,first_name,last_name,dni,modality,position,status,needs_completion,cessation_date,legacy_data)
          values($1,'Perfil previo','Inactivo',$2,'Part-Time','COLABORADOR','inactive',false,'2026-09-01','{"proof":"unchanged"}'::jsonb)`, [ids.storeA, inactiveDni]);
      });
      return responseJson(response, { reset: true });
    }
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(js); }
    if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); return response.end(css); }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba aislada de planilla</title><link rel="stylesheet" href="/style.css"><body class="bg-slate-50"><div id="root"></div><script src="/app.js"></script></body></html>');
  } catch (error) { response.statusCode = 500; responseJson(response, { error: error.message }); }
});
const port = Number(process.env.STAFF_PLANILLA_QA_PORT || 4191);
server.listen(port, '127.0.0.1', () => console.log(`Planilla QA aislada: http://127.0.0.1:${port}/`));
async function close() { server.close(); await pending; await db.close(); process.exit(0); }
process.on('SIGTERM', close); process.on('SIGINT', close);
