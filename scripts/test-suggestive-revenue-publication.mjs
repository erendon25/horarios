import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleName=process.env.PGLITE_MODULE || '@electric-sql/pglite';
const {PGlite}=await import(isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const db=new PGlite();
const migration='supabase/migrations/20261019200253_dynamic_revenue_suggestive_goals.sql';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store=id(1), otherStore=id(2), admin=id(10), user=id(11), otherUser=id(12), unprofiled=id(13), staff=id(20), second=id(21), outsider=id(22);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const authenticate=async userId=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId || '']);await db.exec('set role authenticated')};
const allowedChannels=['SALÓN','DRIVE THRU','SERV. FILA','SERV. AUTO'];
const targets={chosen:33,calculation:{basis:'channel_sales_revenue',participation:0.3,products:[{id:'chosen',label:'Producto elegido',reportName:'NOMBRE EXACTO',price:29.90}],channels:[{id:'SALÓN'}]}};
const row={staffId:staff,date:'2026-10-18',channel:'SALÓN',schedule:'09:00–10:00',goals:{chosen:33},hourlyGoals:{9:{chosen:33}},coveredHours:[9]};
const publish=(rows=[row],monthly=targets,storeId=store)=>scalar('select publish_suggestive_sales_goals($1,$2,$3,$4)',[storeId,'2026-10-01',JSON.stringify(rows),JSON.stringify(monthly)]);
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table stores(id uuid primary key);create table staff_profiles(id uuid primary key,store_id uuid references stores,user_id uuid references auth.users);
 create table user_profiles(id uuid primary key,store_id uuid,staff_id uuid,role text);
 create function private.current_user_role() returns text language sql security definer set search_path='' as $$select role from public.user_profiles where id=auth.uid()$$;
 create function private.current_user_store_id() returns uuid language sql security definer set search_path='' as $$select store_id from public.user_profiles where id=auth.uid()$$;
 create function private.current_staff_profile_id() returns uuid language sql security definer set search_path='' as $$select staff_id from public.user_profiles where id=auth.uid()$$;
 grant usage on schema private,auth to authenticated;grant execute on all functions in schema private,auth to authenticated;
 alter table staff_profiles enable row level security;grant select on staff_profiles to authenticated;
 create policy own_staff on staff_profiles for select to authenticated using(user_id=auth.uid() or private.current_user_role()='admin' and store_id=private.current_user_store_id());`);
 await db.exec(await readFile('supabase/migrations/20260911184406_publish_suggestive_sales_goals.sql','utf8'));
 await db.exec(`alter function public.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb) set schema private;
 create function public.publish_suggestive_sales_goals(p_store_id uuid,p_month_start date,p_rows jsonb,p_targets jsonb) returns integer language sql security invoker set search_path='' as $$select private.publish_suggestive_sales_goals(p_store_id,p_month_start,p_rows,p_targets)$$;
 revoke all on function public.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb) from public,anon;grant execute on function public.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb) to authenticated;`);
 await db.exec(await readFile(migration,'utf8'));
 await db.query('insert into stores values($1),($2)',[store,otherStore]);
 await db.query('insert into auth.users values($1),($2),($3),($4)',[admin,user,otherUser,unprofiled]);
 await db.query('insert into staff_profiles values($1,$2,$3),($4,$2,$5),($6,$7,$5)',[staff,store,user,second,otherUser,outsider,otherStore]);
 await db.query("insert into user_profiles values($1,$2,null,'admin'),($3,$2,$4,'collaborator'),($5,$2,$6,'collaborator')",[admin,store,user,staff,otherUser,second]);
 await authenticate(admin);assert.equal(await publish(),1);
 for(const channel of allowedChannels) {
   const configured={...targets,calculation:{...targets.calculation,channels:[{id:channel}]}};
   assert.equal(await publish([{...row,channel}],configured),1);
   assert.equal(await scalar('select channel from suggestive_sales_goal_assignments'),channel);
 }
 const fourChannelTargets={...targets,chosen:132,calculation:{...targets.calculation,channels:allowedChannels.map(id=>({id}))}};
 assert.equal(await publish(allowedChannels.map(channel=>({...row,channel})),fourChannelTargets),4);
 assert.deepEqual((await db.query('select channel,goals from suggestive_sales_goal_assignments order by channel')).rows.map(assignment=>assignment.channel).sort(),[...allowedChannels].sort(),'Fila, Auto and Drive remain separate assignments');
 assert.equal(Number(await scalar("select sum((goals->>'chosen')::integer) from suggestive_sales_goal_assignments")),132);
 assert.equal(await publish(),1);
 for(const channel of ['DELIVERY','CANAL NUEVO','MÓDULO','SERV.FILA','SERV.AUTO','DRIVE']) {
   const configured={...targets,calculation:{...targets.calculation,channels:[{id:channel}]}};
   await assert.rejects(()=>publish([{...row,channel}],configured),/configuration/i);
   assert.equal(Number(await scalar('select count(*) from suggestive_sales_goal_assignments')),1);
 }
 for(const patch of [
   {staffId:outsider},{date:'2026-11-01'},{channel:'NO CONFIGURADO'},{goals:{chosen:33,extra:1}},
   {goals:{chosen:-1}},{goals:{chosen:1.5}},{hourlyGoals:{9:{chosen:32}}},{coveredHours:[9,9]},{coveredHours:[8]},
   {hourlyGoals:{24:{chosen:33}},coveredHours:[24]}, {staffId:null},
 ]) { await assert.rejects(()=>publish([{...row,...patch}]),/Assignment|hourly|Covered|totals/i);assert.equal(Number(await scalar('select count(*) from suggestive_sales_goal_assignments')),1,'Invalid publication rolls back the previous month'); }
 await assert.rejects(()=>publish([row],{...targets,chosen:32}),/exceed/);
 await assert.rejects(()=>publish([row],{...targets,calculation:{...targets.calculation,products:[{...targets.calculation.products[0],price:0}]}}),/configuration/);
 await assert.rejects(()=>publish([row],{...targets,calculation:{...targets.calculation,products:[targets.calculation.products[0],targets.calculation.products[0]]}}),/Duplicate/);
 const {reportName:removedReportName,...missingReportName}=targets.calculation.products[0];
 for(const product of [missingReportName,...['','   ',null,13,'NOMBRE\nEXACTO'].map(reportName=>({...targets.calculation.products[0],reportName}))]) {
   await assert.rejects(()=>publish([row],{...targets,calculation:{...targets.calculation,products:[product]}}),/configuration/i);
   assert.equal(Number(await scalar('select count(*) from suggestive_sales_goal_assignments')),1,'Missing report names never remove a published snapshot');
 }
 for(const reportName of ['NOMBRE EXACTO','  NOMBRE EXACTO  ']) {
   const products=[targets.calculation.products[0],{id:'second',label:'Otro producto',reportName,price:10}];
   await assert.rejects(()=>publish([row],{...targets,second:0,calculation:{...targets.calculation,products}}),/Duplicate/i);
 }
 const caseProducts=[{...targets.calculation.products[0],reportName:'Producto'},{id:'second',label:'Otro producto',reportName:'producto',price:10}];
 const caseTargets={...targets,chosen:17,second:16,calculation:{...targets.calculation,products:caseProducts}};
 const caseGoals={chosen:17,second:16};
 assert.equal(await publish([{...row,goals:caseGoals,hourlyGoals:{9:caseGoals}}],caseTargets),1,'Exact report names remain case sensitive');
 assert.deepEqual((await scalar('select monthly_targets from suggestive_sales_goal_assignments')).calculation.products.map(product=>product.reportName),['Producto','producto']);
 assert.equal(await publish(),1);
 await assert.rejects(()=>publish([row],targets,otherStore),/administrators/);
 await authenticate(unprofiled);await assert.rejects(()=>publish(),/administrators/);
 await authenticate(user);await assert.rejects(()=>publish(),/administrators/);
 await authenticate(null);await assert.rejects(()=>publish(),/Authentication/);
 await authenticate(admin);
 assert.equal(await publish([{...row,goals:{chosen:17},hourlyGoals:{9:{chosen:17}}},{...row,staffId:second,goals:{chosen:16},hourlyGoals:{9:{chosen:16}}}]),2);
 await authenticate(user);
 let own=(await db.query("select * from get_my_suggestive_sales_goals('2026-10-18')")).rows;
 assert.equal(own.length,1);assert.equal(own[0].goals.chosen,17);assert.equal(own[0].channel,'SALÓN');
 assert.equal(Number(await scalar('select count(*) from suggestive_sales_goal_assignments')),1,'RLS keeps other staff assignments hidden');
 await authenticate(otherUser);own=(await db.query("select * from get_my_suggestive_sales_goals('2026-10-18')")).rows;assert.equal(own.length,1);assert.equal(own[0].goals.chosen,16);
 await authenticate(admin);assert.equal(Number(await scalar("select count(*) from get_my_suggestive_sales_goals('2026-10-18')")),0,'The reader never broadens ownership for admins');
 const legacy={cheeseBorder:1,hazloCanelitasV3:0,hazloCrazyV3:0};
 assert.equal(await publish([{...row,channel:'SALÓN',goals:legacy,hourlyGoals:{9:legacy}}],legacy),1);
 await authenticate(user);assert.equal(Number(await scalar("select count(*) from get_my_suggestive_sales_goals('2026-10-18')")),1,'Legacy three-product goals remain readable');
 await db.exec('reset role');
 const legacyRevenue=structuredClone(targets);
 delete legacyRevenue.calculation.products[0].reportName;
 legacyRevenue.calculation.channels=[{id:'MÓDULO'}];
 await db.query(`insert into suggestive_sales_goal_assignments(store_id,staff_id,goal_date,channel,schedule_label,goals,hourly_goals,covered_hours,monthly_targets)
 values($1,$2,'2026-10-17','MÓDULO','Snapshot antiguo',$3,$4,'[9]',$5)`,[store,staff,JSON.stringify({chosen:7}),JSON.stringify({9:{chosen:7}}),JSON.stringify(legacyRevenue)]);
 await authenticate(user);
 const oldRevenue=(await db.query("select * from get_my_suggestive_sales_goals('2026-10-17')")).rows;
 assert.equal(oldRevenue.length,1,'Published revenue snapshots without reportName remain readable');
 assert.equal(oldRevenue[0].channel,'MÓDULO');
 assert.equal(oldRevenue[0].monthly_targets.calculation.products[0].label,'Producto elegido');
 assert.equal(oldRevenue[0].monthly_targets.calculation.products[0].reportName,undefined);
 await authenticate(otherUser);assert.equal(Number(await scalar("select count(*) from get_my_suggestive_sales_goals('2026-10-17')")),0,'Legacy snapshots keep staff ownership');
 await db.exec('reset role');
 assert.equal(await scalar("select prosecdef from pg_proc where oid='public.get_my_suggestive_sales_goals(date)'::regprocedure"),false);
 assert.equal(await scalar("select prosecdef from pg_proc where oid='public.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb)'::regprocedure"),false);
 assert.equal(await scalar("select has_function_privilege('anon','public.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb)','execute')"),false);
 console.log('PASS: four separate evaluable channels, exact required report names, integer/hour conservation, atomic rollback, own-profile reader, RLS, admin/store isolation and legacy snapshot compatibility');
} finally {await db.close()}
