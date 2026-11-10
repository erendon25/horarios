import test from 'node:test';
import assert from 'node:assert/strict';
import { canLimitPositionCoverage, getHeatmapAssignments, getPositionTimeline } from './scheduleExportData.js';
import { replacePositionInterval, validatePositionRange } from './heatmapTransfers.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { createScheduleDraft } from './scheduleDraft.js';
import { calculateScheduleTotals } from './scheduleHours.js';

const requirements={positions:['Salón','Cocina'],matrix:[Array(21).fill(1),Array(21).fill(1)]};
const base={start:'09:00',end:'18:00',position:'Salón',breakStart:'13:00'};
const range={start:660,end:780,position:'Salón'};
const staff=role=>[{id:'a',name:'Ana',position:role,modality:'Full-Time'}];
const assignments=(shift,role='GERENTE')=>getHeatmapAssignments(staff(role),{a:{monday:shift}},'monday',requirements.positions,'2026-10-05');
const color=(shift,time,role='GERENTE')=>buildHeatmapRows(assignments(shift,role),requirements).find(row=>row.name==='Salón').cells[HOURS.indexOf(time)].color;

test('gerente, asistente y trainer pueden limitar cobertura sin cambiar la clasificación del personal',()=>{
  for(const role of ['GERENTE','ASISTENTE','ENTRENADOR','TRAINER'])assert.equal(canLimitPositionCoverage({position:role}),true);
  assert.equal(canLimitPositionCoverage({position:'COLABORADOR'}),false);
});
test('un rango del mismo puesto base solo cubre ese intervalo, con fin exclusivo',()=>{
  const shift={...base,positionRangesOnly:true};
  shift.positionAssignments=replacePositionInterval(shift,range);
  assert.equal(shift.positionAssignments.length,1);
  assert.equal(color(shift,'10:45'),'bg-yellow-300');
  assert.equal(color(shift,'11:00'),'bg-blue-500');
  assert.equal(color(shift,'12:45'),'bg-blue-500');
  assert.equal(color(shift,'13:00'),'bg-yellow-300');
  assert.equal(color(shift,'17:00'),'bg-yellow-300');
  assert.deepEqual(calculateScheduleTotals({monday:shift},'Full-Time'),calculateScheduleTotals({monday:base},'Full-Time'));
});
test('trainer pinta solo el rango en naranja y respeta el descanso',()=>{
  const shift={...base,positionRangesOnly:true,positionAssignments:[{start:720,end:900,position:'Salón'}]};
  assert.equal(color(shift,'12:00','ENTRENADOR'),'bg-orange-500');
  assert.equal(color(shift,'13:00','ENTRENADOR'),'bg-yellow-300');
  assert.equal(color(shift,'13:30','ENTRENADOR'),'bg-yellow-300');
  assert.equal(color(shift,'13:45','ENTRENADOR'),'bg-orange-500');
  assert.equal(color(shift,'15:00','ENTRENADOR'),'bg-yellow-300');
});
test('admite varios puestos y quitar un rango no restaura cobertura fuera de rangos',()=>{
  let shift={...base,positionRangesOnly:true};
  shift.positionAssignments=replacePositionInterval(shift,range);
  shift.positionAssignments=replacePositionInterval(shift,{start:720,end:750,position:'Cocina'});
  assert.equal(assignments(shift).find(item=>item.start==='12:00').position,'Cocina');
  shift.positionAssignments=replacePositionInterval(shift,{start:660,end:780,position:''});
  assert.equal(assignments(shift).length,0);
  assert.equal(getPositionTimeline(shift,'Full-Time').every(item=>!item.position),true);
  assert.equal(color({...shift,positionRangesOnly:false},'11:00'),'bg-blue-500');
});
test('valida rangos y turnos partidos/nocturnos sin cubrir huecos',()=>{
  assert.equal(validatePositionRange(base,requirements.positions,range),'');
  assert.ok(validatePositionRange(base,requirements.positions,{...range,start:661}));
  assert.ok(validatePositionRange(base,requirements.positions,{...range,start:480}));
  assert.ok(validatePositionRange(base,requirements.positions,{...range,position:'Otro'}));
  const split={start:'09:00',end:'12:00',splitShift:true,start2:'16:00',end2:'20:00',positionRangesOnly:true};
  assert.ok(validatePositionRange(split,requirements.positions,{...range,end:1020}));
  assert.equal(validatePositionRange(split,requirements.positions,{...range,start:960,end:1080}),'');
  const night={start:'20:00',end:'01:00',positionRangesOnly:true,positionAssignments:[{start:1440,end:1500,position:'Salón'}]};
  assert.equal(color(night,'23:45'),'bg-yellow-300');
  assert.equal(color(night,'24:00'),'bg-blue-500');
  assert.equal(color(night,'25:00'),'bg-blue-500');
});

test('el guardado del borrador conserva el modo por rangos y sus intervalos',()=>{
  const values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const scope={userId:'admin',storeId:'store',weekKey:'2026-10-05_to_2026-10-11'};
  const server={a:{monday:base}};
  const draft=createScheduleDraft(scope,()=>storage);draft.hydrate(server);
  const shift={...base,positionRangesOnly:true};shift.positionAssignments=replacePositionInterval(shift,range);
  draft.edit(previous=>({...previous,a:{monday:shift}}));
  const reloaded=createScheduleDraft(scope,()=>storage);reloaded.hydrate(server);
  assert.equal(reloaded.getSnapshot().schedules.a.monday.positionRangesOnly,true);
  const saved=reloaded.beginSave();reloaded.acknowledgeSave(saved);
  assert.equal(color(reloaded.getSnapshot().schedules.a.monday,'10:45'),'bg-yellow-300');
  assert.equal(color(reloaded.getSnapshot().schedules.a.monday,'11:00'),'bg-blue-500');
});

test('turno completo y reasignación hasta la salida conservan la marca final sin duplicar relevos',()=>{
  const plain={...base,end:'17:45'};
  const reassigned={...plain,positionAssignments:[{start:975,end:1065,position:'Cocina'}]};
  const plainRows=buildHeatmapRows(assignments(plain),requirements);
  const movedRows=buildHeatmapRows(assignments(reassigned),requirements);
  const cell=(rows,position,time)=>rows.find(row=>row.name===position).cells[HOURS.indexOf(time)];
  assert.equal(cell(plainRows,'Salón','17:30').color,'bg-blue-500');
  assert.equal(cell(plainRows,'Salón','17:45').color,'bg-blue-500');
  assert.equal(cell(movedRows,'Cocina','17:30').color,'bg-blue-500');
  assert.equal(cell(movedRows,'Cocina','17:45').color,'bg-blue-500');
  const night={start:'20:00',end:'01:00',position:'Salón'};
  assert.equal(color(night,'24:45'),'bg-blue-500');assert.equal(color(night,'25:00'),'bg-blue-500');
  const relays=getHeatmapAssignments([{id:'a',modality:'Part-Time'},{id:'b',modality:'Part-Time'}],{
    a:{monday:{start:'09:00',end:'12:00',position:'Salón'}},b:{monday:{start:'12:00',end:'16:00',position:'Salón'}},
  },'monday',requirements.positions,'2026-10-05');
  assert.equal(buildHeatmapRows(relays,requirements).find(row=>row.name==='Salón').cells[HOURS.indexOf('12:00')].color,'bg-blue-500');
  assert.equal(buildHeatmapRows(relays,requirements).filter(row=>row.name==='Salón').length,1);
});


test('trainer hasta 01:00 pinta 25:00, con puesto base o con rango hasta su salida',()=>{
  const shift={start:'16:15',end:'01:00',position:'Salón'};
  const ranged={...shift,positionRangesOnly:true,positionAssignments:[{start:975,end:1500,position:'Salón'}]};
  for (const schedule of [shift,ranged]) {
    assert.equal(color(schedule,'16:15','ENTRENADOR'),'bg-orange-500');
    assert.equal(color(schedule,'24:45','ENTRENADOR'),'bg-orange-500');
    assert.equal(color(schedule,'25:00','ENTRENADOR'),'bg-orange-500');
    assert.deepEqual(calculateScheduleTotals({monday:schedule},'Full-Time'),calculateScheduleTotals({monday:shift},'Full-Time'));
  }
});
