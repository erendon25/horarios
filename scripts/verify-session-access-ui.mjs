import { build } from 'esbuild';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = await import('../tmp/competition-test-runtime/node_modules/playwright/index.mjs');
const transport = `
let listener, session=null, profileCalls=0;
const user={id:'dual-account',email:'dual@example.test'};
const profile={...user,role:'superadmin',status:'active',store_id:'store',staff_profile_id:window.qa==='ceased'?'old-staff':null,registration_pending:false,staff_profiles:window.qa==='ceased'?{cessation_date:'2020-01-01'}:null};
window.qaPending=[];window.qaSignouts=0;
window.qaEmit=()=>listener('SIGNED_IN',session);
window.qaLogout=()=>{session=null;listener('SIGNED_OUT',null)};
window.qaResolve=(index,fail)=>window.qaPending[index](fail?{error:{message:'Old failed request'}}:{data:profile});
export const supabase={auth:{
 getSession:async()=>({data:{session}}),
 onAuthStateChange(callback){listener=callback;return {data:{subscription:{unsubscribe(){}}}}},
 async signInWithPassword(){session={user,access_token:'current'};listener('SIGNED_IN',session);return {data:{user,session}}},
 async signOut(){window.qaSignouts++;session=null;listener('SIGNED_OUT',null);return {}}
},from(){return {select(){return this},eq(){return this},async maybeSingle(){
 profileCalls++;
 if(window.qaHold)return new Promise(resolve=>window.qaPending.push(resolve));
 if(window.qa==='transient'&&profileCalls===1)return {error:{message:'Temporary network failure'}};
 return {data:profile};
}}}};`;
const built = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';import {AuthProvider} from './src/contexts/AuthContext.jsx';import Login from './src/components/Login.jsx';import PrivateRoute from './src/components/PrivateRoute.jsx';import RequireAdmin from './src/components/RequireAdmin.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><Routes><Route path='/login' element={<Login/>}/><Route path='/superadmin' element={<PrivateRoute role='superadmin'><h1>Panel superadmin</h1><Link to='/admin'>Administrar tienda</Link></PrivateRoute>}/><Route path='/admin' element={<RequireAdmin><h1>Panel administrador</h1><Link to='/superadmin'>Superadmin</Link></RequireAdmin>}/><Route path='/register' element={<h1>Registro inesperado</h1>}/></Routes></AuthProvider></BrowserRouter>);`, loader: 'jsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl' },
  plugins: [{ name: 'session-test-transport', setup(b) {
    b.onLoad({ filter: /lib[\\/]supabase[\\/]client\.js$/ }, () => ({ contents: transport, loader: 'js' }));
  } }],
});
const server = createServer((req,res) => {res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');res.end(req.url === '/bundle.js' ? built.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  for (const width of [1280,390]) for (const scenario of ['normal','ceased','transient']) {
    const page = await browser.newPage({viewport:{width,height:844}});
    await page.addInitScript(scenario => {window.qa=scenario},scenario);
    await page.goto(`http://127.0.0.1:${server.address().port}/login`);
    await page.getByLabel('Correo Electrónico').fill('dual@example.test');
    await page.getByLabel('Contraseña', {exact:true}).fill('Synthetic-only-123!');
    await page.getByRole('button',{name:'Entrar',exact:true}).click();
    if(scenario==='transient') {
      await page.getByRole('alert').waitFor();
      assert.equal(await page.evaluate(()=>window.qaSignouts),0);
      await page.getByRole('button',{name:'Reintentar',exact:true}).click();
    }
    await page.getByRole('heading',{name:'Panel superadmin',exact:true}).waitFor();
    await page.getByRole('link',{name:'Administrar tienda'}).click();
    await page.getByRole('heading',{name:'Panel administrador',exact:true}).waitFor();
    // A slow, failed older profile request must not overwrite a newer success.
    await page.evaluate(()=>{window.qaHold=true;window.qaEmit()});
    await page.waitForFunction(()=>window.qaPending.length===1);
    await page.evaluate(()=>window.qaEmit());
    await page.waitForFunction(()=>window.qaPending.length===2);
    await page.evaluate(()=>window.qaResolve(1,false));
    await page.evaluate(()=>window.qaResolve(0,true));
    await page.waitForTimeout(50);
    assert.equal(await page.getByRole('alert').count(),0);
    assert.equal(await page.evaluate(()=>window.qaSignouts),0);
    await page.getByRole('heading',{name:'Panel administrador',exact:true}).waitFor();
    // A late profile response must not restore a logged-out user's access.
    await page.evaluate(()=>window.qaEmit());
    await page.waitForFunction(()=>window.qaPending.length===3);
    await page.evaluate(()=>window.qaLogout());
    await page.getByRole('button',{name:'Entrar',exact:true}).waitFor();
    await page.evaluate(()=>window.qaResolve(2,false));
    await page.waitForTimeout(50);
    assert.equal(new URL(page.url()).pathname,'/login');
    assert.equal(await page.getByRole('heading',{name:'Registro inesperado'}).count(),0);
    await page.close();
  }
  console.log('PASS: desktop/mobile dual access, inactive historical staff link, retry without logout, stale-profile race and logout while a profile request is pending');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
