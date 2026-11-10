import assert from 'node:assert/strict';
import test from 'node:test';
import { getHeatmapCoverageCandidates as candidates } from './heatmapCoverageCandidates.js';
import { getShiftAvailability } from './shiftAvailability.js';
import { getScheduleBreak } from './scheduleHours.js';

const day = 'tuesday';
const date = '2026-11-03';
const weekStart = '2026-11-02';
const selection = { position: 'Masa', start: 720, end: 945 };
const requirements = (source = 0, target = 1) => ({
  positions: ['Caja', 'Masa'], matrix: [Array(21).fill(source), Array(21).fill(target)],
});
const person = (id = 'a', changes = {}) => ({
  id, name: `Persona ${id}`, status: 'active', modality: 'Part-Time', position: 'COLABORADOR',
  skills: ['Masa'], studyAvailabilityStatus: 'ready', study_schedule: {}, ...changes,
});
const run = (changes = {}) => candidates({ selection, staff: [person()], schedules: {}, day, date, weekStart,
  requirements: requirements(), ...changes });
const allIds = result => [...result.available, ...result.transfers].map(item => item.id);
const optionsFor = (result, id = 'a') => result.available.find(item => item.id === id)?.options || [];
const asMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const spans = option => {
  const start = asMinutes(option.start);
  let end = asMinutes(option.end);
  if (end < start) end += 1440;
  return { start, end };
};

test('valida posición, límites, cuartos de hora y coherencia de día, fecha y semana', () => {
  for (const chosen of [null, { ...selection, position:'Desconocida' }, { ...selection, start:721 },
    { ...selection, end:720 }, { ...selection, start:405 }, { ...selection, end:1530 }]) {
    const result = run({ selection:chosen });
    assert.equal(result.valid, false);
    assert.ok(result.reason);
    assert.deepEqual(result.available, []);
    assert.deepEqual(result.transfers, []);
  }
  for (const changes of [{day:'monday'},{date:'2026-11-04'},{date:'2026-02-30'},
    {weekStart:'2026-11-09'},{weekStart:'2026-11-03'}]) {
    const result=run(changes);
    assert.equal(result.valid,false);
    assert.ok(result.reason);
  }
});

test('un faltante de 225 minutos admite un turno aprobado de 240 que lo cubra completo', () => {
  const result = run();
  assert.equal(result.valid, true);
  assert.equal(result.available[0].kind, 'new-shift');
  const option = optionsFor(result).find(item => item.start === '12:00' && item.end === '16:00');
  assert.ok(option, '12:00–16:00 debe cubrir 12:00–15:45 aunque no coincida exactamente');
  assert.equal(option.duration, 240);
  assert.ok(optionsFor(result).every(item => {
    const interval = spans(item);
    return interval.start <= selection.start && interval.end >= selection.end;
  }));
  assert.equal(run({ selection:{...selection,end:1020} }).available.length, 0, 'Un Part-Time de cuatro horas no cubre cinco horas');
});

test('respeta la cuota semanal restante en lugar de proponer una duración ya agotada', () => {
  const schedule = Object.fromEntries(['monday','wednesday','thursday','friday','saturday']
    .map(key => [key,{start:'12:00',end:'16:00'}]));
  assert.equal(run({schedules:{a:schedule}}).available.length, 0,
    'Solo quedan 225 minutos y ningún turno del catálogo cubre todo 12:00–15:45');
  const result = run({schedules:{a:schedule},selection:{...selection,start:735,end:960}});
  assert.ok(optionsFor(result).length > 0);
  assert.ok(optionsFor(result).every(item=>item.duration===225));
  assert.ok(optionsFor(result).some(item=>item.start==='12:15'&&item.end==='16:00'));
});

test('exige habilidad del destino y disponibilidad cargada sin inventar acceso', () => {
  const staff = [person('missing',{skills:[]}),person('loading',{studyAvailabilityStatus:'loading'}),
    person('error',{studyAvailabilityStatus:'error'}),person('unknown',{studyAvailabilityStatus:undefined}),
    person('normalized',{skills:['  MASA#2  ']}),person('abilities',{skills:undefined,positionAbilities:['Masa']})];
  const result = run({staff});
  assert.deepEqual(new Set(result.available.map(item=>item.id)),new Set(['normalized','abilities']));
  for(const id of ['missing','loading','error','unknown']) assert.equal(allIds(result).includes(id),false,id);
});

test('excluye cesados, entrenamiento terminado, inactivos, días libres y feriados', () => {
  const staff = [person('ceased',{cessationDate:'2026-11-02'}),
    person('training',{isTrainee:true,trainingEndDate:'2026-11-02'}),person('inactive',{status:'inactive'}),
    person('off'),person('holiday'),person('pending',{status:'pending'}),person('legacy',{status:undefined})];
  const result = run({staff,schedules:{off:{tuesday:{off:true}},holiday:{tuesday:{feriado:true}}}});
  assert.deepEqual(new Set(result.available.map(item=>item.id)),new Set(['pending','legacy']));
});

test('comprueba el turno propuesto completo aunque la clase esté fuera del hueco seleccionado', () => {
  const staff = [person('a',{study_schedule:{tuesday:{free:false,blocks:[{start:'15:45',end:'16:00'}]}}})];
  const result = run({staff});
  assert.equal(result.available.length,0,'La clase empieza cuando acaba el hueco, pero coincide con 12:00–16:00');
  assert.ok(result.blocked.some(item=>item.id==='a'));
  assert.equal(run({staff:[person('a',{study_schedule:{tuesday:{free:true,blocks:[]}}})]}).available.length,0);
});

test('recomienda breaks fuera de la cobertura y no ofrece una jornada que exigiría cubrir su propio break', () => {
  const staff = [person('a',{modality:'Full-Time'})];
  const result = run({staff});
  assert.ok(optionsFor(result).length > 0);
  for(const option of optionsFor(result)){
    assert.equal(option.breakMinutes,45);
    assert.ok(option.breakStart);
    assert.ok(option.breakOptions.length>0);
    const rest=getScheduleBreak({...option,bukApprovedShiftId:option.id},'Full-Time');
    assert.ok(rest);
    assert.ok(rest.endMinutes<=selection.start||rest.startMinutes>=selection.end);
  }
  const entire = run({staff,selection:{...selection,start:495,end:1020}});
  assert.equal(entire.available.length,0,'525 minutos de cobertura continua no dejan 45 minutos para break');
});

test('las cuotas nocturnas y las clases del día siguiente se respetan a la vez', () => {
  const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const schedule=Object.fromEntries(days.map(key=>[key,{bukRestDays:3}]));
  for(const key of ['monday','wednesday','thursday']) schedule[key]={...schedule[key],start:'06:15',end:'13:00'};
  const staff=[person('a',{study_schedule:{wednesday:{free:false,blocks:[{start:'00:00',end:'04:00'}]}}})];
  const result=run({staff,schedules:{a:schedule},selection:{...selection,start:1260,end:1350}});
  assert.ok(optionsFor(result).length>0);
  assert.ok(optionsFor(result).every(option=>option.duration===345));
  assert.ok(optionsFor(result).every(option=>getShiftAvailability({date,shift:option,studySchedule:staff[0].study_schedule}).available));
  assert.equal(optionsFor(result).some(option=>option.start==='19:00'&&option.end==='00:45'),false);
});

test('un puesto ocupado no se reemplaza por un turno nuevo ni se duplica a quien ya cubre el destino', () => {
  const staff=[person('a')];
  const occupied={a:{tuesday:{start:'11:00',end:'16:00',position:'Caja'}}};
  const result=run({staff,schedules:occupied,requirements:requirements(1,1)});
  assert.equal(result.available.length,0);
  assert.equal(result.transfers.length,0,'Mover a la única persona de Caja dejaría un faltante');
  const already=run({staff,schedules:{a:{tuesday:{start:'11:00',end:'16:00',position:'Masa'}}},requirements:requirements(0,2)});
  assert.equal(allIds(already).includes('a'),false);
});

test('tener excedente en otro puesto no convierte a una persona con turno en candidata', () => {
  const staff=[person('a'),person('b')];
  const schedules={a:{tuesday:{start:'11:00',end:'16:00',position:'Caja'}},
    b:{tuesday:{start:'11:00',end:'16:00',position:'Caja'}}};
  const result=run({staff,schedules,requirements:requirements(1.49,1)});
  assert.deepEqual(result.available,[]);
  assert.deepEqual(result.transfers,[]);
  assert.deepEqual(run({staff,schedules,requirements:requirements(0,1),includeTransfers:true}).transfers,[],
    'La búsqueda nunca ofrece reasignar personas que ya tienen turno');
});

test('un gerente con horario ya asignado tampoco es candidato aunque tenga rangos sin posición', () => {
  const staff=[person('a',{position:'GERENTE',modality:'Full-Time'})];
  const base={start:'09:00',end:'18:00',positionRangesOnly:true,position:'Caja',breakStart:'16:30',
    positionAssignments:[{start:660,end:720,position:'Caja'}]};
  const free=run({staff,schedules:{a:{tuesday:base}}});
  assert.equal(free.available.length,0);
  assert.equal(allIds(free).includes('a'),false);
  assert.deepEqual(free.transfers,[]);
  const busy=run({staff,schedules:{a:{tuesday:{...base,positionAssignments:[{start:720,end:780,position:'Caja'}]}}},requirements:requirements(1,1)});
  assert.equal(allIds(busy).includes('a'),false,'El intervalo completo debe estar libre o ser un excedente seguro');
  const rest=run({staff,schedules:{a:{tuesday:{...base,breakStart:'13:00'}}}});
  assert.equal(allIds(rest).includes('a'),false);
});

test('un turno incompleto o con horas de un segundo tramo requiere revisión antes de reemplazarlo', () => {
  for (const current of [{start:'12:00',end:''},{start:'',end:'16:00'},
    {start:'',end:'',start2:'12:00',end2:'16:00'}, {splitShift:true}]) {
    const result=run({schedules:{a:{tuesday:current}}});
    assert.equal(result.available.length,0);
    assert.deepEqual(result.transfers,[]);
    assert.ok(result.blocked.some(item=>item.id==='a'));
  }
});

test('una selección que ya no tiene faltantes se comprueba con toda la plantilla', () => {
  const staff=[person('a'),person('b',{skills:[],studyAvailabilityStatus:'error'})];
  const schedules={b:{tuesday:{start:'12:00',end:'16:00',position:'Masa'}}};
  const result=run({staff,schedules});
  assert.equal(result.valid,false,'Quien ya cubre el destino cuenta aunque no pueda ser candidato');
  assert.deepEqual(result.available,[]);
  assert.deepEqual(result.transfers,[]);
});

test('gerentes y asistentes sin turno pueden usar el tramo solicitado sin catálogo BUK', () => {
  const staff=[person('manager',{position:'GERENTE',modality:'Full-Time'}),person('assistant',{position:'ASISTENTE',modality:'Full-Time'})];
  const result=run({staff});
  assert.deepEqual(new Set(result.available.map(item=>item.id)),new Set(['manager','assistant']));
  for(const entry of result.available) assert.ok(entry.options.some(option=>option.start==='12:00'&&option.end==='15:45'));
});

test('los turnos del día anterior y sus extras impiden sugerir trabajo superpuesto', () => {
  const chosen={...selection,start:480,end:600};
  const blocked=run({selection:chosen,schedules:{a:{monday:{start:'23:30',end:'08:15'}}}});
  assert.equal(blocked.available.length,0);
  const touching=run({selection:chosen,schedules:{a:{monday:{start:'23:00',end:'07:45',extraHoursPost:0.25}}}});
  assert.ok(optionsFor(touching).some(option=>option.start==='08:00'));
  assert.equal(optionsFor(touching).some(option=>option.start==='06:00'),false);
});

test('comprueba el carril exacto marcado y rechaza una selección de otra fecha', () => {
  const staff=[person('a'),person('b'),person('c')];
  const schedules={b:{tuesday:{start:'11:00',end:'16:00',position:'Masa'}},
    c:{tuesday:{start:'11:00',end:'16:00',position:'Masa'}}};
  const blue={...selection,slot:1,positionKey:'masa',rowKey:'masa-1',date};
  assert.equal(run({staff,schedules,requirements:requirements(0,3),selection:blue}).valid,false,
    'El carril 1 está cubierto aunque el carril 2 de la misma posición siga amarillo');
  const yellow={...blue,slot:2,rowKey:'masa-2'};
  const result=run({staff,schedules,requirements:requirements(0,3),selection:yellow});
  assert.equal(result.valid,true);
  assert.deepEqual(result.available.map(item=>item.id),['a']);
  assert.equal(run({selection:{...selection,date:'2026-11-02'}}).valid,false);
});

test('los turnos del día siguiente impiden propuestas nocturnas que los invadan', () => {
  const result=run({selection:{...selection,start:1275,end:1380},schedules:{a:{wednesday:{start:'00:00',end:'08:00'}}}});
  assert.ok(optionsFor(result).length>0);
  assert.equal(optionsFor(result).some(option=>spans(option).end>1440),false);
  assert.ok(optionsFor(result).some(option=>option.end==='00:00'));
});

test('no declara segura una propuesta nocturna cuando falta la semana adyacente necesaria', () => {
  const unknown=run({day:'sunday',date:'2026-11-08',selection:{...selection,start:1440,end:1500}});
  assert.equal(unknown.available.length,0);
  const known=run({day:'sunday',date:'2026-11-08',selection:{...selection,start:1440,end:1500},nextWeekSchedules:{a:{}}});
  assert.ok(optionsFor(known).length>0);
});

test('la búsqueda es de lectura y conserva personas, turnos y proyección sin cambios', () => {
  const input={selection,staff:[person('a'),person('b')],schedules:{},day,date,weekStart,requirements:requirements()};
  const before=structuredClone(input);
  candidates(input);
  assert.deepEqual(input,before);
});
