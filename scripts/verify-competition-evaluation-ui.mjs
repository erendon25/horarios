// Start serve-competition-qa.mjs with COMPETITION_QA_MODE=evaluation first.
// Real React UI + real PostgreSQL commands; isolated test identities/transport.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.COMPETITION_QA_OUTPUT || '/workspace/horarios/output/evaluation-e2e';
await mkdir(output, { recursive: true });
const base = `http://127.0.0.1:${process.env.COMPETITION_QA_PORT || 4189}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox'], env:{...process.env, XDG_CONFIG_HOME:'/tmp/horarios-playwright-config'} });
const context = await browser.newContext({ viewport:{width:1440,height:1000} });
await context.tracing.start({screenshots:true,snapshots:true,sources:true});
const errors = [], passed = [];
let admin;
const pass = name => { passed.push(name); console.log(`PASS: ${name}`); };
const until = async (fn, label) => {
  const deadline = Date.now()+12000;
  while(Date.now()<deadline) { if(await fn()) return; await new Promise(r=>setTimeout(r,80)); }
  throw Error(`Timeout: ${label}`);
};
try {
  admin = await context.newPage();
  const collaborator = await context.newPage();
  const rival = await context.newPage();
  for(const page of [admin,collaborator,rival]) {
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'Prueba E2E: motivo registrado':undefined));
  }
  const api = async body => {
    const response = await admin.request.post(`${base}/api`,{data:{...body,role:'admin'}});
    const result=await response.json();
    assert.equal(result.error,null,JSON.stringify(result.error));
    return result.data;
  };
  const read = (table, filters={}) => api({table,filters,orders:[],start:0,end:999,columns:'*'});
  await admin.goto(`${base}/concurso`);
  await admin.getByRole('heading',{name:'Dashboard del concurso'}).waitFor();
  const id=await admin.getByRole('combobox',{name:'Concurso',exact:true}).inputValue();
  assert.ok(id);
  await admin.getByRole('button',{name:'Participantes',exact:true}).click();
  assert.equal(await admin.getByRole('button',{name:'Asignar área',exact:true}).count(),0);
  await admin.getByRole('button',{name:'Áreas',exact:true}).click();
  const sheetoutEditor=admin.locator('section.card').filter({has:admin.getByRole('heading',{name:'Sheetout',exact:true})});
  await sheetoutEditor.getByLabel('Tiempo máximo (segundos)',{exact:true}).fill('5');
  await sheetoutEditor.getByRole('button',{name:'Guardar área',exact:true}).click();
  await until(async()=>Number((await read('competition_areas',{competition_id:id,name:'Sheetout'}))[0].maximum_duration_ms)===5000,'Tiempo máximo 5s');
  await admin.getByRole('button',{name:'Configuración',exact:true}).click();
  await admin.getByLabel('Permitir pausas',{exact:true}).check();
  await admin.getByRole('button',{name:'Guardar configuración',exact:true}).click();
  await until(async()=>(await read('competitions',{id}))[0].allow_timer_pause,'Pausas configuradas');
  for(const [page,role] of [[collaborator,'collaborator'],[rival,'rival']]) {
    await page.goto(`${base}/concurso?role=${role}&id=${id}`);
    await page.getByRole('button',{name:'Inscripción',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Evaluar',exact:true}).count(),0);
    for(const name of ['Sheetout','Landing']) {
      const card=page.locator('section.card').filter({has:page.getByRole('heading',{name,exact:true})});
      await card.getByRole('button',{name:'Inscribirme',exact:true}).click();
      await card.getByText('Inscrito ·',{exact:false}).waitFor();
    }
    assert.equal(await page.getByRole('button',{name:'Inscribirme',exact:true}).count(),5);
    for(const button of await page.getByRole('button',{name:'Inscribirme',exact:true}).all()) assert.equal(await button.isDisabled(),true);
  }
  pass('Inscripción propia en Sheetout y Landing, tercera área bloqueada y colaborador sin controles de evaluación');
  await admin.getByRole('button',{name:'Activar concurso',exact:true}).click();
  await admin.getByRole('button',{name:'Volver a borrador',exact:true}).waitFor();
  const contest=(await read('competitions',{id}))[0];
  assert.equal(contest.status,'active'); assert.ok(contest.drawn_at);
  await collaborator.reload();
  await collaborator.getByRole('button',{name:'Inscripción',exact:true}).click();
  await collaborator.getByText('Inscripciones cerradas.',{exact:false}).waitFor();
  assert.equal(await collaborator.getByRole('button',{name:'Retirar mi inscripción'}).count(),0);
  pass('Activación, sorteo persistido y cierre de inscripción');
  const sheetout=(await read('competition_areas',{competition_id:id,name:'Sheetout'}))[0];
  const entries=await read('competition_fixture_view',{competition_id:id,area_id:sheetout.id});
  const mainEntry=entries.find(e=>e.display_name==='Colaboradora Demo');
  const rivalEntry=entries.find(e=>e.display_name==='Rival Demo');
  assert.ok(mainEntry); assert.ok(rivalEntry);
  const open = async (name,phase) => {
    await admin.getByRole('button',{name:'Evaluar',exact:true}).click();
    await admin.getByRole('combobox',{name:'Área',exact:true}).selectOption({label:'Sheetout'});
    await admin.getByRole('combobox',{name:'Fase',exact:true}).selectOption({label:phase});
    await until(async()=>(await admin.getByRole('combobox',{name:'Colaborador',exact:true}).locator('option').allTextContents()).some(t=>t.includes(name)),`Seleccionable ${name} ${phase}`);
    await admin.getByRole('combobox',{name:'Colaborador',exact:true}).selectOption({label:`${name} · Equipo 1`});
    await admin.getByRole('button',{name:'Abrir evaluación',exact:true}).click();
    await admin.getByRole('button',{name:'INICIAR',exact:true}).waitFor();
    return new URL(admin.url()).searchParams.get('evaluation');
  };
  const stop = async () => {
    await admin.getByRole('button',{name:'INICIAR',exact:true}).click();
    await admin.getByRole('button',{name:'DETENER',exact:true}).click();
    await admin.getByText('TIEMPO REGISTRADO',{exact:true}).waitFor();
  };
  const fillQuality = async quality => {
    const checks=await admin.locator('.rubric-check select').all();
    if(checks.length) {
      const weights=[];
      for(const select of checks) weights.push(Math.round(Number(await select.getAttribute('data-points'))*100));
      const target=quality*100, choices=new Map([[0,[]]]);
      for(let i=0;i<weights.length;i++) for(const [sum,indices] of [...choices]) if(sum+weights[i]<=target && !choices.has(sum+weights[i])) choices.set(sum+weights[i],[...indices,i]);
      assert.ok(choices.has(target),'Puntuación representable por acciones observadas');
      const selected=new Set(choices.get(target));
      for(let i=0;i<checks.length;i++) await checks[i].selectOption(selected.has(i)?'true':'false');
      return;
    }
    const labels=await admin.locator('.score-row').all();
    let deduction=100-quality;
    for(const row of labels) {
      const input=row.locator('input');
      const max=Number(await input.getAttribute('max'));
      const amount=Math.min(deduction,max);
      await input.fill(String(max-amount)); deduction-=amount;
    }
    assert.equal(deduction,0);
  };
  const save = async (evaluationId,approved) => {
    await admin.getByRole('button',{name:'GUARDAR EVALUACIÓN',exact:true}).click();
    const dialog=admin.getByRole('dialog',{name:'Confirmar evaluación'});
    await dialog.waitFor();
    await dialog.getByRole('button',{name:'Confirmar y guardar',exact:true}).click();
    await admin.getByText('EVALUACIÓN GUARDADA',{exact:true}).waitFor();
    const evaluation=(await read('competition_evaluations',{id:evaluationId}))[0];
    assert.equal(evaluation.timer_status,'saved'); assert.equal(evaluation.approved,approved);
    return evaluation;
  };
  const firstId=await open('Colaboradora Demo','Clasificación');
  await admin.getByRole('button',{name:'INICIAR',exact:true}).click();
  await until(async()=>(await admin.getByRole('timer').innerText())!=='00:00.00','Cronómetro avanzando');
  await admin.getByRole('button',{name:'PAUSAR',exact:true}).click();
  await admin.getByText('PAUSADO',{exact:true}).waitFor();
  const paused=(await read('competition_evaluations',{id:firstId}))[0];
  assert.equal(paused.timer_status,'paused');
  await admin.reload();
  await admin.getByText('PAUSADO',{exact:true}).waitFor();
  const fixedTime=await admin.getByRole('timer').innerText();
  await admin.waitForTimeout(250);
  assert.equal(await admin.getByRole('timer').innerText(),fixedTime);
  await admin.getByRole('button',{name:'REANUDAR',exact:true}).click();
  await admin.getByRole('button',{name:'DETENER',exact:true}).click();
  await admin.getByText('TIEMPO REGISTRADO',{exact:true}).waitFor();
  const stoppedTime=await admin.getByRole('timer').innerText();
  await admin.reload();
  await admin.getByText('TIEMPO REGISTRADO',{exact:true}).waitFor();
  assert.equal(await admin.getByRole('timer').innerText(),stoppedTime);
  await fillQuality(90);
  if(await admin.locator('.rubric-check select').count()) await admin.locator('.rubric-check select').first().selectOption('');
  else await admin.locator('.score-row input').first().fill('26');
  assert.equal(await admin.getByRole('button',{name:'GUARDAR EVALUACIÓN',exact:true}).isDisabled(),true);
  await fillQuality(90);
  await admin.getByRole('button',{name:'GUARDAR EVALUACIÓN',exact:true}).click();
  await admin.getByRole('dialog',{name:'Confirmar evaluación'}).getByRole('button',{name:'Volver a revisar'}).click();
  assert.equal((await read('competition_evaluations',{id:firstId}))[0].timer_status,'stopped');
  await admin.screenshot({path:`${output}/evaluacion-desktop.png`,fullPage:true});
  const mobile=await context.newPage(); await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(admin.url()); await mobile.getByText('TIEMPO REGISTRADO',{exact:true}).waitFor();
  await mobile.screenshot({path:`${output}/evaluacion-mobile.png`,fullPage:true}); await mobile.close();
  const first=await save(firstId,true);
  assert.equal(Number(first.quality_score),90); assert.equal(first.points_awarded,1);
  assert.ok(Number(first.paused_duration_ms)>=250); assert.ok(Number(first.duration_ms)<5000);
  const scores=Object.fromEntries((await read('competition_evaluation_scores',{evaluation_id:firstId})).map(s=>[s.rubric_item_id,s.score]));
  await api({rpc:'competition_command',args:{p_competition_id:id,p_action:'finalize',p_payload:{evaluation_id:firstId,scores,critical_error:false}}});
  assert.equal(Number((await read('competition_individual_ranking',{member_id:mainEntry.member_id}))[0].points),1);
  pass('Cronómetro, pausa/reanudación, recuperación tras recarga, rúbrica válida, 90 aprobado, confirmación y guardado sin duplicar puntos');
  const reopen = async () => {
    await admin.getByRole('button',{name:'Participantes',exact:true}).click();
    await admin.getByRole('button',{name:'Autorizar reintento',exact:true}).click();
    await until(async()=>(await read('competition_entries',{id:rivalEntry.id}))[0].status==='active','Reintento autorizado');
  };
  let criticalId=await open('Rival Demo','Clasificación');
  await stop(); await fillQuality(100);
  await admin.getByLabel('ERROR CRÍTICO',{exact:true}).check();
  assert.equal(await admin.getByRole('button',{name:'GUARDAR EVALUACIÓN',exact:true}).isDisabled(),true);
  await admin.getByLabel('Motivo obligatorio',{exact:true}).fill('Manipulación insegura: prueba E2E');
  assert.equal((await save(criticalId,false)).points_awarded,0);
  pass('Error crítico con motivo obligatorio rechaza calidad 100 y otorga cero puntos');
  await reopen();
  const lowId=await open('Rival Demo','Clasificación'); await stop(); await fillQuality(89);
  assert.equal((await save(lowId,false)).points_awarded,0);
  pass('Calidad 89 rechazada y reintento auditado');
  await reopen();
  const overtimeId=await open('Rival Demo','Clasificación');
  await admin.getByRole('button',{name:'INICIAR',exact:true}).click();
  await admin.waitForTimeout(5400);
  await admin.getByRole('button',{name:'DETENER',exact:true}).click();
  await admin.getByText('TIEMPO REGISTRADO',{exact:true}).waitFor();
  await fillQuality(100);
  const overtime=await save(overtimeId,false);
  assert.ok(Number(overtime.duration_ms)>5000); assert.equal(overtime.points_awarded,0);
  pass('Tiempo excedido rechaza calidad 100 y otorga cero puntos');
  await reopen();
  const canceledId=await open('Rival Demo','Clasificación');
  await admin.getByRole('button',{name:'REINICIAR',exact:true}).click();
  await until(async()=>new URL(admin.url()).searchParams.get('evaluation')!==canceledId,'Nuevo intento tras reinicio');
  const replacementId=new URL(admin.url()).searchParams.get('evaluation');
  const canceled=(await read('competition_evaluations',{id:canceledId}))[0];
  assert.equal(canceled.timer_status,'cancelled'); assert.equal(canceled.points_awarded,0);
  await admin.getByRole('button',{name:'INICIAR',exact:true}).waitFor();
  await stop(); await fillQuality(89); await save(replacementId,false);
  pass('Reinicio cancela el intento anterior, guarda motivo y crea un intento nuevo');
  for(const [phase,points] of [['Fase 2',2],['Semifinal',3],['Final',5]]) {
    const evaluationId=await open('Colaboradora Demo',phase);
    await stop(); await fillQuality(100);
    assert.equal((await save(evaluationId,true)).points_awarded,points);
  }
  assert.equal(Number((await read('competition_individual_ranking',{member_id:mainEntry.member_id}))[0].points),11);
  await admin.getByRole('button',{name:'Fixture',exact:true}).click();
  await admin.getByRole('combobox',{name:'Área del fixture',exact:true}).selectOption({label:'Sheetout'});
  await admin.getByRole('button',{name:'Resolver final / declarar campeón',exact:true}).click();
  await until(async()=>(await read('competition_entries',{id:mainEntry.id}))[0].status==='champion','Campeón');
  const verifyPoints = async (individual,trainer) => {
    assert.equal(Number((await read('competition_individual_ranking',{member_id:mainEntry.member_id}))[0].points),individual);
    assert.equal(Number((await read('competition_team_ranking',{team_id:mainEntry.team_id}))[0].points),individual);
    assert.equal(Number((await read('competition_trainer_ranking',{team_id:mainEntry.team_id}))[0].points),trainer);
  };
  await verifyPoints(14,7);
  await admin.getByRole('button',{name:'Ranking',exact:true}).click();
  await admin.getByRole('button',{name:'Trainers',exact:true}).click();
  const trainerRow=admin.locator('tbody tr').filter({hasText:'Trainer Demo'});
  assert.equal(await trainerRow.locator('td').last().innerText(),'7');
  await admin.screenshot({path:`${output}/ranking-lider.png`,fullPage:true});
  const trainerPage=await context.newPage();
  await trainerPage.goto(`${base}/concurso?role=trainer&id=${id}`);
  await trainerPage.getByText('puntos promedio por colaborador',{exact:true}).waitFor();
  assert.match(await trainerPage.locator('.stat').innerText(),/^7\s/);
  await trainerPage.close();
  pass('Avance por cuatro fases, campeón +3, total individual/equipo 14 y promedio del líder 7 entre dos integrantes');
  await admin.getByRole('button',{name:'Historial',exact:true}).click();
  const finalRow=admin.locator('tbody tr').filter({hasText:'Colaboradora Demo'}).filter({has:admin.locator('td').filter({hasText:/^Final · 1$/})});
  await finalRow.getByRole('button',{name:'Corregir con auditoría',exact:true}).click();
  await until(async()=>Number((await read('competition_individual_ranking',{member_id:mainEntry.member_id}))[0].points)===6,'Corrección recalcula puntos');
  await verifyPoints(6,3);
  assert.notEqual((await read('competition_entries',{id:mainEntry.id}))[0].status,'champion');
  const correctedId=await open('Colaboradora Demo','Final'); await stop(); await fillQuality(100); await save(correctedId,true);
  await admin.getByRole('button',{name:'Fixture',exact:true}).click();
  await admin.getByRole('combobox',{name:'Área del fixture',exact:true}).selectOption({label:'Sheetout'});
  await admin.getByRole('button',{name:'Resolver final / declarar campeón',exact:true}).click();
  await until(async()=>Number((await read('competition_individual_ranking',{member_id:mainEntry.member_id}))[0].points)===14,'Campeón restaurado');
  await verifyPoints(14,7);
  const audits=await read('audit_log',{table_name:'competitions',record_id:id});
  assert.ok(audits.some(a=>a.new_data?.event==='correct'));
  pass('Corrección revoca resultado y campeón, recalcula puntos y permite repetir la final con auditoría');
  assert.deepEqual(errors,[]);
  pass('Sin errores de consola ni excepciones de la página');
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',scope:'React + PostgreSQL aislado; autenticación y transporte de prueba, sin mutaciones de producción',passed,errors},null,2));
  await writeFile(`${output}/informe.md`,[
    '# Evaluación del concurso — prueba E2E',
    '', 'Resultado: **PASS**. Las 10 comprobaciones del navegador pasaron, sin errores de consola.',
    '', 'Se usaron los componentes reales de React y las migraciones/comandos reales de PostgreSQL en PGlite. Las identidades, el transporte de Supabase y las notificaciones de actualización son adaptadores de prueba. Este resultado verifica el flujo de evaluación en un entorno aislado; no verifica el inicio de sesión real de Supabase ni la conexión y Realtime del despliegue de Firebase.',
    '', '## Comprobaciones', '', ...passed.map(name=>`- ${name}.`),
    '', '## Evidencia', '', '- [Evaluación en escritorio](evaluacion-desktop.png)',
    '- [Evaluación en móvil](evaluacion-mobile.png)', '- [Ranking del líder: 14 ÷ 2 = 7](ranking-lider.png)',
    '- [Resultados estructurados](resultado.json)', '- [Traza de Playwright](trace.zip)', '',
  ].join('\n'));
  await context.tracing.stop({path:`${output}/trace.zip`});
  console.log(`E2E completo: ${passed.length} comprobaciones. Evidencia: ${output}`);
} catch(error) {
  await admin?.screenshot({path:`${output}/fallo.png`,fullPage:true}).catch(()=>{});
  await context.tracing.stop({path:`${output}/trace-fallo.zip`}).catch(()=>{});
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'FAIL',passed,errors,error:String(error)},null,2));
  throw error;
} finally {await browser.close();}
