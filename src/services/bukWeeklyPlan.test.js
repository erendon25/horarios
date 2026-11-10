import test from 'node:test';
import assert from 'node:assert/strict';
import {getBukRestDays, applyBukSchedulePatch, approvedBukShiftLabel, approvedBukShifts, findApprovedBukShiftByStart, makeApprovedBukPatch, getAvailableApprovedBukOptions} from './bukSchedule.js';
import {createScheduleDraft, DRAFT_DAYS} from './scheduleDraft.js';

test('dos descansos reales resuelven los planes diarios históricos de forma uniforme', () => {
  const schedule = {
    monday:{start:'21:00',end:'01:00',bukRestDays:1,bukApprovedShiftId:'PT1-65'},
    tuesday:{start:'20:15',end:'01:00',bukRestDays:2,bukApprovedShiftId:'PT2-33'},
    saturday:{off:true},sunday:{off:true},
  };
  assert.equal(getBukRestDays('Part-Time',schedule),2);
  assert.equal(getBukRestDays('Full-Time',schedule),1);
  assert.equal(findApprovedBukShiftByStart('Part-Time',getBukRestDays('Part-Time',schedule),'20:15').end,'01:00');
});

test('elegir un plan lo aplica a toda la semana sin alterar horarios, posiciones, extras o breaks', () => {
  const schedule={
    monday:{start:'21:00',end:'01:00',position:'Driver',extraHoursPost:1,bukRestDays:1,bukApprovedShiftId:'PT1-65',positionAssignments:[{start:1260,end:1320,position:'Masa'}]},
    tuesday:{start:'06:15',end:'13:00',breakStart:'09:00',bukRestDays:3},
    sunday:{off:true},storeId:'store',weekKey:'2026-10-12_to_2026-10-18',
  };
  const before=structuredClone(schedule);
  const next=applyBukSchedulePatch(schedule,'tuesday',{bukRestDays:2});
  for(const day of DRAFT_DAYS) {
    assert.equal(next[day].bukRestDays,2);
    const {bukRestDays,bukRestDaysBasis,...rest}=next[day];
    assert.equal(bukRestDaysBasis,1,'The explicit target remembers the current rest count');
    const {bukRestDays:old,...original}=schedule[day] || {};
    assert.deepEqual(rest,original,day);
  }
  assert.equal(next.storeId,schedule.storeId);assert.equal(next.weekKey,schedule.weekKey);
  assert.deepEqual(schedule,before,'No mutation of the previous draft');
  const later=applyBukSchedulePatch(next,'thursday',{start:'20:15',end:'01:00'});
  assert.equal(getBukRestDays('Part-Time',later),2);
  assert.equal(getBukRestDays('Part-Time',applyBukSchedulePatch(next,'friday',{bukRestDays:3})),3);
});

test('marcar el segundo descanso actualiza el plan, y preparar un plan no obliga a marcar sus descansos de golpe', () => {
  const schedule={sunday:{off:true},monday:{bukRestDays:1,start:'21:00',end:'01:00'}};
  const two=applyBukSchedulePatch(schedule,'saturday',{off:true});
  assert.equal(getBukRestDays('Part-Time',two),2);
  const one=applyBukSchedulePatch(two,'saturday',{off:false});
  assert.equal(getBukRestDays('Part-Time',one),1);
  let planned=applyBukSchedulePatch({},'monday',{bukRestDays:2});
  planned=applyBukSchedulePatch(planned,'saturday',{off:true});
  assert.equal(getBukRestDays('Part-Time',planned),2,'Preserve the chosen weekly target while assigning rest days');
  planned=applyBukSchedulePatch(planned,'sunday',{off:true});
  assert.equal(getBukRestDays('Part-Time',planned),2);
  assert.equal(getBukRestDays('Part-Time',{}),1);
});

test('el plan semanal sobrevive a borrador, guardado y recarga sin afectar otra persona o semana', () => {
  const values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const scope={userId:'manager',storeId:'store',weekKey:'2026-10-12_to_2026-10-18'};
  const remote={person:{monday:{start:'21:00',end:'01:00'}},other:{monday:{start:'12:00',end:'16:00'}}};
  const draft=createScheduleDraft(scope,()=>storage);draft.hydrate(remote);
  draft.edit(prev=>({...prev,person:applyBukSchedulePatch(prev.person,'monday',{bukRestDays:2})}));
  const restored=createScheduleDraft(scope,()=>storage);restored.hydrate(remote);
  assert.equal(getBukRestDays('Part-Time',restored.getSnapshot().schedules.person),2);
  assert.deepEqual(restored.getSnapshot().schedules.other,remote.other);
  const saved=restored.beginSave();
  assert.deepEqual(Object.keys(saved.schedules),['person']);
  assert.ok(DRAFT_DAYS.every(day=>saved.schedules.person[day].bukRestDays===2));
  restored.acknowledgeSave(saved);
  const reloaded=createScheduleDraft(scope,()=>storage);reloaded.hydrate({...remote,...saved.schedules});
  assert.equal(getBukRestDays('Part-Time',reloaded.getSnapshot().schedules.person),2);
  assert.equal(reloaded.getSnapshot().dirtyStaff.size,0);
  const otherWeek=createScheduleDraft({...scope,weekKey:'2026-10-19_to_2026-10-25'},()=>storage);otherWeek.hydrate(remote);
  assert.equal(getBukRestDays('Part-Time',otherWeek.getSnapshot().schedules.person),1);
});

test('los rangos muestran su duración real al cruzar medianoche y distinguen el refrigerio', () => {
  const option=(group,start,duration)=>approvedBukShifts.find(item=>item.group===group && item.start===start && (!duration || item.duration===duration));
  assert.equal(approvedBukShiftLabel(option('PT2','20:15')),'20:15 → 01:00 · 4 h 45 min (sin break)');
  assert.equal(approvedBukShiftLabel(option('PT1','21:00')),'21:00 → 01:00 · 4 h (sin break)');
  assert.match(approvedBukShiftLabel(option('FT1','06:15')),/8 h 45 min \(8 h netas; break de 45 min\)$/);
  assert.match(approvedBukShiftLabel(approvedBukShifts.find(item=>item.group==='PT3' && item.duration===405)),/6 h 45 min \(6 h netas; break de 45 min\)$/);
});

test('un plan guardado de un descanso no oculta los dos descansos reales al cargar', () => {
  const schedule = Object.fromEntries(DRAFT_DAYS.map(day => [day, { bukRestDays: 1 }]));
  schedule.saturday.off = true;
  schedule.sunday.off = true;
  const before = structuredClone(schedule);
  assert.equal(getBukRestDays('Part-Time', schedule), 2);
  assert.equal(findApprovedBukShiftByStart('Part-Time', getBukRestDays('Part-Time', schedule), '20:15').end, '01:00');
  assert.deepEqual(schedule, before, 'Loading does not rewrite saved shifts');
});

test('un plan desactualizado sigue cada descanso agregado o retirado', () => {
  let schedule = Object.fromEntries(DRAFT_DAYS.map(day => [day, { bukRestDays: 1 }]));
  schedule.saturday.off = true;
  schedule.sunday.off = true;
  for (const [day, off, expected] of [
    ['friday', true, 3], ['thursday', true, 4],
    ['friday', false, 3], ['thursday', false, 2],
    ['saturday', false, 1], ['sunday', false, 1],
  ]) {
    schedule = applyBukSchedulePatch(schedule, day, { off });
    assert.equal(getBukRestDays('Part-Time', schedule), expected, `${day}: ${off}`);
    assert.ok(DRAFT_DAYS.every(key => schedule[key].bukRestDays === expected));
  }
});

test('un plan antiguo mayor que los descansos reales tampoco domina la semana', () => {
  const schedule = Object.fromEntries(DRAFT_DAYS.map(day => [day, { bukRestDays: 4 }]));
  schedule.sunday.off = true;
  assert.equal(getBukRestDays('Part-Time', schedule), 1);
  const next = applyBukSchedulePatch(schedule, 'saturday', { off: true });
  assert.equal(getBukRestDays('Part-Time', next), 2);
  assert.ok(getAvailableApprovedBukOptions('Part-Time', getBukRestDays('Part-Time', next), next, 'monday').every(option => option.group === 'PT2'));
});

test('el objetivo explícito se conserva hasta alcanzarlo, luego cada cambio usa los descansos reales', () => {
  let schedule = applyBukSchedulePatch({}, 'monday', { bukRestDays: 3 });
  schedule = applyBukSchedulePatch(schedule, 'sunday', { off: true });
  const option = approvedBukShifts.find(item => item.group === 'PT3');
  schedule = applyBukSchedulePatch(schedule, 'monday', makeApprovedBukPatch(option.id));
  assert.equal(getBukRestDays('Part-Time', JSON.parse(JSON.stringify(schedule))), 3);
  schedule = applyBukSchedulePatch(schedule, 'saturday', { off: true });
  assert.equal(getBukRestDays('Part-Time', schedule), 3);
  schedule = applyBukSchedulePatch(schedule, 'friday', { off: true });
  assert.ok(DRAFT_DAYS.every(day => !Object.hasOwn(schedule[day], 'bukRestDaysBasis')));
  schedule = applyBukSchedulePatch(schedule, 'friday', { off: false });
  assert.equal(getBukRestDays('Part-Time', schedule), 2);
  schedule = applyBukSchedulePatch(schedule, 'thursday', { bukRestDays: 1 });
  assert.equal(getBukRestDays('Part-Time', schedule), 1, 'An explicitly reduced target can also be prepared');
  schedule = applyBukSchedulePatch(schedule, 'saturday', { off: false });
  assert.equal(getBukRestDays('Part-Time', schedule), 1);
  schedule = applyBukSchedulePatch(schedule, 'saturday', { off: true });
  assert.equal(getBukRestDays('Part-Time', schedule), 2);
});

test('los descansos editados por otro flujo invalidan un objetivo pendiente sin mutar los datos', () => {
  const schedule = applyBukSchedulePatch({}, 'monday', { bukRestDays: 4 });
  schedule.saturday.off = true;
  schedule.sunday.off = true;
  const before = structuredClone(schedule);
  assert.equal(getBukRestDays('Part-Time', schedule), 2);
  assert.deepEqual(schedule, before);
});

test('alejarse de un objetivo pendiente lo cancela y los marcadores incompletos no lo reactivan', () => {
  let schedule = applyBukSchedulePatch({}, 'monday', { bukRestDays: 3 });
  schedule = applyBukSchedulePatch(schedule, 'sunday', { off: true });
  const partial = structuredClone(schedule);
  delete partial.monday.bukRestDaysBasis;
  assert.equal(getBukRestDays('Part-Time', partial), 1);
  partial.monday.bukRestDaysBasis = '1';
  assert.equal(getBukRestDays('Part-Time', partial), 1);
  schedule = applyBukSchedulePatch(schedule, 'sunday', { off: false });
  assert.equal(getBukRestDays('Part-Time', schedule), 1);
  assert.ok(DRAFT_DAYS.every(day => !Object.hasOwn(schedule[day], 'bukRestDaysBasis')));
});

test('reemplazar un descanso con turno o feriado no mantiene el plan anterior de su parche', () => {
  for (const holiday of [false, true]) {
    const schedule = { saturday: { off: true }, sunday: { off: true } };
    const option = approvedBukShifts.find(item => item.group === 'PT2');
    const next = applyBukSchedulePatch(schedule, 'saturday', { ...makeApprovedBukPatch(option.id), feriado: holiday });
    assert.equal(getBukRestDays('Part-Time', next), 1);
    assert.ok(DRAFT_DAYS.every(day => next[day].bukRestDays === 1));
    assert.equal(next.saturday.feriado, holiday);
    assert.equal(next.sunday.off, true);
  }
});
