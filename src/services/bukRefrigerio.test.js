import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { getBukCatalogShift, bukRefrigerioRows, createBukPlanningWorkbook, createBukWorkbook, makeApprovedBukPatch, buildBukRows } from './bukSchedule.js';
import { getHeatmapAssignments } from './scheduleExportData.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { calculateScheduleDay } from './scheduleHours.js';

const person = { id: 'trainer', name: 'Trainer de prueba', modality: 'Full-Time', dni: '00000001', position: 'ENTRENADOR' };
const data = breakStart => ({ staff: [person], schedules: { trainer: { monday: { ...makeApprovedBukPatch('FT1-25'), breakStart } } }, weekStart: '2026-10-19', storeName: 'PRUEBA', supervisorName: 'Gerente de prueba' });
const roundTrip = workbook => XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }), { type: 'buffer' });

test('el turno BUK distingue su refrigerio fijo del break de cobertura y resuelve la medianoche', () => {
  const shift = data('19:00').schedules.trainer.monday;
  assert.deepEqual(getBukCatalogShift(shift, 'monday'), { code: '16:15 A 01:00', start: '16:15', end: '01:00', breakStart: '18:00', breakEnd: '18:45' });
  const rows = bukRefrigerioRows(data('19:00'));
  assert.deepEqual(rows[0], ['Trainer de prueba', 'Full-Time', '2026-10-19', 'Lunes', '16:15', '01:00', '16:15 A 01:00', '18:00–18:45', '19:00–19:45', 'Diferencia de refrigerio']);
  assert.equal(rows[1].at(-1), 'Sin turno');
});

test('Excel planificación permite exportar con otro break de cobertura y hace visibles ambas horas', () => {
  const input = data('23:00'), original = structuredClone(input);
  assert.equal(buildBukRows(input)[1][4], '16:15 A 01:00');
  const workbook = roundTrip(createBukPlanningWorkbook(input));
  assert.ok(workbook.Sheets.BUK);
  assert.equal(workbook.Sheets['BUK PENDIENTE'], undefined);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.REFRIGERIOS, { header: 1 });
  assert.equal(rows[0][7], 'Refrigerio BUK');
  assert.equal(rows[0][8], 'Break de cobertura');
  assert.deepEqual(rows[1].slice(-3), ['18:00–18:45', '23:00–23:45', 'Diferencia de refrigerio']);
  assert.deepEqual(input, original, 'Export must not move assigned breaks or change saved schedules');
});

test('el archivo de importación mantiene el código, las cuatro hojas y la colación BUK aunque cambie la cobertura', () => {
  const workbook = createBukWorkbook(data('23:00'));
  assert.deepEqual(workbook.SheetNames, ['turnosColaboradores', 'turnosSemanales', 'turnosFlexibles', 'turnosTransitorios']);
  assert.ok(workbook.Sheets.turnosSemanales['!cols'][5].wch >= 22);
  const reopened = roundTrip(workbook);
  const assigned = XLSX.utils.sheet_to_json(reopened.Sheets.turnosColaboradores, { header: 1 });
  assert.equal(assigned[1][4], '16:15 A 01:00');
  const catalog = XLSX.utils.sheet_to_json(reopened.Sheets.turnosSemanales, { header: 1 });
  assert.deepEqual(catalog[0].slice(5), ['Entrada de colación', 'Salida de colación']);
  assert.deepEqual(catalog.find(row => row[1] === '16:15 A 01:00' && row[2] === 'Lunes').slice(5), ['18:00', '18:45']);
});

test('exportar BUK conserva el break del heatmap y descuenta una sola vez los 45 minutos', () => {
  const input = data('19:00');
  input.schedules.trainer.monday.position = 'Caja';
  const before = structuredClone(input);
  assert.equal(buildBukRows(input)[1][4], '16:15 A 01:00');
  const rows = buildHeatmapRows(getHeatmapAssignments(input.staff, input.schedules, 'monday', ['Caja'], input.weekStart), { positions: ['Caja'], matrix: [Array(21).fill(1)] });
  assert.equal(rows[0].cells[HOURS.indexOf('18:00')].color, 'bg-orange-500', 'BUK collation does not remove internal coverage');
  for (const time of ['19:00', '19:15', '19:30']) assert.equal(rows[0].cells[HOURS.indexOf(time)].color, 'bg-yellow-300', time);
  assert.equal(rows[0].cells[HOURS.indexOf('19:45')].color, 'bg-orange-500');
  assert.equal(rows[0].cells[HOURS.indexOf('25:00')].color, 'bg-orange-500', 'The last coverage cell is preserved');
  assert.equal(calculateScheduleDay(input.schedules.trainer.monday, 'Full-Time').baseMinutes, 480);
  assert.deepEqual(input, before);
});

test('Part-Time sin break ignora la marca antigua y no crea diferencias ficticias', () => {
  const input = data('23:00');
  input.staff[0] = { ...person, modality: 'Part-Time', position: 'COLABORADOR' };
  input.schedules.trainer.monday = { ...makeApprovedBukPatch('PT2-33'), breakStart: '23:00', bukBreakMinutes: 45, bukBreakIncludedInHours: true };
  const row = bukRefrigerioRows(input)[0];
  assert.deepEqual(row.slice(-3), ['Sin refrigerio', 'Sin break', 'Sin refrigerio']);
});

test('respeta descansos, compensaciones, cese y exención de gerentes y asistentes', () => {
  for (const [patch, state] of [[{ off: true }, 'Descanso'], [{ feriado: true }, 'Feriado compensado'], [{ holiday: true }, 'Feriado compensado']]) {
    const input = data('19:00');
    Object.assign(input.schedules.trainer.monday, patch);
    const row = bukRefrigerioRows(input)[0];
    assert.equal(row.at(-1), state);
    assert.deepEqual(row.slice(6, 9), ['', '', '']);
  }
  for (const position of ['GERENTE', 'ASISTENTE']) {
    const input = data('19:00'); input.staff[0] = { ...person, position };
    assert.equal(bukRefrigerioRows(input)[0].at(-1), 'No se envía a BUK');
  }
  const ceased = data('19:00'); ceased.staff[0] = { ...person, cessationDate: '2026-10-18' };
  assert.equal(bukRefrigerioRows(ceased)[0].at(-1), 'Cese');
});

test('usa el catálogo proporcionado y no decide entre definiciones BUK ambiguas', () => {
  const shift = data('19:00').schedules.trainer.monday;
  const custom = [{ code: 'T1', day: 'Lunes', start: '16:15', end: '01:00', breakStart: '19:00', breakEnd: '19:45' }];
  assert.equal(bukRefrigerioRows({ ...data('19:00'), catalog: custom })[0].at(-1), 'Coincide');
  assert.equal(getBukCatalogShift(shift, 'monday', [...custom, { ...custom[0], breakStart: '20:00' }]), null);
  assert.equal(getBukCatalogShift(shift, 'tuesday', custom), null);
});
