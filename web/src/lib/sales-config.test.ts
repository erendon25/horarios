import { describe, expect, it } from "vitest";
import { normalizeNumericInput, parseDelimitedText, parseSalesMatrix, sanitizeMonthlyData, totalsForMonth } from "./sales-config";

describe("sales config", () => {
  it("normaliza formatos monetarios locales", () => {
    expect(normalizeNumericInput("S/ 1.234,50")).toBe("1234.5");
    expect(normalizeNumericInput("1,234.50")).toBe("1234.5");
    expect(normalizeNumericInput("S/ (1.234,50)")).toBe("-1234.5");
  });

  it("procesa CSV con pedidos únicos y mueve la madrugada al día comercial anterior", () => {
    const matrix = parseDelimitedText("Fecha,Hora,Pedido,Total,Estado,Canal\n14/07/2026,22:10,A1,100,OK,Delivery\n15/07/2026,01:15,A2,50,OK,\n15/07/2026,01:30,A2,25,OK,\n15/07/2026,02:00,A3,99,Anulado,Salón");
    const result = parseSalesMatrix(matrix);
    expect(result.rows).toBe(3);
    expect(result.real["2026-07-14"]).toEqual({ vta: "175.00", txs: "2" });
    expect(result.hourly["2026-07-14"]["22:00"]).toBeCloseTo(57.1428, 3);
    expect(result.hourly["2026-07-14"]["01:00"]).toBeCloseTo(42.8571, 3);
    expect(result.history).toEqual([{
      date: "2026-07-14",
      totalSales: 175,
      totalTxs: 2,
      hourlyData: { "1": { "SIN CLASIFICAR": 75 }, "22": { DELIVERY: 100 } },
      hourlyTxs: { "1": { "SIN CLASIFICAR": 1 }, "22": { DELIVERY: 1 } },
    }]);
  });

  it("suma metas del mes", () => {
    expect(totalsForMonth({ "1": { vta: "10.5", txs: "2" }, "2": { vta: "20", txs: "3" } })).toEqual({ sales: 30.5, transactions: 5 });
  });

  it("conserva ventas netas negativas por hora y asigna una sola TX por documento", () => {
    const matrix = parseDelimitedText("Fecha,Hora,Pedido,Total,Estado,Canal\n14/07/2026,22:10,B1,100,OK,Salón\n14/07/2026,23:10,NC1,-20,OK,Delivery\n14/07/2026,21:10,B1,5,OK,Delivery");
    const result = parseSalesMatrix(matrix);
    expect(result.real["2026-07-14"]).toEqual({ vta: "85.00", txs: "2" });
    expect(result.history[0]).toMatchObject({
      totalSales: 85,
      totalTxs: 2,
      hourlyData: { "21": { DELIVERY: 5 }, "22": { "SALÓN": 100 }, "23": { DELIVERY: -20 } },
      hourlyTxs: { "21": { DELIVERY: 1 }, "22": {}, "23": { DELIVERY: 1 } },
    });
  });

  it("agrupa bloques por Nro. pedido, convierte una NC positiva y no inventa TX para filas huérfanas", () => {
    const matrix = parseDelimitedText([
      "Fecha,Hora,Nro. pedido,Documento,Total,Estado,Canal,Descripción",
      "2026-07-14,21:00,,,15,OK,Salón,fila sin identidad",
      "2026-07-14,22:10,P1,B001-1,100,OK,Salón,venta",
      "2026-07-14,23:10,P2,,20,OK,Delivery,ajuste",
      ",,,FN01-9,,OK,,devolución",
    ].join("\n"));
    const result = parseSalesMatrix(matrix);
    expect(result.rows).toBe(2);
    expect(result.real["2026-07-14"]).toEqual({ vta: "80.00", txs: "2" });
    expect(result.history[0]).toEqual({
      date: "2026-07-14",
      totalSales: 80,
      totalTxs: 2,
      hourlyData: { "22": { "SALÓN": 100 }, "23": { DELIVERY: -20 } },
      hourlyTxs: { "22": { "SALÓN": 1 }, "23": { DELIVERY: 1 } },
    });
  });

  it("usa el total explícito del bloque sin contar sus ítems como transacciones separadas", () => {
    const matrix = parseDelimitedText("Fecha,Hora,Nro. pedido,Documento,Total,Estado,Canal\n2026-07-14,22:00,P9,B009,40,OK,Salón\n,,,,60,OK,Salón\n,,Total Pedido,,95,OK,");
    const result = parseSalesMatrix(matrix);
    expect(result.rows).toBe(2);
    expect(result.real["2026-07-14"]).toEqual({ vta: "95.00", txs: "1" });
    expect(result.history[0]).toMatchObject({
      totalSales: 95,
      totalTxs: 1,
      hourlyData: { "22": { "SALÓN": 95 } },
      hourlyTxs: { "22": { "SALÓN": 1 } },
    });
  });

  it("deduplica por comprobante aunque existan dos bloques de pedido", () => {
    const matrix = parseDelimitedText("Fecha,Hora,Nro. pedido,Documento,Total,Estado,Canal\n2026-07-14,20:00,P1,B001-7,10,OK,Salón\n2026-07-14,21:00,P2,B001-7,20,OK,Delivery");
    const result = parseSalesMatrix(matrix);
    expect(result.real["2026-07-14"]).toEqual({ vta: "30.00", txs: "1" });
    expect(result.history[0].hourlyTxs).toEqual({ "20": { "SALÓN": 1 }, "21": {} });
  });

  it("cuenta una TX por cada día cuando el sistema reutiliza el mismo identificador", () => {
    const matrix = parseDelimitedText("Fecha,Hora,Nro. pedido,Documento,Total,Estado,Canal\n2026-07-14,20:00,P1,B001-7,10,OK,Salón\n2026-07-15,20:00,P1,B001-7,20,OK,Salón");
    const result = parseSalesMatrix(matrix);
    expect(result.history.map(({ date, totalSales, totalTxs }) => ({ date, totalSales, totalTxs }))).toEqual([
      { date: "2026-07-14", totalSales: 10, totalTxs: 1 },
      { date: "2026-07-15", totalSales: 20, totalTxs: 1 },
    ]);
  });

  it("excluye pedidos sin comprobante solo cuando el reporte declara esa columna", () => {
    const withDocumentColumn = parseDelimitedText([
      "Fecha,Hora,Nro. pedido,Documento,Total,Estado,Canal",
      "2026-07-14,20:00,P1,,10,OK,Salón",
      "2026-07-14,21:00,P2,,20,OK,Serv. Fila",
      "2026-07-14,22:00,P3,B003,30,OK,Delivery",
    ].join("\n"));
    const withoutDocumentColumn = parseDelimitedText([
      "Fecha,Hora,Nro. pedido,Total,Estado,Canal",
      "2026-07-14,20:00,P1,10,OK,Salón",
      "2026-07-14,21:00,P2,20,OK,Delivery",
    ].join("\n"));

    expect(parseSalesMatrix(withDocumentColumn).real["2026-07-14"]).toEqual({ vta: "50.00", txs: "2" });
    expect(parseSalesMatrix(withoutDocumentColumn).real["2026-07-14"]).toEqual({ vta: "30.00", txs: "2" });
  });

  it("trata placeholders de documento igual que un comprobante ausente", () => {
    const matrix = parseDelimitedText([
      "Fecha,Hora,Nro. pedido,Documento,Total,Estado,Canal",
      "2026-07-14,20:00,P1,NO APLICA,10,OK,Salón",
      "2026-07-14,21:00,P2,NO DEFINIDO,20,OK,Delivery",
      "2026-07-14,22:00,P3,B003,30,OK,Delivery",
    ].join("\n"));
    expect(parseSalesMatrix(matrix).real["2026-07-14"]).toEqual({ vta: "30.00", txs: "1" });
  });

  it("convierte fechas seriales de Excel en la zona local del negocio", () => {
    const excelSerial = (Date.UTC(2026, 6, 14) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const result = parseSalesMatrix([
      ["Fecha", "Hora", "Pedido", "Total", "Estado", "Canal"],
      [excelSerial, 1 / 24, "P1", 10, "OK", "Salón"],
    ]);
    expect(result.real["2026-07-13"]).toEqual({ vta: "10.00", txs: "1" });
  });

  it("cuenta una cortesía con cero explícito pero no un bloque sin monto", () => {
    const matrix = parseDelimitedText([
      "Fecha,Hora,Nro. pedido,Documento,Total,Estado,Canal",
      "2026-07-14,20:00,P1,B001,,OK,Salón",
      "2026-07-14,21:00,P2,B002,0,OK,Salón",
    ].join("\n"));
    const result = parseSalesMatrix(matrix);
    expect(result.real["2026-07-14"]).toEqual({ vta: "0.00", txs: "1" });
  });

  it("descarta estados no cobrados con la misma paridad que el importador Vite", () => {
    const matrix = parseDelimitedText("Fecha,Hora,Nro. pedido,Total,Estado,Canal\n2026-07-14,20:00,P1,10,Pendiente,Salón\n2026-07-14,20:30,P2,20,VOID,Salón\n2026-07-14,21:00,P3,30,No cobrado,Delivery\n2026-07-14,21:30,P4,40,OK,Delivery");
    const result = parseSalesMatrix(matrix);
    expect(result.rows).toBe(1);
    expect(result.real["2026-07-14"]).toEqual({ vta: "40.00", txs: "1" });
  });

  it("ignora metadatos antiguos al sanear ventas reales", () => {
    expect(sanitizeMonthlyData({ hourlyParticipation: null, "2026-07-14": { vta: 125, txs: 4 } })).toEqual({
      "2026-07-14": { vta: "125", txs: "4" },
    });
  });
});
