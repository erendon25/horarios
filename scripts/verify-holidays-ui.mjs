// Fictional records only. Database permissions require a separate SQL/RLS test.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'holiday-ui-qa-'));
const mock = `
const rules = ['2026-05-01','2026-06-29','2026-07-29'].map(holiday_date=>({store_id:'s',holiday_date,payment_method:'boleta'}));
const rows = [
 {id:1,staff_id:'a',store_id:'s',holiday_date:'2026-08-30',name:'Santa Rosa',balance_type:'ganado'},
 {id:2,staff_id:'a',store_id:'s',holiday_date:'2026-07-28',name:'Fiestas Patrias',balance_type:'ganado'},
 {id:3,staff_id:'a',store_id:'s',holiday_date:'2026-09-19',name:'Descanso',balance_type:'compensado'},
 {id:4,staff_id:'b',store_id:'s',holiday_date:'2026-08-30',name:'Santa Rosa',balance_type:'ganado'},
 {id:5,staff_id:'a',store_id:'s',holiday_date:'2099-12-25',name:'Futuro',balance_type:'ganado'},
 ...['2026-04-03','2026-06-07','2026-07-23','2026-08-06','2026-08-30','2026-10-08','2026-09-01'].map((holiday_date,i)=>({id:10+i,staff_id:'c',store_id:'s',holiday_date,name:'Feriado trabajado',balance_type:'ganado'})),
 ...['2026-05-01','2026-06-29','2026-07-29'].map((holiday_date,i)=>({id:20+i,staff_id:'c',store_id:'s',holiday_date,name:'Feriado para boleta',balance_type:'ganado'})),
 ...['2099-12-19','2099-12-20','2099-12-21','2099-12-22'].map((holiday_date,i)=>({id:30+i,staff_id:'c',store_id:'s',holiday_date,name:'Compensación de Feriado',balance_type:'compensado'}))
];
export const supabase = {from(table) {
 const filters=[]; let operation='read', values={}, range=[0,99999], single=false;
 const query={eq(key,value){filters.push([key,value]);return this},select(){return this},order(){return this},range(a,b){range=[a,b];return this},single(){single=true;return this},
 insert(data){operation='insert';values=data;return this},update(data){operation='update';values=data;return this},
 delete(){operation='delete';return this},
 then(resolve,reject){return new Promise(done=>setTimeout(()=>{
  if(window.__holidayFail && table==='worked_holiday_ledger'){done({data:null,error:{message:'network'}});return;}
  if(table==='worked_holidays' && operation==='delete') {
   const removed=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
   for(const row of removed)rows.splice(rows.indexOf(row),1);
   done({data:single?removed[0]:removed,error:null});return;
  }
  if(table==='store_holiday_payment_rules' && operation!=='read'){
   let changed;
   if(operation==='insert'){changed=values;rules.push(changed);}
   else {changed=rules.find(r=>filters.every(([k,v])=>r[k]===v));Object.assign(changed,values);}
   done({data:single?changed:[changed],error:null});return;
  }
  let data=table==='store_holiday_payment_rules'?rules:rows.map(r=>{
    const payment_method=r.balance_type==='ganado'?(rules.find(rule=>rule.store_id===r.store_id&&rule.holiday_date===r.holiday_date)?.payment_method||'descanso'):'descanso';
    const is_future=r.holiday_date>'2026-10-16';
    return {...r,payment_method,is_future,balance_delta:r.balance_type==='compensado'?-1:is_future?0:payment_method==='boleta'?0:1};
  });
  data=data.filter(r=>filters.every(([k,v])=>r[k]===v)).slice(range[0],range[1]+1);
  done({data:single?data[0]:data,error:null});
 },30)).then(resolve,reject)}
 };return query;
}};
`;
const root = process.cwd();
const bundle = await build({ stdin: { contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Panel from './src/components/HolidayBalancePanel.jsx';import Settings from './src/components/HolidayPaymentSettings.jsx';
function App(){const [version,setVersion]=useState(0);return <main style={{maxWidth:900,margin:'auto',padding:16}}>
{!location.search.includes('collaborator')&&<Settings storeId="s" onSaved={()=>setVersion(v=>v+1)}/>}
<div data-testid="a"><Panel staffId="a" previousBalance={4} refreshKey={version}/></div>
<div data-testid="b"><Panel staffId="b" previousBalance={1} refreshKey={version}/></div>
<div data-testid="c"><Panel staffId="c" previousBalance={0} refreshKey={version} canDelete={!location.search.includes('collaborator')}/></div>
</main>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`, loader: 'jsx', resolveDir: root },
bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{ name: 'mock-db', setup(builder) {
  builder.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({ path: 'db', namespace: 'mock' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mock, loader: 'js' }));
} }] });
const raw = await Promise.all(['HolidayBalancePanel.jsx','HolidayPaymentSettings.jsx'].map(file=>readFile(path.join(root,'src/components',file),'utf8')));
const css = await postcss([tailwind({content:raw.map(raw=>({raw})),theme:{},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
const server=createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.css);}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1200,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let confirmText='';page.on('dialog',async dialog=>{confirmText=dialog.message();await dialog.accept();});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const a=page.getByTestId('a'),b=page.getByTestId('b'),c=page.getByTestId('c');
 await a.getByText('1 días de saldo disponible',{exact:true}).waitFor();
 await b.getByText('1 días de saldo disponible',{exact:true}).waitFor();
 await c.getByText('3 días de saldo disponible',{exact:true}).waitFor();
 await c.getByText('4 compensaciones futuras ya descontadas del saldo disponible.',{exact:true}).waitFor();
 await c.getByText('Ver historial (14)',{exact:true}).click();
 assert.equal(await c.getByText('Compensación programada · ya descontada',{exact:true}).count(),4);
 const scheduled=c.locator('li').filter({hasText:'Compensación programada · ya descontada'});
 for(const row of await scheduled.all()) assert.equal(await row.locator('span').innerText(),'-1 días');
 await c.screenshot({path:path.join(output,'compensaciones-desktop.png')});
 await page.getByText('Feriados: descanso o pago en boleta',{exact:true}).click();
 await page.getByLabel('Fecha del feriado').fill('2026-08-30');
 await page.getByLabel('Tratamiento').selectOption('boleta');
 await page.getByRole('button',{name:'Aplicar a toda la tienda'}).click();
 await a.getByText('0 días de saldo disponible',{exact:true}).waitFor();
 await b.getByText('0 días de saldo disponible',{exact:true}).waitFor();
 assert.ok(confirmText.includes('3 registros'));
 await a.getByText('Ver historial (4)',{exact:true}).click();
 await a.getByText('Destinado a boleta',{exact:true}).waitFor();
 assert.equal(await a.locator('li').count(),4,'la decisión no elimina historial');
 await a.getByText(/Pendiente de revisión/).waitFor();
 await page.getByLabel('Tratamiento').selectOption('descanso');
 await page.getByRole('button',{name:'Aplicar a toda la tienda'}).click();
 await a.getByText('1 días de saldo disponible',{exact:true}).waitFor();
 await b.getByText('1 días de saldo disponible',{exact:true}).waitFor();
 await c.getByText('3 días de saldo disponible',{exact:true}).waitFor();
 if(!await c.locator('details').evaluate(element=>element.open)) await c.getByText('Ver historial (14)',{exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 await c.screenshot({path:path.join(output,'compensaciones-mobile.png')});
 await scheduled.first().getByRole('button',{name:'Eliminar registro',exact:true}).click();
 await c.getByText('4 días de saldo disponible',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'feriados-mobile.png'),fullPage:true});
 await page.evaluate(()=>{window.__holidayFail=true});
 await a.getByRole('button',{name:'Actualizar saldo'}).click();
 await a.getByRole('alert').waitFor();
 assert.equal(await a.getByText(/días de saldo disponible/).count(),0,'fallo de lectura no debe mostrar cero');
 await page.goto('http://127.0.0.1:'+server.address().port+'/?collaborator');
 await c.getByText('3 días de saldo disponible',{exact:true}).waitFor();
 await c.getByText('Ver historial (14)',{exact:true}).click();
 assert.equal(await c.getByRole('button',{name:'Eliminar registro',exact:true}).count(),0,'Consulta del colaborador sin controles administrativos');
 assert.equal(await c.getByText('Compensación programada · ya descontada',{exact:true}).count(),4);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,checks:['7 acumulados menos 4 programados = 3 disponibles','compensaciones futuras muestran -1','cancelar compensación devuelve un día','saldos e historial','boleta afecta toda la tienda','reversión a descanso','no elimina historial','advierte diferencia histórica','móvil y escritorio','consulta del colaborador','error distinto de saldo cero'],output},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
