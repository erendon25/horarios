import { isStaffActive } from '../components/Training/staffStatus.js';

export const STUDY_EXPORT_HEADERS = ['TIENDA', 'NOMBRE DEL COLABORADOR', 'CARGO', 'REQUERIMIENTOS', 'DÍA', 'DESDE', 'HASTA'];
const DAYS = [['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'], ['thursday', 'Jueves'], ['friday', 'Viernes'], ['saturday', 'Sábado'], ['sunday', 'Domingo']];
const text = value => typeof value === 'string' ? value.trim() : '';
const timeMinutes = value => {
  const match = text(value).match(/^(\d{1,2}):(\d{2})(?::00)?$/);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
};

// Read-only export: never changes a day-off flag or the source study hours.
export function buildStudyAvailabilityRows({ staff, storeId, storeName, referenceDate = new Date() }) {
  if (!storeId || !text(storeName)) throw new Error('No se pudo identificar el nombre de la tienda.');
  const rows = [];
  const people = staff.filter(person => person.storeId === storeId && isStaffActive(person, referenceDate))
    .sort((a, b) => `${a.lastName || ''} ${a.name || ''}`.localeCompare(`${b.lastName || ''} ${b.name || ''}`, 'es'));
  for (const person of people) {
    const name = [text(person.name), text(person.lastName)].filter(Boolean).join(' ');
    for (const [key, label] of DAYS) {
      const day = person.study_schedule?.[key];
      if (!day) continue;
      if (day.free === true) {
        rows.push([storeName, name, text(person.cargo) || text(person.position), 'Día libre solicitado', label, 8 / 24, 23 / 24]);
        continue;
      }
      if (day.blocks != null && !Array.isArray(day.blocks)) throw new Error(`Revisa los estudios de ${name} (${label}).`);
      const blocks = (day.blocks || []).map(block => {
        const start = timeMinutes(block?.start), end = timeMinutes(block?.end);
        if (start === null || end === null || start >= end) throw new Error(`Revisa el horario de ${name} (${label}): desde y hasta no son válidos.`);
        return { start, end };
      }).sort((a, b) => a.start - b.start || a.end - b.end);
      for (const block of blocks) {
        rows.push([storeName, name, text(person.cargo) || text(person.position), 'Horario de estudio', label, block.start / 1440, block.end / 1440]);
      }
    }
  }
  if (!rows.length) throw new Error('No hay horarios de estudio ni días libres registrados para los colaboradores activos de esta tienda.');
  return rows;
}

export async function buildStudyAvailabilityWorkbook(input) {
  const rows = buildStudyAvailabilityRows(input);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LC Scheduler';
  const sheet = workbook.addWorksheet('Horarios de estudio', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' },
  });
  sheet.addRow(STUDY_EXPORT_HEADERS);
  rows.forEach(row => sheet.addRow(row));
  [24, 44, 28, 27, 16, 14, 14].forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  sheet.autoFilter = { from: 'A1', to: `G${sheet.rowCount}` };
  sheet.eachRow((row, number) => {
    row.height = number === 1 ? 30 : 32;
    row.eachCell((cell, column) => {
      cell.font = { name: 'Calibri', size: 11, ...(number === 1 ? { bold: true, color: { argb: 'FFFFFFFF' } } : {}) };
      cell.alignment = { vertical: 'middle', horizontal: column >= 5 ? 'center' : 'left', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      if (number === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      else if (number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      if (number > 1 && column >= 6) cell.numFmt = 'hh:mm';
    });
  });
  sheet.getCell('D1').note = 'Los días libres solicitados se representan únicamente en este archivo de 08:00 a 23:00. No se modifican los datos ni las reglas de disponibilidad de la aplicación. Los estudios conservan las horas declaradas, sin añadir traslados.';
  return workbook;
}

export function studyAvailabilityFilename(storeName) {
  const safeStore = text(storeName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'tienda';
  return `Disponibilidades_${safeStore}.xlsx`;
}
