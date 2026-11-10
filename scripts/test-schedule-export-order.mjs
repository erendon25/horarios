import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { orderScheduleStaff } from '../src/services/scheduleStaffOrder.js';
import { buildBukRows, createBukPlanningWorkbook } from '../src/services/bukSchedule.js';
import { buildWeeklyScheduleWorkbook } from '../src/services/weeklyScheduleExcel.js';
const weekStart = '2026-10-12';
const staff = [
 { id:'pt', name:'A Part', modality:'Part-Time', position:'COLABORADOR' },
 { id:'ft', name:'B Full', modality:'Full-Time', position:'COLABORADOR' },
 { id:'trainer', name:'C Trainer', modality:'Part-Time', position:' entrenador ' },
 { id:'assistant', name:'D Asistente', modality:'Part-Time', position:'ASISTENTE' },
 { id:'manager', name:'Z Gerente', modality:'Full-Time', position:'GERENTE' },
].map((person, i) => ({...person, dni:String(10000000+i)}));
const original = structuredClone(staff);
const expected = ['Z Gerente','D Asistente','C Trainer','B Full','A Part'];
assert.deepEqual(orderScheduleStaff(staff, weekStart).map(p=>p.name), expected);
assert.deepEqual(orderScheduleStaff([{name:'Cambio',modality:'Part-Time',nextModality:'Full-Time',modalityChangeDate:weekStart},staff[0]], weekStart).map(p=>p.name), ['Cambio','A Part']);
const data = {staff,schedules:{},weekStart,storeName:'PRUEBA',supervisorName:'Z Gerente'};
const identities = [...staff].reverse().map(p=>({name:p.name,dni:p.dni,area:'PRUEBA',supervisor:'Z Gerente'}));
assert.deepEqual(buildBukRows({...data,identities}).slice(1).map(row=>row[0]),expected);
const planning=createBukPlanningWorkbook(data);
const rows=XLSX.utils.sheet_to_json(planning.Sheets['PLANIFICACIÓN'],{header:1});
assert.deepEqual(rows.slice(1).map(row=>row[1]),expected);
assert.deepEqual(rows.slice(1).map(row=>row[0]),[1,2,3,4,5]);
const weekly=await buildWeeklyScheduleWorkbook(data);
const names=[];weekly.getWorksheet('Horario').eachRow(row=>{const value=row.getCell(2).value;if(expected.map(name=>name.toUpperCase()).includes(value))names.push(value)});
assert.deepEqual(names,expected.map(name=>name.toUpperCase()));
assert.deepEqual(staff,original);
console.log('PASS: gerente → asistentes → trainers → FT → PT en BUK, planificación/PDF y Excel semanal; numeración consecutiva y datos sin mutaciones');
