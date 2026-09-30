// Isolated browser verification of the real matrix and transfer form.
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const output = await mkdtemp(path.join(tmpdir(), 'heatmap-transfers-'));
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Matrix from './src/components/ScheduleHeatmapMatrix.jsx';
import BreakControl from './src/components/ScheduleBreakControl.jsx';
import PositionControl from './src/components/SchedulePositionControl.jsx';
import { getHeatmapAssignments, getPositionTimeline } from './src/services/scheduleExportData.js';
import { replacePositionInterval, validateHeatmapTransfer } from './src/services/heatmapTransfers.js';
const staff = [{id:'a',name:'Ana',modality:'Full-Time'}, {id:'b',name:'Beto',modality:'Full-Time'}];
const shift = {start:'09:00',end:'17:45',position:'Caja',breakStart:'13:00'};
const initial = {a:{monday:shift},b:{monday:{...shift,breakStart:'14:00'}}};
const requirements = {positions:['Caja','Cocina','Despacho'],matrix:[Array(21).fill(1),Array(21).fill(1),Array(21).fill(1)]};
function App() {
 const [schedules,setSchedules] = useState(() => JSON.parse(localStorage.getItem('fixture-schedule') || 'null') || initial);
 const assigned = getHeatmapAssignments(staff,schedules,'monday',requirements.positions,'2026-09-28');
 const apply = transfer => {
  const error = validateHeatmapTransfer(assigned,requirements,transfer); if(error) throw new Error(error);
  const previous = schedules[transfer.staffId].monday;
  setSchedules({...schedules,[transfer.staffId]:{monday:{...previous,positionAssignments:replacePositionInterval(previous,transfer)}}});
 };
 return <><button onClick={() => localStorage.setItem('fixture-schedule',JSON.stringify(schedules))}>Guardar prueba</button>
 <BreakControl shift={schedules.a.monday} modality="Full-Time" name="Ana" onChange={breakStart=>setSchedules({...schedules,a:{monday:{...schedules.a.monday,breakStart}}})}/>
 <PositionControl shift={schedules.a.monday} modality="Full-Time" name="Ana" onChange={positionAssignments=>setSchedules({...schedules,a:{monday:{...schedules.a.monday,positionAssignments}}})}/>
 <div style={{height:650}}><Matrix assigned={assigned} requirements={requirements} onTransfer={apply}/></div>
 <ul aria-label="Tramos de Ana">{getPositionTimeline(schedules.a.monday,'Full-Time').map((segment,index) => <li key={index}>{segment.label}</li>)}</ul>
 </>;
}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const sources = await Promise.all(['components/ScheduleHeatmapMatrix.jsx', 'components/HeatmapTransferForm.jsx', 'components/ScheduleBreakControl.jsx', 'components/SchedulePositionControl.jsx', 'services/heatmapModel.js', 'services/heatmapExport.js'].map(name => readFile(path.join(root, 'src', name), 'utf8')));
const css = await postcss([tailwind({ content: sources.map(raw => ({raw})), theme: {}, plugins: [] })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
const server = createServer((request, response) => {
 if (request.url === '/app.js') { response.setHeader('Content-Type','text/javascript'); response.end(bundle.outputFiles[0].text); }
 else if (request.url === '/style.css') { response.setHeader('Content-Type','text/css'); response.end(css.css); }
 else { response.setHeader('Content-Type','text/html'); response.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser = await chromium.launch({headless:true});
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 const errors = [];
 page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
 const url = 'http://127.0.0.1:' + server.address().port;
 await page.goto(url);
 const selectRange = async (from, to) => {
  const first = page.getByLabel('Seleccionar tramo de Caja desde ' + from,{exact:true});
  const last = page.getByLabel('Seleccionar tramo de Caja desde ' + to,{exact:true});
  await first.scrollIntoViewIfNeeded();
  const a = await first.boundingBox(), b = await last.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
  await page.mouse.down();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});
  await page.mouse.up();
 };
 await page.getByRole('button',{name:'Asignar break de Ana'}).click();
 await page.getByLabel('Inicio del break',{exact:true}).selectOption('13:15');
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 assert.match(await page.getByRole('button',{name:'Asignar break de Ana'}).innerText(),/13:00/);
 await page.getByRole('button',{name:'Asignar break de Ana'}).click();
 await page.getByLabel('Inicio del break',{exact:true}).selectOption('13:00');
 await page.getByRole('button',{name:'Aplicar break',exact:true}).click();
 assert.equal(await page.getByRole('dialog').count(),0);
 await selectRange('10:00','11:45');
 assert.equal(await page.getByLabel('Fin del cambio',{exact:true}).inputValue(),'720');
 await page.getByLabel('Puesto destino',{exact:true}).selectOption('Cocina');
 await page.getByLabel('Fin del cambio',{exact:true}).selectOption('720');
 await page.screenshot({path:path.join(output,'form.png'),fullPage:true});
 await page.getByRole('button',{name:'Aplicar tramo',exact:true}).click();
 assert.match(await page.getByRole('list',{name:'Tramos de Ana'}).innerText(),/10:00-12:00 · Cocina/);
 assert.equal(await page.getByLabel('Seleccionar tramo de Caja desde 10:00',{exact:true}).count(),0);
 // Drag a different interval to another destination, then extend it.
 await selectRange('12:45','12:00');
 assert.equal(await page.getByLabel('Fin del cambio',{exact:true}).inputValue(),'780');
 await page.getByLabel('Puesto destino',{exact:true}).selectOption('Despacho');
 await page.getByLabel('Fin del cambio',{exact:true}).selectOption('780');
 await page.getByRole('button',{name:'Aplicar tramo',exact:true}).click();
 assert.match(await page.getByRole('list',{name:'Tramos de Ana'}).innerText(),/12:00-13:00 · Despacho/);
 await page.getByRole('button',{name:'Guardar prueba'}).click();
 await page.reload();
 assert.match(await page.getByRole('list',{name:'Tramos de Ana'}).innerText(),/10:00-12:00 · Cocina/);
 await page.getByLabel('Seleccionar tramo de Caja desde 15:00',{exact:true}).click();
 await page.getByLabel('Puesto destino',{exact:true}).selectOption('Despacho');
 await page.getByLabel('Fin del cambio',{exact:true}).selectOption('1065');
 await page.getByRole('button',{name:'Aplicar tramo',exact:true}).click();
 assert.match(await page.getByRole('list',{name:'Tramos de Ana'}).innerText(),/15:00-17:45 · Despacho/);
 await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Ver tramos de Ana'}).click();
 const positionsDialog=page.getByRole('dialog',{name:'Puestos de Ana'});
 assert.equal(await positionsDialog.getByRole('listitem').count(),5);
 await page.screenshot({path:path.join(output,'positions.png'),fullPage:true});
 await positionsDialog.getByRole('button',{name:'Quitar Despacho de 15:00 a 17:45'}).click();
 assert.equal(await positionsDialog.getByRole('listitem').count(),4);
 await positionsDialog.getByRole('button',{name:'Cerrar puestos'}).click();
 const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 mobile.on('pageerror',error=>errors.push(error.message));
 await mobile.goto(url);
 await mobile.getByLabel('Seleccionar tramo de Caja desde 10:00',{exact:true}).tap();
 await mobile.screenshot({path:path.join(output,'mobile-form.png'),fullPage:true});
 await mobile.getByLabel('Puesto destino',{exact:true}).selectOption('Cocina');
 await mobile.getByRole('button',{name:'Aplicar tramo',exact:true}).tap();
 assert.match(await mobile.getByRole('list',{name:'Tramos de Ana'}).innerText(),/10:00-10:15 · Cocina/);
 await page.getByRole('button',{name:'Maximizar mapa de cobertura'}).click();
 await selectRange('09:00','09:45');
 assert.equal(await page.getByLabel('Fin del cambio',{exact:true}).inputValue(),'600');
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByRole('button',{name:'Desplazar mapa',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Desplazar mapa',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Minimizar mapa de cobertura'}).click();
 assert.deepEqual(errors,[]);
 console.log('PASS: selección de intervalos en ambos sentidos, break compacto, tramos consecutivos, fin de turno, recarga y móvil. Captura: ' + path.join(output,'desktop.png'));
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
