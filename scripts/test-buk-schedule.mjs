import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import { approvedBukShifts, defaultBukCatalog, makeApprovedBukPatch, parseBukTemplate, buildBukRows, createBukWorkbook, createBukPlanningWorkbook, planningBukRows } from '../src/services/bukSchedule.js';
import { calculateScheduleTotals } from '../src/services/scheduleHours.js';
import { SCHEDULE_DAYS } from '../src/services/scheduleExportData.js';

const weekStart = '2026-10-12';
const plans = [ ['FT1', [525,525,525,525,525,525], 2880], ['PT1', [240,240,240,240,240,225],1425], ['PT2',[285,285,285,285,285],1425], ['PT3',[405,405,405,345],1425], ['PT4',[525,525,510],1425] ];
const staff=[];const identities=[];const schedules={};
for(const [group,durations,target] of plans){
  const person={id:group,name:`Prueba ${group}`,lastName:'BUK',dni:`0000000${staff.length+1}`,modality:group==='FT1'?'Full-Time':'Part-Time',status:'active'};
  staff.push(person);identities.push({name:`Prueba ${group} BUK`,dni:person.dni,area:'TIENDA DE PRUEBA',supervisor:'GERENTE DE PRUEBA'});
  const schedule={};schedules[person.id]=schedule;
  SCHEDULE_DAYS.forEach((day,index)=>{
    if(index>=durations.length){schedule[day]={off:true};return;}
    const option=approvedBukShifts.find(item=>item.group===group && item.duration===durations[index] && defaultBukCatalog.some(turn=>turn.start===item.start && turn.end===item.end));
    assert.ok(option,`${group}: falta turno ${durations[index]}`);
    schedule[day]={position:'LANDING',extraHoursPre:0,extraHoursPost:0,...makeApprovedBukPatch(option.id,{},day)};
  });
  assert.equal(calculateScheduleTotals(schedule,person,weekStart).baseMinutes,target,group);
}
const data={staff,identities,schedules,weekStart,catalog:defaultBukCatalog};
const before=JSON.stringify(data);
const rows=buildBukRows(data);
const automated={...data,identities:undefined,storeName:'TIENDA DE PRUEBA',supervisorName:'GERENTE DE PRUEBA'};
assert.deepEqual(buildBukRows(automated),rows,'La información del sistema reemplaza la plantilla');
const extras=structuredClone(automated);extras.schedules.FT1.monday.extraHoursPre=1;extras.schedules.FT1.monday.extraHoursPost=2;
assert.equal(buildBukRows(extras)[1][4],rows[1][4],'BUK conserva el turno base');
const shared=planningBukRows(extras.staff,extras.schedules,weekStart)[0];
assert.equal(shared[4],'05:15');assert.equal(shared[5],'17:00');assert.equal(shared.at(-2),'51:00');
const holiday={...makeApprovedBukPatch(approvedBukShifts[0].id),feriado:true};
assert.equal(holiday.start,'06:15');assert.equal(holiday.end,'15:00');
assert.deepEqual(rows[0].slice(4),['12-10-2026','13-10-2026','14-10-2026','15-10-2026','16-10-2026','17-10-2026','18-10-2026']);
assert.equal(rows[1][1],'00000001');
assert.equal(rows[1].at(-1),'D');
assert.equal(planningBukRows(staff,schedules,weekStart).every(row=>row.at(-1)==='CORRECTO'),true);
const partial=structuredClone(data);delete partial.schedules.FT1.monday;
assert.equal(buildBukRows(partial)[1][4],'');
const ceased=structuredClone(data);ceased.staff[0].cessationDate='2026-10-13';
assert.equal(buildBukRows(ceased)[1][6],'');
const bad=structuredClone(data);bad.schedules.FT1.monday.start='03:17';
assert.throws(()=>buildBukRows(bad),/no disponible/);
const manualWorkbook = createBukPlanningWorkbook(bad);
assert.ok(manualWorkbook.Sheets['PLANIFICACIÓN']);
assert.ok(manualWorkbook.Sheets['BUK PENDIENTE']);
assert.equal(manualWorkbook.Sheets.BUK, undefined);
const split=structuredClone(data);split.schedules.FT1.monday.splitShift=true;
assert.throws(()=>buildBukRows(split),/partido/);
const noDni=structuredClone(data);noDni.staff[0].dni='';assert.throws(()=>buildBukRows(noDni),/falta DNI/);
assert.throws(()=>buildBukRows({...data,weekStart:'2026-10-13'}),/lunes/);
assert.equal(JSON.stringify(data),before,'La exportación no modifica horarios');
const original={position:'DRIVE THRU',extraHoursPost:1,positionAssignments:[{start:600,end:660,position:'MASA'}]};
const applied={...original,...makeApprovedBukPatch(approvedBukShifts[0].id,original)};
assert.equal(applied.position,original.position);assert.equal(applied.extraHoursPost,1);assert.deepEqual(applied.positionAssignments,original.positionAssignments);
const output=fileURLToPath(new URL('../artifacts/buk/',import.meta.url));fs.mkdirSync(output,{recursive:true});
const workbook=createBukWorkbook(data);XLSX.writeFile(workbook,`${output}/BUK_PRUEBA_2026-10-12.xls`,{bookType:'biff8'});
const reread=XLSX.readFile(`${output}/BUK_PRUEBA_2026-10-12.xls`);
assert.deepEqual(XLSX.utils.sheet_to_json(reread.Sheets.turnosColaboradores,{header:1,defval:''}),rows);
const templatePath=process.argv[2];
if(templatePath){const template=parseBukTemplate(XLSX.readFile(templatePath));assert.equal(template.identities.length,29);assert.equal(template.catalog.length,1644);assert.equal(template.identities[0].dni,'74350425');}
XLSX.writeFile(createBukPlanningWorkbook(data),`${output}/PLANIFICACION_PRUEBA_2026-10-12.xls`,{bookType:'biff8'});
fs.writeFileSync(`${output}/fixture.json`,JSON.stringify(data,null,2));
console.log('PASS: cinco planes (48:00/23:45), fechas, DNI, descansos, cese, vacíos, turnos inválidos/partidos, conservación y XLS BIFF8 reabierto');
