import test from "node:test";
import assert from "node:assert/strict";
import { mapSalesHistoryRow, salesHistoryDayPayload } from "./salesHistoryCompat.js";

test('guarda y recupera importes reales por producto sin inferirlos de la cantidad', () => {
  const productSales = [{ name: 'VS Borde de queso', hour: 0, channel: 'SERV. FILA', quantity: 2, revenue: 8.5 }];
  const payload = salesHistoryDayPayload('2026-10-18', {
    totalSales: 30, totalTxs: 1, productSales, productSalesRecorded: true, productRevenueRecorded: true,
  });
  const read = mapSalesHistoryRow({ sales_date: payload.date, source_data: payload });
  assert.equal(read.productRevenueRecorded, true);
  assert.deepEqual(read.productSales, productSales);
  assert.equal(mapSalesHistoryRow({ source_data: { productSales, productSalesRecorded: true } }).productRevenueRecorded, false);
});

test('conserva la marca de jornada comercial al guardar y recargar sin reinterpretar datos antiguos', () => {
  const metadata = { businessDateVersion: 1, salesDayBasis: 'business-06:00' };
  const payload = salesHistoryDayPayload('2026-10-12', { totalSales: 100, totalTxs: 1, ...metadata });
  assert.equal(payload.businessDateVersion, 1);
  assert.equal(payload.salesDayBasis, 'business-06:00');
  const read = mapSalesHistoryRow({ sales_date: '2026-10-12', source_data: metadata });
  assert.equal(read.businessDateVersion, 1);
  assert.equal(read.salesDayBasis, 'business-06:00');
  assert.equal(mapSalesHistoryRow({ source_data: {} }).businessDateVersion, undefined);
});

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
