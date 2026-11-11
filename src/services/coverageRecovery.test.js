import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleDraft } from './scheduleDraft.js';
import { coverageInsights, coveragePeopleAt, cellOccupants, workCategory } from './coverageInsights.js';
import { planCoveragePlacement, placementFingerprint, placementPlanFingerprint, placementPreviewAssignments } from './coveragePlacement.js';
import { calculateScheduleDay } from './scheduleHours.js';
import { planHeatmapTransfer } from './heatmapTransfers.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { getHeatmapCoverageCandidates } from './heatmapCoverageCandidates.js';
import { makeApprovedBukPatch, getAvailableApprovedBukOptions } from './bukSchedule.js';
const memory = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
};
const draft = () => {
  const controller = createScheduleDraft({
    userId: 'admin',
    storeId: 'store',
    weekKey: 'week'
  }, memory);
  controller.hydrate({
    a: {
      tuesday: {
        start: '12:00',
        end: '16:00'
      }
    }
  });
  return controller;
};
test('deshacer y rehacer recuperan un turno completo y persisten sin escribir al servidor', () => {
  const controller = draft();
  controller.edit(previous => ({
    ...previous,
    a: {
      tuesday: {
        off: true,
        start: '',
        end: ''
      }
    }
  }));
  assert.equal(controller.getSnapshot().canUndo, true);
  assert.equal(controller.undo(), true);
  assert.equal(controller.getSnapshot().schedules.a.tuesday.start, '12:00');
  assert.equal(controller.getSnapshot().dirtyStaff.size, 0);
  assert.equal(controller.redo(), true);
  assert.equal(controller.getSnapshot().schedules.a.tuesday.off, true);
  controller.undo();
  controller.edit(previous => ({
    ...previous,
    a: {
      tuesday: {
        start: '14:00',
        end: '18:00'
      }
    }
  }));
  assert.equal(controller.redo(), false);
});
test('historial agrupado y guardado establecen límites coherentes', () => {
  const controller = draft();
  controller.beginHistoryGroup();
  for (const start of ['12:15', '12:30', '12:45']) controller.edit(previous => ({
    ...previous,
    a: {
      tuesday: {
        ...previous.a.tuesday,
        start
      }
    }
  }));
  controller.finishHistoryGroup();
  controller.undo();
  assert.equal(controller.getSnapshot().schedules.a.tuesday.start, '12:00');
  controller.redo();
  controller.acknowledgeSave(controller.beginSave());
  assert.equal(controller.undo(), false);
  assert.equal(controller.getSnapshot().dirtyStaff.size, 0);
});
const requirements = {
  positions: ['Masa', 'Caja'],
  intervalMinutes: 15,
  startMinutes: 420,
  matrix: [Array(76).fill(1), Array(76).fill(1)]
};
const definitions = [{
  name: 'Masa',
  department: 'production'
}, {
  name: 'Caja',
  department: 'service'
}];
const assigned = [{
  staffId: 'a',
  staffName: 'Ana',
  position: 'Masa',
  start: '12:00',
  end: '13:00',
  breakStartMinutes: 750,
  breakEndMinutes: 765
}, {
  staffId: 'b',
  staffName: 'Beto',
  position: 'Masa',
  start: '12:00',
  end: '13:00'
}];
test('personas por cuarto excluye breaks y la salida; un ID no se duplica por rotaciones', () => {
  assert.equal(coveragePeopleAt([...assigned, assigned[0]], 720).length, 2);
  assert.equal(coveragePeopleAt(assigned, 750).length, 1);
  assert.equal(coveragePeopleAt(assigned, 780).length, 0);
  const hour = coverageInsights(assigned, requirements, definitions).hours.find(item => item.minute === 720);
  assert.equal(hour.min, 1);
  assert.equal(hour.max, 2);
});
test('horas por departamento ponderan los cuartos y el extremo 26:00 no suma duración', () => {
  const req = {
    positions: ['Masa'],
    intervalMinutes: 15,
    startMinutes: 1545,
    matrix: [[1, 50]]
  };
  const value = coverageInsights([], req, definitions);
  assert.equal(value.missing, .25);
  assert.equal(value.groups.production.missing, .25);
  assert.equal(HOURS.at(-1), '26:00');
  assert.equal(HOURS.length, 77);
});
test('identidad del ocupante conserva la marca de salida visual', () => {
  const rows = buildHeatmapRows(assigned, requirements),
    value = cellOccupants(assigned, rows);
  assert.equal(value.get(`masa-0:${HOURS.indexOf('12:00')}`).staffId, 'a');
  assert.equal(value.get(`masa-0:${HOURS.indexOf('13:00')}`).exit, true);
});
test('el plan de traslado salta un break y conserva dos subtramos compatibles', () => {
  const req = {
    positions: ['Masa', 'Caja'],
    matrix: [Array(22).fill(1), Array(22).fill(1)]
  };
  const plan = planHeatmapTransfer(assigned, req, {
    staffId: 'a',
    source: 'Masa',
    position: 'Caja',
    start: 720,
    end: 780
  });
  assert.deepEqual(plan.map(item => [item.start, item.end]), [[720, 750], [765, 780]]);
  assert.deepEqual(planHeatmapTransfer(assigned, req, {
    staffId: 'a',
    source: 'Masa',
    position: 'Caja',
    start: 720,
    end: 99999999
  }), []);
});
const person = {
  id: 'a',
  name: 'Ana',
  status: 'active',
  storeId: 'store',
  modality: 'Part-Time',
  position: 'COLABORADOR',
  workCategory: 'production',
  studyAvailabilityStatus: 'ready',
  study_schedule: {},
  skills: []
};
const context = (changes = {}) => ({
  staff: [person],
  schedules: {},
  day: 'tuesday',
  date: '2026-10-13',
  weekStart: '2026-10-12',
  requirements,
  positionDefinitions: definitions,
  ...changes
});
const request = ctx => ({
  staffId: 'a',
  sourceFingerprint: placementFingerprint(ctx.schedules, 'a'),
  position: 'Masa',
  start: 720
});
test('la jornada pintada usa modalidad, descansos, duración aprobada y break completos',()=>{
  const expected=[['Full-Time',1,525,480],['Part-Time',1,225,225],['Part-Time',2,285,285],['Part-Time',3,405,360],['Part-Time',4,525,480]];
  for(const [modality,rests,gross,net] of expected){
    const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const schedule=Object.fromEntries(days.slice(-rests).map(day=>[day,{off:true}]));
    const ctx=context({staff:[{...person,modality}],schedules:{a:schedule}});
    const req={...request(ctx),start:735};
    const plan=planCoveragePlacement(ctx,req),hours=calculateScheduleDay(plan.patch,modality);
    assert.equal(plan.patch.start,'12:15');assert.equal(hours.grossMinutes,gross);assert.equal(hours.totalMinutes,net);
    const before=JSON.stringify(ctx.schedules),preview=placementPreviewAssignments(ctx,req,plan);
    assert.equal(JSON.stringify(ctx.schedules),before,'La previsualización nunca modifica el horario');
    assert.equal(preview[0].start,'12:15');assert.ok(preview[0].end);
    if(gross!==net)assert.ok(preview[0].breakStartMinutes);
  }
});
test('un gerente sin jornada no recibe un turno inventado de quince minutos',()=>{
  const ctx=context({staff:[{...person,position:'GERENTE',modality:'Full-Time'}]});
  assert.throws(()=>planCoveragePlacement(ctx,{...request(ctx),start:885}),/Define primero su jornada completa/);
});
test('no aproxima ingresos ni convierte el inicio 24:00 a la mañana del mismo día',()=>{
  const ctx=context({staff:[{...person,modality:'Full-Time'}]});
  assert.throws(()=>planCoveragePlacement(ctx,{...request(ctx),start:720}),/exactamente/);
  assert.throws(()=>planCoveragePlacement(ctx,{...request(ctx),start:1440}),/antes de medianoche/);
});
test('la disponibilidad se comprueba sobre toda la jornada pintada',()=>{
  const ctx=context({staff:[{...person,modality:'Full-Time',study_schedule:{tuesday:{blocks:[{start:'19:00',end:'20:00'}]}}}]});
  assert.throws(()=>planCoveragePlacement(ctx,{...request(ctx),start:735}),/horario de estudio/);
  const preview=planCoveragePlacement(ctx,{...request(ctx),start:735},{preview:true});
  assert.equal(preview.valid,false);assert.deepEqual(preview.academicIntervals,[{start:1140,end:1200}]);
  assert.equal(preview.patch.end,'21:00');
});
test('cambio de modalidad, cupo semanal agotado y descansos remotos impiden colocar',()=>{
  const original=context(),stamp=placementPlanFingerprint(original,'a');
  const changed=context({staff:[{...person,modality:'Full-Time'}]});
  assert.throws(()=>planCoveragePlacement(changed,{...request(changed),start:735,planFingerprint:stamp}),/modalidad.*plan de descansos/);
  const exhausted={monday:{},tuesday:{start:'12:15',end:'21:00'},wednesday:{start:'12:00',end:'20:30'},thursday:{start:'12:15',end:'21:00'},friday:{off:true},saturday:{off:true},sunday:{off:true}};
  for(const value of Object.values(exhausted)){value.bukRestDays=4;value.bukRestDaysBasis=3;}
  const ctx=context({schedules:{a:exhausted},day:'monday',date:'2026-10-12',previousWeekSchedules:{a:{}}});
  assert.throws(()=>planCoveragePlacement(ctx,{...request(ctx),start:735}),/cupos del plan semanal/);
  assert.throws(()=>planCoveragePlacement(context({verifiedSchedule:{sunday:{off:true}}}),request(original)),/otra sesión/);
});
test('agregar al mapa propone un turno aprobado compatible con la categoría aunque no exista habilidad', () => {
  const ctx = context(),
    plan = planCoveragePlacement(ctx, request(ctx));
  assert.equal(plan.operation, 'add');
  assert.ok(plan.patch.bukApprovedShiftId);
  assert.equal(plan.patch.position, 'Masa');
  assert.ok(plan.options.length);
  assert.throws(() => planCoveragePlacement(ctx, {
    ...request(ctx),
    optionId: 'turno-que-ya-no-existe'
  }), /ya no está disponible/);
});
test('exclusiones distinguen sin categorizar e incompatible y explican el faltante restante', () => {
  const result = getHeatmapCoverageCandidates({
    ...context({
      staff: [{
        ...person,
        workCategory: ''
      }, {
        ...person,
        id: 'b',
        workCategory: 'service'
      }]
    }),
    selection: {
      position: 'Masa',
      start: 720,
      end: 735
    }
  });
  assert.equal(result.uncategorizedStaffCount, 1);
  assert.equal(result.incompatibleStaffCount, 1);
  assert.equal(result.available.length, 0);
  assert.equal(result.coverageNeed[0].missing, 1);
  assert.equal(result.coverageNeed[0].remaining, 0);
  assert.equal(workCategory({
    legacy_data: {
      workCategory: 'Producción'
    }
  }), 'production');
});
test('una nueva colocación rechaza estudios, descanso, cambio de categoría o de horario', () => {
  for (const changes of [{
    staff: [{
      ...person,
      study_schedule: {
        tuesday: {
          blocks: [{
            start: '00:00',
            end: '23:59'
          }]
        }
      }
    }]
  }, {
    schedules: {
      a: {
        tuesday: {
          off: true
        }
      }
    }
  }, {
    staff: [{
      ...person,
      workCategory: 'service'
    }]
  }, {
    staff: [{
      ...person,
      studyAvailabilityStatus: 'error'
    }]
  }]) {
    const ctx = context(changes);
    assert.throws(() => planCoveragePlacement(ctx, request(ctx)));
  }
  assert.throws(() => planCoveragePlacement(context({
    schedules: {
      a: {
        wednesday: {
          off: true
        }
      }
    }
  }), request(context())), /horario.*descansos cambiaron/);
});
const ft = {
  ...person,
  modality: 'Full-Time'
};
const option = getAvailableApprovedBukOptions('Full-Time', 1).find(item => item.start === '12:15');
const ftShift = {
  ...makeApprovedBukPatch(option.id, {}, 'tuesday'),
  position: 'Masa'
};
test('mover conserva duración BUK, verifica categoría y no permite una hora no aprobada', () => {
  const ctx = context({
    staff: [ft],
    schedules: {
      a: {
        tuesday: ftShift
      }
    }
  });
  const req = {
    ...request(ctx),
    start: 735
  };
  const plan = planCoveragePlacement(ctx, req);
  assert.equal(plan.operation, 'move');
  assert.equal(plan.patch.start, ftShift.start);
  assert.equal(plan.patch.end, ftShift.end);
  assert.throws(() => planCoveragePlacement(ctx, {
    ...req,
    start: 1485
  }));
});
test('mover comprueba turnos nocturnos contiguos y la lectura de la semana previa', () => {
  const ctx = context({
    staff: [ft],
    schedules: {
      a: {
        tuesday: ftShift,
        monday: {
          start: '23:00',
          end: '13:00'
        }
      }
    }
  });
  assert.throws(() => planCoveragePlacement(ctx, {
    ...request(ctx),
    start: 735
  }), /superpone/);
  const monday = context({
    staff: [ft],
    day: 'monday',
    date: '2026-10-12',
    schedules: {
      a: {
        monday: ftShift
      }
    }
  });
  assert.throws(() => planCoveragePlacement(monday, {
    ...request(monday),
    start: 735
  }), /semana contigua/);
});
