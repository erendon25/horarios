import { describe, expect, it } from "vitest";
import { addIsoDays, effectiveModality, emptyStaffWeek, mondayOf, segmentMinutes, shiftConflicts, shiftMinutes, type Shift } from "./weekly-schedule";

const shift = (values: Partial<Shift> = {}): Shift => ({ date: "2026-07-13", start: "08:00", end: "16:45", position: "CAJA", off: false, holiday: false, notes: "", splitShift: false, start2: "", end2: "", extraHoursPre: 0, extraHoursPost: 0, ...values });

describe("weekly schedule rules", () => {
  it("normaliza cualquier fecha al lunes local equivalente", () => expect(mondayOf("2026-07-19")).toBe("2026-07-13"));
  it("suma fechas sin desplazamiento de zona horaria", () => expect(addIsoDays("2026-07-31", 1)).toBe("2026-08-01"));
  it("crea exactamente siete días fechados", () => expect(Object.values(emptyStaffWeek("2026-07-13")).map((day) => day.date)).toEqual(["2026-07-13","2026-07-14","2026-07-15","2026-07-16","2026-07-17","2026-07-18","2026-07-19"]));
  it("conserva turnos nocturnos", () => expect(segmentMinutes("22:00", "06:00")).toBe(480));
  it("descuenta 45 minutos solo al full-time continuo", () => {
    expect(shiftMinutes(shift(), true)).toBe(480);
    expect(shiftMinutes(shift(), false)).toBe(525);
    expect(shiftMinutes(shift({ splitShift: true, start: "08:00", end: "12:00", start2: "16:00", end2: "20:00" }), true)).toBe(480);
  });
  it("aplica el cambio de modalidad desde su fecha", () => {
    const staff = { modality: "Part-Time", modality_change_date: "2026-07-15", next_modality: "Full-Time" };
    expect(effectiveModality(staff, "2026-07-14")).toBe("Part-Time");
    expect(effectiveModality(staff, "2026-07-15")).toBe("Full-Time");
  });
  it("detecta día libre, habilidad y choque de estudios", () => {
    expect(shiftConflicts(shift(), { free: true, blocks: [{ start: "09:00", end: "10:00" }] }, [])).toEqual([
      "Solicitó día libre por estudios", "No posee la habilidad requerida", "Conflicto con horario de estudio",
    ]);
  });
  it("detecta estudios que cruzan medianoche", () => {
    expect(shiftConflicts(shift({ start: "22:00", end: "02:00" }), { free: false, blocks: [{ start: "23:00", end: "01:00" }] }, ["CAJA"])).toEqual(["Conflicto con horario de estudio"]);
  });
});
