import { describe, expect, it } from "vitest";
import { buildCoverageRows, expandProjectionMatrix } from "./schedule-coverage";

describe("schedule coverage", () => {
  it("alinea 06:00-08:00 y expande cada hora a cuatro bloques", () => {
    const row = expandProjectionMatrix({ 0: { 0: 1, 1: 2 } }, 1)[0];
    expect(row.slice(0, 8)).toEqual(Array(8).fill(0));
    expect(row.slice(8, 12)).toEqual(Array(4).fill(1));
    expect(row.slice(12, 16)).toEqual(Array(4).fill(2));
  });

  it("no cuenta dos veces un relevo exacto", () => {
    const matrix = [Array(77).fill(1)];
    const rows = buildCoverageRows(["CAJA"], matrix, [
      { position: "CAJA", start: "08:00", end: "12:00" },
      { position: "CAJA", start: "12:00", end: "16:00" },
    ]);
    expect(rows[0].cells[24]).toBe("assigned");
    expect(rows).toHaveLength(1);
  });

  it("distingue faltantes, excesos y entrenadores", () => {
    const matrix = [Array(77).fill(0)];
    matrix[0][8] = 2;
    const rows = buildCoverageRows(["CAJA"], matrix, [{ position: "CAJA", start: "08:00", end: "08:15", isTrainer: true }]);
    expect(rows[0].cells[8]).toBe("trainer");
    expect(rows[1].cells[8]).toBe("missing");
    expect(rows[0].cells[9]).toBe("trainer");
  });
});

