import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { WEEKDAYS, WEEKDAY_LABELS, addIsoDays, effectiveModality, segmentMinutes, type StaffWeek, type Weekday } from "./weekly-schedule";

export type ExportStaff = {
  id: string; first_name: string; last_name: string; dni: string | null; modality: string | null;
  modality_change_date: string | null; next_modality: string | null; is_trainee: boolean;
  cessation_date: string | null; training_end_date: string | null;
};

type ScheduleMap = Record<string, StaffWeek>;
type PositionTurn = "mañana" | "tarde" | "ambos";
type AutoTableDocument = jsPDF & { lastAutoTable?: { finalY: number } };

const fullName = (person: ExportStaff) => `${person.first_name} ${person.last_name}`.trim();
const decimal = (value: number) => Math.round(value * 100) / 100;

function adjustedTimes(shift: StaffWeek[Weekday]) {
  const pre = Number(shift.extraHoursPre) || 0;
  const post = Number(shift.extraHoursPost) || 0;
  const format = (minutes: number) => `${String(Math.floor((((minutes % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((minutes % 60) + 60) % 60).padStart(2, "0")}`;
  const [startHours, startMinutes] = shift.start.split(":").map(Number);
  const [endHours, endMinutes] = shift.end.split(":").map(Number);
  return { start: format(Math.max(0, startHours * 60 + startMinutes - pre * 60)), end: format(endHours * 60 + endMinutes + post * 60), pre, post };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildWeeklySchedulePdf(staff: ExportStaff[], schedules: ScheduleMap, weekStart: string, options: { excludeTrainees?: boolean; showPositions?: boolean } = {}) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const selected = staff.filter((person) => !options.excludeTrainees || !person.is_trainee).sort((a, b) => {
    const aMode = effectiveModality(a, weekStart); const bMode = effectiveModality(b, weekStart);
    return (aMode === "Full-Time" ? 0 : 1) - (bMode === "Full-Time" ? 0 : 1) || fullName(a).localeCompare(fullName(b));
  });
  const header = ["Nombre", "Modalidad", ...WEEKDAYS.map((_, index) => `${WEEKDAY_LABELS[index]}\n${addIsoDays(weekStart, index).slice(5).split("-").reverse().join("/")}`), "Total Hrs"];
  const body = selected.map((person) => {
    let total = 0;
    let breakDays = 0;
    const row: Array<string> = [fullName(person).toUpperCase(), effectiveModality(person, weekStart) || "--"];
    WEEKDAYS.forEach((day) => {
      const shift = schedules[person.id]?.[day];
      if (!shift || (!shift.start && !shift.off && !shift.holiday)) { row.push("S/A"); return; }
      if (shift.off) { row.push("DESCANSO"); return; }
      if (shift.holiday && !shift.start) { row.push("FERIADO"); return; }
      const adjusted = adjustedTimes(shift);
      let text = shift.holiday ? "FERIADO" : `${adjusted.start}-${adjusted.end}`;
      if (shift.splitShift && shift.start2 && shift.end2) text += `\n${shift.start2}-${shift.end2}`;
      if (options.showPositions && shift.position) text += `\n(${shift.position})`;
      total += segmentMinutes(shift.start, shift.end) / 60 + (shift.splitShift ? segmentMinutes(shift.start2, shift.end2) / 60 : 0) + adjusted.pre + adjusted.post;
      if (effectiveModality(person, shift.date) === "Full-Time" && !shift.holiday && !shift.splitShift) breakDays++;
      row.push(text);
    });
    total -= breakDays * 0.75;
    row.push(decimal(total).toFixed(2));
    return row;
  });
  autoTable(pdf, { head: [header], body, margin: { top: 42, left: 24, right: 24 }, styles: { fontSize: options.showPositions ? 5.8 : 6.5, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [30, 58, 95], textColor: 255 }, didDrawPage: () => { pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(23, 32, 51); pdf.text(`HORARIOS SEMANALES - ${weekStart} AL ${addIsoDays(weekStart, 6)}`, 24, 25); } });
  return pdf;
}

export function buildPositioningPdf(staff: ExportStaff[], schedules: ScheduleMap, selectedDay: Weekday, date: string, turn: PositionTurn, orderedPositions: string[]) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  type Entry = { name: string; details: string; start: number };
  const groups = new Map<string, Entry[]>();
  for (const person of staff) {
    const shift = schedules[person.id]?.[selectedDay];
    if (!shift?.position || !shift.start || !shift.end || shift.off) continue;
    const adjusted = adjustedTimes(shift);
    const start = Number(adjusted.start.slice(0, 2)) * 60 + Number(adjusted.start.slice(3));
    let end = Number(adjusted.end.slice(0, 2)) * 60 + Number(adjusted.end.slice(3));
    if (end <= start) end += 1440;
    const splitStart = shift.splitShift && shift.start2 ? Number(shift.start2.slice(0, 2)) * 60 + Number(shift.start2.slice(3)) : null;
    const isMorning = start < 14 * 60 || (splitStart !== null && splitStart < 14 * 60);
    const isAfternoon = start >= 12 * 60 || end > 14 * 60 || (splitStart !== null && splitStart >= 12 * 60);
    if ((turn === "mañana" && !isMorning) || (turn === "tarde" && !isAfternoon)) continue;
    const list = groups.get(shift.position) ?? [];
    const extra = adjusted.pre + adjusted.post;
    list.push({ name: `${fullName(person).toUpperCase()}${extra ? ` (+${extra}h)` : ""}`, details: `${effectiveModality(person, date)} - ${adjusted.start}-${adjusted.end}${shift.splitShift ? ` / ${shift.start2}-${shift.end2}` : ""}`, start });
    groups.set(shift.position, list);
  }
  const order = (position: string) => { const index = orderedPositions.indexOf(position); return index < 0 ? 9999 : index; };
  const entries = [...groups.entries()].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const addHeader = () => { pdf.setFillColor(248, 250, 252); pdf.rect(0, 0, pageWidth, 54, "F"); pdf.setTextColor(30, 58, 95); pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text("POSICIONAMIENTO DIARIO", pageWidth - 24, 24, { align: "right" }); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.text(`${date} | ${turn === "ambos" ? "DÍA COMPLETO" : turn.toUpperCase()}`, pageWidth - 24, 40, { align: "right" }); };
  addHeader();
  const rows = entries.flatMap(([position, people]) => people.sort((a, b) => a.start - b.start).map((row) => [position.toUpperCase(), row.name, row.details]));
  if (!rows.length) pdf.text("No hay asignaciones para este turno.", 24, 78);
  const columns = rows.length > 42 ? 2 : 1;
  const splitAt = Math.ceil(rows.length / columns);
  const chunks = columns === 1 ? [rows] : [rows.slice(0, splitAt), rows.slice(splitAt)];
  const gap = 12;
  const tableWidth = (pageWidth - 48 - gap * (columns - 1)) / columns;
  const maxRows = Math.max(...chunks.map((chunk) => chunk.length), 1);
  const availableHeight = pageHeight - 76;
  const fontSize = Math.max(4.5, Math.min(7.2, (availableHeight / (maxRows + 1) - 1.4) / 1.15));
  chunks.forEach((chunk, index) => {
    const left = 24 + index * (tableWidth + gap);
    autoTable(pdf, {
      startY: 62,
      margin: { left, right: pageWidth - left - tableWidth },
      tableWidth,
      head: [["Posición", "Colaborador", "Horario"]],
      body: chunk,
      theme: "grid",
      pageBreak: "avoid",
      rowPageBreak: "avoid",
      styles: { fontSize, cellPadding: .7, overflow: "ellipsize", valign: "middle" },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: Math.max(fontSize, 5.2) },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: columns === 1 ? { 0: { cellWidth: 150 }, 1: { cellWidth: 330 }, 2: { cellWidth: "auto" } } : { 0: { cellWidth: tableWidth * .25 }, 1: { cellWidth: tableWidth * .45 }, 2: { cellWidth: tableWidth * .3 } },
    });
  });
  pdf.setFontSize(7); pdf.setTextColor(120); pdf.text("Hoja única", pageWidth / 2, pageHeight - 7, { align: "center" });
  return pdf;
}

export function buildExtraHoursPdf(staff: ExportStaff[], schedules: ScheduleMap, weekStart: string) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const rows: Array<[string, string, string, string, string]> = [];
  let total = 0;
  staff.forEach((person) => WEEKDAYS.forEach((day, index) => {
    const shift = schedules[person.id]?.[day];
    if (!shift?.start || !shift.end) return;
    const adjusted = adjustedTimes(shift); const extra = adjusted.pre + adjusted.post;
    if (!extra) return;
    total += extra;
    rows.push([fullName(person).toUpperCase(), WEEKDAY_LABELS[index], effectiveModality(person, shift.date), `${adjusted.start}-${adjusted.end}`, `${extra} hrs`]);
  }));
  const addHeader = () => { pdf.setFillColor(248, 250, 252); pdf.rect(0, 0, 595, 70, "F"); pdf.setTextColor(30, 58, 95); pdf.setFont("helvetica", "bold"); pdf.setFontSize(17); pdf.text("REPORTE DE HORAS EXTRAS", 565, 30, { align: "right" }); pdf.setFont("helvetica", "normal"); pdf.setFontSize(10); pdf.text(`Semana ${weekStart} al ${addIsoDays(weekStart, 6)}`, 565, 49, { align: "right" }); };
  addHeader();
  if (rows.length) autoTable(pdf, { startY: 85, head: [["Colaborador", "Día", "Modalidad", "Turno (+HE)", "Horas extras"]], body: rows, theme: "grid", styles: { fontSize: 8.5, cellPadding: 4 }, headStyles: { fillColor: [37, 99, 235], textColor: 255 }, didDrawPage: addHeader });
  else pdf.text("No se encontraron horas extras registradas esta semana.", 30, 95);
  const finalY = (pdf as AutoTableDocument).lastAutoTable?.finalY ?? 100;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(12); pdf.setTextColor(30, 58, 95); pdf.text(`TOTAL GENERAL: ${decimal(total)} hrs`, 30, Math.min(finalY + 25, 810));
  return pdf;
}

export async function buildGeoVictoriaWorkbook(staff: ExportStaff[], schedules: ScheduleMap, weekStart: string, shiftMap: Record<string, string | number>) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Planificacion");
  sheet.addRow(["Nombre", "DNI", ...Array.from({ length: 31 }, (_, index) => index + 1)]);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  staff.forEach((person) => {
    if (!person.dni) return;
    const row: Array<string | number | null> = Array(33).fill(null);
    row[0] = fullName(person); row[1] = person.dni;
    WEEKDAYS.forEach((day, index) => {
      const shift = schedules[person.id]?.[day];
      if (!shift) return;
      const dayOfMonth = Number(addIsoDays(weekStart, index).slice(8));
      if (shift.off) { row[dayOfMonth + 1] = -1; return; }
      if (!shift.start || !shift.end) return;
      const key = `${shift.start}-${shift.end}`;
      row[dayOfMonth + 1] = shiftMap[key] ?? `${shift.start}-${shift.end === "00:00" ? "24:00" : shift.end}`;
    });
    const worksheetRow = sheet.addRow(row);
    worksheetRow.eachCell((cell, column) => { if (column > 2 && typeof cell.value === "string" && cell.value.includes("-")) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCCCC" } }; });
  });
  sheet.getColumn(1).width = 30; sheet.getColumn(2).width = 14;
  for (let column = 3; column <= 33; column++) sheet.getColumn(column).width = 6;
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  return workbook;
}

export function exportWeeklySchedulePdf(staff: ExportStaff[], schedules: ScheduleMap, weekStart: string, options: { excludeTrainees?: boolean; showPositions?: boolean } = {}) {
  buildWeeklySchedulePdf(staff, schedules, weekStart, options).save(`horarios_${weekStart}_${addIsoDays(weekStart, 6)}.pdf`);
}
export function exportPositioningPdf(staff: ExportStaff[], schedules: ScheduleMap, selectedDay: Weekday, date: string, turn: PositionTurn, positions: string[]) {
  buildPositioningPdf(staff, schedules, selectedDay, date, turn, positions).save(`posicionamiento_${date}_${turn}.pdf`);
}
export function exportExtraHoursPdf(staff: ExportStaff[], schedules: ScheduleMap, weekStart: string) {
  buildExtraHoursPdf(staff, schedules, weekStart).save(`Horas_Extras_${weekStart}.pdf`);
}
export async function exportGeoVictoriaExcel(staff: ExportStaff[], schedules: ScheduleMap, weekStart: string, shiftMap: Record<string, string | number>) {
  const workbook = await buildGeoVictoriaWorkbook(staff, schedules, weekStart, shiftMap);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Planificacion_GeoVictoria_${weekStart}.xlsx`);
}

