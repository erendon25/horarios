import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { planningBukRows } from './bukSchedule';
import { getWeekDates, SCHEDULE_DAY_LABELS } from './scheduleExportData';

export function exportBukPlanningPDF({ staff, schedules, weekStart }) {
  const dates = getWeekDates(weekStart);
  const pdf = new jsPDF('landscape', 'pt', 'a3');
  const headerCell = content => ({ content, rowSpan: 2 });
  const head = [[...['N°', 'Nombre del colaborador', 'Modalidad', 'Descanso'].map(headerCell), ...dates.map((date, i) => ({ content: `${SCHEDULE_DAY_LABELS[i]}\n${date}`, colSpan: 2 })), headerCell('Horas\nnetas'), headerCell('Control')], dates.flatMap(() => ['Ingreso', 'Salida'])];
  const body = planningBukRows(staff, schedules, weekStart).flatMap(row => {
    const first = row.slice(0, 4).map(content => ({ content, rowSpan: 2 }));
    const positions = [];
    dates.forEach((_, i) => {
      const entry = row[4 + i * 3];
      if (['DESCANSO', 'FERIADO', 'CESE'].includes(entry)) first.push({ content: entry, colSpan: 2 });
      else first.push(entry, row[5 + i * 3]);
      positions.push({ content: row[6 + i * 3], colSpan: 2, styles: { halign: 'center', fontStyle: 'bold' } });
    });
    first.push(...row.slice(-2).map(content => ({ content, rowSpan: 2 })));
    return [first, positions];
  });
  autoTable(pdf, { head, body, rowPageBreak: 'avoid', margin: { top: 45, left: 20, right: 20 },
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', halign: 'center', valign: 'middle' }, headStyles: { fillColor: [44, 62, 80] },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 150 }, 2: { cellWidth: 55 }, 3: { cellWidth: 45 } },
    didDrawPage: () => { pdf.setFontSize(12); pdf.text(`PLANIFICACIÓN SEMANAL · ${weekStart} al ${dates[6]}`, 20, 25); },
  });
  pdf.save(`Planificacion_${weekStart}.pdf`);
  return pdf;
}
