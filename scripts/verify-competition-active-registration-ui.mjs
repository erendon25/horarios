// Isolated React + real PostgreSQL flow, with separate collaborator identities.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=`http://127.0.0.1:${process.env.COMPETITION_QA_PORT || 4194}`;
const output='output/active-registration-e2e';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const errors=[];
try {
  const admin=await browser.newPage({viewport:{width:1440,height:1000}});
  const mobile=await browser.newPage({viewport:{width:390,height:844}});
  const desktop=await browser.newPage({viewport:{width:1280,height:900}});
  for(const page of [admin,mobile,desktop]) {
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  }
  const api=async body=>{
    const result=await (await admin.request.post(`${base}/api`,{data:{...body,role:'admin'}})).json();
    assert.equal(result.error,null,JSON.stringify(result.error));return result.data;
  };
  const read=(table,filters={})=>api({table,filters,columns:'*',orders:['id'],start:0,end:999});
  await admin.goto(`${base}/concurso`);
  await admin.getByRole('heading',{name:'Dashboard del concurso'}).waitFor();
  const id=await admin.getByRole('combobox',{name:'Concurso',exact:true}).inputValue();
  const card=(page,name)=>page.locator('section.card').filter({has:page.getByRole('heading',{name,exact:true})});
  const register=async(page,name)=>{
    await card(page,name).getByRole('button',{name:'Inscribirme',exact:true}).click();
    await card(page,name).getByText('Inscrito ·',{exact:false}).waitFor();
  };
  for(const [page,role] of [[mobile,'collaborator'],[desktop,'rival']]) {
    await page.goto(`${base}/concurso?role=${role}&id=${id}`);
    await page.getByRole('button',{name:'Inscripción',exact:true}).click();
    await register(page,'Landing');
  }
  await admin.getByRole('button',{name:'Configuración',exact:true}).click();
  await admin.getByRole('button',{name:'Activar concurso',exact:true}).click();
  await admin.getByRole('button',{name:'Volver a preparación',exact:true}).waitFor();
  const contest=(await read('competitions',{id}))[0];
  const landing=(await read('competition_areas',{competition_id:id,name:'Landing'}))[0];
  const initial=await read('competition_entries',{competition_id:id});
  const pending=await api({rpc:'competition_command',args:{p_competition_id:id,p_action:'prepare',p_payload:{entry_id:initial[0].id}}});
  const evaluationBefore=await read('competition_evaluations',{id:pending.id});
  for(const page of [mobile,desktop]) {
    await page.reload();
    await page.getByRole('button',{name:'Inscripción',exact:true}).click();
    await page.getByText('El concurso está activo.',{exact:false}).waitFor();
    await register(page,'Sheetout');
    assert.equal(await page.getByRole('button',{name:'Retirar mi inscripción'}).count(),0);
    for(const button of await page.getByRole('button',{name:'Inscribirme',exact:true}).all()) assert.equal(await button.isDisabled(),true);
  }
  const sheetout=(await read('competition_areas',{competition_id:id,name:'Sheetout'}))[0];
  const added=await read('competition_entries',{competition_id:id,area_id:sheetout.id});
  assert.deepEqual(added.map(e=>e.seed_order).sort(),[1,2]);
  assert.ok(added.every(e=>e.draw_group===1));
  assert.deepEqual(await read('competition_entries',{competition_id:id,area_id:landing.id}),initial);
  assert.deepEqual(await read('competition_evaluations',{id:pending.id}),evaluationBefore);
  assert.equal((await read('competitions',{id}))[0].drawn_at,contest.drawn_at);
  await mobile.screenshot({path:`${output}/inscripcion-mobile.png`,fullPage:true});
  await desktop.screenshot({path:`${output}/inscripcion-desktop.png`,fullPage:true});
  await mobile.reload();
  await mobile.getByRole('button',{name:'Fixture',exact:true}).click();
  await mobile.getByRole('combobox',{name:'Área del fixture',exact:true}).selectOption({label:'Sheetout'});
  await mobile.getByRole('heading',{name:'Cruces y orden sorteado',exact:true}).waitFor();
  await mobile.getByText('Colaboradora Demo',{exact:true}).first().waitFor();
  await mobile.getByText('Rival Demo',{exact:true}).first().waitFor();
  await admin.getByRole('button',{name:'Evaluar',exact:true}).click();
  await admin.getByRole('combobox',{name:'Área',exact:true}).selectOption({label:'Sheetout'});
  await admin.getByRole('combobox',{name:'Colaborador',exact:true}).selectOption({label:'Colaboradora Demo · Equipo 1'});
  await admin.getByRole('button',{name:'Abrir evaluación',exact:true}).click();
  await admin.getByRole('button',{name:'INICIAR',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/resultado.json`,JSON.stringify({status:'PASS',checks:['Inscripción durante concurso activo en móvil y escritorio','Máximo dos áreas y retiro bloqueado','Fixture persistente tras recargar','Orden anterior, sorteo y evaluación pendiente intactos','Nuevos inscritos disponibles para evaluar'],errors,scope:'React y PostgreSQL reales, autenticación/transporte aislados de producción'},null,2));
  console.log('PASS: inscripción con concurso activo en móvil/escritorio, límite dos, fixture persistente, evaluación nueva disponible y resultados anteriores intactos; sin errores de consola.');
} finally {await browser.close();}
