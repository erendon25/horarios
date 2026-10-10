import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {buildBukRows,createBukWorkbook,planningBukRows} from '../src/services/bukSchedule.js';
const staff=[
 {id:'manager',name:'Gerente',position:' gerente ',modality:'Full-Time',dni:'10000001'},
 {id:'assistant',name:'Asistente',position:'ASISTENTE',modality:'Part-Time',dni:'10000002'},
 {id:'trainer',name:'Trainer',position:'ENTRENADOR',modality:'Full-Time',dni:'10000003'},
];
const schedules={manager:{monday:{start:'09:17',end:'17:23',position:'LANDING'},tuesday:{off:true},wednesday:{feriado:true}},assistant:{monday:{start:'12:07',end:'19:13',position:'MASA'}},trainer:{monday:{start:'06:15',end:'15:00'}}};
const before=structuredClone(schedules);
const data={staff,schedules,weekStart:'2026-10-12',storeName:'PRUEBA',supervisorName:'Gerente'};
const rows=buildBukRows(data);
assert.deepEqual(rows[1].slice(4),Array(7).fill(''));assert.deepEqual(rows[2].slice(4),Array(7).fill(''));assert.equal(rows[3][4],'06:15 A 15:00');
const workbook=createBukWorkbook(data);const reread=XLSX.read(XLSX.write(workbook,{bookType:'biff8',type:'buffer'}),{type:'buffer'});
assert.deepEqual(XLSX.utils.sheet_to_json(reread.Sheets.turnosColaboradores,{header:1,defval:''}),rows);
const planning=planningBukRows(staff,schedules,data.weekStart);
assert.deepEqual(planning[0].slice(4,7),['09:17','17:23','LANDING']);assert.equal(planning[0].at(-1),'HORARIO LIBRE');assert.deepEqual(planning[1].slice(4,7),['12:07','19:13','MASA']);
assert.throws(()=>buildBukRows({...data,schedules:{...schedules,trainer:{monday:{start:'09:17',end:'17:23'}}}}),/no disponible/);
assert.deepEqual(schedules,before);
console.log('PASS: horarios libres gerentes/asistentes, BUK vacío incluso descansos/feriados, planificación conserva turnos y posiciones; trainers siguen validados');
