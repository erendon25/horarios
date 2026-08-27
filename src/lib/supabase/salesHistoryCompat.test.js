import test from "node:test";
import assert from "node:assert/strict";
import {
  allowsOrderTransactionFallback,
  assignCanonicalTransactionBucket,
  buildCanonicalHourlyTransactions,
  hasExplicitSalesAmount,
  hasSalesDocumentColumn,
  isCreditNoteTransaction,
  mapSalesHistoryRow,
  normalizeTransactionDocument,
  parseCanonicalSalesRows,
  parseExplicitSalesAmount,
  parseSalesTimestamp,
  salesBlockAmountEntries,
  salesConfigurationRpcArgs,
  salesHistoryDayPayload,
  salesTransactionScopeKey,
} from "./salesHistoryCompat.js";

test("prioriza las transacciones horarias canónicas", () => {
  const mapped = mapSalesHistoryRow({
    sales_date: "2026-08-21",
    sales_amount: 100,
    transactions: 2,
    hourly_data: { 10: { "SALÓN": 100 } },
    hourly_transactions: { 10: { "SALÓN": 2 } },
    source_data: { hourlyTxs: { 10: { "SALÓN": 99 } } },
  });
  assert.deepEqual(mapped.hourlyTxs, { 10: { "SALÓN": 2 } });
});

test("conserva compatibilidad con hourlyTxs legado y normaliza el payload", () => {
  const mapped = mapSalesHistoryRow({
    hourly_transactions: {},
    source_data: { hourlyTxs: { 19: { DELIVERY: 3 } } },
  });
  assert.deepEqual(mapped.hourlyTxs, { 19: { DELIVERY: 3 } });
  assert.deepEqual(salesHistoryDayPayload("2026-08-21", {
    totalSales: "10.5",
    totalTxs: "2",
    hourlyData: null,
  }), {
    date: "2026-08-21",
    totalSales: 10.5,
    totalTxs: 2,
    hourlyData: {},
    hourlyTxs: {},
  });
});

test("asigna cada comprobante a una sola hora y conserva horas sin una TX propia", () => {
  const buckets = new Map();
  assignCanonicalTransactionBucket(buckets, "B001", { hour: 22, channel: "SALÓN", timestamp: 200 });
  assignCanonicalTransactionBucket(buckets, "B001", { hour: 21, channel: "DELIVERY", timestamp: 100 });
  assignCanonicalTransactionBucket(buckets, "B002", { hour: 22, channel: "SALÓN", timestamp: 300 });

  assert.deepEqual(buildCanonicalHourlyTransactions({
    20: { "SIN CLASIFICAR": -10 },
    21: { DELIVERY: 40 },
    22: { "SALÓN": 100 },
  }, buckets), {
    20: {},
    21: { DELIVERY: 1 },
    22: { "SALÓN": 1 },
  });
});

test("no convierte marcadores sin comprobante en una única transacción", () => {
  for (const marker of ["", "0", "000", "0.00", "-", ".", "sin documento", "sin doc.", "S/N", "NO APLICA", "NO DEFINIDO", "undefined", null]) {
    assert.equal(normalizeTransactionDocument(marker), "");
  }
  assert.equal(normalizeTransactionDocument("  b001-123  "), "B001-123");
  assert.equal(normalizeTransactionDocument("000123"), "000123");
});

test("aísla el mismo pedido por día comercial y conserva fechas ISO como locales", () => {
  const first = parseSalesTimestamp("2026-08-21", "22:15");
  const earlyMorning = parseSalesTimestamp("2026-08-22", 1 / 24);
  assert.equal(first?.businessDate, "2026-08-21");
  assert.equal(first?.hour, 22);
  assert.equal(earlyMorning?.businessDate, "2026-08-21");
  assert.equal(earlyMorning?.hour, 1);
  assert.notEqual(
    salesTransactionScopeKey("A-1", "2026-08-21", "22:15"),
    salesTransactionScopeKey("A-1", "2026-08-22", "22:15"),
  );
});

test("convierte fechas seriales de Excel sin desplazar el día local", () => {
  const excelSerial = (Date.UTC(2026, 6, 14) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const parsed = parseSalesTimestamp(excelSerial, 1 / 24);
  assert.equal(parsed?.timestamp.getFullYear(), 2026);
  assert.equal(parsed?.timestamp.getMonth(), 6);
  assert.equal(parsed?.timestamp.getDate(), 14);
  assert.equal(parsed?.hour, 1);
  assert.equal(parsed?.businessDate, "2026-07-13");
});

test("solo exige comprobante cuando el reporte realmente trae esa columna", () => {
  assert.equal(hasSalesDocumentColumn([{ Fecha: "2026-07-14", Pedido: "P1" }]), false);
  assert.equal(hasSalesDocumentColumn([{ Fecha: "2026-07-14", "Nro. Comprobante": "B001" }]), true);
  assert.equal(hasSalesDocumentColumn([{ Fecha: "2026-07-14", "N° Comprobante": "B001" }]), true);
  assert.equal(hasSalesDocumentColumn([{ Fecha: "2026-07-14", "Tipo comprobante": "BOLETA" }]), false);
  assert.equal(allowsOrderTransactionFallback(false, "SALÓN"), true);
  assert.equal(allowsOrderTransactionFallback(true, "SALÓN"), false);
  assert.equal(allowsOrderTransactionFallback(true, "SERV. FILA"), true);
});

test("distingue una cortesía cero de un monto ausente", () => {
  assert.equal(hasExplicitSalesAmount(0), true);
  assert.equal(hasExplicitSalesAmount("0.00"), true);
  assert.equal(hasExplicitSalesAmount("   "), false);
  assert.equal(hasExplicitSalesAmount(null), false);
  assert.equal(parseExplicitSalesAmount(0), 0);
  assert.equal(parseExplicitSalesAmount("0.00"), 0);
  assert.equal(parseExplicitSalesAmount("S/ (1.234,50)"), -1234.5);
  assert.equal(parseExplicitSalesAmount("OK"), null);
  assert.equal(parseExplicitSalesAmount("Salón"), null);
  assert.equal(parseExplicitSalesAmount(""), null);
});

test("conserva la hora y canal de cada ítem cuando no existe Total Pedido", () => {
  const first = parseSalesTimestamp("2026-07-14", "21:10");
  const second = parseSalesTimestamp("2026-07-14", "22:20");
  const entries = salesBlockAmountEntries({
    totalPedido: null,
    canalRaw: "Salón",
    items: [
      { amount: 5, parsedDate: first, canalRaw: "Delivery" },
      { amount: 100, parsedDate: second, canalRaw: "Salón" },
    ],
  }, first);
  assert.deepEqual(entries.map((entry) => ({ amount: entry.amount, hour: entry.parsedDate?.hour, channel: entry.channel })), [
    { amount: 5, hour: 21, channel: "Delivery" },
    { amount: 100, hour: 22, channel: "Salón" },
  ]);
  assert.deepEqual(salesBlockAmountEntries({
    totalPedido: 95,
    canalRaw: "Salón",
    items: [{ amount: 40, parsedDate: first, canalRaw: "Delivery" }],
  }, second).map((entry) => ({ amount: entry.amount, hour: entry.parsedDate?.hour, channel: entry.channel })), [
    { amount: 95, hour: 22, channel: "Salón" },
  ]);
});

test("reconoce FN y devoluciones aunque aparezcan en una fila posterior", () => {
  assert.equal(isCreditNoteTransaction("FN01-123"), true);
  assert.equal(isCreditNoteTransaction("", "Detalle de devolución del pedido"), true);
  assert.equal(isCreditNoteTransaction("B001-123", "Venta normal"), false);
});

test("el parser canónico no fabrica una cortesía desde textos de una fila Total Pedido", () => {
  const missing = parseCanonicalSalesRows([
    { Fecha: "2026-07-14", Hora: "20:00", "Nro. Pedido": "P0", Documento: "B000", Total: "", Estado: "OK", Canal: "Salón" },
    { "Nro. Pedido": "Total Pedido", Documento: "", Total: "", Estado: "OK", Canal: "Salón" },
  ]);
  assert.deepEqual(missing.history, []);

  const courtesy = parseCanonicalSalesRows([
    { Fecha: "2026-07-14", Hora: "20:00", "Nro. Pedido": "P1", Documento: "B001", Total: 0, Estado: "OK", Canal: "Salón" },
  ]);
  assert.deepEqual(courtesy.history, [{
    date: "2026-07-14",
    totalSales: 0,
    totalTxs: 1,
    hourlyData: { 20: { "SALÓN": 0 } },
    hourlyTxs: { 20: { "SALÓN": 1 } },
  }]);
});

test("el parser canónico distribuye ítems por hora y cuenta una TX por documento", () => {
  const result = parseCanonicalSalesRows([
    { Fecha: "2026-07-14", Hora: "22:10", "Nro. Pedido": "P1", Documento: "B001", Total: 100, Estado: "OK", Canal: "Salón" },
    { Fecha: "2026-07-14", Hora: "21:10", "Nro. Pedido": "P1", Documento: "B001", Total: 5, Estado: "OK", Canal: "Delivery" },
  ]);
  assert.deepEqual(result.history, [{
    date: "2026-07-14",
    totalSales: 105,
    totalTxs: 1,
    hourlyData: { 21: { DELIVERY: 5 }, 22: { "SALÓN": 100 } },
    hourlyTxs: { 21: { DELIVERY: 1 }, 22: {} },
  }]);
});

test("Nro. Pedido y Documento producen TX en la ruta canónica de configuración", () => {
  const result = parseCanonicalSalesRows([
    { Fecha: "2026-07-14", Hora: "20:00", "Nro. Pedido": "P1", Documento: "B001", Total: 10, Estado: "OK", Canal: "Salón" },
    { Fecha: "2026-07-14", Hora: "21:00", "Nro. Pedido": "P2", Comprobante: "B002", Total: 20, Estado: "OK", Canal: "Delivery" },
  ]);
  assert.equal(result.totalSales, 30);
  assert.equal(result.totalTxs, 2);
  assert.deepEqual(result.realSalesData["2026-07-14"], { vta: 30, txs: 2 });
});

test("el parser canónico aplica total de bloque, placeholders, estados y NC tardía en conjunto", () => {
  const result = parseCanonicalSalesRows([
    { Fecha: "2026-07-14", Hora: "22:00", "Nro. Pedido": "P1", Documento: "B001", Total: 40, Estado: "OK", Canal: "Salón" },
    { Fecha: "", Hora: "", "Nro. Pedido": "", Documento: "", Total: 60, Estado: "OK", Canal: "Salón" },
    { Fecha: "", Hora: "", "Nro. Pedido": "Total Pedido", Documento: "", Total: 95, Estado: "OK", Canal: "" },
    { Fecha: "2026-07-14", Hora: "22:30", "Nro. Pedido": "P2", Documento: "NO APLICA", Total: 20, Estado: "OK", Canal: "Delivery" },
    { Fecha: "2026-07-14", Hora: "22:40", "Nro. Pedido": "P3", Documento: "B003", Total: 10, Estado: "Pendiente", Canal: "Delivery" },
    { Fecha: "2026-07-14", Hora: "23:00", "Nro. Pedido": "P4", Documento: "", Total: 20, Estado: "OK", Canal: "Delivery" },
    { Fecha: "", Hora: "", "Nro. Pedido": "", Documento: "FN01-9", Total: "", Estado: "OK", Canal: "", Descripción: "Devolución" },
  ]);
  assert.deepEqual(result.history, [{
    date: "2026-07-14",
    totalSales: 75,
    totalTxs: 2,
    hourlyData: { 22: { "SALÓN": 95 }, 23: { DELIVERY: -20 } },
    hourlyTxs: { 22: { "SALÓN": 1 }, 23: { DELIVERY: 1 } },
  }]);
});

test("la configuración Vite envía config e historial juntos al RPC atómico", () => {
  const history = [{ date: "2026-07-14", totalSales: 30, totalTxs: 2, hourlyData: {}, hourlyTxs: {} }];
  assert.deepEqual(salesConfigurationRpcArgs("store-1", "2026-07", {
    monthlyData: { 14: { vta: "40", txs: "3" } },
    dailyHourlyParts: { "2026-07-14": { "20:00": "100.00" } },
    realSalesData: { "2026-07-14": { vta: 30, txs: 2 } },
    pendingHistory: history,
  }), {
    p_store_id: "store-1",
    p_month_start: "2026-07-01",
    p_monthly_data: { 14: { vta: "40", txs: "3" } },
    p_daily_hourly_parts: { "2026-07-14": { "20:00": "100.00" } },
    p_real_sales_data: { "2026-07-14": { vta: 30, txs: 2 }, hourlyParticipation: null },
    p_days: history,
  });
});
