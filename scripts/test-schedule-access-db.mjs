// Real RLS/RPC regression, with fake staff/Auth and a local PGlite database only.
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createScheduleAccessTestDb,asScheduleActor } from './schedule-access-test-db.mjs';

const {db,staff,ids}=await createScheduleAccessTestDb();
const passed=[];
const migration=process.env.SCHEDULE_ACCESS_MIGRATION||'supabase/migrations/20261025055140_store_schedule_access_controls.sql';
const defaults={adminOnlyStudyEditing:false,requestsEnabled:true,blockedWeeks:[],blockedDates:[]};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const as=(actor,operation)=>asScheduleActor(db,actor,operation);
const check=async(name,operation)=>{await operation();passed.push(name);console.log(`PASS: ${name}`);};
const config=(value,store=ids.storeA,actor=ids.admin)=>as(actor,()=>db.query("insert into store_configs(store_id,config_key,value) values($1,'schedule_access',$2::jsonb) on conflict(store_id,config_key) do update set value=excluded.value",[store,JSON.stringify(value)]));
const setLegacyLock=enabled=>as(ids.admin,()=>db.query("insert into store_configs(store_id,config_key,value) values($1,'schedule_lock',$2::jsonb) on conflict(store_id,config_key) do update set value=excluded.value",[ids.storeA,JSON.stringify({restrictionsEnabled:enabled,reenableDate:'2099-12-31'})]));
const readConfig=store=>as(ids.superadmin,()=>scalar('select private.read_schedule_access($1)',[store]));
const mergeConfig=(original,draft,store=ids.storeA,actor=ids.admin)=>as(actor,()=>scalar('select public.update_schedule_access($1,$2::jsonb,$3::jsonb)',[store,JSON.stringify(original),JSON.stringify(draft)]));
const study=(staffId=staff.own,actor=ids.collaborator,values={monday:{blocks:[{start:'18:00',end:'20:00'}]}})=>as(actor,()=>db.query('select public.save_study_schedule($1,$2::jsonb)',[staffId,JSON.stringify(values)]));
const request=(date='2026-10-26',staffId=staff.own,actor=ids.collaborator,store=ids.storeA,start='08:00',end='12:00')=>as(actor,()=>scalar(`insert into schedule_requests(staff_id,user_id,store_id,requested_date,shift_type,start_time,end_time,reason)
  values($1,$2,$3,$4,'rango',$5,$6,'Prueba aislada') returning id`,[staffId,actor,store,date,start,end]));
const review=(id,status='approved',actor=ids.admin)=>as(actor,()=>db.query('update schedule_requests set status=$2,reviewed_by=$3,reviewed_at=now() where id=$1 returning id,status',[id,status,actor]));
// Intentionally omit client-side status/user/store filters: RLS must enforce them.
const remove=(id,actor=ids.collaborator)=>as(actor,()=>db.query('delete from schedule_requests where id=$1 returning id',[id]));
const studySnapshot=async(staffId=staff.own)=>({
  days:(await db.query('select * from study_schedule_days where staff_id=$1 order by weekday',[staffId])).rows,
  blocks:(await db.query('select block.* from study_schedule_blocks block join study_schedule_days day on day.id=block.study_day_id where day.staff_id=$1 order by block.id',[staffId])).rows,
});
const resetClaim=async()=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");};

try{
  const originalStudyWriter=await scalar("select pg_get_functiondef('private.replace_study_schedule(uuid,jsonb)'::regprocedure)");
  await db.exec(await readFile(migration,'utf8'));

  await check('documento ausente conserva acceso anterior; nuevos helpers no añaden SECURITY DEFINER',async()=>{
    assert.deepEqual(await readConfig(ids.storeA),defaults);
    await study();
    assert.ok(await request());
    const helpers=(await db.query("select proname,prosecdef from pg_proc join pg_namespace ns on ns.oid=pronamespace where ns.nspname='private' and proname in ('schedule_access_config_valid','read_schedule_access','validate_schedule_access_config','enforce_study_access_policy','enforce_request_access_policy')")).rows;
    assert.equal(helpers.length,5);assert.equal(helpers.every(item=>item.prosecdef===false),true);
    assert.equal(await scalar("select pg_get_functiondef('private.replace_study_schedule(uuid,jsonb)'::regprocedure)"),originalStudyWriter);
  });

  await check('configuración presente exige cuatro campos estrictos, fechas reales y lunes; metadata adicional permitida',async()=>{
    await config({...defaults,updatedAt:'metadata permitida'});
    const bad=[null,{},[],{...defaults,adminOnlyStudyEditing:'false'},{...defaults,requestsEnabled:null},
      {...defaults,blockedDates:'2026-10-26'},{...defaults,blockedDates:[null]},
      {...defaults,blockedDates:['2026-02-30']},{...defaults,blockedDates:['2026-2-01']},
      {...defaults,blockedDates:['0000-01-01']},{...defaults,blockedWeeks:['2026-10-27']},
      {...defaults,blockedWeeks:['2026-02-30']}];
    const before=await readConfig(ids.storeA);
    for(const value of bad){
      assert.equal(await scalar('select private.schedule_access_config_valid($1::jsonb)',[JSON.stringify(value)]),false);
      await assert.rejects(()=>config(value),/Configuración de acceso no válida/);
      assert.deepEqual(await readConfig(ids.storeA),before);
    }
    assert.equal(await scalar('select private.schedule_access_config_valid($1::jsonb)',[JSON.stringify({...defaults,blockedDates:['2028-02-29'],blockedWeeks:['2026-10-26']})]),true);
    await config(defaults);
  });

  await check('solo administradores activos de la tienda o superadmin pueden guardar su configuración',async()=>{
    await config(defaults,ids.storeB,ids.otherAdmin);
    for(const [actor,store] of [[ids.collaborator,ids.storeA],[ids.inactiveAdmin,ids.storeA],[ids.admin,ids.storeB]]){
      await assert.rejects(()=>config({...defaults,requestsEnabled:false},store,actor),/permiso|row-level security/);
    }
    assert.deepEqual(await readConfig(ids.storeA),defaults);assert.deepEqual(await readConfig(ids.storeB),defaults);
    await assert.rejects(()=>request('2026-10-26',staff.other,ids.collaborator,ids.storeB),/row-level security/);
    await db.query("update user_profiles set status='inactive' where id=$1",[ids.collaborator]);
    await assert.rejects(()=>request(),/sin acceso|row-level security/);
    await db.query("update user_profiles set status='active' where id=$1",[ids.collaborator]);
    await config({...defaults,adminOnlyStudyEditing:true},ids.storeB,ids.superadmin);
    assert.equal((await readConfig(ids.storeB)).adminOnlyStudyEditing,true);
    await config(defaults,ids.storeB,ids.superadmin);
  });

  await check('RPC serializa cambios de dos administradores con la misma lectura anterior sin perder fechas, semanas ni otros flags',async()=>{
    const original={...defaults,blockedDates:['2026-10-28'],blockedWeeks:['2026-10-26'],extra:{owner:'preservar'},updatedAt:'metadata existente'};
    await config(original);
    const first={...original,adminOnlyStudyEditing:true,blockedDates:['2026-11-04','2026-10-28'],blockedWeeks:['2026-11-02','2026-10-26']};
    await mergeConfig(original,first,ids.storeA,ids.admin);
    // Both forms read original before either saved. The second RPC must merge
    // only its intent, rather than replace the first administrator's additions.
    const second={...original,requestsEnabled:false,blockedDates:['2026-10-28','2026-11-05','2026-11-05'],blockedWeeks:['2026-10-26','2026-11-09']};
    const merged=await mergeConfig(original,second,ids.storeA,ids.secondAdmin);
    assert.deepEqual(merged.blockedDates,['2026-10-28','2026-11-04','2026-11-05']);
    assert.deepEqual(merged.blockedWeeks,['2026-10-26','2026-11-02','2026-11-09']);
    assert.equal(merged.adminOnlyStudyEditing,true);assert.equal(merged.requestsEnabled,false);
    assert.deepEqual(merged.extra,{owner:'preservar'});assert.equal(merged.updatedAt,'metadata existente');
    const removed=await mergeConfig(original,{...original,blockedDates:[]},ids.storeA,ids.secondAdmin);
    assert.deepEqual(removed.blockedDates,['2026-11-04','2026-11-05']);
    assert.deepEqual(removed.blockedWeeks,merged.blockedWeeks);
    assert.equal(removed.adminOnlyStudyEditing,true);assert.equal(removed.requestsEnabled,false);
    assert.deepEqual(await readConfig(ids.storeA),removed);
    await config(defaults);
  });

  await check('RPC sin cambios no modifica metadata, timestamps ni otros documentos; creación ausente usa defaults y scope sigue estricto',async()=>{
    const current={...defaults,extra:{version:1},updatedAt:'conservar'};
    await config(current);
    const before=(await db.query('select * from store_configs order by id')).rows;
    assert.deepEqual(await mergeConfig(current,{...current,extra:{version:999},updatedAt:'ignorar',untrustedExtra:'ignorar'}),current);
    assert.deepEqual((await db.query('select * from store_configs order by id')).rows,before);
    for(const actor of [ids.collaborator,ids.trainer,ids.inactiveAdmin,ids.otherAdmin]){
      await assert.rejects(()=>mergeConfig(current,{...current,requestsEnabled:false},ids.storeA,actor),/permiso para cambiar/);
    }
    await assert.rejects(()=>mergeConfig({},defaults),/Configuración de acceso no válida/);
    await assert.rejects(()=>mergeConfig(defaults,{...defaults,blockedWeeks:['2026-10-27']}),/Configuración de acceso no válida/);
    assert.deepEqual((await db.query('select * from store_configs order by id')).rows,before);
    await assert.rejects(()=>mergeConfig(null,defaults,ids.storeC,ids.superadmin),/Configuración de acceso no válida/);
    assert.equal(await scalar("select count(*)::int from store_configs where store_id=$1 and config_key='schedule_access'",[ids.storeC]),0);
    const created=await mergeConfig(defaults,{...defaults,requestsEnabled:false,extra:'no copiar del cliente'},ids.storeC,ids.superadmin);
    assert.deepEqual(created,{...defaults,requestsEnabled:false});
    assert.equal(await scalar("select prosecdef from pg_proc join pg_namespace ns on ns.oid=pronamespace where ns.nspname='public' and proname='update_schedule_access'"),false);
    assert.equal(await scalar("select has_function_privilege('anon','public.update_schedule_access(uuid,jsonb,jsonb)','EXECUTE')"),false);
    await config(defaults);
  });

  await check('activar solo-admin conserva estudios; RPC con pantalla desactualizada se bloquea y desactivar restaura edición',async()=>{
    const before=await studySnapshot();
    await config({...defaults,adminOnlyStudyEditing:true});
    assert.deepEqual(await studySnapshot(),before);
    await assert.rejects(()=>study(staff.own,ids.collaborator,{monday:{blocks:[{start:'09:00',end:'11:00'}]}}),/solo para administradores/);
    assert.deepEqual(await studySnapshot(),before);
    // Other stores remain open and do not inherit this store's flag.
    await study(staff.other,ids.otherCollaborator);
    await config(defaults);
    await study();assert.equal((await studySnapshot()).blocks[0].start_time,'18:00:00');
  });

  await check('admin propia tienda y superadmin editan siempre; administradores ajenos y API directa del colaborador siguen restringidos',async()=>{
    await config({...defaults,adminOnlyStudyEditing:true,requestsEnabled:false});
    await study(staff.own,ids.admin,{monday:{blocks:[{start:'19:00',end:'21:00'}]}});
    await study(staff.own,ids.superadmin,{monday:{blocks:[{start:'18:00',end:'20:00'}]}});
    const before=await studySnapshot();
    await assert.rejects(()=>study(staff.own,ids.otherAdmin),/permiso|Colaborador no encontrado/);
    assert.deepEqual(await studySnapshot(),before);
    const id=before.days[0].id;
    try{
      const direct=await as(ids.collaborator,()=>db.query('update study_schedule_days set requests_day_off=true where id=$1 returning id',[id]));
      // UPDATE USING can hide the row before a trigger runs.
      assert.deepEqual(direct.rows,[]);
    }catch(error){assert.match(error.message,/solo para administradores/);}
    assert.deepEqual(await studySnapshot(),before);
    await config(defaults);
    const direct=await as(ids.collaborator,()=>db.query('update study_schedule_days set requests_day_off=true where id=$1 returning id',[id]));
    assert.deepEqual(direct.rows,[]);
  });

  await check('carnet vencido y bloqueo anterior mantienen su protección; admin conserva corrección autorizada',async()=>{
    await db.query("update staff_profiles set sanitary_card_expiry='2020-01-01',sanitary_card_unlock=false where id=$1",[staff.own]);
    await assert.rejects(()=>study(),/Carnet sanitario vencido/);
    await study(staff.own,ids.admin);
    await db.query('update staff_profiles set sanitary_card_expiry=null where id=$1',[staff.own]);
    await setLegacyLock(true);
    assert.equal((await scalar("select with_check from pg_policies where schemaname='public' and tablename='schedule_requests' and policyname='schedule_requests_create'")).includes('schedule_changes_locked'),false);
    await assert.rejects(()=>study(),/temporalmente bloqueados/);
    await assert.rejects(()=>request(),/temporalmente bloqueados/);
    await study(staff.own,ids.admin);
    await setLegacyLock(false);
  });

  await check('deshabilitar solicitudes solo impide nuevas; pendientes y revisiones ya enviadas se conservan',async()=>{
    const pending=await request(),otherPending=await request('2026-10-27');
    const before=await scalar('select count(*)::int from schedule_requests');
    await config({...defaults,requestsEnabled:false});
    await assert.rejects(()=>request(),/deshabilitadas/);
    assert.equal(await scalar('select count(*)::int from schedule_requests'),before);
    assert.equal((await review(pending)).rows[0].status,'approved');
    assert.equal((await review(otherPending,'rejected')).rows[0].status,'rejected');
    await request('2026-10-26',staff.other,ids.otherCollaborator,ids.storeB);
    await config(defaults);
  });

  await check('bloqueo por fecha y semana usa calendario lunes-domingo y no afecta otra tienda ni semana',async()=>{
    const earlier=await request('2026-10-28');
    await config({...defaults,blockedDates:['2026-10-28']});
    await assert.rejects(()=>request('2026-10-28'),/fecha seleccionada/);
    assert.ok(await request('2026-10-27'));
    assert.equal((await review(earlier)).rows[0].status,'approved');
    await config({...defaults,blockedWeeks:['2026-10-26']});
    for(const date of ['2026-10-26','2026-10-28','2026-11-01'])await assert.rejects(()=>request(date),/semana seleccionada/);
    assert.ok(await request('2026-10-25'));assert.ok(await request('2026-11-02'));
    assert.ok(await request('2026-10-28',staff.other,ids.otherCollaborator,ids.storeB));
    await config(defaults);
  });

  await check('disponibilidad de estudios sigue validándose después de permitir nuevas solicitudes',async()=>{
    await study();
    await assert.rejects(()=>request('2026-10-26',staff.own,ids.collaborator,ids.storeA,'18:30','21:00'),/horario de estudio/);
    const stale=await request('2026-10-27');
    await study(staff.own,ids.admin,{tuesday:{blocks:[{start:'10:00',end:'14:00'}]}});
    await assert.rejects(()=>review(stale),/horario de estudio/);
    assert.equal((await review(stale,'rejected')).rows[0].status,'rejected');
    await study(staff.own,ids.admin,{});
  });

  await check('colaborador elimina solo pendientes propias sin depender del bloqueo, carnet o filtros de la interfaz',async()=>{
    const own=await request(),otherOwn=await request('2026-10-27');
    const other=await request('2026-10-26',staff.trainer,ids.trainer);
    const foreign=await request('2026-10-26',staff.other,ids.otherCollaborator,ids.storeB);
    await config({...defaults,requestsEnabled:false,blockedWeeks:['2026-10-26']});
    await setLegacyLock(true);
    await db.query("update staff_profiles set sanitary_card_expiry='2020-01-01' where id=$1",[staff.own]);
    assert.deepEqual((await remove(other)).rows,[]);assert.deepEqual((await remove(foreign)).rows,[]);
    assert.deepEqual((await remove(own)).rows,[{id:own}]);
    assert.equal(await scalar('select count(*)::int from schedule_requests where id=$1',[own]),0);
    assert.deepEqual((await remove(other,ids.trainer)).rows,[{id:other}]);
    await db.query("update user_profiles set status='inactive' where id=$1",[ids.collaborator]);
    assert.deepEqual((await remove(otherOwn)).rows,[]);
    await db.query("update user_profiles set status='active' where id=$1",[ids.collaborator]);
    assert.deepEqual((await remove(otherOwn)).rows,[{id:otherOwn}]);
    await setLegacyLock(false);await config(defaults);
    await db.query('update staff_profiles set sanitary_card_expiry=null where id=$1',[staff.own]);
  });

  await check('aprobadas/rechazadas/revisadas se preservan y carrera aprobar-antes-de-borrar devuelve cero',async()=>{
    const approved=await request(),rejected=await request(),reviewedPending=await request();
    await review(approved);await review(rejected,'rejected');
    await as(ids.admin,()=>db.query('update schedule_requests set reviewed_by=$2,reviewed_at=now() where id=$1',[reviewedPending,ids.admin]));
    for(const id of [approved,rejected,reviewedPending]){
      assert.deepEqual((await remove(id)).rows,[]);
      assert.equal(await scalar('select count(*)::int from schedule_requests where id=$1',[id]),1);
    }
    const raced=await request();await review(raced);assert.deepEqual((await remove(raced)).rows,[]);
    assert.equal(await scalar('select status from schedule_requests where id=$1',[raced]),'approved');
    const unlinked=await request();
    await db.query('update user_profiles set staff_profile_id=null where id=$1',[ids.collaborator]);
    assert.deepEqual((await remove(unlinked)).rows,[]);
    await db.query('update user_profiles set staff_profile_id=$2 where id=$1',[ids.collaborator,staff.own]);
    assert.deepEqual((await remove(unlinked)).rows,[{id:unlinked}]);
    // Administrative deletion keeps its existing own-store/global scope.
    assert.deepEqual((await remove(approved,ids.otherAdmin)).rows,[]);
    assert.deepEqual((await remove(approved,ids.admin)).rows,[{id:approved}]);
    assert.deepEqual((await remove(rejected,ids.superadmin)).rows,[{id:rejected}]);
  });

  await check('documento corrupto existente falla cerrado sin impedir correcciones administrativas ni borrar historial',async()=>{
    const pending=await request();const before=await studySnapshot();
    await resetClaim();
    await db.exec('alter table store_configs disable trigger store_configs_validate_schedule_access');
    await db.query("update store_configs set value='{}'::jsonb where store_id=$1 and config_key='schedule_access'",[ids.storeA]);
    await db.exec('alter table store_configs enable trigger store_configs_validate_schedule_access');
    await assert.rejects(()=>request(),/configuración de acceso.*no es válida/);
    await assert.rejects(()=>study(),/configuración de acceso.*no es válida/);
    await assert.rejects(()=>mergeConfig(defaults,{...defaults,requestsEnabled:false}),/configuración de acceso.*no es válida/);
    assert.deepEqual(await studySnapshot(),before);
    await study(staff.own,ids.admin,{});
    assert.equal((await review(pending)).rows[0].status,'approved');
    await config(defaults);
  });

  await check('cascadas administrativas/mantenimiento siguen funcionando y cascada sin padre no omite el guard del colaborador',async()=>{
    await study();const before=await studySnapshot();const dayId=before.days[0].id;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.collaborator]);
    await assert.rejects(()=>db.query('delete from study_schedule_days where id=$1',[dayId]),/permiso para editar/);
    assert.deepEqual(await studySnapshot(),before);
    const removed=await as(ids.admin,()=>db.query('delete from study_schedule_days where id=$1 returning id',[dayId]));
    assert.deepEqual(removed.rows,[{id:dayId}]);
    assert.equal(await scalar('select count(*)::int from study_schedule_blocks where study_day_id=$1',[dayId]),0);
    await study();await resetClaim();
    await db.query('delete from study_schedule_days where staff_id=$1',[staff.own]);
    assert.equal((await studySnapshot()).days.length,0);
  });

  const output=new URL('../output/schedule-access-qa/',import.meta.url);await mkdir(output,{recursive:true});
  await writeFile(new URL('db-result.json',output),JSON.stringify({status:'PASS',passed,migration,scope:'PGlite only; real prior schema/RLS/study/weekly/availability RPCs; no remote DDL/DML or production access.'},null,2)+'\n');
}finally{await db.close();}
