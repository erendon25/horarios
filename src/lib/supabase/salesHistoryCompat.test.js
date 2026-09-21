import test from "node:test";
import assert from "node:assert/strict";
import { mapSalesHistoryRow, salesHistoryDayPayload } from "./salesHistoryCompat.js";

test("normaliza el payload requerido por save_sales_history_batch", () => {
  assert.deepEqual(salesHistoryDayPayload("2026-08-25", {
    totalSales: "15668.54",
    totalTxs: "561",
    hourlyData: { 9: { DELIVERY: 49.9 } },
    hourlyTxs: { 9: { DELIVERY: 1 } },
    suggestiveProducts: { cheeseBorder: { 9: { "SALÓN": 2 } } },
  }), {
    date: "2026-08-25",
    totalSales: 15668.54,
    totalTxs: 561,
    hourlyData: { 9: { DELIVERY: 49.9 } },
    hourlyTxs: { 9: { DELIVERY: 1 } },
    suggestiveProducts: { cheeseBorder: { 9: { "SALÓN": 2 } } },
  });
});

test("lee las transacciones horarias canónicas y mantiene compatibilidad legado", () => {
  assert.deepEqual(mapSalesHistoryRow({
    sales_date: "2026-08-25",
    sales_amount: 100,
    transactions: 2,
    hourly_data: { 10: { "SALÓN": 100 } },
    hourly_transactions: { 10: { "SALÓN": 2 } },
    suggestive_products: { cheeseBorder: { 10: { "SALÓN": 1 } } },
    source_data: { hourlyTxs: { 10: { "SALÓN": 99 } } },
  }), {
    totalSales: 100,
    totalTxs: 2,
    hourlyData: { 10: { "SALÓN": 100 } },
    hourlyTxs: { 10: { "SALÓN": 2 } },
    suggestiveProducts: { cheeseBorder: { 10: { "SALÓN": 1 } } },
    date: "2026-08-25",
    updatedAt: undefined,
  });

  assert.deepEqual(mapSalesHistoryRow({
    hourly_transactions: {},
    source_data: { hourlyTxs: { 19: { DELIVERY: 3 } } },
  }).hourlyTxs, { 19: { DELIVERY: 3 } });
});
