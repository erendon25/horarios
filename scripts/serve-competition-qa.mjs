// Local-only browser harness. Uses real module components and real PostgreSQL RPCs.
// Auth and Supabase transport are test adapters; no production credentials/data.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { createCompetitionTestDb } from "./competition-test-db.mjs";
const db = await createCompetitionTestDb();
const scalar = async (sql, params = []) =>
  Object.values((await db.query(sql, params)).rows[0])[0];
const store = await scalar("insert into stores default values returning id");
await db.exec(
  "alter table stores add column name text default 'Tienda de prueba'; grant select on stores,staff_profiles,audit_log to authenticated;",
);
const admin = await scalar(
  "insert into auth.users values(gen_random_uuid()) returning id",
);
const collab = await scalar(
  "insert into auth.users values(gen_random_uuid()) returning id",
);
const rivalAccount = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
const trainerAccount = await scalar('insert into auth.users values(gen_random_uuid()) returning id');
await db.query(
  "insert into user_profiles(id,store_id,role) values($1,$3,'admin'),($2,$3,'collaborator')",
  [admin, collab, store],
);
const trainer = await scalar(
  "insert into staff_profiles(store_id,first_name,last_name,position) values($1,'Trainer','Demo','ENTRENADOR') returning id",
  [store],
);
const staff = await scalar(
  "insert into staff_profiles(store_id,first_name,last_name) values($1,'Colaboradora','Demo') returning id",
  [store],
);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
await db.exec("set role authenticated");
const cmd = (id, action, payload = {}) =>
  scalar("select competition_command($1,$2,$3::jsonb)", [
    id,
    action,
    JSON.stringify(payload),
  ]);
const c = await cmd(null, "create", {
  store_id: store,
  name: "Concurso de velocidad y calidad · Prueba local",
});
const t = await cmd(c.id, "team", {
  name: "Equipo 1",
  trainer_staff_id: trainer,
});
const m = await cmd(c.id, "member", { team_id: t.id, staff_id: staff });
const areas = (await db.query("select * from competition_areas")).rows;
for (const a of areas)
  await cmd(c.id, "area", { ...a, maximum_duration_ms: 45000 });
const landing = areas.find((a) => a.name === "Landing");
const evaluationMode = process.env.COMPETITION_QA_MODE === 'evaluation';
const collaboratorMode = process.env.COMPETITION_QA_MODE === 'collaborator';
if (!evaluationMode && !collaboratorMode) await cmd(c.id, "entry", { member_id: m.id, area_id: landing.id });
await db.exec("reset role");
const rivalStaff = await scalar("insert into staff_profiles(store_id,first_name,last_name) values($1,'Rival','Demo') returning id", [store]);
await db.query("update user_profiles set staff_profile_id=$1 where id=$2", [staff, collab]);
await db.query("insert into user_profiles(id,store_id,staff_profile_id,role) values($1,$3,$4,'collaborator'),($2,$3,$5,'trainer')",[rivalAccount,trainerAccount,store,rivalStaff,trainer]);
await db.exec("set role authenticated");
const rivalMember = await cmd(c.id, "member", { team_id: t.id, staff_id: rivalStaff });
if (!evaluationMode && !collaboratorMode) {
  await cmd(c.id, "entry", { member_id: rivalMember.id, area_id: landing.id });
  await cmd(c.id, "status", { status: "active" });
}
if (!collaboratorMode) await cmd(c.id, "publication", { published: true });
const mock = `
const users={admin:${JSON.stringify(admin)},collaborator:${JSON.stringify(collab)},rival:${JSON.stringify(rivalAccount)},trainer:${JSON.stringify(trainerAccount)}};
const sessions=Object.fromEntries(Object.entries(users).map(([role,uid])=>[role,{currentUser:{uid,email:'demo@example.test'},logout:async()=>{},updatePassword:async()=>{},userRole:role==='rival'?'collaborator':role,userData:{storeId:${JSON.stringify(store)},staffProfileId:role==='trainer'?${JSON.stringify(trainer)}:role==='rival'?${JSON.stringify(rivalStaff)}:${JSON.stringify(staff)}}}]));
export function useAuth(){const role=new URLSearchParams(location.search).get('role')||sessionStorage.getItem('qa-role')||'admin';if(new URLSearchParams(location.search).has('role'))sessionStorage.setItem('qa-role',role);return sessions[role]};
`;
// Only the dashboard's unrelated profile/schedule widgets use fixture adapters.
// Publication checks still use the real competition service and PostgreSQL RLS.
const profileAdapter = `
import {trainingRecognition} from './src/services/trainingRecognition.js';
const storeId=${JSON.stringify(store)},staffId=${JSON.stringify(staff)};
const profile={name:'Colaboradora Demo',storeId,position:'COLABORADOR',modality:'Part Time',status:'active',sanitaryCardDate:'2030-01-01',positioning:[]};
const snap=(id,data)=>({id,exists:()=>!!data,data:()=>data});
export const getFirestore=()=>({});
export const db=getFirestore();
export const collection=(db,...path)=>({path});
export const doc=(db,...path)=>({path});
export const where=(...args)=>args;
export const query=(ref,...filters)=>({...ref,filters});
export async function getDocs(ref){
 let docs=[];
 if(ref.path.length===1&&ref.path[0]==='staff_profiles'){
   const role=new URLSearchParams(location.search).get('role')||sessionStorage.getItem('qa-role')||'admin';
   const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,table:'staff_profiles',filters:{store_id:storeId},columns:'*',orders:[],start:0,end:999})});
   const result=await response.json();if(result.error)throw Error(result.error.message);
   docs=result.data.map(row=>snap(row.id,{...profile,...trainingRecognition(row),name:[row.first_name,row.last_name].filter(Boolean).join(' '),lastName:'',position:row.position,status:row.status,uid:row.id===staffId?${JSON.stringify(collab)}:null}));
   if(location.pathname==='/staff')docs=docs.filter(d=>d.id===staffId);
 }else if(ref.path.length===1&&ref.path[0]==='stores')docs=[snap(storeId,{name:'Tienda de prueba',active:true})];
 return {docs,empty:!docs.length};
}
export async function getDoc(ref){return snap(ref.path.at(-1),ref.path[0]==='stores'&&ref.path.length===2?{name:'Tienda de prueba'}:null)}
export function onSnapshot(ref,fn){fn(snap('',null));return ()=>{}}
export const updateDoc=async()=>{throw Error('Edición de perfil fuera de alcance QA')};
export const setDoc=updateDoc;
export const serverTimestamp=()=>new Date();
`;
const transport = `
function role(){const role=new URLSearchParams(location.search).get('role');if(role)sessionStorage.setItem('qa-role',role);return sessionStorage.getItem('qa-role')||'admin'}
async function request(body){const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,role:role()})});return r.json()}
export const supabase={
auth:{async getUser(){const ids={admin:${JSON.stringify(admin)},collaborator:${JSON.stringify(collab)},rival:${JSON.stringify(rivalAccount)},trainer:${JSON.stringify(trainerAccount)}};return {data:{user:{id:ids[role()]}},error:null}}},
storage:{from(bucket){return {async upload(path,blob,options){const bytes=new Uint8Array(await blob.arrayBuffer());let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);return request({storage:'upload',bucket,path,content:btoa(raw),contentType:options.contentType,upsert:options.upsert})},createSignedUrls(paths){return request({storage:'sign',bucket,paths})},remove(paths){return request({storage:'remove',bucket,paths})}}}},
from(table){const filters={},inFilters={},notNull=[],orders=[];let start=0,end=999,columns='*';return {select(s){columns=s;return this},eq(k,v){filters[k]=v;return this},in(k,v){inFilters[k]=v;return this},not(k,op,v){if(op!=='is'||v!==null)throw Error('Unsupported QA filter');notNull.push(k);return this},limit(n){end=start+n-1;return this},order(k){orders.push(k);return this},range(a,b){start=a;end=b;return this},then(resolve,reject){return request({table,filters,inFilters,notNull,orders,start,end,columns}).then(resolve,reject)}}},
rpc(name,args){return request({rpc:name,args})},channel(){let callback;return {on(event,filter,fn){callback=fn;return this},subscribe(fn){fn('SUBSCRIBED');this.interval=setInterval(()=>callback?.(),1500);return this}}},removeChannel(c){clearInterval(c.interval)}
};`;
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import App from './src/components/Competition/CompetitionApp.jsx';import Dashboard from './src/components/CollaboratorDashboard.jsx';import TrainingDashboard from './src/components/Training/TrainingDashboard.jsx';function Training(){const [area,setArea]=React.useState('production');return <TrainingDashboard activeArea={area} onAreaChange={setArea}/>};createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/concurso' element={<App/>}/><Route path='/staff' element={<Dashboard/>}/><Route path='/training' element={<Training/>}/><Route path='*' element={<a href='/concurso'>Abrir concurso</a>}/></Routes></BrowserRouter>);`,
    loader: "jsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  outdir: "/tmp/competition-qa-build",
  format: "esm",
  plugins: [
    {
      name: "test-adapters",
      setup(b) {
        b.onResolve({ filter: /contexts\/AuthContext$/ }, () => ({
          path: "auth",
          namespace: "test",
        }));
        b.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({
          path: "db",
          namespace: "test",
        }));
        b.onResolve({ filter: /lib\/supabase\/firestoreCompat$/ }, () => ({path:'profile',namespace:'test'}));
        b.onResolve({ filter: /^\.\/(HolidayForm|HolidayBalancePanel|StudyScheduleForm|ScheduleRequestForm|WeeklyView|CollaboratorSuggestiveGoals|ModalSelectorDePosiciones)$/ }, args =>
          args.importer.endsWith('CollaboratorDashboard.jsx') ? {path:'unrelated-widget',namespace:'test'} : undefined);
        b.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents: args.path === "auth" ? mock : args.path === 'profile' ? profileAdapter : args.path === 'unrelated-widget' ? 'export default function Widget(){return null}' : transport,
          loader: "js",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const dashboardCss = await postcss([tailwindcss({content:['./src/components/CollaboratorDashboard.jsx','./src/components/ProfilePhotoEditor.jsx','./src/components/Training/TrainingDashboard.jsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from:undefined});
const css = dashboardCss.css + '\n' + bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
let queue = Promise.resolve();
const photoFiles = new Map(), photoTokens = new Map();
const server = createServer(async (req, res) => {
  if(req.url.startsWith('/qa-photo/')) {
    const signed = photoTokens.get(req.url.split('?')[0].slice('/qa-photo/'.length));
    const file = signed && signed.expires > Date.now() && photoFiles.get(signed.path);
    if(!file){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',file.type);res.setHeader('Cache-Control','private, no-store');res.end(file.bytes);return;
  }
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
    return;
  }
  if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  if (req.url === "/api" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const task = queue.then(async () => {
      try {
        await db.exec("reset role");
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          ({ collaborator:collab, rival:rivalAccount, trainer:trainerAccount })[body.role] || admin,
        ]);
        await db.exec("set role authenticated");
        let data;
        if (body.rpc === "competition_command")
          data = await cmd(
            body.args.p_competition_id,
            body.args.p_action,
            body.args.p_payload,
          );
        else if (body.rpc === "competition_server_time")
          data = await scalar("select competition_server_time()");
        else if(body.rpc === 'set_own_profile_photo')
          data = await scalar('select set_own_profile_photo($1)',[body.args.p_object_path]);
        else if(body.storage) {
          if(body.bucket!=='profile-photos')throw Error('Bucket not allowed');
          if(body.storage==='upload') {
            const bytes=Buffer.from(body.content,'base64');
            if(!['image/webp','image/jpeg','image/png'].includes(body.contentType)||bytes.length>2097152)throw Error('Archivo no permitido');
            const owner=({collaborator:collab,rival:rivalAccount,trainer:trainerAccount})[body.role]||admin;
            await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb)' + (body.upsert ? ' on conflict(bucket_id,name) do update set owner_id=excluded.owner_id,metadata=excluded.metadata' : ''),[body.bucket,body.path,owner,JSON.stringify({size:bytes.length,mimetype:body.contentType})]);
            photoFiles.set(body.path,{bytes,type:body.contentType});data={path:body.path};
          } else if(body.storage==='sign') {
            data=[];
            for(const path of body.paths) {
              const found=(await db.query('select name from storage.objects where bucket_id=$1 and name=$2',[body.bucket,path])).rows;
              if(found.length) {const token=crypto.randomUUID();photoTokens.set(token,{path,expires:Date.now()+3600000});data.push({path,signedUrl:'/qa-photo/'+token,error:null})}
              else data.push({path,signedUrl:null,error:'No autorizado'});
            }
          } else if(body.storage==='remove') {
            data=[];
            for(const path of body.paths) {const deleted=await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[body.bucket,path]);if(deleted.rows.length){photoFiles.delete(path);data.push({name:path})}}
          } else throw Error('Storage operation not allowed');
        }
        else {
          if (
            !/^(competition_[a-z_]+|competitions|stores|staff_profiles|staff_profile_photos|audit_log)$/.test(
              body.table,
            )
          )
            throw new Error("Table not allowed");
          const keys = Object.keys(body.filters),
            orders = body.orders;
          const inKeys = Object.keys(body.inFilters || {});
          const notNull = body.notNull || [];
          for (const k of [...keys, ...inKeys, ...notNull, ...orders])
            if (!/^[a-z_]+$/.test(k)) throw new Error("Invalid identifier");
          const cols =
            body.columns === "*"
              ? "*"
              : body.columns
                  .split(",")
                  .map((k) => {
                    if (!/^[a-z_]+$/.test(k)) throw new Error("Invalid column");
                    return '"' + k + '"';
                  })
                  .join(",");
          data = (
            await db.query(
              "select " +
                cols +
                ' from "' +
                body.table +
                '"' +
                (keys.length || inKeys.length || notNull.length
                  ? " where " +
                    [...keys.map((k, i) => '"' + k + '"=$' + (i + 1)), ...inKeys.map((k,i)=>'"'+k+'"::text=any($'+(keys.length+i+1)+'::text[])'), ...notNull.map(k=>'"'+k+'" is not null')].join(" and ")
                  : "") +
                (orders.length
                  ? " order by " + orders.map((k) => '"' + k + '"').join(",")
                  : "") +
                " limit " +
                Number(body.end - body.start + 1) +
                " offset " +
                Number(body.start),
              [...Object.values(body.filters),...Object.values(body.inFilters || {})],
            )
          ).rows;
        }
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    });
    queue = task.then(() => {});
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(await task));
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Concurso · QA local</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0;font-family:system-ui,sans-serif"><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  );
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.COMPETITION_QA_PORT || 4178),
    "127.0.0.1",
    resolve,
  ),
);
console.log(
  `QA local lista: http://127.0.0.1:${process.env.COMPETITION_QA_PORT || 4178}/concurso`,
);
await mkdir("/tmp/competition-qa", { recursive: true });
await readFile(new URL("../docs/CONCURSO.md", import.meta.url));
