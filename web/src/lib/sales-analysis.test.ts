import { describe, expect, it } from "vitest";
import { addIsoDays, aggregateSales, paginateSalesHistory, previousPeriod, previousYearPeriod, salesGoal, variation, type SalesHistoryInput } from "./sales-analysis";

const rows: SalesHistoryInput[] = [{
  sales_date: "2026-06-30",
  sales_amount: 100,
  transactions: 4,
  hourly_data: { "10": { "SALÓN": 40, DELIVERY: 10 }, "19": { "SALÓN": 50 } },
  hourly_transactions: { "10": { "SALÓN": 1, DELIVERY: 1 }, "19": { "SALÓN": 2 } },
  source_data: { hourlyTxs: { "10": { "SALÓN": 99 }, "19": { "SALÓN": 99 } } },
  updated_at: "2026-07-01T01:00:00Z",
}];

describe("sales analysis", () => {
  it("agrega ventas por canal, turno, día y hora", () => {
    const result = aggregateSales(rows, "2026-06-30", "2026-06-30");
    expect(result.sales).toBe(100);
    expect(result.transactions).toBe(4);
    expect(result.channelsSales["SALÓN"]).toBe(90);
    expect(result.shiftsSales.Apertura).toBe(50);
    expect(result.shiftsSales.Cierre).toBe(50);
    expect(result.weekdaysSales.Martes).toBe(100);
    expect(result.hourlyTransactions["19:00"]).toBe(2);
  });

  it("usa transacciones horarias canónicas y conserva el JSON legado como fallback", () => {
    const legacyOnly = [{ ...rows[0], hourly_transactions: {}, source_data: { hourlyTxs: { "10": { "SIN CLASIFICAR": 3 } } } }];
    expect(aggregateSales(legacyOnly, "2026-06-30", "2026-06-30").channelsTransactions["SIN CLASIFICAR"]).toBe(3);
    expect(aggregateSales(rows, "2026-06-30", "2026-06-30").channelsTransactions["SALÓN"]).toBe(3);
  });

  it("pagina el historial con cursor de fecha sin un límite silencioso", async () => {
    const pages = new Map<string | undefined, Array<{ sales_date: string }>>([
      [undefined, [{ sales_date: "2026-07-04" }, { sales_date: "2026-07-03" }]],
      ["2026-07-03", [{ sales_date: "2026-07-02" }, { sales_date: "2026-07-01" }]],
      ["2026-07-01", []],
    ]);
    const cursors: Array<string | undefined> = [];
    const result = await paginateSalesHistory(async (cursor) => { cursors.push(cursor); return pages.get(cursor) ?? []; }, 2);
    expect(result.map((row) => row.sales_date)).toEqual(["2026-07-04", "2026-07-03", "2026-07-02", "2026-07-01"]);
    expect(cursors).toEqual([undefined, "2026-07-03", "2026-07-01"]);
  });

  it("calcula periodos y desplazamientos ISO", () => {
    expect(addIsoDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(previousPeriod("2026-07-08", "2026-07-14")).toEqual({ start: "2026-07-01", end: "2026-07-07" });
    expect(previousYearPeriod("2026-07-08", "2026-07-14")).toEqual({ start: "2025-07-08", end: "2025-07-14" });
    expect(previousYearPeriod("2024-02-29", "2024-02-29")).toEqual({ start: "2023-02-28", end: "2023-02-28" });
  });

  it("suma metas diarias y calcula variación", () => {
    expect(salesGoal([{ month_start: "2026-07-01", monthly_data: { "1": { vta: "10" }, "2": { vta: "20" } } }], "2026-07-01", "2026-07-02")).toBe(30);
    expect(variation(120, 100)).toBe(20);
  });
});
