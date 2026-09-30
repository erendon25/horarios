import { describe, expect, it } from "vitest";
import { addIsoDays, aggregateSales, previousPeriod, previousYearPeriod, salesGoal, variation, type SalesHistoryInput } from "./sales-analysis";

const rows: SalesHistoryInput[] = [{
  sales_date: "2026-06-30",
  sales_amount: 100,
  transactions: 4,
  hourly_data: { "10": { "SALÓN": 40, DELIVERY: 10 }, "19": { "SALÓN": 50 } },
  source_data: { hourlyTxs: { "10": { "SALÓN": 1, DELIVERY: 1 }, "19": { "SALÓN": 2 } } },
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
