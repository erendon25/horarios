// Disposable QA servers with fresh PostgreSQL data for each browser suite.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = {...process.env};
function moduleUrl(variable, specifier, fallback) {
  if (env[variable]) return env[variable];
  try {return import.meta.resolve(specifier)} catch {
    const path=resolve(root,'tmp/competition-test-runtime/node_modules',fallback);
    if(existsSync(path)) return pathToFileURL(path).href;
    throw Error(`Falta ${specifier}. Ejecuta: npm install --prefix tmp/competition-test-runtime --no-audit --no-fund @electric-sql/pglite@0.3.16 playwright@1.58.2`);
  }
}
env.PGLITE_MODULE=moduleUrl('PGLITE_MODULE','@electric-sql/pglite','@electric-sql/pglite/dist/index.js');
env.PLAYWRIGHT_MODULE=moduleUrl('PLAYWRIGHT_MODULE','playwright','playwright/index.mjs');
if(!env.CHROMIUM_PATH && process.platform==='win32' && env.LOCALAPPDATA) {
  const cache=resolve(env.LOCALAPPDATA,'ms-playwright');
  const versions=(await readdir(cache).catch(()=>[])).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
  for(const version of versions) {
    const exe=resolve(cache,version,'chrome-win64/chrome.exe');
    if(existsSync(exe)){env.CHROMIUM_PATH=exe;break}
  }
} else if(!env.CHROMIUM_PATH && existsSync('/usr/bin/chromium')) env.CHROMIUM_PATH='/usr/bin/chromium';

for(const [mode,port,script] of [
  ['collaborator','4191','verify-competition-collaborator-ui.mjs'],
  ['evaluation','4192','verify-competition-evaluation-ui.mjs'],
]) {
  const suiteEnv={...env,COMPETITION_QA_MODE:mode,COMPETITION_QA_PORT:port};
  delete suiteEnv.COMPETITION_QA_OUTPUT; // Keep separate evidence for the two suites.
  const server=spawn(process.execPath,['scripts/serve-competition-qa.mjs'],{cwd:root,env:suiteEnv,stdio:['ignore','pipe','inherit']});
  try {
    await new Promise((ok,fail)=>{
      let ready=false;
      const timeout=setTimeout(()=>fail(Error('El servidor QA no inició en 30 segundos')),30000);
      server.once('error',error=>{clearTimeout(timeout);fail(error)});
      server.once('exit',code=>{clearTimeout(timeout);if(!ready)fail(Error(`El servidor QA terminó con código ${code}`))});
      server.stdout.on('data',chunk=>{if(chunk.toString().includes('QA local lista:')){ready=true;clearTimeout(timeout);ok()}});
    });
    console.log(`E2E ${mode}: datos nuevos, puerto ${port}`);
    await new Promise((ok,fail)=>{
      const test=spawn(process.execPath,[`scripts/${script}`],{cwd:root,env:suiteEnv,stdio:'inherit'});
      test.once('error',fail);
      test.once('exit',code=>code===0?ok():fail(Error(`${script} terminó con código ${code}`)));
    });
  } finally {
    server.kill();
  }
}
console.log('PASS: E2E de colaborador y evaluación. Capturas e informes en output/collaborator-e2e y output/evaluation-e2e.');
