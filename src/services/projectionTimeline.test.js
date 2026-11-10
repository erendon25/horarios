import test from 'node:test';
import assert from 'node:assert/strict';
import { expandProjectionHours, normalizeProjectionManualStaff, projectionQuantityAtMinute } from './projectionTimeline.js';
import { calculatePositionStaffByGeneralVhl } from './projectionVhl.js';
import { summarizeProjectionHours } from './projectionHours.js';
import { getProjectionForDay } from './scheduleExportData.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { validateHeatmapTransfer } from './heatmapTransfers.js';
import { buildHeatmapWorkbook } from './heatmapExport.js';

const source = () => ({ positions: ['Vestido'], startMinutes: 660, intervalMinutes: 15, matrix: { 0: { 0: 1, 1: 2, 2: 3, 3: 4 } } });

test('tramos de 15 minutos cruzan medianoche sin perder su hora de origen', () => {
  assert.deepEqual(expandProjectionHours(['23:00', '00:00']).map(slot => slot.hour), ['23:00','23:15','23:30','23:45','00:00','00:15','00:30','00:45']);
  assert.ok(expandProjectionHours(['00:00']).every(slot => slot.sourceHour === '00:00'));
});

test('migrar ajustes horarios conserva ceros y cada cuarto se vuelve independiente', () => {
  const old = { lunes: { vestido: { '12:00': 2, '00:00': 0 } } };
  const quarters = normalizeProjectionManualStaff(old);
  assert.deepEqual(quarters.lunes.vestido, { '12:00':2,'12:15':2,'12:30':2,'12:45':2,'00:00':0,'00:15':0,'00:30':0,'00:45':0 });
  quarters.lunes.vestido['12:15'] = 3;
  assert.equal(old.lunes.vestido['12:00'], 2);
  assert.equal(quarters.lunes.vestido['12:00'], 2);
  assert.equal(normalizeProjectionManualStaff(quarters, 15), quarters);
});

test('dividir la venta por cuatro conserva dotación y horas de todas las lógicas', () => {
  const options = { sale: 1200, generalVhl: 500, positions: [
    { id:'cocina',name:'Vestido',logic:'sales' },
    { id:'masa',logic:'sales',factor:0.55 },
    { id:'servicio',logic:'service',ticketAverage:35,transactionsPerCollaborator:23,factor:1 },
    { id:'driver',logic:'driver',ticketAverage:35,factor:1 },
    { id:'fijo',logic:'fixed',fixedStaff:2 },
  ] };
  const hourly = calculatePositionStaffByGeneralVhl(options);
  const quarter = calculatePositionStaffByGeneralVhl({ ...options, sale:300, intervalMinutes:15 });
  assert.deepEqual(quarter, hourly);
  const matrix = options.positions.map(position => Array(4).fill(quarter.requiredByPosition[position.id]));
  assert.ok(Math.abs(summarizeProjectionHours({ monday: { positions:options.positions.map(p=>p.id),intervalMinutes:15,matrix } }, [], 'monday').dayHours - hourly.totalStaffAtHour) < 1e-10);
});

test('las horas y cobertura respetan inicio real y cantidades independientes por cuarto', () => {
  const day = getProjectionForDay({ monday:source() }, [], 'monday');
  assert.equal(day.startMinutes, 660);
  assert.equal(day.intervalMinutes, 15);
  assert.equal(summarizeProjectionHours({ monday:day }, [], 'monday').dayHours, 2.5);
  for (const [minute, expected] of [[645,0],[660,1],[675,2],[690,3],[705,4],[720,0]]) {
    assert.equal(projectionQuantityAtMinute(day, 0, minute), expected);
    const rows = buildHeatmapRows([], day);
    const index = HOURS.indexOf(`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`);
    assert.equal(rows.filter(row=>row.cells[index].color==='bg-yellow-300').length, expected);
  }
});

test('las proyecciones horarias antiguas mantienen sus totales y alineación', () => {
  const legacy = { positions:['Vestido'],matrix:[[2,3]] };
  assert.equal(summarizeProjectionHours({ monday:legacy }, [], 'monday').dayHours, 5);
  assert.deepEqual([480,495,510,525,540,555].map(minute=>projectionQuantityAtMinute(legacy,0,minute)), [2,2,2,2,3,3]);
  const overnight = { positions:['Vestido'],startMinutes:1425,intervalMinutes:15,matrix:[[1,2,3,4]] };
  assert.deepEqual([1425,1440,1455,1470,1485].map(minute=>projectionQuantityAtMinute(overnight,0,minute)), [1,2,3,4,0]);
});

test('filas y columnas dispersas no desplazan áreas ni intervalos al exportar', () => {
  const day = getProjectionForDay({ monday:{ ...source(),positions:['Vestido','Masa'],matrix:{1:{2:3}} } }, [], 'monday');
  assert.equal(projectionQuantityAtMinute(day,0,690),0);
  assert.equal(projectionQuantityAtMinute(day,1,690),3);
  assert.equal(projectionQuantityAtMinute(day,1,660),0);
});

test('los movimientos validan cada cuarto y no replican la demanda de la hora', () => {
  const assigned = ['a','b'].map(staffId=>({staffId,position:'Caja',start:'11:00',end:'12:00'}));
  const requirements = { positions:['Caja','Cocina'],startMinutes:660,intervalMinutes:15,matrix:[[1,2,1,1],[1,1,0,1]] };
  const transfer = {staffId:'a',source:'Caja',position:'Cocina',start:660,end:675};
  assert.equal(validateHeatmapTransfer(assigned,requirements,transfer),'');
  assert.match(validateHeatmapTransfer(assigned,requirements,{...transfer,start:675,end:690}),/origen/);
  assert.match(validateHeatmapTransfer(assigned,requirements,{...transfer,start:690,end:705}),/destino/);
});

test('Excel conserva la cobertura distinta de cada cuarto del día', async () => {
  const workbook = await buildHeatmapWorkbook({rows:buildHeatmapRows([],source()),hours:HOURS,date:'2026-11-10',dayLabel:'Martes'});
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell(9,HOURS.indexOf('11:30')+2).value,'');
  assert.equal(sheet.getCell(9,HOURS.indexOf('11:45')+2).value,'F');
});
