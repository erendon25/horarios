import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
const source=readFileSync(new URL('../supabase/functions/staff-account-admin/index.ts', import.meta.url),'utf8').replace(/^import .*;$/mg,'');
const compiled=(await transform(source,{loader:'ts',format:'esm'})).code;
async function run(opts={}) {
 let handler, created=[],profiles=[],deleted=[];
 const service={auth:{getUser:async()=>({data:{user:{id:'caller'}}}),admin:{createUser:async data=>{created.push(data);return opts.duplicate?{error:{code:'email_exists'}}:{data:{user:{id:'new-admin'}}};},deleteUser:async id=>{deleted.push(id);return{};}}},rpc:async()=>({data:[{allowed:true}]}),from(table){return {select(){return this},eq(){return this},maybeSingle:async()=>table==='stores'?{data:{id:'e57fdc36-1db9-5e13-9a15-2a741da3b701',is_active:opts.activeStore!==false}}:{data:{role:opts.role||'superadmin',status:opts.status||'active'}},insert:async data=>{profiles.push(data);return {error:opts.profileError?{}:null};}}}};
 vm.runInNewContext(compiled,{Deno:{env:{get:()=> 'configured'},serve:fn=>handler=fn},createClient:()=>service,Response,console,Intl,Date,Set});
 const resp=await handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({operation:'create_admin',email:' NEWADMIN@EXAMPLE.COM ',password:'Testing123!',storeId:'e57fdc36-1db9-5e13-9a15-2a741da3b701',...opts.body})}));
 return {status:resp.status,body:await resp.json(),created,profiles,deleted};
}
const ok=await run();assert.equal(ok.status,201);assert.equal(ok.profiles[0].role,'admin');assert.equal(ok.profiles[0].registration_pending,false);assert.equal(ok.created[0].email,'newadmin@example.com');assert.equal(ok.profiles[0].store_id,'e57fdc36-1db9-5e13-9a15-2a741da3b701');
for(const role of ['admin','collaborator','trainer']) {const r=await run({role});assert.equal(r.status,403);assert.equal(r.created.length,0);}
assert.equal((await run({status:'inactive'})).status,403);
const inactive=await run({activeStore:false});assert.equal(inactive.status,409);assert.equal(inactive.created.length,0);
assert.equal((await run({body:{password:'short'}})).status,400);
assert.equal((await run({body:{storeId:'invalid'}})).status,400);
assert.equal((await run({duplicate:true})).body.error,'email_already_registered');
const rollback=await run({profileError:true});assert.equal(rollback.status,500);assert.deepEqual(rollback.deleted,['new-admin']);
console.log('PASS: creation, store assignment, authorization, inactive store, validation, duplicate and rollback');
