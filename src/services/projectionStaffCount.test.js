import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { operationalStaffCount as count } from './projectionStaffCount.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { validateHeatmapTransfer } from './heatmapTransfers.js';
import { buildHeatmapWorkbook, buildHeatmapPdf } from './heatmapExport.js';
import { summarizeProjectionHours } from './projectionHours.js';

const projection = (quantity) => ({ positions: ['Caja'], matrix: [Array(21).fill(quantity)] });
const assigned = (quantity, position = 'Caja') => Array.from({ length: quantity }, (_, index) => ({
  staffId: `${position}-${index}`, staffName: `Persona ${index}`, position, start: '09:00', end: '17:00',
}));
const cellsAt = (rows, time) => rows.map((row) => row.cells[HOURS.indexOf(time)]);
const transfer = { staffId: 'Caja-0', source: 'Caja', position: 'Masa', start: 600, end: 660 };
const transferRequirements = (source, destination) => ({
  positions: ['Caja', 'Masa'], matrix: [Array(21).fill(source), Array(21).fill(destination)],
});

test('la cantidad operativa usa el mismo redondeo habitual aprobado en pantalla', () => {
  for (const [value, expected] of [[2.2, 2], [2.6, 3], [0.4, 0], [0.8, 1], [0.5, 1], ['2.2', 2], ['2.6', 3]]) {
    assert.equal(count(value), expected);
  }
  for (let value = 0; value <= 20; value += 1) assert.equal(count(value), value);
  for (const invalid of [-1, NaN, Infinity, -Infinity, 'incorrecto', null, undefined, true, {}]) {
    assert.equal(count(invalid), 0);
  }
});

test('las fracciones generan exactamente los carriles requeridos sin slots fraccionarios', () => {
  for (const [quantity, required] of [[2.2, 2], [2.6, 3], [0.4, 0], [0.8, 1]]) {
    const rows = buildHeatmapRows([], projection(quantity));
    assert.equal(rows.length, Math.max(1, required)); // Preserve the existing empty-position placeholder.
    assert.equal(cellsAt(rows, '10:00').filter((cell) => cell.color === 'bg-yellow-300').length, required);
    assert.ok(rows.every((row) => Number.isInteger(row.slot)));
    assert.equal(new Set(rows.map((row) => row.slot)).size, rows.length);
  }
});

test('2.2 con tres personas muestra dos asignados y un exceso, sin duplicar la tercera persona', () => {
  const rows = buildHeatmapRows(assigned(3), projection(2.2));
  assert.deepEqual(rows.map((row) => row.slot), [0, 1, 2]);
  assert.deepEqual(cellsAt(rows, '10:00').map((cell) => cell.color), ['bg-blue-500', 'bg-blue-500', 'bg-red-500']);
  assert.equal(cellsAt(rows, '10:00').filter((cell) => cell.isExcess).length, 1);
  assert.equal(rows[0].groupSize, 3);
});

test('2.6 requiere tres personas; 0.4 no requiere una persona y 0.8 sí la requiere', () => {
  assert.deepEqual(cellsAt(buildHeatmapRows(assigned(3), projection(2.6)), '10:00').map((cell) => cell.color),
    ['bg-blue-500', 'bg-blue-500', 'bg-blue-500']);
  assert.equal(cellsAt(buildHeatmapRows(assigned(1), projection(0.4)), '10:00')[0].color, 'bg-red-500');
  assert.equal(cellsAt(buildHeatmapRows(assigned(1), projection(0.8)), '10:00')[0].color, 'bg-blue-500');
});

test('el trainer conserva naranja al cubrir y rojo en cualquier exceso, respetando su break', () => {
  const trainers = assigned(3).map((person) => ({ ...person, isTrainer: true,
    breakStartMinutes: 780, breakEndMinutes: 825 }));
  const requirements = projection(2);
  requirements.matrix[0][3] = 1; // At 11:00, the second normal lane is also excess.
  const rows = buildHeatmapRows(trainers, requirements);
  assert.deepEqual(cellsAt(rows, '10:00').map((cell) => cell.color), ['bg-orange-500', 'bg-orange-500', 'bg-red-500']);
  assert.deepEqual(cellsAt(rows, '11:00').map((cell) => cell.color), ['bg-orange-500', 'bg-red-500', 'bg-red-500']);
  for (const cell of cellsAt(rows, '11:00')) assert.equal(cell.isTrainer, true);
  assert.ok(cellsAt(rows, '11:00').slice(1).every((cell) => cell.isExcess));
  assert.deepEqual(cellsAt(rows, '13:00').map((cell) => cell.color), ['bg-yellow-300', 'bg-yellow-300', 'bg-white']);
  assert.deepEqual(cellsAt(rows, '13:45').map((cell) => cell.color), ['bg-orange-500', 'bg-orange-500', 'bg-red-500']);
});

test('transferir desde 2.6 exige dejar tres personas y desde 2.2 permite dejar dos', () => {
  assert.match(validateHeatmapTransfer(assigned(3), transferRequirements(2.6, 0.8), transfer), /origen/);
  assert.equal(validateHeatmapTransfer(assigned(4), transferRequirements(2.6, 0.8), transfer), '');
  assert.equal(validateHeatmapTransfer(assigned(3), transferRequirements(2.2, 0.8), transfer), '');
  assert.match(validateHeatmapTransfer(assigned(2), transferRequirements(2.2, 0.8), transfer), /origen/);
});

test('los faltantes del destino usan exactamente la cantidad entera visible', () => {
  assert.match(validateHeatmapTransfer(assigned(2), transferRequirements(0.8, 0.4), transfer), /destino/);
  assert.equal(validateHeatmapTransfer(assigned(1), transferRequirements(0.4, 0.8), transfer), '');
  assert.match(validateHeatmapTransfer(assigned(1), transferRequirements(0.8, 0.8), transfer), /origen/);
  const filled = [...assigned(4), ...assigned(3, 'Masa')];
  assert.match(validateHeatmapTransfer(filled, transferRequirements(2.6, 2.6), transfer), /destino/);
});

test('el mismo límite operativo se usa con matrices compactas y cantidades como texto', () => {
  const requirements = { positions: ['Caja', 'Masa'], matrix: { 0: { 2: '2.6' }, 1: { 2: '0.8' } } };
  assert.match(validateHeatmapTransfer(assigned(3), requirements, transfer), /origen/);
  assert.equal(validateHeatmapTransfer(assigned(4), requirements, transfer), '');
});

test('redondear el mapa no modifica la proyección guardada ni sus HH precisas', () => {
  const requirements = { positions: ['Caja'], matrix: [[2.2, 2.2, 2.2]] };
  const original = structuredClone(requirements);
  const before = summarizeProjectionHours({ monday: requirements }, [], 'monday');
  buildHeatmapRows(assigned(3), requirements);
  const after = summarizeProjectionHours({ monday: requirements }, [], 'monday');
  assert.deepEqual(requirements, original);
  assert.deepEqual(after, before);
  assert.ok(Math.abs(after.dayHours - 6.6) < 1e-10);
  assert.notEqual(after.dayHours, 6);
});

test('Excel y PDF exportan los tres carriles enteros y el exceso mostrado en pantalla', async () => {
  const rows = buildHeatmapRows(assigned(3), projection(2.2));
  const data = { rows, hours: HOURS, date: '2026-10-26', dayLabel: 'Lunes' };
  const workbook = await buildHeatmapWorkbook(data);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = restored.getWorksheet('Mapa de cobertura');
  assert.equal(sheet.rowCount, 8);
  assert.deepEqual([6, 7, 8].map((row) => sheet.getCell(row, 1).value), ['Caja (1)', 'Caja (2)', 'Caja (3)']);
  const column = HOURS.indexOf('10:00') + 2;
  assert.deepEqual([6, 7, 8].map((row) => sheet.getCell(row, column).value), ['A', 'A', 'E']);
  const pdf = await buildHeatmapPdf(data);
  const output = pdf.output();
  assert.equal(pdf.getNumberOfPages(), 1);
  assert.ok(output.includes('Caja \\(3\\)'));
  assert.equal(output.includes('Caja \\(4\\)'), false);
});

test('Excel y PDF conservan el exceso rojo del trainer y naranja en cobertura normal', async () => {
  const rows = buildHeatmapRows(assigned(3).map((person) => ({ ...person, isTrainer: true })), projection(2));
  const cells = cellsAt(rows, '10:00');
  assert.ok(cells.every((cell) => cell.isTrainer));
  assert.equal(cells[2].isExcess, true);
  const data = { rows, hours: HOURS, date: '2026-10-26', dayLabel: 'Lunes' };
  const workbook = await buildHeatmapWorkbook(data);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = restored.getWorksheet('Mapa de cobertura');
  const column = HOURS.indexOf('10:00') + 2;
  assert.deepEqual([6, 7, 8].map((row) => sheet.getCell(row, column).value), ['T', 'T', 'E']);
  assert.deepEqual([6, 7, 8].map((row) => sheet.getCell(row, column).fill.fgColor.argb), ['FFF97316', 'FFF97316', 'FFEF4444']);
  const pdf = await buildHeatmapPdf(data);
  const output = pdf.output();
  assert.ok(output.includes('0.94 0.27 0.27 rg'), 'PDF uses the shared red excess color');
  assert.ok(output.includes('0.98 0.45 0.09 rg'), 'PDF retains the shared orange trainer color');
});
