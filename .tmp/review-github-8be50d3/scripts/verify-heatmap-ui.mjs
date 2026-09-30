// Isolated UI regression test. No authentication or production data is used.
// PLAYWRIGHT_MODULE can point to the bundled Codex playwright/index.mjs.
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'heatmap-qa-'));
const root = process.cwd();
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Matrix from './src/components/ScheduleHeatmapMatrix.jsx';
import WeeklyScheduleExcelButton from './src/components/WeeklyScheduleExcelButton.jsx';
const positions = Array.from({length:40}, (_,i) => i === 0 ? 'Servicio' : 'Posición de prueba ' + (i+1));
const requirements = {positions, matrix: Object.fromEntries(positions.map((_,i)=>[i,Array(21).fill(1)]))};
const assigned = [
 {position:'Servicio',start:'08:00',end:'16:00'},
 {position:'Servicio',start:'14:00',end:'01:00',isTrainer:true},
 {position:positions[1],start:'07:00',end:'18:00'}
];
const authorized = !location.search.includes('unauthorized');
createRoot(document.getElementById('root')).render(<>
 <WeeklyScheduleExcelButton canExport={authorized} weekStart="2026-09-14"
  staff={[
   {id:'1',name:'Gerente',lastName:'Ejemplo',position:'GERENTE',modality:'Full-Time'},
   {id:'2',name:'Colaborador',lastName:'Full Time',position:'COLABORADOR',modality:'Full-Time'},
   {id:'3',name:'Colaborador',lastName:'Part Time',position:'COLABORADOR',modality:'Part-Time'},
   {id:'4',name:'Turno',lastName:'Partido',position:'ENTRENADOR',modality:'Part-Time'}
  ]}
  schedules={{
   '1':Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day=>[day,{start:'16:15',end:'01:00',position:'Servicio'}])),
   '2':{monday:{start:'09:00',end:'17:45',extraHoursPre:1,position:'Servicio'},tuesday:{off:true}},
   '3':{wednesday:{start:'18:00',end:'22:00',position:'Servicio'},thursday:{feriado:true}},
   '4':{monday:{start:'09:00',end:'13:00',splitShift:true,start2:'17:00',end2:'21:00',position:'Servicio'}}
  }}
  requirements={Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday'].map(day=>[day,requirements]))}
 />
 <div data-testid="competing-column" style={{position:'fixed',left:0,top:200,width:240,height:100,zIndex:99999,background:'purple',color:'white'}}>Colaboradores del editor</div>
 <div style={{marginLeft:260,position:'sticky',top:0,transform:'translateZ(0)',width:600,height:450,overflow:'hidden'}}>
  <Matrix assigned={assigned} requirements={requirements} canExport={authorized} date="2026-09-18" dayLabel="Viernes"/>
 </div>
</>);`;
const bundle = await build({ stdin: { contents: fixture, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const component = await readFile(path.join(root, 'src/components/ScheduleHeatmapMatrix.jsx'), 'utf8');
const css = await postcss([tailwind({ content: [{ raw: component }], theme: {}, plugins: [] })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); }
  else if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const weeklyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel horario + mapas', exact: true }).click();
  const weekly = await weeklyDownload;
  assert.equal(weekly.suggestedFilename(), 'horarios_2026-09-14_2026-09-20.xlsx');
  assert.equal(await weekly.failure(), null);
  await weekly.saveAs(path.join(output, 'horario-semanal.xlsx'));
  await page.getByRole('button', { name: 'PDF', exact: true }).waitFor();
  assert.ok(await page.locator('tbody tr').count() > 1);
  await page.getByRole('button', { name: 'Maximizar mapa de cobertura', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(el => el.matches(':modal')), true);
  assert.equal(await page.evaluate(() => document.elementFromPoint(100, 250).closest('dialog') !== null), true, 'La columna externa no debe cubrir la matriz');
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  const region = dialog.getByRole('region');
  await region.evaluate(el => { el.scrollLeft = 650; el.scrollTop = 200; });
  await page.waitForTimeout(100);
  const sticky = await region.evaluate(el => {
    const th = el.querySelector('th');
    const position = el.querySelector('tbody td[rowspan]');
    return { left: el.scrollLeft, top: el.scrollTop, thZ: +getComputedStyle(th).zIndex, rowZ: +getComputedStyle(position).zIndex, thTop: th.getBoundingClientRect().top, regionTop: el.getBoundingClientRect().top };
  });
  assert.ok(sticky.left > 0 && sticky.top > 0);
  assert.ok(sticky.thZ > sticky.rowZ);
  assert.ok(Math.abs(sticky.thTop - sticky.regionTop) < 2);
  const viewport = await region.boundingBox();
  const beforeDrag = await region.evaluate(el => el.scrollLeft);
  await page.mouse.move(viewport.x + 250, viewport.y + 90);
  await page.mouse.down();
  await page.mouse.move(viewport.x + 450, viewport.y + 90, { steps: 5 });
  await page.mouse.up();
  assert.ok(await region.evaluate(el => el.scrollLeft) < beforeDrag, 'arrastrar debe desplazar la matriz ampliada');
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  for (const [label, extension] of [['PDF', 'pdf'], ['Excel', 'xlsx']]) {
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), `mapa-cobertura-2026-09-18.${extension}`);
    assert.equal(await download.failure(), null);
    await download.saveAs(path.join(output, `matriz.${extension}`));
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  await page.getByRole('button', { name: 'Maximizar mapa de cobertura', exact: true }).click();
  await page.getByRole('button', { name: 'Minimizar mapa de cobertura', exact: true }).click();
  await page.goto(`${url}/?unauthorized`);
  assert.equal(await page.getByRole('button', { name: 'Excel horario + mapas', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'PDF', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Excel', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Maximizar mapa de cobertura', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'PDF', exact: true }).count(), 0);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(url);
  // Fixture sidebar starts outside mobile viewport; activation is programmatic only for this harness.
  await mobile.getByRole('button', { name: 'Maximizar mapa de cobertura', exact: true }).evaluate(el => el.click());
  const mobileDialog = mobile.getByRole('dialog');
  await mobileDialog.waitFor();
  const bounds = await mobileDialog.boundingBox();
  assert.ok(bounds.width <= 390 && bounds.height <= 844);
  const mobileRegion = mobileDialog.getByRole('region');
  assert.equal(await mobileRegion.evaluate(el => getComputedStyle(el).touchAction), 'auto');
  await mobileRegion.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = 150; });
  assert.ok(await mobileRegion.evaluate(el => el.scrollLeft > 1000));
  const touchViewport = await mobileRegion.boundingBox();
  const cdp = await mobile.context().newCDPSession(mobile);
  const beforeTouch = await mobileRegion.evaluate(el => el.scrollLeft);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchViewport.x + 160, y: touchViewport.y + 120 }] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchViewport.x + 160 + step * 20, y: touchViewport.y + 120 }] });
    await mobile.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(150);
  assert.ok(await mobileRegion.evaluate(el => el.scrollLeft) < beforeTouch, 'el gesto táctil debe desplazar la matriz');
  await mobile.screenshot({ path: path.join(output, 'mobile.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS: modal sobre columnas externas, scroll, capas, Escape, reapertura, permisos, descargas PDF/Excel y vista móvil. Archivos de prueba: ${output}`);
} finally {
  await browser?.close();
  server.close();
}
