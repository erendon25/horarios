// Upload the two user-supplied report formats into an isolated real React page.
// Usage: node scripts/verify-weekly-suggestive-ui.mjs report.xlsx report.xls
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
const files=[process.env.REPORT_XLSX_PATH||process.argv[2],process.env.REPORT_XLS_PATH||process.argv[3]];
if(files.some(file=>!file))throw Error('Provide REPORT_XLSX_PATH/REPORT_XLS_PATH or .xlsx and .xls file arguments.');
for(const file of files)await access(file);
const moduleName=process.env.PLAYWRIGHT_MODULE||resolve('tmp/competition-test-runtime/node_modules/playwright/index.mjs');
const {chromium}=await import(isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const legacyRpc=process.env.SALES_QA_LEGACY_RPC==='1';
const output=resolve(legacyRpc?'output/weekly-suggestive-product-legacy':'output/weekly-suggestive-product');await mkdir(output,{recursive:true});
const port=Number(process.env.WEEKLY_SUGGESTIVE_QA_PORT||(legacyRpc?4184:4183)),base=`http://127.0.0.1:${port}`;
const state={configuration:{calculationVersion:'revenue-v1',participation:.3,products:[],channels:[{id:'SALÓN',enabled:true},{id:'DRIVE THRU',enabled:false},{id:'SERV. FILA',enabled:true},{id:'SERV. AUTO',enabled:false}]},history:new Map(),archives:new Map(),writes:[]};
const archivedMonth={store_id:'qa-store',month_start:'2026-10-01',monthly_data:{18:{vta:32399.83,txs:123}},daily_hourly_parts:{'2026-10-18':{'09:00':100}},real_sales_data:{savedFormValue:'preserved'}};
if(legacyRpc)state.archives.set('qa-store|2026-10-01',structuredClone(archivedMonth));
const transport=`export const db={};export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=(...v)=>v;export const query=(ref,...filters)=>({...ref,filters});
const snap=(id,data)=>({id,exists:()=>data!=null,data:()=>data});export async function getDocs(){return{docs:[]}};
export async function getDoc(ref){const result=await(await fetch('/qa/config')).json();const data=ref.path.includes('/config/suggestive_sales_goals:')?result:ref.path.includes('/sales_config/')?{monthlyData:{}}:null;return snap(ref.path.split('/').at(-1),data)}
export async function setDoc(ref,data){const response=await fetch('/qa/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:ref.path,data})});if(!response.ok)throw Error('Configuration write failed')}`;
const client=`export const supabase={from(table){const filters=[];let sort=null,limit=null;return{select(){return this},eq(k,v){filters.push(row=>row[k]===v);return this},in(k,v){filters.push(row=>v.includes(row[k]));return this},order(k,v={}){sort={k,v};return this},limit(n){limit=n;return this},upsert(rows,options){return fetch('/qa/archives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows,options})}).then(response=>response.json())},then(resolve,reject){return fetch(table==='sales_month_configs'?'/qa/archives':'/qa/history').then(r=>r.json()).then(source=>{let rows=['sales_daily_history','sales_month_configs'].includes(table)?source:[];rows=rows.filter(row=>filters.every(test=>test(row)));if(sort)rows.sort((a,b)=>String(a[sort.k]).localeCompare(String(b[sort.k]))*(sort.v.ascending===false?-1:1));if(limit!==null)rows=rows.slice(0,limit);return{data:rows,error:null}}).then(resolve,reject)}}},async rpc(name,args){const response=await fetch('/qa/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});return response.json()}};`;
const auth=`export const useAuth=()=>({userData:{storeId:'qa-store'},currentUser:{uid:'qa-admin'},userRole:'admin'});`;
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Page from'./src/components/SuggestiveSalesGoalsPage.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Page/></BrowserRouter>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'isolated-upload',setup(builder){
 builder.onLoad({filter:/lib[\\/]supabase[\\/]firestoreCompat\.js$/},()=>({contents:transport,loader:'js'}));
 builder.onLoad({filter:/lib[\\/]supabase[\\/]client\.js$/},()=>({contents:client,loader:'js'}));
 builder.onLoad({filter:/contexts[\\/]AuthContext\.jsx$/},()=>({contents:auth,loader:'js'}));
 builder.onLoad({filter:/src[\\/]supabase\.js$/},()=>({contents:'export const db={};',loader:'js'}));
}}]});
const css=(await postcss([tailwind({content:['./src/components/SuggestiveSalesGoalsPage.jsx','./src/components/WeeklySuggestiveSalesReport.jsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const server=createServer(async(request,response)=>{
 const json=value=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value))};
 if(request.url==='/qa/history')return json([...state.history.values()]);
 if(request.url==='/qa/archives'&&request.method==='GET')return json([...state.archives.values()]);
 if(request.url==='/qa/archives'&&request.method==='POST'){
  let text='';for await(const chunk of request)text+=chunk;const {rows,options}=JSON.parse(text);
  assert.deepEqual(options,{onConflict:'store_id,month_start'});
  for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['month_start','real_sales_data','store_id']);const key=row.store_id+'|'+row.month_start;state.archives.set(key,{...state.archives.get(key),...row});}
  state.writes.push({type:'archive-upsert',months:rows.length});return json({data:[],error:null});
 }
 if(request.url==='/qa/state')return json({configuration:state.configuration,historyDates:[...state.history.keys()].sort(),writes:state.writes,totalSales:[...state.history.values()].reduce((sum,day)=>sum+day.sales_amount,0)});
 if(request.url==='/qa/config'&&request.method==='GET')return json(state.configuration);
 if(request.url==='/qa/config'&&request.method==='POST'){let text='';for await(const chunk of request)text+=chunk;const {data}=JSON.parse(text);state.configuration=data;state.writes.push({type:'configuration'});return json({saved:true})}
 if(request.url==='/qa/rpc'){let text='';for await(const chunk of request)text+=chunk;const {name,args}=JSON.parse(text);
  if(name!=='save_sales_history_batch'){state.writes.push({type:'unexpected-publication',name});return json({data:null,error:{message:'Publishing is disabled in this local test'}})}
  for(const day of args.p_days)state.history.set(day.date,{store_id:args.p_store_id,sales_date:day.date,sales_amount:day.totalSales,transactions:day.totalTxs,hourly_data:day.hourlyData,hourly_transactions:day.hourlyTxs,suggestive_products:day.suggestiveProducts,updated_at:'2026-10-19T18:00:00.000Z',source_data:legacyRpc?{hourlyTxs:day.hourlyTxs}:{businessDateVersion:day.businessDateVersion,salesDayBasis:day.salesDayBasis,productSales:day.productSales,productSalesRecorded:day.productSalesRecorded,productRevenueRecorded:day.productRevenueRecorded}});
  state.writes.push({type:'report-upload',days:args.p_days.length});return json({data:args.p_days.length,error:null});
 }
 if(request.url==='/app.js'){response.setHeader('Content-Type','text/javascript');return response.end(bundle.outputFiles[0].text)}
 if(request.url==='/style.css'){response.setHeader('Content-Type','text/css');return response.end(css)}
 response.setHeader('Content-Type','text/html');response.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
let browser,page;const errors=[],passed=[],blockedRequests=[];const pass=name=>{passed.push(name);console.log('PASS: '+name)};
const targets=['LTO BORDE QUESO PEPPE','YAPE LTO BDQ PEPPE','VS Borde de queso','VS HAZLO CMB V3 CRAZY','VS HAZLO CMB V3 CANELITAS'];
const assertNear=(value,expected)=>assert.ok(Math.abs(value-expected)<.011,`${value} expected ${expected}`);
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 const chrome=process.env.CHROMIUM_PATH||(existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
 browser=await chromium.launch({headless:true,...(chrome?{executablePath:chrome}:{}),args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'America/Lima'});
 await context.addInitScript(()=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-19T17:00:00Z']))}static now(){return new NativeDate('2026-10-19T17:00:00Z').getTime()}}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base)return route.continue();blockedRequests.push(url.origin);return route.abort()});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);await page.getByRole('button',{name:'Guardar configuración',exact:true}).waitFor();
 assert.equal(state.history.size,0);assert.equal(state.writes.length,0);
 await page.getByLabel('Semana del reporte de venta sugestiva',{exact:true}).waitFor();
 await page.getByText(/No hay reportes para esta semana/).waitFor();
 assert.equal(await page.locator('input[aria-label^="Nombre exacto en el reporte de "]').count(),5);
 for(const name of targets){
  assert.equal(await page.getByLabel(`Nombre exacto en el reporte de ${name}`,{exact:true}).evaluate(input=>input.readOnly),true);
  assert.equal(await page.getByLabel(`Meta de participación de ${name}`,{exact:true}).inputValue(),'30');
  assert.equal(await page.getByRole('button',{name:`Quitar producto ${name}`,exact:true}).count(),0);
 }
 pass('La página real abre con cinco productos protegidos al 30%, sin escrituras ni historial y con semana 43 sin reportes');
 const upload=async(file,expectedDays,expectedWrites)=>{
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Cargar reporte de ventas'&&!button.disabled));
  await page.getByLabel('Cargar reporte de ventas',{exact:true}).setInputFiles(file);
  await page.waitForFunction(async({expectedDays,expectedWrites})=>{const state=await(await fetch('/qa/state')).json();return state.historyDates.length===expectedDays&&state.writes.filter(row=>row.type==='report-upload').length===expectedWrites},{expectedDays,expectedWrites},{timeout:120000});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Cargar reporte de ventas'&&!button.disabled));
 };
 await upload(files[0],17,1);
 assertNear([...state.history.values()].reduce((sum,day)=>sum+day.sales_amount,0),386101.30);
 if(legacyRpc){
  assert.ok([...state.history.values()].every(day=>day.source_data.productSales===undefined&&day.source_data.productRevenueRecorded===undefined&&day.source_data.businessDateVersion===undefined));
  const archive=state.archives.get('qa-store|2026-10-01');
  assert.ok([...state.history.keys()].every(date=>archive.real_sales_data[date].productRevenueRecorded===true&&archive.real_sales_data[date].productSalesRecorded===true));
 }else assert.ok([...state.history.values()].every(day=>day.source_data.productRevenueRecorded===true&&day.source_data.productSalesRecorded===true));
 await page.getByLabel('Semana del reporte de venta sugestiva',{exact:true}).selectOption('2026-W42');
 const table=page.getByRole('table',{name:'Participación semanal por producto y canal',exact:true});
 await page.getByText(/Parcial.*6\/7 días/).waitFor();
 pass('La carga .xlsx conserva 17 jornadas, importes por producto y semana 42 parcial de seis días');
 await upload(files[1],18,2);
 assertNear([...state.history.values()].reduce((sum,day)=>sum+day.sales_amount,0),416079.50);
 await page.getByText(/Completa.*7\/7 días/).waitFor();
 const snapshot=JSON.stringify([...state.history]);
 await upload(files[1],18,3);assert.equal(JSON.stringify([...state.history]),snapshot,'Uploading the same report again replaces dates without doubling history');
 pass('La carga .xls incluye madrugada del 19 en la jornada 18; repetir el archivo no duplica fechas, unidades ni importes');
 assert.equal(await page.locator('input[aria-label^="Nombre exacto en el reporte de "]').count(),5);
 assert.ok((await page.locator('input[aria-label^="Precio de "]').evaluateAll(inputs=>inputs.map(input=>input.value))).every(value=>value===''));
 // Editing a required target preserves its exact name; weekly tracking does not require prices.
 await page.getByLabel(`Meta de participación de ${targets[0]}`,{exact:true}).fill('31');
 await page.getByLabel(`Meta de participación de ${targets[0]}`,{exact:true}).fill('30');
 await page.getByText('Configuración guardada automáticamente.',{exact:true}).waitFor();
 assert.equal(state.configuration.products.length,5);assert.equal(state.writes.filter(row=>row.type==='unexpected-publication').length,0);
 const selector=page.getByLabel('Semana del reporte de venta sugestiva',{exact:true});
 const verifyRow=async(week,channel,reportName,amount,numerator)=>{
  await selector.selectOption(week);
  const productId=state.configuration.products.find(product=>product.reportName===reportName)?.id;
  assert.ok(productId,`No configured product id for ${reportName}`);
  const row=table.locator(`tr[data-week-id="${week}"][data-channel="${channel}"][data-product-id="${productId}"]`);
  await row.waitFor();
  const cells=await row.locator('td').allTextContents();
  const number=text=>Number(text.replace(/[^\d.-]/g,''));
  assert.equal(cells[1],channel==='SERV. FILA'?'Módulo (Serv. Fila)':channel,'The displayed channel label must preserve its canonical row id');
  assert.ok(cells[2].includes(reportName),'The row must identify the literal product name');
  assertNear(number(cells[4]),amount);assertNear(number(cells[5]),numerator);assertNear(number(cells[6]),numerator/amount*100);
  assert.equal(cells[7],'30%','The weekly threshold belongs to this product and survives autosave');
 };
 const weeklyAmounts={
  '2026-W41':{'SALÓN':{total:59263.90,products:[4514.90,13425.10,495.00,425.70,316.80]},'SERV. FILA':{total:22193.90,products:[2033.20,5501.60,79.20,59.40,69.30]}},
  '2026-W42':{'SALÓN':{total:64174.20,products:[14262.30,1465.10,514.80,693.00,613.80]},'SERV. FILA':{total:19202.70,products:[7176.00,1554.80,29.70,108.90,148.50]}},
 };
 for(const [week,channels]of Object.entries(weeklyAmounts))for(const [channel,values]of Object.entries(channels))
  for(const [index,name]of targets.entries())await verifyRow(week,channel,name,values.total,values.products[index]);
 assert.equal(await table.locator('tbody tr').count(),10,'The selected week has one row per product and channel');
 assert.equal((await page.locator('body').innerText()).includes('46.96%'),false,'The combined five-product rate must not appear');
 pass('Cada producto tiene su propio importe y porcentaje semanal en Salón y Fila, con el mismo denominador del canal');
 await page.getByLabel('Nombre exacto del nuevo producto',{exact:true}).fill('HAZLO COMBO');await page.getByRole('button',{name:'Agregar producto',exact:true}).click();
 const literalRows=table.locator('tbody tr').filter({hasText:'HAZLO COMBO'});assert.equal(await literalRows.count(),2);
 for(const row of await literalRows.all()){const cells=await row.locator('td').allTextContents();assert.match(cells[5],/0\.00/);assert.equal(cells[6],'0%');}
 await page.getByRole('button',{name:'Quitar producto HAZLO COMBO',exact:true}).click();
 await page.getByText('Configuración guardada automáticamente.',{exact:true}).waitFor();
 await page.screenshot({path:output+'/semana42-salon-fila.png',fullPage:true});
 await page.getByRole('button',{name:'Semana actual',exact:true}).click();await table.locator('tr[data-week-id="2026-W43"]').first().waitFor();
 for(const row of await table.locator('tbody tr').all()){const cells=await row.locator('td').allTextContents();assert.equal(cells[3].startsWith('0/7'),true);assert.equal(cells[6],'—');}
 await page.getByRole('button',{name:'Todas las semanas',exact:true}).click();await table.locator('tr[data-week-id="2026-W41"]').first().waitFor();
 assert.equal(await table.locator('tbody tr').count(),40);
 await page.reload();await selector.waitFor();assert.equal(await page.locator('input[aria-label^="Nombre exacto en el reporte de "]').count(),5);
 for(const [channel,values]of Object.entries(weeklyAmounts['2026-W42']))for(const [index,name]of targets.entries())await verifyRow('2026-W42',channel,name,values.total,values.products[index]);
 assert.equal((await page.locator('body').innerText()).includes('46.96%'),false);
 assert.equal(state.history.size,18);assert.equal(state.writes.filter(row=>row.type==='unexpected-publication').length,0);
 pass('Semanas 41/42/43, todas las semanas y recarga conservan histórico y configuración; HAZLO COMBO literal no suma otros combos');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/semana42-mobile.png',fullPage:true});
 if(legacyRpc){
  const archive=state.archives.get('qa-store|2026-10-01');
  assert.deepEqual(archive.monthly_data,archivedMonth.monthly_data);assert.deepEqual(archive.daily_hourly_parts,archivedMonth.daily_hourly_parts);assert.equal(archive.real_sales_data.savedFormValue,'preserved');
  assert.equal(Object.keys(archive.real_sales_data).filter(key=>/^\d{4}-\d{2}-\d{2}$/.test(key)).length,18);
  assert.equal(state.writes.filter(row=>row.type==='archive-upsert').length,3);
  pass('El RPC antiguo omite el detalle; el archivo compatible lo recupera tras recargar y conserva metas y participación horaria');
 }else assert.equal(state.writes.filter(row=>row.type==='archive-upsert').length,0);
 assert.deepEqual(errors,[]);assert.deepEqual(blockedRequests,[]);
 await writeFile(output+'/resultado.json',JSON.stringify({status:'PASS',legacyRpc,passed,errors,blockedRequests,historyDays:state.history.size,writes:state.writes,scope:'Página real; originales cargados sólo en navegador y almacenamiento HTTP local aislado, sin publicación ni datos remotos'},null,2));
}catch(error){await page?.screenshot({path:output+'/fallo.png',fullPage:true}).catch(()=>{});await writeFile(output+'/resultado.json',JSON.stringify({status:'FAIL',passed,errors,blockedRequests,error:String(error)},null,2));throw error}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
