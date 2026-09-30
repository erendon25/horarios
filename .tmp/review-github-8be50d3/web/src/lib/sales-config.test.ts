import { describe, expect, it } from "vitest";
import { normalizeNumericInput, parseDelimitedText, parseSalesMatrix, sanitizeMonthlyData, totalsForMonth } from "./sales-config";

describe("sales config", () => {
  it("normaliza formatos monetarios locales", () => {
    expect(normalizeNumericInput("S/ 1.234,50")).toBe("1234.5");
    expect(normalizeNumericInput("1,234.50")).toBe("1234.5");
  });

  it("procesa CSV con pedidos únicos y mueve la madrugada al día comercial anterior", () => {
    const matrix = parseDelimitedText("Fecha,Hora,Pedido,Total,Estado\n14/07/2026,22:10,A1,100,OK\n15/07/2026,01:15,A2,50,OK\n15/07/2026,01:30,A2,25,OK\n15/07/2026,02:00,A3,99,Anulado");
    const result = parseSalesMatrix(matrix);
    expect(result.rows).toBe(3);
    expect(result.real["2026-07-14"]).toEqual({ vta: "175.00", txs: "2" });
    expect(result.hourly["2026-07-14"]["22:00"]).toBeCloseTo(57.1428, 3);
    expect(result.hourly["2026-07-14"]["01:00"]).toBeCloseTo(42.8571, 3);
  });

  it("suma metas del mes", () => {
    expect(totalsForMonth({ "1": { vta: "10.5", txs: "2" }, "2": { vta: "20", txs: "3" } })).toEqual({ sales: 30.5, transactions: 5 });
  });

  it("ignora metadatos antiguos al sanear ventas reales", () => {
    expect(sanitizeMonthlyData({ hourlyParticipation: null, "2026-07-14": { vta: 125, txs: 4 } })).toEqual({
      "2026-07-14": { vta: "125", txs: "4" },
    });
  });
});
