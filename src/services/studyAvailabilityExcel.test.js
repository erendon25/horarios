import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildStudyAvailabilityRows, buildStudyAvailabilityWorkbook, studyAvailabilityFilename, STUDY_EXPORT_HEADERS } from './studyAvailabilityExcel.js';
const person = { id: 'p1', name: 'Ana', lastName: 'Pérez', storeId: 'porongoche', position: 'Colaborador PT', study_schedule: { monday: { blocks: [{ start: '09:13', end: '12:07' }, { start: '16:00', end: '18:00' }] }, tuesday: { free: true, blocks: [{ start: '09:00', end: '10:00' }] } } };
const input = { staff: [person], storeId: 'porongoche', storeName: 'PORONGOCHE', referenceDate: new Date(2026, 10, 10) };
test('siete columnas, múltiples bloques y libre 08:00 a 23:00, sin modificar origen', () => {
  const before = JSON.stringify(input);
  const rows = buildStudyAvailabilityRows(input);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].slice(0, 5), ['PORONGOCHE', 'Ana Pérez', 'Colaborador PT', 'Horario de estudio', 'Lunes']);
  assert.equal(rows[0][5], 553 / 1440);
  assert.equal(rows[0][6], 727 / 1440);
  assert.deepEqual(rows[2].slice(3), ['Día libre solicitado', 'Martes', 8 / 24, 23 / 24]);
  assert.equal(JSON.stringify(input), before);
});
test('excluye otras tiendas, inactivos, cesados e históricos; incluye no vinculados', () => {
  const staff = [person, { ...person, id: 'p2', storeId: 'otra' }, { ...person, status: 'inactive' }, { ...person, cessationDate: '2026-11-09' }, { ...person, reconstructedFromHistory: true }, { ...person, uid: null, name: 'No vinculado', study_schedule: { sunday: { free: true } } }];
  assert.equal(buildStudyAvailabilityRows({ ...input, staff }).length, 4);
});
test('horas inválidas abortan en lugar de producir archivo incompleto', () => {
  for (const block of [{ start: '', end: '10:00' }, { start: '25:00', end: '26:00' }, { start: '12:60', end: '14:00' }, { start: '12:00', end: '12:00' }, { start: '24:00', end: '08:00' }]) {
    assert.throws(() => buildStudyAvailabilityRows({ ...input, staff: [{ ...person, study_schedule: { monday: { blocks: [block] } } }] }), /no son válidos/);
  }
  assert.throws(() => buildStudyAvailabilityRows({ ...input, staff: [] }), /No hay/);
  assert.throws(() => buildStudyAvailabilityRows({ ...input, storeName: '' }), /tienda/);
});
test('reabre xlsx, mantiene texto sin fórmulas, encabezados y horas Excel', async () => {
  const book = await buildStudyAvailabilityWorkbook({ ...input, staff: [{ ...person, name: '=HYPERLINK("untrusted")' }] });
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await book.xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('Horarios de estudio');
  assert.deepEqual(sheet.getRow(1).values.slice(1), STUDY_EXPORT_HEADERS);
  assert.equal(sheet.rowCount, 4);
  assert.equal(sheet.columnCount, 7);
  assert.equal(sheet.getCell('B2').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('F2').value.toISOString(), '1899-12-30T09:13:00.000Z');
  assert.equal(sheet.getCell('F4').value.toISOString(), '1899-12-30T08:00:00.000Z');
  assert.equal(sheet.getCell('G4').value.toISOString(), '1899-12-30T23:00:00.000Z');
  assert.equal(sheet.getCell('F2').numFmt, 'hh:mm');
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.autoFilter, 'A1:G4');
});
test('nombre archivo no contiene rutas', () => {
  assert.equal(studyAvailabilityFilename('PORONGOCHE'), 'Disponibilidades_PORONGOCHE.xlsx');
  assert.ok(!studyAvailabilityFilename('../tienda: A\\B').includes('/'));
});

 test('exporta cruces de medianoche con hora y día siguiente explícito', async () => {
  for (const [start, end, expectedEnd] of [['16:00', '01:00', 25 / 24], ['23:00', '12:30', 36.5 / 24], ['16:00', '24:00', 1]]) {
    const data = { ...input, staff: [{ ...person, study_schedule: { saturday: { blocks: [{ start, end }] } } }] };
    const rows = buildStudyAvailabilityRows(data);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][6], expectedEnd);
    assert.match(rows[0][3], /día siguiente/);
    assert.equal(rows[0][4], 'Sábado');
    const wb = await buildStudyAvailabilityWorkbook(data);
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await wb.xlsx.writeBuffer());
    const cell = restored.getWorksheet('Horarios de estudio').getCell('G2');
    assert.equal(cell.numFmt, 'hh:mm');
    assert.equal(cell.value.getUTCDate(), 31);
    assert.match(JSON.stringify(cell.note), /día siguiente/);
  }
});
