import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {approvedBukShifts,defaultBukCatalog,getApprovedBukOptions,makeApprovedBukPatch,approvedBukShiftLabel,buildBukRows,createBukPlanningWorkbook} from './bukSchedule.js';
import {getScheduleBreak,getScheduleBreakOptions,calculateScheduleDay,calculateScheduleTotals,requiresScheduleBreak} from './scheduleHours.js';
import {getHeatmapAssignments,getPositionTimeline,SCHEDULE_DAYS} from './scheduleExportData.js';
import {buildHeatmapRows,HOURS} from './heatmapModel.js';

// HORARIOS APROBADOS: A2, D2, G2, J2, M2 in the supplied workbook.
const plans=[
  ['FT1',[525,525,525,525,525,525],new Map([[525,45]]),2880],
  ['PT1',[240,240,240,240,240,225],new Map([[240,0],[225,0]]),1425],
  ['PT2',[285,285,285,285,285],new Map([[285,0]]),1425],
  ['PT3',[405,405,405,345],new Map([[405,45],[345,0]]),1425],
  ['PT4',[525,525,510],new Map([[525,45],[510,45]]),1425],
];
const person={id:'pt',name:'Prueba',modality:'Part-Time',dni:'00000001',position:'COLABORADOR'};
const option=(group,duration)=>approvedBukShifts.find(shift=>shift.group===group && shift.duration===duration && defaultBukCatalog.some(t=>t.start===shift.start && t.end===shift.end));

test('todos los rangos de los cinco planes usan el refrigerio indicado en el Excel',()=>{
  assert.equal(approvedBukShifts.length,261);
  for(const [group,,breaks] of plans) {
    const options=getApprovedBukOptions(group==='FT1'?'Full-Time':'Part-Time',Number(group.slice(2)));
    assert.ok(options.length>0);
    for(const row of options) {
      assert.equal(row.group,group);assert.ok(breaks.has(row.duration));
      assert.equal(row.breakMinutes,breaks.get(row.duration),row.id);
      const shift={...makeApprovedBukPatch(row.id),breakStart:row.start};
      assert.equal(requiresScheduleBreak(shift,group==='FT1'?'Full-Time':'Part-Time'),row.breakMinutes===45,row.id);
      assert.equal(calculateScheduleDay(shift,group==='FT1'?'Full-Time':'Part-Time').baseMinutes,row.duration-row.breakMinutes,row.id);
      assert.equal(Boolean(getScheduleBreak(shift,group==='FT1'?'Full-Time':'Part-Time')),row.breakMinutes>0,row.id);
    }
  }
});

test('las combinaciones de la hoja completan 48:00 FT y 23:45 en cada opción PT',()=>{
  for(const [group,durations,,target] of plans) {
    const modality=group==='FT1'?'Full-Time':'Part-Time';
    const schedule=Object.fromEntries(SCHEDULE_DAYS.map((day,i)=>[day,i<durations.length?makeApprovedBukPatch(option(group,durations[i]).id,{},day):{off:true}]));
    const totals=calculateScheduleTotals(schedule,{...person,modality},'2026-10-12');
    assert.equal(totals.baseMinutes,target,group);
    const workbook=createBukPlanningWorkbook({staff:[{...person,modality}],schedules:{pt:schedule},weekStart:'2026-10-12',storeName:'Prueba',supervisorName:'Gerente'});
    const data=XLSX.utils.sheet_to_json(workbook.Sheets['PLANIFICACIÓN'],{header:1});
    assert.equal(data[1].at(-2),group==='FT1'?'48:00':'23:45',group);
    assert.equal(data[1].at(-1),'CORRECTO',group);
  }
});

test('opción 2 sin break ignora la antigua excepción sin borrar horarios ni bloquear BUK',()=>{
  const shift={...makeApprovedBukPatch('PT2-33'),position:'Caja',breakStart:'23:45',bukBreakMinutes:45,bukBreakIncludedInHours:true};
  assert.equal(getScheduleBreak(shift,'Part-Time'),null);assert.deepEqual(getScheduleBreakOptions(shift,'Part-Time'),[]);
  assert.equal(calculateScheduleDay(shift,'Part-Time').baseMinutes,285);
  const schedule=Object.fromEntries(SCHEDULE_DAYS.map((day,i)=>[day,i<5?{...shift}:{off:true}]));
  const data={staff:[person],schedules:{pt:schedule},weekStart:'2026-10-12',storeName:'Prueba',supervisorName:'Gerente'};
  const before=structuredClone(data);
  assert.equal(calculateScheduleTotals(schedule,person,data.weekStart).totalMinutes,1425);
  assert.deepEqual(buildBukRows(data)[1].slice(4),['20:15 A 01:00','20:15 A 01:00','20:15 A 01:00','20:15 A 01:00','20:15 A 01:00','D','D']);
  assert.deepEqual(data,before,'Legacy data remains intact');
  assert.match(approvedBukShiftLabel(option('PT2',285)),/sin break/);
});

test('opción 3 aplica break solo a 6:45 y conserva cobertura completa en 5:45 y opción 2',()=>{
  const long=approvedBukShifts.find(shift=>shift.group==='PT3' && shift.start==='20:15' && shift.duration===405);
  const shift={...makeApprovedBukPatch(long.id),position:'Caja',breakStart:'23:45'};
  const rows=buildHeatmapRows(getHeatmapAssignments([person],{pt:{monday:shift}},'monday',['Caja'],'2026-10-12'),{positions:['Caja'],matrix:[Array(21).fill(1)]});
  for(const time of ['23:45','24:00','24:15']) assert.equal(rows[0].cells[HOURS.indexOf(time)].color,'bg-yellow-300',time);
  assert.equal(rows[0].cells[HOURS.indexOf('24:30')].color,'bg-blue-500');
  assert.equal(getPositionTimeline(shift,'Part-Time').reduce((sum,s)=>sum+s.end-s.start,0),360);
  assert.equal(calculateScheduleDay(shift,'Part-Time').baseMinutes,360);
  const short={...makeApprovedBukPatch(option('PT3',345).id),breakStart:'09:00'};
  assert.equal(getScheduleBreak(short,'Part-Time'),null);assert.equal(calculateScheduleDay(short,'Part-Time').baseMinutes,345);
  const legacy={...makeApprovedBukPatch('PT2-33'),position:'Caja',breakStart:'23:45',bukBreakIncludedInHours:true};
  const noBreak=buildHeatmapRows(getHeatmapAssignments([person],{pt:{monday:legacy}},'monday',['Caja'],'2026-10-12'),{positions:['Caja'],matrix:[Array(21).fill(1)]});
  for(const time of ['23:45','24:00','24:15','25:00']) assert.equal(noBreak[0].cells[HOURS.indexOf(time)].color,'bg-blue-500',time);
});

test('opción 4 descuenta 45 minutos en ambos rangos y no acepta flags históricos de break incluido',()=>{
  for(const [duration,net] of [[525,480],[510,465]]) {
    const shift={...makeApprovedBukPatch(option('PT4',duration).id),bukBreakIncludedInHours:true};
    assert.equal(requiresScheduleBreak(shift,'Part-Time'),true);
    assert.equal(calculateScheduleDay(shift,'Part-Time').baseMinutes,net);
    assert.equal(calculateScheduleDay({...shift,extraHoursPost:1},'Part-Time').totalMinutes,net+60);
    for(const flags of [{off:true},{feriado:true},{splitShift:true}]) assert.equal(requiresScheduleBreak({...shift,...flags},'Part-Time'),false);
  }
  assert.equal(requiresScheduleBreak({start:'20:15',end:'01:00',breakStart:'23:45'},'Part-Time'),false,'Manual 4:45 does not reactivate the old exception');
});
