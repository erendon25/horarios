import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '../tmp/competition-test-runtime/node_modules/playwright/index.mjs';

const source = './tmp/sales-channel-hotfix/src/components/SalesAnalysis.jsx';
const transport = `
const db={};const user={uid:'qa-user'};
export const getFirestore=()=>db;
export const doc=(...parts)=>({path:parts.filter(x=>typeof x==='string').join('/')});
export const collection=doc;export const query=value=>value;export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});
const history={
 '2026-10-23':{totalSales:180,totalTxs:6,hourlyData:{20:null,21:{'SERV. AUTO':90,RAPPI:70,'SALÓN':20}},hourlyTxs:{21:{'SERV. AUTO':2,RAPPI:1,'SALÓN':1},22:{'SOLO TXS':2}}},
 '2026-10-16':{totalSales:30,totalTxs:1,hourlyData:{21:{'SERV. AUTO':'30'}},hourlyTxs:{21:{'SERV. AUTO':'1'}}}
};
export async function getDoc(ref){const id=ref.path.split('/').at(-1);const data=ref.path==='users/qa-user'?{storeId:'qa-store'}:ref.path.includes('/sales_history/')?history[id]:null;return{id,exists:()=>!!data,data:()=>data}}
export const getDocs=async()=>({docs:Object.entries(history).map(([id,data])=>({id,data:()=>data,exists:()=>true}))});
export const writeBatch=()=>({set(){throw Error('Unexpected write')},commit(){throw Error('Unexpected write')}});
`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import SalesAnalysis from '${source}';createRoot(document.getElementById('root')).render(<BrowserRouter><SalesAnalysis/></BrowserRouter>);`, loader: 'jsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  plugins: [{ name: 'isolated-sales', setup(b) {
    b.onLoad({ filter: /lib[\\/]supabase[\\/]firestoreCompat\.js$/ }, () => ({ contents: transport, loader: 'js' }));
    b.onLoad({ filter: /contexts[\\/]AuthContext\.jsx$/ }, () => ({ contents: "const user={uid:'qa-user'};export const useAuth=()=>({currentUser:user});", loader: 'js' }));
  } }],
});
const css = await readFile('tmp/production-buk-rrhh/build/assets/index-BYQ5ILUl.css', 'utf8');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
await mkdir('output/sales-channel-hotfix', { recursive: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Lima' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('input[type=date]').nth(0).fill('2026-10-23');
    await page.locator('input[type=date]').nth(1).fill('2026-10-23');
    await page.getByRole('button', { name: 'Consultar', exact: true }).click();
    const section = page.getByRole('heading', { name: /^VS / }).first().locator('xpath=..');
    await section.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.bg-black')].some(el => /180[.,]00/.test(el.textContent)));
    assert.match(await section.locator('.bg-black').nth(0).innerText(), /30[.,]00/);
    assert.match(await section.locator('.bg-black').nth(1).innerText(), /180[.,]00/);
    await page.getByRole('button', { name: 'Transacciones', exact: true }).click();
    assert.match(await section.locator('.bg-black').nth(0).innerText(), /1\s*$/);
    assert.match(await section.locator('.bg-black').nth(1).innerText(), /6\s*$/);
    await page.screenshot({ path: `output/sales-channel-hotfix/${width}.png` });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: published SalesAnalysis with hotfix loads extra channels at 21:00 on desktop/mobile and preserves sales/transaction comparison totals without console errors');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
