// Start serve-competition-qa.mjs with COMPETITION_QA_MODE=collaborator.
// Actual dashboard/module, real PostgreSQL RPC/RLS, isolated auth/profile adapters.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.COMPETITION_QA_OUTPUT || 'output/collaborator-e2e');
await mkdir(output, { recursive: true });
const base = `http://127.0.0.1:${process.env.COMPETITION_QA_PORT || 4190}`;
const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
context.setDefaultTimeout(20000);
await context.tracing.start({screenshots:true,snapshots:true,sources:true});
const passed = [], errors = [], apiErrors = [];
let collaborator;
const pass = name => {passed.push(name);console.log(`PASS: ${name}`)};
const until = async (check, label) => {
  const end = Date.now()+20000;
  while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100))}
  throw Error(`Timeout: ${label}`);
};
try {
  const admin = await context.newPage();
  collaborator = await context.newPage();
  const rival = await context.newPage();
  const trainer = await context.newPage();
  for(const page of [admin,collaborator,rival,trainer]) {
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    page.on('dialog',d=>d.accept());
    page.on('response',async r=>{
      if(r.url().endsWith('/api')) {const body=await r.json().catch(()=>({}));if(body.error)apiErrors.push(body.error.message)}
    });
  }
  const api = async (body,role='admin') => {
    const response=await admin.request.post(`${base}/api`,{data:{...body,role}});
    const result=await response.json();assert.equal(result.error,null,JSON.stringify(result.error));return result.data;
  };
  const read = (table,filters={},role='admin') => api({table,filters,orders:[],start:0,end:999,columns:'*'},role);
  await admin.goto(`${base}/concurso`);
  await admin.getByRole('heading',{name:'Dashboard del concurso'}).waitFor();
  const id=await admin.getByRole('combobox',{name:'Concurso',exact:true}).inputValue();
  const command = (action,payload={}) => api({rpc:'competition_command',args:{p_competition_id:id,p_action:action,p_payload:payload}});
  await collaborator.goto(`${base}/staff?role=collaborator`);
  await collaborator.getByRole('heading',{name:'Bienvenido, Colaboradora Demo'}).waitFor();
  // Wait for the real publication query, so absence is checked after loading.
  await until(async()=>await collaborator.evaluate(()=>performance.getEntriesByType('resource').some(e=>e.name.endsWith('/api'))),'consulta de publicación');
  assert.equal(await collaborator.getByRole('button',{name:'MI CONCURSO',exact:true}).count(),0);
  await collaborator.screenshot({path:`${output}/01-panel-oculto.png`,fullPage:true});
  const testImage=async color=>Buffer.from(await collaborator.evaluate(color=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
    const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,320,240);
    ctx.fillStyle='#fff';ctx.font='bold 60px sans-serif';ctx.fillText('DEMO',60,140);
    return canvas.toDataURL('image/png').split(',')[1];
  },color),'base64');
  const editor=collaborator.getByRole('region',{name:'Foto de perfil',exact:true});
  await editor.getByRole('img',{name:'Imagen predeterminada de Colaboradora Demo',exact:true}).waitFor();
  await editor.getByLabel('Elegir foto de perfil').setInputFiles({name:'invalid.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await editor.getByRole('alert').getByText('Elige una imagen JPG, PNG o WebP.',{exact:true}).waitFor();
  const uploadPhoto=async color=>{
    await editor.getByLabel('Elegir foto de perfil').setInputFiles({name:'demo.png',mimeType:'image/png',buffer:await testImage(color)});
    await editor.getByRole('button',{name:'Guardar foto',exact:true}).click();
    await editor.getByText('Foto de perfil guardada.',{exact:true}).waitFor();
    await until(async()=>await editor.getByRole('img',{name:'Foto de Colaboradora Demo'}).evaluate(img=>img.complete&&img.naturalWidth===512),'foto real servida y redimensionada');
  };
  await uploadPhoto('#c74808');
  const firstPhoto=(await read('staff_profile_photos'))[0];assert.ok(firstPhoto.object_path);
  await collaborator.reload();
  await until(async()=>await editor.getByRole('img',{name:'Foto de Colaboradora Demo'}).evaluate(img=>img.complete&&img.naturalWidth===512),'foto persiste tras recarga');
  await collaborator.screenshot({path:`${output}/11-panel-foto.png`,fullPage:true});
  pass('Foto propia: SVG rechazado, imagen PNG preparada a 512px, guardada y persistente después de recargar');
  await rival.goto(`${base}/concurso?role=rival&id=${id}`);
  await rival.getByRole('heading',{name:'No hay concursos disponibles'}).waitFor();
  assert.equal(await rival.getByRole('navigation',{name:'Secciones del concurso'}).count(),0);
  assert.deepEqual(await read('competition_team_members',{competition_id:id},'collaborator'),[]);
  pass('Concurso oculto: sin MI CONCURSO en el panel, sin acceso por URL ni lectura de integrantes');

  await admin.getByRole('button',{name:'Configuración',exact:true}).click();
  await admin.getByRole('button',{name:'Publicar al equipo',exact:true}).click();
  await admin.getByRole('button',{name:'Ocultar al equipo',exact:true}).waitFor();
  await collaborator.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await collaborator.getByRole('button',{name:'MI CONCURSO',exact:true}).waitFor();
  await collaborator.screenshot({path:`${output}/02-panel-publicado.png`,fullPage:true});
  await collaborator.getByRole('button',{name:'MI CONCURSO',exact:true}).click();
  await collaborator.getByRole('heading',{name:'Mi concurso'}).waitFor();
  assert.equal(new URL(collaborator.url()).pathname,'/concurso');
  for(const name of ['Configuración','Evaluar','Participantes','Áreas','Historial'])
    assert.equal(await collaborator.getByRole('button',{name,exact:true}).count(),0);
  await collaborator.screenshot({path:`${output}/03-mi-concurso.png`,fullPage:true});
  pass('Publicar en borrador muestra el botón naranja MI CONCURSO y abre equipo, líder, compañeros y áreas sin controles administrativos');

  await trainer.goto(`${base}/concurso?role=trainer&id=${id}`);
  await trainer.getByText('Como líder, solo haces seguimiento a tus colaboradores.',{exact:false}).waitFor();
  assert.equal(await trainer.getByRole('button',{name:'Inscripción',exact:true}).count(),0);
  assert.equal(await trainer.getByRole('button',{name:'Inscribirme',exact:true}).count(),0);
  for(const name of ['Mi concurso','Fixture','Ranking']) await trainer.getByRole('button',{name,exact:true}).waitFor();
  const leaderAreas = await read('competition_areas',{competition_id:id});
  const denied = await trainer.request.post(`${base}/api`,{data:{role:'trainer',rpc:'competition_command',args:{p_competition_id:id,p_action:'register',p_payload:{area_id:leaderAreas[0].id}}}});
  assert.match((await denied.json()).error?.message || '',/Los líderes de equipo no se inscriben/);
  await trainer.setViewportSize({width:390,height:844});
  await trainer.screenshot({path:`${output}/14-lider-seguimiento.png`,fullPage:true});
  await trainer.reload();
  await trainer.getByText('Como líder, solo haces seguimiento a tus colaboradores.',{exact:false}).waitFor();
  assert.equal(await trainer.getByRole('button',{name:'Inscripción',exact:true}).count(),0);
  pass('Líder: sin inscripción en escritorio/móvil o al recargar, seguimiento disponible y RPC de inscripción denegada');

  await collaborator.getByRole('button',{name:'Inscripción',exact:true}).click();
  const card = (page,name) => page.locator('section.card').filter({has:page.getByRole('heading',{name,exact:true})});
  assert.equal(await collaborator.locator('section.card').filter({has:collaborator.getByRole('button',{name:'Inscribirme',exact:true})}).count(),7);
  for(const name of ['Landing','Sheetout']) {
    await card(collaborator,name).getByRole('button',{name:'Inscribirme',exact:true}).click();
    await card(collaborator,name).getByRole('button',{name:'Retirar mi inscripción'}).waitFor();
  }
  await collaborator.getByText('Ya elegiste tus 2 áreas.',{exact:false}).waitFor();
  for(const button of await collaborator.getByRole('button',{name:'Inscribirme',exact:true}).all()) assert.equal(await button.isDisabled(),true);
  await collaborator.screenshot({path:`${output}/04-inscripcion-desktop.png`,fullPage:true});
  await collaborator.reload();
  await collaborator.getByRole('button',{name:'Inscripción',exact:true}).click();
  assert.equal(await collaborator.getByRole('button',{name:'Retirar mi inscripción'}).count(),2);
  await card(collaborator,'Sheetout').getByRole('button',{name:'Retirar mi inscripción'}).click();
  await until(async()=>await card(collaborator,'Sheetout').getByRole('button',{name:'Inscribirme',exact:true}).isEnabled(),'retiro abre cupo');
  await card(collaborator,'Masa').getByRole('button',{name:'Inscribirme',exact:true}).click();
  await card(collaborator,'Masa').getByRole('button',{name:'Retirar mi inscripción'}).waitFor();
  await card(collaborator,'Masa').getByRole('button',{name:'Retirar mi inscripción'}).click();
  await card(collaborator,'Sheetout').getByRole('button',{name:'Inscribirme',exact:true}).click();
  await card(collaborator,'Sheetout').getByRole('button',{name:'Retirar mi inscripción'}).waitFor();
  await collaborator.setViewportSize({width:390,height:844});
  await collaborator.screenshot({path:`${output}/05-inscripcion-mobile.png`,fullPage:true});
  await collaborator.setViewportSize({width:1440,height:1000});
  pass('Inscripción en dos de siete áreas, tercera bloqueada, persistencia al recargar, retiro y sustitución en borrador; escritorio y móvil');

  await trainer.getByRole('button',{name:'Actualizar',exact:true}).click();
  const followed = trainer.locator('li').filter({hasText:'Colaboradora Demo'});
  await until(async()=>{
    const text=await followed.innerText();return text.includes('Landing')&&text.includes('Sheetout');
  },'líder consulta las dos áreas elegidas por su colaboradora');
  assert.equal(await trainer.getByRole('button',{name:'Inscripción',exact:true}).count(),0);
  pass('El líder sigue las áreas elegidas por su equipo sin recibir controles de inscripción');

  await rival.goto(`${base}/concurso?role=rival&id=${id}`);
  await rival.getByRole('button',{name:'Inscripción',exact:true}).click();
  for(const name of ['Landing','Sheetout']) {
    await card(rival,name).getByRole('button',{name:'Inscribirme',exact:true}).click();
    await card(rival,name).getByRole('button',{name:'Retirar mi inscripción'}).waitFor();
  }
  await until(async()=>await card(collaborator,'Landing').getByText('2 inscritos elegibles · mínimo 2',{exact:true}).count()>0,'inscripción del segundo colaborador visible');
  await collaborator.getByRole('button',{name:'Fixture',exact:true}).click();
  await collaborator.getByText('El sorteo del orden y los cruces se genera al activar',{exact:false}).waitFor();
  await admin.getByRole('button',{name:'Activar concurso',exact:true}).click();
  await admin.getByRole('button',{name:'Volver a borrador',exact:true}).waitFor();
  await until(async()=>await collaborator.getByRole('heading',{name:'Cruces y orden sorteado',exact:true}).count()>0,'fixture actualizado tras activar');
  await collaborator.getByRole('combobox',{name:'Área del fixture',exact:true}).selectOption({label:'Landing'});
  await collaborator.getByRole('heading',{name:'Cruce 1',exact:true}).waitFor();
  assert.ok(await collaborator.getByRole('img',{name:'Foto de Colaboradora Demo'}).count()>=2,'Foto en cruce y fase');
  assert.ok(await collaborator.getByRole('img',{name:'Imagen predeterminada de Rival Demo'}).count()>=2,'Sin foto: silueta de persona');
  const draw=await collaborator.locator('.grid ol').allTextContents();
  assert.match(draw.join(' '),/Colaboradora Demo/);assert.match(draw.join(' '),/Rival Demo/);
  await collaborator.screenshot({path:`${output}/06-fixture-desktop.png`,fullPage:true});
  await collaborator.reload();
  await collaborator.getByRole('button',{name:'Fixture',exact:true}).click();
  await collaborator.getByRole('combobox',{name:'Área del fixture',exact:true}).selectOption({label:'Landing'});
  assert.deepEqual(await collaborator.locator('.grid ol').allTextContents(),draw);
  await collaborator.setViewportSize({width:390,height:844});
  await collaborator.screenshot({path:`${output}/07-fixture-mobile.png`,fullPage:true});
  await collaborator.setViewportSize({width:1440,height:1000});
  await collaborator.getByRole('button',{name:'Inscripción',exact:true}).click();
  await collaborator.getByText('Inscripciones cerradas.',{exact:false}).waitFor();
  assert.equal(await collaborator.getByRole('button',{name:'Retirar mi inscripción'}).count(),0);
  for(const button of await collaborator.getByRole('button',{name:'Inscribirme',exact:true}).all()) assert.equal(await button.isDisabled(),true);
  pass('Activación cierra las inscripciones y muestra cruces, turnos y fases por área; el sorteo persiste al recargar');
  pass('La foto aparece en cruces y fases del fixture; los competidores sin foto muestran una silueta de persona');

  const photoPanel=await context.newPage();
  photoPanel.on('pageerror',e=>errors.push(e.message));photoPanel.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await photoPanel.goto(`${base}/staff?role=collaborator`);
  const photoEditor=photoPanel.getByRole('region',{name:'Foto de perfil',exact:true});
  await photoEditor.getByRole('img',{name:'Foto de Colaboradora Demo'}).waitFor();
  await photoEditor.getByLabel('Elegir foto de perfil').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:await testImage('#1962b8')});
  await photoEditor.getByRole('button',{name:'Guardar foto',exact:true}).click();
  await photoEditor.getByText('Foto de perfil guardada.',{exact:true}).waitFor();
  const replacement=(await read('staff_profile_photos'))[0];assert.equal(replacement.object_path,firstPhoto.object_path);assert.notEqual(replacement.updated_at,firstPhoto.updated_at);
  await collaborator.getByRole('button',{name:'Fixture',exact:true}).click();
  await collaborator.getByRole('combobox',{name:'Área del fixture',exact:true}).selectOption({label:'Landing'});
  await collaborator.getByRole('button',{name:'Actualizar',exact:true}).click();
  await until(async()=>{
    const urls=await collaborator.getByRole('img',{name:'Foto de Colaboradora Demo'}).evaluateAll(images=>images.map(img=>img.src));
    return urls.length>=2&&urls.every(url=>new URL(url).searchParams.get('v')===replacement.updated_at)&&await collaborator.getByRole('img',{name:'Foto de Colaboradora Demo'}).first().evaluate(img=>img.complete&&img.naturalWidth===512);
  },'foto reemplazada en fixture');
  assert.equal(await collaborator.getByRole('img',{name:'Foto de Colaboradora Demo'}).first().evaluate(img=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    const [red,,blue]=ctx.getImageData(0,0,1,1).data;return blue>red;
  }),true,'El fixture muestra los píxeles de la foto nueva');
  await collaborator.screenshot({path:`${output}/12-fixture-foto.png`,fullPage:true});
  await photoPanel.close();
  pass('Cambiar foto sustituye el archivo propio y actualiza el fixture sin romper los enlaces abiertos');

  const entries=await read('competition_fixture_view',{competition_id:id});
  const landing=(await read('competition_areas',{competition_id:id,name:'Landing'}))[0];
  const mine=entries.find(e=>e.display_name==='Colaboradora Demo'&&e.area_id===landing.id);
  assert.ok(mine);
  const evaluation=await command('prepare',{entry_id:mine.id});
  await command('start',{evaluation_id:evaluation.id});
  await command('stop',{evaluation_id:evaluation.id});
  const scores=await read('competition_evaluation_scores',{evaluation_id:evaluation.id});
  const checks=Object.fromEntries(scores.map(s=>[s.rubric_item_id,Object.fromEntries(s.checklist.map(step=>[step.id,true]))]));
  await command('finalize',{evaluation_id:evaluation.id,checks});
  await collaborator.getByRole('button',{name:'Mi concurso',exact:true}).click();
  await until(async()=>/^1\s/.test(await collaborator.locator('.stat').innerText()),'punto personal actualizado');
  await collaborator.screenshot({path:`${output}/08-mi-concurso-resultado.png`,fullPage:true});
  await collaborator.getByRole('button',{name:'Fixture',exact:true}).click();
  await collaborator.getByRole('combobox',{name:'Área del fixture',exact:true}).selectOption({label:'Landing'});
  const nextPhase=collaborator.locator('section.phase').filter({has:collaborator.getByRole('heading',{name:'Fase 2 →',exact:true})});
  await nextPhase.getByRole('heading',{name:'Colaboradora Demo',exact:true}).waitFor();
  await collaborator.screenshot({path:`${output}/09-fixture-avance.png`,fullPage:true});
  await collaborator.getByRole('button',{name:'Ranking',exact:true}).click();
  await until(async()=>await collaborator.locator('tbody tr').filter({hasText:'Colaboradora Demo'}).locator('td').last().innerText()==='1','ranking actualizado');
  await collaborator.screenshot({path:`${output}/10-ranking-colaborador.png`,fullPage:true});
  pass('Resultado administrativo aprobado actualiza Mi concurso y Ranking a +1 punto y muestra avance a Fase 2 en el fixture del colaborador');

  await admin.getByRole('button',{name:'Ocultar al equipo',exact:true}).click();
  await admin.getByRole('button',{name:'Publicar al equipo',exact:true}).waitFor();
  await collaborator.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await collaborator.getByRole('heading',{name:'No hay concursos disponibles'}).waitFor();
  await collaborator.getByRole('button',{name:'Volver a mi panel'}).click();
  await collaborator.getByRole('heading',{name:'Bienvenido, Colaboradora Demo'}).waitFor();
  assert.equal(await collaborator.getByRole('button',{name:'MI CONCURSO',exact:true}).count(),0);
  assert.equal((await read('competition_evaluations',{id:evaluation.id}))[0].timer_status,'saved');
  pass('Ocultar retira el detalle y el acceso desde el panel conservando inscripciones, resultados y puntos');
  await editor.getByRole('button',{name:'Eliminar foto',exact:true}).click();
  await editor.getByText('Foto eliminada.',{exact:true}).waitFor();
  assert.equal(await editor.getByRole('img',{name:'Foto de Colaboradora Demo'}).count(),0);
  assert.equal(await editor.getByRole('img',{name:'Imagen predeterminada de Colaboradora Demo'}).count(),1);
  assert.equal((await read('staff_profile_photos')).length,0);
  pass('Eliminar foto conserva el perfil y restaura la silueta de persona');
  assert.deepEqual(errors,[]);assert.deepEqual(apiErrors,[]);
  pass('Sin errores de consola, excepciones de página ni errores de las API durante el recorrido');
  await context.tracing.stop({path:`${output}/trace.zip`});
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',scope:'React dashboard/module + PostgreSQL RPC/RLS; auth, profile and transport adapters; no production mutations',passed,errors,apiErrors},null,2));
  await writeFile(`${output}/informe.md`,['# Recorrido del colaborador — E2E','',`Resultado: PASS (${passed.length} comprobaciones).`,'','Panel y módulo React reales, migraciones y RPC PostgreSQL reales. Autenticación, transporte y perfil ficticios; widgets ajenos al concurso omitidos. Archivos de foto reales con transporte Storage aislado y políticas RLS reales. No verifica Auth, Storage, Realtime o despliegue de producción.','',...passed.map(p=>`- ${p}`),'','Capturas: 01–12. Traza: trace.zip. Resultados: resultado.json.'].join('\n'));
  console.log(`E2E colaborador completo: ${passed.length} comprobaciones. Evidencia: ${output}`);
} catch(error) {
  await collaborator?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});
  await context.tracing.stop({path:`${output}/trace-fallo.zip`}).catch(()=>{});
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,apiErrors,error:String(error)},null,2));
  throw error;
} finally {await browser.close()}
