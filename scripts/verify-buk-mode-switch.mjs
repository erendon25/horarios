import { chromium } from '/opt/codex/runtimes/cua/lib/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.goto(process.env.QA_URL || 'http://localhost:4179/');
 const mode=page.getByLabel('Modalidad de planificación',{exact:true});await mode.waitFor();
 const approved=page.locator('select[aria-label^="Horario aprobado BUK"]').first();await approved.waitFor();
 const row=approved.locator('xpath=ancestor::tr[1]');await row.getByTitle('Entrada',{exact:true}).fill('06:45');assert.equal(await row.getByTitle('Salida',{exact:true}).inputValue(),'15:30');
 const draft=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>!key.startsWith('schedule_mode:'))));
 await mode.selectOption('legacy');assert.equal(await page.locator('select[aria-label^="Horario aprobado BUK"]').count(),0);
 await page.getByRole('button',{name:'Excel GeoVictoria',exact:true}).waitFor();await page.getByRole('columnheader',{name:'Partido',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>!key.startsWith('schedule_mode:')))),draft);
 await page.reload();await page.getByRole('button',{name:'Excel GeoVictoria',exact:true}).waitFor();assert.equal(await mode.inputValue(),'legacy');
 const input=page.getByTitle('Entrada 1',{exact:true}).first();const end=page.getByTitle('Salida 1',{exact:true}).first();assert.equal(await input.inputValue(),'06:45');await input.fill('07:00');assert.equal(await end.inputValue(),'15:30');
 await mode.selectOption('buk');await approved.waitFor();await row.getByTitle('Entrada',{exact:true}).fill('06:45');assert.equal(await row.getByTitle('Salida',{exact:true}).inputValue(),'15:30');
 assert.equal(await page.evaluate(()=>window.bukQaWrites?.length || 0),0);
 console.log('PASS: BUK ↔ anterior, persistencia, turnos y borrador conservados, entrada manual anterior, BUK automático; sin escrituras remotas');
} finally {await browser.close();}
