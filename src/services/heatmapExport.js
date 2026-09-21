// Export the same cells shown on screen, including columns outside the viewport.
export const HEATMAP_LEGEND = [
  { color: 'bg-yellow-300', hex: 'FDE047', label: 'Faltante', code: 'F' },
  { color: 'bg-blue-500', hex: '3B82F6', label: 'Asignado', code: 'A' },
  { color: 'bg-red-500', hex: 'EF4444', label: 'Exceso', code: 'E' },
  { color: 'bg-orange-500', hex: 'F97316', label: 'Entrenador', code: 'T' },
  { color: 'bg-white', hex: 'FFFFFF', label: 'Sin requerimiento', code: '' },
];
const styleFor = (cell) => HEATMAP_LEGEND.find(({ color }) => color === cell?.color) || HEATMAP_LEGEND[4];
const laneName = (row) => `${row.name} (${row.slot + 1})`;
export const heatmapFilename = (date = '') => `mapa-cobertura-${date.replace(/[^0-9-]/g, '') || 'sin-fecha'}`;

function validate({ rows, hours }) {
  if (!rows?.length || !hours?.length) throw new Error('No hay una matriz para exportar.');
  if (rows.some((row) => row.cells.length !== hours.length)) throw new Error('La matriz tiene columnas incompletas.');
}

export async function buildHeatmapWorkbook({ rows, hours, date = '', dayLabel = '' }) {
  validate({ rows, hours });
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  addHeatmapWorksheet(workbook, { rows, hours, date, dayLabel });
  return workbook;
}

export function addHeatmapWorksheet(workbook, { rows, hours, date = '', dayLabel = '', sheetName = 'Mapa de cobertura', noProjection = false }) {
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 5, showGridLines: false }],
    pageSetup: { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5', printTitlesColumn: 'A:A' },
  });
  const lastColumn = hours.length + 1;
  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.getCell('A1').value = `Mapa de cobertura - ${dayLabel} ${date}`.trim();
  sheet.getCell('A1').font = { name: 'Calibri', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell('A2').value = 'Intervalos de 15 minutos. 24:00 y 25:00 corresponden al día siguiente. Cada fila representa un carril de una posición.';
  sheet.getRow(2).height = 24;
  HEATMAP_LEGEND.forEach((item, index) => {
    const start = index === 0 ? 1 : 2 + (index - 1) * 8;
    const end = index === 0 ? 1 : start + 7;
    if (end > start) sheet.mergeCells(3, start, 3, end);
    const cell = sheet.getCell(3, start);
    cell.value = item.code ? `${item.code}: ${item.label}` : item.label;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${item.hex}` } };
    cell.font = { bold: true, size: 10 };
  });
  sheet.getRow(3).height = 23;
  sheet.mergeCells('A4:A5');
  sheet.getCell('A4').value = 'Posición / carril';
  hours.forEach((hour, index) => {
    const [h, m] = hour.split(':').map(Number);
    if (m === 0) {
      const end = Math.min(index + 5, lastColumn);
      if (end > index + 2) sheet.mergeCells(4, index + 2, 4, end);
      sheet.getCell(4, index + 2).value = hour;
    }
    const cell = sheet.getCell(5, index + 2);
    cell.value = (h * 60 + m) / 1440;
    cell.numFmt = '[h]:mm';
    sheet.getColumn(index + 2).width = 6.5;
  });
  [4, 5].forEach((rowNumber) => {
    sheet.getRow(rowNumber).height = 23;
    sheet.getRow(rowNumber).eachCell((cell) => {
      cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });
  sheet.getColumn(1).width = 38;
  rows.forEach((row, index) => {
    const output = sheet.getRow(index + 6);
    output.height = 32;
    output.getCell(1).value = laneName(row);
    output.getCell(1).font = { name: 'Calibri', bold: true, size: 11 };
    output.getCell(1).alignment = { vertical: 'middle', wrapText: true };
    row.cells.forEach((cell, j) => {
      const style = styleFor(cell);
      const target = output.getCell(j + 2);
      target.value = style.code;
      target.font = { name: 'Calibri', size: 10, bold: true };
      target.alignment = { horizontal: 'center', vertical: 'middle' };
      target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.hex}` } };
      target.border = Object.fromEntries(['top', 'bottom', 'left', 'right'].map((side) => [side, { style: 'thin', color: { argb: 'FFE5E7EB' } }]));
    });
  });
  if (rows.length === 0) {
    sheet.mergeCells(6, 1, 6, lastColumn);
    sheet.getCell('A6').value = noProjection ? 'Sin proyección cargada para este día. No se ha calculado cobertura.' : 'Sin posiciones para mostrar.';
    sheet.getRow(6).height = 30;
  }
  sheet.pageSetup.printArea = `A1:${sheet.getCell(Math.max(6, rows.length + 5), lastColumn).address}`;
  return sheet;
}

export async function buildHeatmapPdf({ rows, hours, date = '', dayLabel = '' }) {
  validate({ rows, hours });
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const margin = 12;
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const nameWidth = 62;
  const cellWidth = (width - margin * 2 - nameWidth) / hours.length;
  const rowHeight = 9;
  const top = 43;
  const perPage = Math.floor((height - top - 18) / rowHeight);
  const pages = Math.ceil(rows.length / perPage);
  for (let page = 0; page < pages; page++) {
    if (page > 0) pdf.addPage();
    pdf.setTextColor(31, 41, 55);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(`Mapa de cobertura - ${dayLabel} ${date}`.trim(), margin, 15);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Intervalos de 15 minutos. 24:00 y 25:00 corresponden al día siguiente. Filas por posición y carril.', margin, 22);
    HEATMAP_LEGEND.forEach((item, index) => {
      const x = margin + index * 65;
      pdf.setFillColor(`#${item.hex}`);
      pdf.setDrawColor(180);
      pdf.rect(x, 26, 4, 4, 'FD');
      pdf.text(item.label, x + 6, 29);
    });
    pdf.setFillColor(55, 65, 81);
    pdf.rect(margin, 35, width - 2 * margin, 8, 'F');
    pdf.setTextColor(255);
    pdf.setFontSize(8);
    pdf.text('Posición / carril', margin + 2, 40);
    hours.forEach((hour, index) => {
      if (!hour.endsWith(':00')) return;
      const span = Math.min(4, hours.length - index);
      const x = margin + nameWidth + index * cellWidth;
      pdf.setFontSize(span === 1 ? 5 : 8);
      pdf.text(hour, x + span * cellWidth / 2, 40, { align: 'center' });
    });
    rows.slice(page * perPage, (page + 1) * perPage).forEach((row, index) => {
      const y = top + index * rowHeight;
      pdf.setDrawColor(210);
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, nameWidth, rowHeight, 'FD');
      pdf.setTextColor(31, 41, 55);
      pdf.setFontSize(8);
      const label = pdf.splitTextToSize(laneName(row), nameWidth - 4);
      pdf.text(label.slice(0, 2), margin + 2, y + (label.length > 1 ? 3.5 : 5.5));
      row.cells.forEach((cell, j) => {
        pdf.setFillColor(`#${styleFor(cell).hex}`);
        pdf.rect(margin + nameWidth + j * cellWidth, y, cellWidth, rowHeight, 'FD');
      });
    });
    pdf.setTextColor(80);
    pdf.setFontSize(9);
    pdf.text(`Página ${page + 1} de ${pages}`, width - margin, height - 8, { align: 'right' });
  }
  return pdf;
}

export async function downloadHeatmap(format, data) {
  if (format === 'pdf') {
    const pdf = await buildHeatmapPdf(data);
    pdf.save(`${heatmapFilename(data.date)}.pdf`);
  } else if (format === 'xlsx') {
    const workbook = await buildHeatmapWorkbook(data);
    const buffer = await workbook.xlsx.writeBuffer();
    const { saveAs } = await import('file-saver');
    saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${heatmapFilename(data.date)}.xlsx`);
  } else throw new Error('Formato no compatible.');
}
