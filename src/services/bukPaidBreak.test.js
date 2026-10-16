import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {getApprovedBukOptions,makeApprovedBukPatch,approvedBukShiftLabel,buildBukRows,createBukWorkbook,createBukPlanningWorkbook} from './bukSchedule.js';
import {getScheduleBreak,getScheduleBreakOptions,calculateScheduleDay,calculateScheduleTotals,requiresScheduleBreak} from './scheduleHours.js';
import {getHeatmapAssignments,getPositionTimeline,SCHEDULE_DAYS} from './scheduleExportData.js';
import {buildHeatmapRows,HOURS} from './heatmapModel.js';

const person={id:'pt',name:'Prueba',modality:'Part-Time',dni:'00000001',position:'COLABORADOR'};
const shift=()=>({...makeApprovedBukPatch('PT2-33'),position:'Caja',breakStart:'23:45'});
const week=()=>Object.fromEntries(SCHEDULE_DAYS.map((day,i)=>[day,i<5?shift():{off:true}]));
const data=()=>({staff:[person],schedules:{pt:week()},weekStart:'2026-10-12',storeName:'Prueba',supervisorName:'Gerente'});

test('dos descansos solo ofrece turnos de 4:45 con break incluido y completa 23:45 en cinco días',()=>{
  const options=getApprovedBukOptions('Part-Time',2);
  assert.ok(options.length>0);
  assert.ok(options.every(item=>item.group==='PT2' && item.duration===285 && item.breakMinutes===45 && item.breakIncludedInHours));
  assert.match(approvedBukShiftLabel(options[0]),/4 h 45 min \(break de 45 min incluido\)$/);
  const totals=calculateScheduleTotals(week(),person,'2026-10-12');
  assert.equal(totals.baseMinutes,1425);assert.equal(totals.totalMinutes,1425);
  assert.equal(totals.breakMinutes,0,'Included breaks are not deducted');
});

test('break de 45 minutos asignable en PT de 4:45, incluidos turnos manuales e históricos',()=>{
  const current=shift();
  assert.equal(requiresScheduleBreak(current,'Part-Time'),true);
  assert.deepEqual(getScheduleBreak(current,'Part-Time'),{start:'23:45',end:'00:30',startMinutes:1425,endMinutes:1470});
  assert.equal(getScheduleBreakOptions(current,'Part-Time').at(-1),'00:15');
  assert.equal(calculateScheduleDay(current,'Part-Time').baseMinutes,285);
  const old={...current,bukBreakMinutes:0,bukBreakIncludedInHours:false};
  assert.ok(getScheduleBreak(old,'Part-Time'),'Previously stored PT2 entries also gain the control');
  assert.equal(calculateScheduleDay(old,'Part-Time').baseMinutes,285);
  const manual={start:'20:15',end:'01:00',breakStart:'23:45'};
  assert.ok(getScheduleBreak(manual,'Part-Time'));
  for(const breakStart of ['20:00','00:30','23:46','']) assert.equal(getScheduleBreak({...current,breakStart},'Part-Time'),null);
});

test('break incluido retira tres recuadros de cobertura y devuelve la cobertura al terminar',()=>{
  const schedule={pt:{monday:shift()}};
  const assignments=getHeatmapAssignments([person],schedule,'monday',['Caja'],'2026-10-12');
  const rows=buildHeatmapRows(assignments,{positions:['Caja'],matrix:[Array(21).fill(1)]});
  for(const time of ['23:45','24:00','24:15']) {
    assert.ok(HOURS.indexOf(time)>=0,time);
    assert.equal(rows[0].cells[HOURS.indexOf(time)].color,'bg-yellow-300',time);
  }
  for(const time of ['23:30','24:30','25:00']) assert.equal(rows[0].cells[HOURS.indexOf(time)].color,'bg-blue-500',time);
  const coverage=getPositionTimeline(shift(),'Part-Time');
  assert.equal(coverage.reduce((sum,item)=>sum+item.end-item.start,0),240,'Only 4:00 are position coverage');
  assert.equal(calculateScheduleDay(shift(),'Part-Time').totalMinutes,285,'All 4:45 remain credited');
});

test('BUK conserva el código válido y planificación mantiene 23:45 con break incluido',()=>{
  const current=data(),before=structuredClone(current);
  const rows=buildBukRows(current);
  assert.deepEqual(rows[1].slice(4),['20:15 A 01:00','20:15 A 01:00','20:15 A 01:00','20:15 A 01:00','20:15 A 01:00','D','D']);
  const book=createBukWorkbook(current);
  const read=XLSX.read(XLSX.write(book,{bookType:'biff8',type:'buffer'}),{type:'buffer'});
  assert.deepEqual(XLSX.utils.sheet_to_json(read.Sheets.turnosColaboradores,{header:1,defval:''}),rows);
  const planning=createBukPlanningWorkbook(current);
  const planRows=XLSX.utils.sheet_to_json(planning.Sheets['PLANIFICACIÓN'],{header:1});
  assert.equal(planRows[1].at(-2),'23:45');assert.equal(planRows[1].at(-1),'CORRECTO');
  const approved=XLSX.utils.sheet_to_json(planning.Sheets['HORARIOS APROBADOS'],{header:1});
  assert.ok(approved.filter(r=>r[0]==='PT2').every(r=>r[3]===45 && r[4]==='Sí'));
  assert.deepEqual(current,before);
  const invalid=data();invalid.schedules.pt.monday.breakStart='00:45';
  assert.throws(()=>buildBukRows(invalid),/quedar dentro del turno/);
});

test('conserva las reglas de FT, los otros planes, las extras, los feriados y los descansos',()=>{
  const full=makeApprovedBukPatch('FT1-5');
  assert.equal(requiresScheduleBreak(full,'Full-Time'),true);
  assert.equal(calculateScheduleDay(full,'Full-Time').baseMinutes,480);
  assert.equal(calculateScheduleDay({...full,bukBreakIncludedInHours:true},'Full-Time').baseMinutes,480,'A stale flag cannot change FT accounting');
  const short=makeApprovedBukPatch('PT1-65');
  assert.equal(requiresScheduleBreak({...short,extraHoursPost:1},'Part-Time'),false);
  assert.equal(calculateScheduleDay({...shift(),extraHoursPost:1},'Part-Time').totalMinutes,345);
  assert.equal(calculateScheduleDay({...shift(),feriado:true},'Part-Time').holidayMinutes,285);
  for(const overrides of [{off:true},{feriado:true},{splitShift:true}]) assert.equal(requiresScheduleBreak({...shift(),...overrides},'Part-Time'),false);
});
