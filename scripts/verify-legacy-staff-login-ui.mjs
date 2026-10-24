import { build } from 'esbuild';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const transport = `
let listener;let attempts=0;let recovered=false;let session=null;
const user={id:'original-staff-account',email:'person@example.test',...(window.qa==='partial'?{app_metadata:{legacy_staff_recovery_id:'approval'}}:{})};
export const supabase={auth:{
  getSession:async()=>({data:{session}}),
  onAuthStateChange(callback){listener=callback;return {data:{listener:null,subscription:{unsubscribe(){}}}}},
  async signInWithPassword(args){
    window.qaCalls.push('signin');attempts++;
    if(window.qa==='rate')return {error:{code:'over_request_rate_limit'}};
    if(window.qa==='normal'||window.qa==='admin'||window.qa==='partial'||recovered){session={user};listener('SIGNED_IN',session);return {data:{user,session}};}
    return {error:{code:'invalid_credentials'}};
  },
  signOut:async()=>({}),
},functions:{async invoke(name,{body}){
  window.qaCalls.push(name);
  if(window.qa==='network')throw Error('network');
  if(window.qa==='deny')return {error:{}};
  recovered=true;return {data:{recovered:true}};
}},from(){return {select(){return this},eq(){return this},async maybeSingle(){
  window.qaCalls.push('profile');
  if(window.qa==='partial'&&!recovered)return {data:null};
  return {data:{...user,first_name:'Persona',last_name:'Prueba',role:window.qa==='admin'?'admin':'collaborator',status:'active',store_id:'store',staff_profile_id:'original-staff',registration_pending:false,staff_profiles:{cessation_date:null}}};
}}}};
`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import {AuthProvider,useAuth} from './src/contexts/AuthContext.jsx';import Login from './src/components/Login.jsx';function Staff(){const {userData}=useAuth();return <div>Mi plataforma: {userData?.name} · {userData?.staffProfileId}</div>};createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><Routes><Route path='/login' element={<Login/>}/><Route path='/staff' element={<Staff/>}/><Route path='/admin' element={<div>Administración</div>}/><Route path='/register' element={<div>Selección de colaborador</div>}/></Routes></AuthProvider></BrowserRouter>);`, loader:'jsx',resolveDir:process.cwd() },
  bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},
  plugins:[{name:'test-transport',setup(b){b.onLoad({filter:/lib[\\/]supabase[\\/]client\.js$/},()=>({contents:transport,loader:'js'}));}}],
});
const js=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?js:'<div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try {
  for (const width of [390,1280]) for(const scenario of ['recover','partial','normal','admin','deny','network','rate']) {
    const page=await browser.newPage({viewport:{width,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(scenario=>{window.qa=scenario;window.qaCalls=[];},scenario);
    await page.goto(`http://127.0.0.1:${server.address().port}/login`);
    await page.getByLabel('Correo Electrónico').fill('person@example.test');
    await page.getByLabel('Contraseña',{exact:true}).fill('Synthetic test password only');
    await page.getByRole('button',{name:'Entrar',exact:true}).click();
    try {
      if (['recover','partial','normal'].includes(scenario)) await page.getByText('Mi plataforma: Persona · original-staff',{exact:true}).waitFor({timeout:8000});
      else if(scenario==='admin') await page.getByText('Administración',{exact:true}).waitFor({timeout:8000});
      else await page.getByText('Credenciales incorrectas.',{exact:true}).waitFor({timeout:8000});
    } catch (error) {
      console.error({scenario,width,calls:await page.evaluate(()=>window.qaCalls),text:await page.locator('body').innerText(),errors});
      throw error;
    }
    assert.equal(await page.getByText('Selección de colaborador',{exact:true}).count(),0);
    const calls=await page.evaluate(()=>window.qaCalls);
    assert.equal(calls.filter(c=>c==='signin').length,['recover','partial'].includes(scenario)?2:1);
    assert.equal(calls.includes('recover-legacy-staff-login'),['recover','partial','deny','network'].includes(scenario));
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: 14 desktop/mobile login flows with actual AuthProvider and Login; recovered staff and interrupted creation go directly to the platform, normal/admin login preserved, failures denied.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
