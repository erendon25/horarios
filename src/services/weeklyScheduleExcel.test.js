import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildWeeklyScheduleWorkbook } from './weeklyScheduleExcel.js';
import { getWeekDates, getExportShiftSegments, getHeatmapAssignments, getProjectionForDay, SCHEDULE_DAYS, SCHEDULE_DAY_LABELS } from './scheduleExportData.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { HEATMAP_LEGEND } from './heatmapExport.js';

export const weeklyExcelFixture = {
  weekStart: '2026-09-14', hasUnsavedChanges: true,
  staff: [
    { id: 'ft', name: 'Ana', lastName: 'Ejemplo', modality: 'Full-Time', position: 'COLABORADOR' },
    { id: 'manager', name: 'Gerente', lastName: 'Ejemplo', modality: 'Full-Time', position: 'GERENTE' },
    { id: 'split', name: 'Turno', lastName: 'Partido', modality: 'Part-Time', position: 'ENTRENADOR' },
    { id: 'ceased', name: 'Cese', lastName: 'Ejemplo', modality: 'Part-Time', cessationDate: '2026-09-15' },
    { id: 'old', name: 'No incluir', cessationDate: '2026-09-13' },
    { id: 'change', name: 'Cambio', lastName: 'Modalidad', modality: 'Part-Time', nextModality: 'Full-Time', modalityChangeDate: '2026-09-17' },
  ],
  schedules: {
    ft: { monday: { start: '09:00', end: '18:00', extraHoursPre: '0,5', extraHoursPost: 0.5, position: 'Servicio' }, tuesday: { start: '09:00', end: '18:00', off: true, position: 'Servicio' } },
    manager: { friday: { start: '16:15', end: '01:00', position: 'Servicio' } },
    split: { monday: { start: '09:00', end: '13:00', splitShift: true, start2: '17:00', end2: '21:00', position: 'Servicio' } },
    ceased: { monday: { start: '10:00', end: '14:00', position: 'Servicio' }, wednesday: { start: '10:00', end: '14:00', position: 'Servicio' } },
    change: { thursday: { start: '09:00', end: '17:45', feriado: true, position: 'Servicio' } },
  },
  requirements: Object.fromEntries(SCHEDULE_DAYS.slice(0, 6).map(day => [day, { positions: ['Servicio'], matrix: [Array(21).fill(1)] }])),
  projectionPositions: ['Servicio'],
};
const personRow = (sheet, name) => {
  let found;
  sheet.eachRow((row, index) => { if (row.getCell(2).value === name && !found) found = index; });
  return found;
};

test('modelo de horario y siete pestañas, fechas, colores y 24:00/25:00 preservados al reabrir', async () => {
  const workbook = await buildWeeklyScheduleWorkbook(weeklyExcelFixture);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(restored.worksheets.map(sheet => sheet.name), ['Horario', ...SCHEDULE_DAY_LABELS]);
  const sheet = restored.getWorksheet('Horario');
  assert.equal(sheet.columnCount, 24);
  assert.equal(sheet.getCell('C3').value.toISOString().slice(0, 10), '2026-09-14');
  assert.equal(sheet.getCell('U3').value.toISOString().slice(0, 10), '2026-09-20');
  assert.equal(sheet.getCell('C4').value, 'LUNES');
  assert.equal(sheet.getCell('C5').value, 'ENT.');
  assert.equal(sheet.getCell('D5').value, 'SAL.');
  assert.equal(sheet.getCell('E5').value, 'DUR.');
  assert.equal(sheet.getCell('X3').value, 'TOTAL HRS');
  assert.equal(sheet.getCell('A6').fill.fgColor.argb, 'FFC7DEB0');
  const manager = personRow(sheet, 'GERENTE EJEMPLO');
  const ft = personRow(sheet, 'ANA EJEMPLO');
  assert.equal(manager, 6);
  assert.equal(sheet.getCell(ft, 1).fill.fgColor.argb, 'FFFFF2CC');
  const beforeExport = workbook.getWorksheet('Horario');
  assert.equal(beforeExport.getCell(manager, 16).value, 25 / 24);
  assert.equal(sheet.getCell(manager, 16).numFmt, '[h]:mm');
  assert.equal(sheet.views[0].xSplit, 2);
  assert.equal(personRow(sheet, 'NO INCLUIR'), undefined);
  assert.match(restored.getWorksheet('Domingo').getCell('A6').value, /Sin proyección/);
});

test('duraciones brutas y total neto respetan extras, refrigerio, partidos, descansos, feriados y ceses', async () => {
  const workbook = await buildWeeklyScheduleWorkbook(weeklyExcelFixture);
  const sheet = workbook.getWorksheet('Horario');
  const ft = personRow(sheet, 'ANA EJEMPLO');
  assert.equal(sheet.getCell(ft, 3).value, 8.5 / 24);
  assert.equal(sheet.getCell(ft, 4).value, 18.5 / 24);
  assert.equal(sheet.getCell(ft, 5).value.result, 10 / 24);
  assert.equal(sheet.getCell(ft, 24).value, 9.25);
  assert.equal(sheet.getCell(ft, 6).value, null);
  assert.equal(sheet.getCell(ft, 8).result, 0);
  const split = personRow(sheet, 'TURNO PARTIDO');
  assert.equal(sheet.getCell(split, 3).value, 9 / 24);
  assert.equal(sheet.getCell(split + 1, 3).value, 17 / 24);
  assert.equal(sheet.getCell(split, 24).value, 8);
  assert.equal(sheet.getCell(split + 1, 24).master.address, `X${split}`);
  const change = personRow(sheet, 'CAMBIO MODALIDAD');
  assert.equal(sheet.getCell(change, 1).value, 'PT/FT');
  assert.equal(sheet.getCell(change, 12).value, 'FERIADO');
  assert.equal(sheet.getCell(change, 24).value, 8.75);
  assert.equal(sheet.getCell(personRow(sheet, 'CESE EJEMPLO'), 9).value, 'CESE');
  assert.ok(sheet.getColumn(1).values.some(value => String(value).startsWith('BORRADOR:')));
});

test('cada pestaña diaria usa exactamente las celdas del modelo compartido, sin copiar el lunes a los demás días', async () => {
  const workbook = await buildWeeklyScheduleWorkbook(weeklyExcelFixture);
  const dates = getWeekDates(weeklyExcelFixture.weekStart);
  for (let i = 0; i < 6; i++) {
    const day = SCHEDULE_DAYS[i];
    const projection = getProjectionForDay(weeklyExcelFixture.requirements, [], day);
    const assigned = getHeatmapAssignments(weeklyExcelFixture.staff, weeklyExcelFixture.schedules, day, projection.positions, dates[i]);
    const rows = buildHeatmapRows(assigned, projection);
    const sheet = workbook.getWorksheet(SCHEDULE_DAY_LABELS[i]);
    assert.equal(sheet.columnCount, HOURS.length + 1);
    rows.forEach((row, r) => row.cells.forEach((cell, c) => {
      const expected = HEATMAP_LEGEND.find(item => item.color === cell.color);
      assert.equal(sheet.getCell(r + 6, c + 2).fill.fgColor.argb, `FF${expected.hex}`);
    }));
  }
  const tuesday = getHeatmapAssignments(weeklyExcelFixture.staff, weeklyExcelFixture.schedules, 'tuesday', ['Servicio'], dates[1]);
  assert.deepEqual(tuesday, []); // stale clock times in an off day must not cover a position
  assert.notEqual(workbook.getWorksheet('Lunes').getCell('H6').value, workbook.getWorksheet('Martes').getCell('H6').value);
});

test('validación de fecha, cambio de mes y turnos partidos de madrugada', async () => {
  assert.equal(getWeekDates('2026-09-28')[6], '2026-10-04');
  assert.throws(() => getWeekDates('2026-02-30'), /válida/);
  assert.deepEqual(getExportShiftSegments({ start: '20:00', end: '23:00', splitShift: true, start2: '00:00', end2: '01:00' }), [{ start: 1200, end: 1380 }, { start: 1440, end: 1500 }]);
  await assert.rejects(buildWeeklyScheduleWorkbook({ staff: [], weekStart: '2026-09-14' }), /colaboradores/);
});
