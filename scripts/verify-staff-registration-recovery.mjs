import { build } from 'esbuild';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const auth = `import {useState} from 'react';
const user={id:'test-person',email:'person@example.com'};
export function useAuth(){const [pending,setPending]=useState(true);return {currentUser:user,needsStaffLink:pending,userRole:pending?null:'collaborator',refreshAccess:async()=>setPending(false),logout:async()=>{},register:async()=>{}}}`;
const transport = `export const supabase={functions:{async invoke(name,{body}){
window.qaCalls.push(body.operation);
if(body.operation==='recover_existing_staff_link'){
 if(window.qa==='recover')return {data:{linked:true}};
 if(window.qa==='network')throw new Error('offline');
 if(window.qa==='deny'||window.qa==='rehire')return {error:{context:{json:async()=>({error:window.qa==='rehire'?'employment_ended':'inactive_staff'})}}};
 return {data:{linked:false}};
}
if(body.operation==='list_registration_stores')return {data:{stores:[{id:'store',name:'Porongoche'}]}};
return {data:{staff:[{id:'staff',first_name:'Persona',last_name:'Nueva',position:'COLABORADOR'}]}};
}}};`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import Register from './src/components/Register.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/register' element={<Register/>}/><Route path='/staff' element={<div>Acceso recuperado</div>}/></Routes></BrowserRouter>);`, loader:'jsx',resolveDir:process.cwd() },
  bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},
  plugins:[{name:'test-transport',setup(b){
    b.onLoad({filter:/contexts\/AuthContext(?:\.jsx)?$/},()=>({contents:auth,loader:'js'}));
    b.onLoad({filter:/lib\/supabase\/client\.js$/},()=>({contents:transport,loader:'js'}));
  }}],
});
const js=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?js:'<div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try {
  for(const scenario of ['recover','new','deny','rehire','network']){
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(scenario=>{window.qa=scenario;window.qaCalls=[];},scenario);
    await page.goto(`http://127.0.0.1:${server.address().port}/register`);
    if(scenario==='recover')await page.getByText('Acceso recuperado',{exact:true}).waitFor();
    else if(['new','rehire'].includes(scenario))await page.getByRole('option',{name:'Persona Nueva — COLABORADOR'}).waitFor({state:'attached'});
    else await page.getByText(/No se pudo/).waitFor();
    const calls=await page.evaluate(()=>window.qaCalls);
    assert.equal(calls[0],'recover_existing_staff_link');
    assert.equal(calls.includes('list_registration_stores'),['new','rehire'].includes(scenario));
    assert.equal(calls.filter(c=>c==='recover_existing_staff_link').length,1);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: existing access redirects, new registration and rehire work, inactive/network errors stop selection');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
