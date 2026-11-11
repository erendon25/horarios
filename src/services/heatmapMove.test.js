import test from 'node:test';
import assert from 'node:assert/strict';
import { planHeatmapMove } from './heatmapMove.js';
import { placementFingerprint, placementPlanFingerprint } from './coveragePlacement.js';
import { getScheduleBreak } from './scheduleHours.js';

const context = changes => ({ staff: [{ id:'a', name:'Ana', modality:'Full-Time', position:'COLABORADOR', status:'active', workCategory:'multifunctional', studyAvailabilityStatus:'ready', study_schedule:{} }],
  schedules:{a:{monday:{start:'12:15',end:'21:00',breakStart:'16:15',position:'Masa',bukApprovedShiftId:'FT1-17'}}},
  day:'monday',date:'2026-11-02',weekStart:'2026-11-02',requirements:{positions:['Masa','Caja']},
  positionDefinitions:[{name:'Masa',department:'production'},{name:'Caja',department:'service'}],previousWeekSchedules:{a:{}},nextWeekSchedules:{a:{}},...changes });
const request = (ctx, changes) => ({staffId:'a',date:ctx.date,anchorMinute:780,sourcePosition:'Masa',position:'Masa',deltaMinutes:0,
  sourceFingerprint:placementFingerprint(ctx.schedules,'a'),planFingerprint:placementPlanFingerprint(ctx,'a'),...changes});

test('mover desde una celda intermedia conserva jornada y desplaza el break por el mismo delta',()=>{
  const ctx=context(),before=structuredClone(ctx);
  const result=planHeatmapMove(ctx,request(ctx,{deltaMinutes:30,position:'Caja'}));
  assert.equal(result.patch.start,'12:45');assert.equal(result.patch.end,'21:30');assert.equal(result.patch.breakStart,'16:45');
  assert.equal(result.patch.bukApprovedShiftId,'FT1-18');assert.equal(result.patch.position,'Caja');
  assert.equal(result.proposedAssignments[0].position,'Caja');assert.deepEqual(ctx,before);
});
test('no modifica una selección sin desplazamiento ni cambio de puesto',()=>{
  const ctx=context();assert.equal(planHeatmapMove(ctx,request(ctx)).noChange,true);
});
test('un desplazamiento de quince minutos conserva las horas y avisa si sale del catálogo',()=>{
  const ctx=context(),result=planHeatmapMove(ctx,request(ctx,{deltaMinutes:15}));
  assert.equal(result.patch.start,'12:30');assert.equal(result.patch.end,'21:15');assert.equal(result.patch.breakStart,'16:30');
  assert.equal(result.patch.bukApprovedShiftId,'');assert.match(result.warnings.join(' '),/fuera del catálogo/);
  assert.ok(getScheduleBreak(result.patch,'Full-Time'));
});
test('un cambio de puesto base conserva y desplaza las reposiciones',()=>{
  const ctx=context();ctx.schedules.a.monday.positionAssignments=[{start:840,end:900,position:'Caja'}];
  const result=planHeatmapMove(ctx,request(ctx,{deltaMinutes:30,positionScope:'base',position:'Caja'}));
  assert.deepEqual(result.patch.positionAssignments,[{start:870,end:930,position:'Caja'}]);
  assert.equal(result.patch.position,'Caja');
});
test('mover una reposición cambia solo el tramo elegido y conserva el resto del turno',()=>{
  const ctx=context();ctx.schedules.a.monday.positionAssignments=[{start:840,end:900,position:'Caja'}];
  const result=planHeatmapMove(ctx,request(ctx,{anchorMinute:855,sourcePosition:'Caja',position:'Masa'}));
  assert.equal(result.positionScope,'segment');assert.deepEqual(result.patch.positionAssignments,[]);
  assert.equal(result.patch.start,'12:15');assert.equal(result.patch.breakStart,'16:15');
});
test('los turnos partidos conservan ambos tramos, su hueco y las horas extras',()=>{
  const ctx=context();ctx.schedules.a.monday={start:'06:00',end:'10:00',start2:'18:00',end2:'22:00',splitShift:true,position:'Masa',extraHoursPre:.25,extraHoursPost:.5};
  const result=planHeatmapMove(ctx,request(ctx,{anchorMinute:480,deltaMinutes:30}));
  assert.equal(result.patch.start,'06:30');assert.equal(result.patch.end,'10:30');
  assert.equal(result.patch.start2,'18:30');assert.equal(result.patch.end2,'22:30');assert.equal(result.patch.extraHoursPre,.25);
});
test('no permite perder el break de un Part-Time al salir de su catálogo',()=>{
  const ctx=context();ctx.staff[0].modality='Part-Time';
  ctx.schedules.a.monday={start:'06:15',end:'13:00',breakStart:'09:15',position:'Masa',bukApprovedShiftId:'PT3-6'};
  for(const day of ['friday','saturday','sunday'])ctx.schedules.a[day]={off:true};
  assert.ok(getScheduleBreak(ctx.schedules.a.monday,'Part-Time'));
  assert.throws(()=>planHeatmapMove(ctx,request(ctx,{anchorMinute:480,deltaMinutes:15})),/perdería el break/);
});
test('cruces académicos se pintan en la vista previa y bloquean aplicar el movimiento',()=>{
  const ctx=context();ctx.staff[0].study_schedule={monday:{blocks:[{start:'21:00',end:'22:00'}]}};
  const chosen=request(ctx,{deltaMinutes:30});
  const result=planHeatmapMove(ctx,chosen,{preview:true});assert.equal(result.valid,false);
  assert.deepEqual(result.academicIntervals,[{start:1260,end:1290}]);
  assert.throws(()=>planHeatmapMove(ctx,chosen),/estudi|clase|disponib/i);
});
test('rechaza cambios de modalidad, horario, fecha y estudios sin verificar',()=>{
  const ctx=context(),chosen=request(ctx,{deltaMinutes:30});
  ctx.verifiedSchedule={...ctx.schedules.a,tuesday:{off:true}};
  assert.throws(()=>planHeatmapMove(ctx,chosen),/otra sesión/);delete ctx.verifiedSchedule;
  ctx.staff[0].modality='Part-Time';assert.throws(()=>planHeatmapMove(ctx,chosen),/plan semanal/);
  ctx.staff[0].modality='Full-Time';ctx.staff[0].studyAvailabilityStatus='error';assert.throws(()=>planHeatmapMove(ctx,chosen),/disponibilidad/);
  ctx.staff[0].studyAvailabilityStatus='ready';assert.throws(()=>planHeatmapMove(ctx,{...chosen,date:'2026-11-03'}),/fecha/);
});
test('no permite superponer el turno con semanas vecinas ni cambiar el día operativo',()=>{
  const ctx=context();ctx.previousWeekSchedules.a.sunday={start:'23:00',end:'13:00'};
  assert.throws(()=>planHeatmapMove(ctx,request(ctx)),/superpone/);
  ctx.previousWeekSchedules={a:{}};
  assert.throws(()=>planHeatmapMove(ctx,request(ctx,{deltaMinutes:720})),/mismo día/);
  delete ctx.nextWeekSchedules;assert.throws(()=>planHeatmapMove(ctx,request(ctx)),/semanas vecinas/);
});
test('un destino incompatible o una celda que ya no ocupa no producen cambios',()=>{
  const ctx=context();ctx.staff[0].workCategory='production';
  assert.throws(()=>planHeatmapMove(ctx,request(ctx,{position:'Caja'})),/categoría/);
  assert.throws(()=>planHeatmapMove(ctx,request(ctx,{anchorMinute:700})),/celda/);
});
