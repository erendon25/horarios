import { addHeatmapWorksheet } from './heatmapExport.js';
import { HOURS, buildHeatmapRows } from './heatmapModel.js';
import { calculateScheduleTotals } from './scheduleHours.js';
import {
  SCHEDULE_DAYS, SCHEDULE_DAY_LABELS, getWeekDates, effectiveModality,
  shortModality, isManagement, isActiveOnDate, getExportShiftSegments,
  getHeatmapAssignments, getProjectionForDay,
} from './scheduleExportData.js';

const fill = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } });
const border = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, { style: 'thin', color: { argb: 'FF808080' } }]));
const colorFor = (person, date) => isManagement(person) ? 'C7DEB0' : shortModality(effectiveModality(person, date)) === 'FT' ? 'FFF2CC' : 'DAEBF5';
const durationFormula = (entry, exit) => `IF(COUNT(${entry}:${exit})<2,0,IF(${exit}<${entry},${exit}+1-${entry},${exit}-${entry}))`;
const numericExtras = value => Math.max(0, Number(String(value ?? 0).replace(',', '.')) || 0);

export async function buildWeeklyScheduleWorkbook({ staff = [], schedules = {}, weekStart, requirements = {}, projectionPositions = [], hasUnsavedChanges = false }) {
  const dates = getWeekDates(weekStart);
  const people = staff.filter(person => isActiveOnDate(person, dates[0])).slice().sort((a, b) => (
    Number(isManagement(b)) - Number(isManagement(a))
    || Number(shortModality(effectiveModality(b, dates[0])) === 'FT') - Number(shortModality(effectiveModality(a, dates[0])) === 'FT')
    || `${a.name || ''} ${a.lastName || ''}`.localeCompare(`${b.name || ''} ${b.lastName || ''}`, 'es')
  ));
  if (!people.length) throw new Error('No hay colaboradores para exportar en esta semana.');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('Horario', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 5, showGridLines: false }],
    pageSetup: { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5' },
  });
  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 54;
  for (let i = 3; i <= 23; i++) sheet.getColumn(i).width = 8;
  sheet.getColumn(24).width = 12;
  const styleRow = (number, color = 'FFFFFF', bold = false) => {
    const row = sheet.getRow(number);
    row.height = 22;
    for (let col = 1; col <= 24; col++) {
      const cell = row.getCell(col);
      cell.font = { name: 'Arial', size: 10, bold };
      cell.fill = fill(color);
      cell.border = border;
      cell.alignment = { horizontal: col === 2 && number >= 6 ? 'left' : 'center', vertical: 'middle', wrapText: true };
    }
    return row;
  };
  for (let row = 1; row <= 5; row++) styleRow(row);
  sheet.mergeCells('A1:B2');
  sheet.getCell('A1').value = 'TODO EL PERSONAL';
  sheet.getCell('A1').font = { name: 'Arial', size: 10, bold: true };
  sheet.mergeCells('C1:X2');
  sheet.getCell('C1').value = 'HORARIO';
  sheet.getCell('C1').font = { name: 'Arial', size: 24, bold: true };
  for (const [range, label] of [['A3:A5', 'M'], ['B3:B5', 'APELLIDOS Y NOMBRES'], ['X3:X5', 'TOTAL HRS']]) {
    sheet.mergeCells(range);
    const cell = sheet.getCell(range.split(':')[0]);
    cell.value = label;
    cell.fill = fill('AAAAAA');
    cell.font = { name: 'Arial', size: 10, bold: true };
  }
  dates.forEach((date, dayIndex) => {
    const col = 3 + dayIndex * 3;
    sheet.mergeCells(3, col, 3, col + 2);
    const dateCell = sheet.getCell(3, col);
    dateCell.value = new Date(`${date}T00:00:00Z`);
    dateCell.numFmt = 'dd/mm/yyyy';
    dateCell.fill = fill('FF7900');
    dateCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.mergeCells(4, col, 4, col + 2);
    const label = sheet.getCell(4, col);
    label.value = SCHEDULE_DAY_LABELS[dayIndex].toUpperCase();
    label.fill = fill('080808');
    label.font = { name: 'Arial', size: 10, color: { argb: 'FFFFFFFF' } };
    ['ENT.', 'SAL.', 'DUR.'].forEach((text, i) => {
      sheet.getCell(5, col + i).value = text;
      sheet.getCell(5, col + i).fill = fill('E6E6E6');
    });
  });
  let rowIndex = 6;
  people.forEach(person => {
    const week = Object.fromEntries(SCHEDULE_DAYS.map((day, i) => {
      const shift = schedules[person.id]?.[day];
      return [day, !isActiveOnDate(person, dates[i]) || !shift ? undefined : {
        ...shift,
        extraHoursPre: numericExtras(shift.extraHoursPre),
        extraHoursPost: numericExtras(shift.extraHoursPost ?? shift.extraHours),
      }];
    }));
    const segments = SCHEDULE_DAYS.map(day => getExportShiftSegments(week[day]));
    const rowCount = Math.max(1, ...segments.map(day => day.length));
    const firstRow = rowIndex;
    for (let segment = 0; segment < rowCount; segment++) {
      styleRow(rowIndex + segment, colorFor(person, dates[0]), isManagement(person));
    }
    for (const column of [1, 2, 24]) {
      if (rowCount > 1) sheet.mergeCells(firstRow, column, firstRow + rowCount - 1, column);
    }
    const modalities = [...new Set(dates.filter(date => isActiveOnDate(person, date)).map(date => shortModality(effectiveModality(person, date))))];
    sheet.getCell(firstRow, 1).value = modalities.join('/');
    sheet.getCell(firstRow, 2).value = `${person.name || ''} ${person.lastName || ''}`.trim().toUpperCase() || 'SIN NOMBRE';
    const total = sheet.getCell(firstRow, 24);
    total.value = calculateScheduleTotals(week, person, dates[0]).totalMinutes / 60;
    total.numFmt = '0.00';
    total.font = { name: 'Arial', size: 10, bold: true };
    SCHEDULE_DAYS.forEach((day, dayIndex) => {
      const shift = week[day];
      const col = 3 + dayIndex * 3;
      const active = isActiveOnDate(person, dates[dayIndex]);
      const status = !active ? 'CESE' : shift?.off ? null : (shift?.feriado || shift?.holiday) ? 'FERIADO' : !segments[dayIndex].length ? 'S/A' : null;
      for (let segment = 0; segment < rowCount; segment++) {
        const number = firstRow + segment;
        const entry = sheet.getCell(number, col), exit = sheet.getCell(number, col + 1), duration = sheet.getCell(number, col + 2);
        entry.fill = exit.fill = fill(colorFor(person, dates[dayIndex]));
        duration.fill = fill('E7EED8');
        [entry, exit, duration].forEach(cell => { cell.numFmt = '[h]:mm'; cell.font = { name: 'Arial', size: 10 }; });
        const interval = segments[dayIndex][segment];
        if (interval) {
          entry.value = interval.start / 1440;
          exit.value = interval.end / 1440;
        }
        duration.value = { formula: durationFormula(entry.address, exit.address), result: interval ? (interval.end - interval.start) / 1440 : 0 };
      }
      if (status) {
        sheet.mergeCells(firstRow, col, firstRow + rowCount - 1, col + 2);
        const cell = sheet.getCell(firstRow, col);
        cell.value = status;
        cell.numFmt = 'General';
      }
    });
    rowIndex += rowCount;
  });
  const notes = [
    'DUR.: duración de presencia sin descontar refrigerio, con horas extras. 24:00 = 00:00; 25:00 = 01:00.',
    'TOTAL HRS: cálculo del sistema al descargar (refrigerio, extras y crédito de feriado). Es un valor fijo, no la suma de DUR.',
    'Entradas y salidas vacías: descanso. S/A: sin asignación. Verde: gerencia. Amarillo: FT. Azul: PT. Los turnos partidos ocupan dos filas.',
    'Mapas diarios: cobertura de todo el personal de la semana con la proyección actual de la tienda. No se aplican filtros de búsqueda.',
    ...(hasUnsavedChanges ? ['BORRADOR: este archivo incluye cambios del editor que todavía no se han guardado.'] : []),
  ];
  notes.forEach((text, i) => {
    const n = rowIndex + 1 + i;
    sheet.mergeCells(n, 1, n, 24);
    const cell = sheet.getCell(n, 1);
    cell.value = text;
    cell.font = { name: 'Arial', size: 10, italic: true };
    cell.alignment = { wrapText: true, vertical: 'middle' };
    sheet.getRow(n).height = 24;
  });
  sheet.pageSetup.printArea = `A1:X${rowIndex + notes.length}`;
  SCHEDULE_DAYS.forEach((day, index) => {
    const projection = getProjectionForDay(requirements, projectionPositions, day);
    const noProjection = !projection.positions.length || !Object.keys(requirements[day]?.matrix || {}).length;
    const assignments = getHeatmapAssignments(people, schedules, day, projection.positions, dates[index]);
    addHeatmapWorksheet(workbook, {
      rows: noProjection ? [] : buildHeatmapRows(assignments, projection), hours: HOURS,
      date: dates[index], dayLabel: SCHEDULE_DAY_LABELS[index], sheetName: SCHEDULE_DAY_LABELS[index], noProjection,
    });
  });
  return workbook;
}

export async function downloadWeeklyScheduleExcel(data) {
  const dates = getWeekDates(data.weekStart);
  const workbook = await buildWeeklyScheduleWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  const { saveAs } = await import('file-saver');
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `horarios_${dates[0]}_${dates[6]}.xlsx`);
}
