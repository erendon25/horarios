import { describe, expect, it } from "vitest";
import { buildDayMatrix, buildProjectionRequirements, calculatePositionStaff, contractHours, emptySalesByDay, normalizeProjectionPositions, parseDelimitedText, parseProjectionMatrix, type ProjectionPosition } from "./sales-projection";

const position = (logic: ProjectionPosition["logic"], values: Partial<ProjectionPosition> = {}): ProjectionPosition => ({ id: logic, name: logic, logic, capacity: 100, ticketAverage: 25, transactionsPerCollaborator: 10, factor: 1, fixedStaff: 1, ...values });

describe("sales projection", () => {
  it("calcula las cuatro lógicas de dotación", () => {
    expect(calculatePositionStaff(250, position("sales"))).toBe(3);
    expect(calculatePositionStaff(2500, position("service"))).toBe(10);
    expect(calculatePositionStaff(2250, position("driver"))).toBe(2);
    expect(calculatePositionStaff(0, position("fixed", { fixedStaff: 2 }))).toBe(2);
  });

  it("aplica ajustes manuales sobre el cálculo", () => {
    const matrix = buildDayMatrix({ "09:00": 250 }, [position("sales")], { sales: { "09:00": 1 } });
    expect(matrix[0].requiredByPosition.sales).toBe(1);
  });

  it("genera el contrato de 21 columnas consumido por horarios", () => {
    const sales = emptySalesByDay(); sales.lunes["09:00"] = 250;
    const requirements = buildProjectionRequirements(sales, [position("sales")], {});
    expect(requirements.monday.positions).toEqual(["sales"]);
    expect(requirements.monday.matrix[0][0]).toBe(0);
    expect(requirements.monday.matrix[0][1]).toBe(3);
    expect(Object.keys(requirements.monday.matrix[0])).toHaveLength(21);
  });

  it("conserva puestos fijos faltantes al sanear una plantilla antigua", () => {
    const positions = normalizeProjectionPositions([{ id: "cocina", name: "Vestido", logic: "sales", capacity: 800 }] as never);
    expect(positions.some((item) => item.id === "limpieza")).toBe(true);
  });

  it("incluye colaboradores pendientes sin cuenta y excluye cesados o inactivos", () => {
    expect(contractHours([
      { modality: "Full-Time", cessation_date: null, status: "pending" },
      { modality: "Part-Time", cessation_date: null, status: "active" },
      { modality: "Full-Time", cessation_date: null, status: "inactive" },
      { modality: "Part-Time", cessation_date: "2026-07-01", status: "active" },
    ], "2026-07-14")).toBe(72);
  });

  it("importa un reporte horario agregado", () => {
    const parsed = parseProjectionMatrix(parseDelimitedText("Día,Horario,Venta\nLunes,09:00,100\nLunes,09:30,50\nMartes,10:00,200"));
    expect(parsed.rows).toBe(3);
    expect(parsed.salesByDay.lunes["09:00"]).toBe(150);
    expect(parsed.salesByDay.martes["10:00"]).toBe(200);
  });
});
