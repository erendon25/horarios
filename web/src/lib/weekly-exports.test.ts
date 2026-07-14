import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildExtraHoursPdf, buildGeoVictoriaWorkbook, buildPositioningPdf, buildWeeklySchedulePdf, type ExportStaff } from "./weekly-exports";
import { emptyStaffWeek } from "./weekly-schedule";

const staff: ExportStaff[] = [{ id: "one", first_name: "Ana", last_name: "Pérez", dni: "12345678", modality: "Full-Time", modality_change_date: null, next_modality: null, is_trainee: false, cessation_date: null, training_end_date: null }];
const week = emptyStaffWeek("2026-07-13");
week.monday = { ...week.monday, start: "22:00", end: "06:00", position: "CAJA", extraHoursPre: 1, extraHoursPost: 0.5 };
week.tuesday = { ...week.tuesday, off: true };
const schedules = { one: week };

describe("weekly exports", () => {
  it("genera los PDF semanal, posicionamiento y horas extra", () => {
    expect(buildWeeklySchedulePdf(staff, schedules, "2026-07-13").output("arraybuffer").byteLength).toBeGreaterThan(3000);
    expect(buildPositioningPdf(staff, schedules, "monday", "2026-07-13", "ambos", ["CAJA"]).output("arraybuffer").byteLength).toBeGreaterThan(2000);
    expect(buildExtraHoursPdf(staff, schedules, "2026-07-13").output("arraybuffer").byteLength).toBeGreaterThan(2000);
  });
  it("mantiene el PDF de posiciones en una sola hoja", () => {
    const manyStaff = Array.from({ length: 60 }, (_, index) => ({ ...staff[0], id: `staff-${index}`, first_name: `Colaborador ${index + 1}` }));
    const manySchedules = Object.fromEntries(manyStaff.map((person) => [person.id, week]));
    expect(buildPositioningPdf(manyStaff, manySchedules, "monday", "2026-07-13", "ambos", ["CAJA"]).getNumberOfPages()).toBe(1);
  });
  it("genera el libro GeoVictoria con descanso y turno mapeado", async () => {
    const workbook = await buildGeoVictoriaWorkbook(staff, schedules, "2026-07-13", { "22:00-06:00": 99 });
    const sheet = workbook.getWorksheet("Planificacion")!;
    expect(sheet.getCell("O2").value).toBe(99);
    expect(sheet.getCell("P2").value).toBe(-1);
    expect((await workbook.xlsx.writeBuffer()).byteLength).toBeGreaterThan(5000);
  });

  it.skipIf(process.env.WRITE_EXPORT_FIXTURES !== "1")("escribe archivos de control visual", async () => {
    const pdfDirectory = resolve(process.cwd(), "..", "output", "pdf");
    const sheetDirectory = resolve(process.cwd(), "..", "output", "xlsx");
    mkdirSync(pdfDirectory, { recursive: true }); mkdirSync(sheetDirectory, { recursive: true });
    writeFileSync(resolve(pdfDirectory, "horario_semanal_prueba.pdf"), Buffer.from(buildWeeklySchedulePdf(staff, schedules, "2026-07-13", { showPositions: true }).output("arraybuffer")));
    writeFileSync(resolve(pdfDirectory, "posicionamiento_prueba.pdf"), Buffer.from(buildPositioningPdf(staff, schedules, "monday", "2026-07-13", "ambos", ["CAJA"]).output("arraybuffer")));
    writeFileSync(resolve(pdfDirectory, "horas_extra_prueba.pdf"), Buffer.from(buildExtraHoursPdf(staff, schedules, "2026-07-13").output("arraybuffer")));
    const workbook = await buildGeoVictoriaWorkbook(staff, schedules, "2026-07-13", { "22:00-06:00": 99 });
    writeFileSync(resolve(sheetDirectory, "geovictoria_prueba.xlsx"), Buffer.from(await workbook.xlsx.writeBuffer()));
  });
});
