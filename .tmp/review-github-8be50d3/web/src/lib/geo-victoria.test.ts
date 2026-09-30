import { describe, expect, it } from "vitest";
import { parseDurationMinutes, parseExtraHours, parseLateArrivals, parseRoster, parseShiftMap, rowsFromMatrix, type GeoVictoriaStaff } from "./geo-victoria";

const staff: GeoVictoriaStaff[] = [{ id: "uuid-1", firestoreId: "old-1", userId: "user-1", dni: "12345678", firstName: "Ana", lastName: "Pérez", position: "Caja", modality: "Full-Time", cessationDate: null }];

describe("GeoVictoria", () => {
  it("interpreta duraciones y el archivo de turnos", () => {
    expect(parseDurationMinutes("01:30")).toBe(90);
    expect(parseDurationMinutes("2h 15m")).toBe(135);
    expect(parseShiftMap([["cabecera"], ["cabecera 2"], [17, 0.25, "", 0.5]])).toEqual({ "06:00-12:00": 17 });
  });

  it("agrupa el detalle y subtotal de horas extra sin duplicar el periodo", () => {
    const rows = rowsFromMatrix([
      ["Fecha", "Nombre", "Apellidos", "Identificador", "Grupo", "Turno", "Entrada", "TE", "x", "x2", "Salió", "TE"],
      ["14/07/2026", "Ana", "Pérez", "12345678", "", "08:00 - 17:00", "07:45", "00:15", "", "", "17:30", "00:30"],
      ["14/07/2026", "", "", "", "", "08:00 - 17:00", "07:45", "00:15", "", "", "17:30", "00:30"],
    ]);
    const result = parseExtraHours(rows, staff, "store-1", "extras.xlsx", "2026-07-14T12:00:00Z");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ firestore_id: "gvextra_old-1_2026-07-14_2026-07-14", duration_minutes: 45, pre_shift_minutes: 15, post_shift_minutes: 30 });
    expect(result.totalMinutes).toBe(45);
  });

  it("reporta DNI sin coincidencia", () => {
    const rows = rowsFromMatrix([["Fecha", "Identificador"], ["14/07/2026", "99999999"]]);
    expect(parseExtraHours(rows, staff, "store-1", "x.xlsx", "now").unmatchedDnis).toEqual(["99999999"]);
  });

  it("detecta altas activas nuevas sin repetir DNI", () => {
    const rows = rowsFromMatrix([["Estado", "Identificador", "Nombre", "Apellidos", "Email", "Fecha inicio contrato"], ["Activo", "87654321", "Luis", "Soto", "LUIS@EXAMPLE.COM", "10/07/2026"], ["Activo", "12345678", "Ana", "Pérez", "", ""]]);
    expect(parseRoster(rows, ["12345678"])).toEqual({ candidates: [{ dni: "87654321", firstName: "Luis", lastName: "Soto", email: "luis@example.com", joinDate: "2026-07-10" }], existing: 1, skipped: 0 });
  });

  it("excluye tardanzas justificadas y ordena el reporte", () => {
    const rows = rowsFromMatrix([["Fecha", "DNI", "Nombre", "Apellidos", "Hora Inicio Turno", "Hora Llegada", "Minutos de Atraso", "Justificado por"], ["14/07/2026", "12345678", "Ana", "Pérez", "08:00", "08:12", "00:12", ""], ["15/07/2026", "12345678", "Ana", "Pérez", "08:00", "08:05", "00:05", "Jefe"]]);
    expect(parseLateArrivals(rows, staff)).toMatchObject([{ dni: "12345678", name: "Ana Pérez", date: "2026-07-14", scheduledStart: "08:00", arrival: "08:12", lateMinutes: 12 }]);
  });
});
