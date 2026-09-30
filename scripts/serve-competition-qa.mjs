// Local-only browser harness. Uses real module components and real PostgreSQL RPCs.
// Auth and Supabase transport are test adapters; no production credentials/data.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
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
await db.query(
  "insert into user_profiles(id,store_id,role) values($1,$3,'admin'),($2,$3,'collaborator')",
  [admin, collab, store],
);
const trainer = await scalar(
  "insert into staff_profiles(store_id,first_name,last_name) values($1,'Trainer','Demo') returning id",
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
await cmd(c.id, "entry", { member_id: m.id, area_id: landing.id });
await db.exec("reset role");
const rivalStaff = await scalar("insert into staff_profiles(store_id,first_name,last_name) values($1,'Rival','Demo') returning id", [store]);
await db.query("update user_profiles set staff_profile_id=$1 where id=$2", [staff, collab]);
await db.exec("set role authenticated");
const rivalMember = await cmd(c.id, "member", { team_id: t.id, staff_id: rivalStaff });
await cmd(c.id, "entry", { member_id: rivalMember.id, area_id: landing.id });
await cmd(c.id, "status", { status: "active" });
const mock = `
export function useAuth(){return {userRole:location.search.includes('role=collaborator')||sessionStorage.getItem('qa-role')==='collaborator'?'collaborator':'admin',userData:{storeId:${JSON.stringify(store)},staffProfileId:${JSON.stringify(staff)}}};}
`;
const transport = `
function role(){if(location.search.includes('role=collaborator'))sessionStorage.setItem('qa-role','collaborator');return sessionStorage.getItem('qa-role')||'admin'}
async function request(body){const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,role:role()})});return r.json()}
export const supabase={
from(table){const filters={},orders=[];let start=0,end=999,columns='*';return {select(s){columns=s;return this},eq(k,v){filters[k]=v;return this},order(k){orders.push(k);return this},range(a,b){start=a;end=b;return this},then(resolve,reject){return request({table,filters,orders,start,end,columns}).then(resolve,reject)}}},
rpc(name,args){return request({rpc:name,args})},channel(){let callback;return {on(event,filter,fn){callback=fn;return this},subscribe(fn){fn('SUBSCRIBED');this.interval=setInterval(()=>callback?.(),1500);return this}}},removeChannel(c){clearInterval(c.interval)}
};`;
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import App from './src/components/Competition/CompetitionApp.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/concurso' element={<App/>}/><Route path='*' element={<a href='/concurso'>Abrir concurso</a>}/></Routes></BrowserRouter>);`,
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
        b.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents: args.path === "auth" ? mock : transport,
          loader: "js",
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
let queue = Promise.resolve();
const server = createServer(async (req, res) => {
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
          body.role === "collaborator" ? collab : admin,
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
        else {
          if (
            !/^(competition_[a-z_]+|competitions|stores|staff_profiles|audit_log)$/.test(
              body.table,
            )
          )
            throw new Error("Table not allowed");
          const keys = Object.keys(body.filters),
            orders = body.orders;
          for (const k of [...keys, ...orders])
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
                (keys.length
                  ? " where " +
                    keys.map((k, i) => '"' + k + '"=$' + (i + 1)).join(" and ")
                  : "") +
                (orders.length
                  ? " order by " + orders.map((k) => '"' + k + '"').join(",")
                  : "") +
                " limit " +
                Number(body.end - body.start + 1) +
                " offset " +
                Number(body.start),
              Object.values(body.filters),
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
