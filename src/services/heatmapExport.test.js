import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildHeatmapPdf, buildHeatmapWorkbook, HEATMAP_LEGEND, heatmapFilename } from './heatmapExport.js';

const hours = Array.from({ length: 73 }, (_, i) => `${String(7 + Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`);
const rows = Array.from({ length: 60 }, (_, i) => ({
  name: i === 0 ? '=HYPERLINK("untrusted")' : `Posición ${i + 1}`,
  slot: i % 3,
  cells: hours.map((_, j) => ({ color: HEATMAP_LEGEND[j % 5].color })),
}));
const data = { rows, hours, date: '2026-09-18', dayLabel: 'Viernes' };

test('Excel conserva todas las filas, 73 franjas, colores, fecha y paneles congelados', async () => {
  const workbook = await buildHeatmapWorkbook(data);
  assert.equal(workbook.worksheets[0].getCell(5, 74).value, 25 / 24);
  const output = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(output);
  const sheet = reopened.getWorksheet('Mapa de cobertura');
  assert.equal(sheet.rowCount, 65);
  assert.equal(sheet.columnCount, 74);
  assert.match(sheet.getCell('A1').value, /Viernes 2026-09-18/);
  assert.equal(sheet.getCell(5, 74).value.toISOString(), '1899-12-31T01:00:00.000Z');
  assert.equal(sheet.getCell(5, 74).numFmt, '[h]:mm');
  assert.equal(sheet.getCell('A6').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('B6').value, 'F');
  assert.equal(sheet.getCell('B6').fill.fgColor.argb, 'FFFDE047');
  assert.equal(sheet.getCell('C6').value, 'A');
  assert.equal(sheet.getCell('D6').value, 'E');
  assert.equal(sheet.getCell('E6').value, 'T');
  assert.equal(sheet.views[0].xSplit, 1);
  assert.equal(sheet.views[0].ySplit, 5);
});

test('PDF pagina verticalmente y repite fecha, leyenda y horarios completos', async () => {
  const pdf = await buildHeatmapPdf(data);
  assert.equal(pdf.getNumberOfPages(), 3);
  const output = pdf.output();
  assert.equal((output.match(/Viernes 2026-09-18/g) || []).length, 3);
  assert.equal((output.match(/25:00/g) || []).length, 6); // nota + encabezado por página
  assert.ok(output.includes('Posici'));
  assert.ok(output.includes('60'));
});

test('no exporta matrices vacías o desalineadas y sanea el nombre del archivo', async () => {
  await assert.rejects(buildHeatmapPdf({ rows: [], hours }), /No hay/);
  await assert.rejects(buildHeatmapWorkbook({ rows: [{ cells: [] }], hours }), /incompletas/);
  assert.equal(heatmapFilename('2026-09-18'), 'mapa-cobertura-2026-09-18');
  assert.equal(heatmapFilename('../'), 'mapa-cobertura-sin-fecha');
});
