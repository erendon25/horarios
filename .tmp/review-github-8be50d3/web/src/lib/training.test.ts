import { describe, expect, it } from "vitest";
import { evaluationGroups, evaluationScore, stationProgress, trainingStats } from "./training";

describe("training", () => {
  it("crea claves únicas para todos los criterios", () => {
    const groups = evaluationGroups("service", "SERVICIO");
    const keys = groups.flatMap((group) => group.points.map((point) => point.key));
    expect(keys.length).toBeGreaterThan(20);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("calcula puntaje contra todos los criterios esperados", () => {
    expect(evaluationScore({ one: true, two: false }, ["one", "two", "three"])).toBe(33);
  });

  it("calcula avance y estadísticas por certificaciones", () => {
    expect(stationProgress(["SERVICIO", "DESPACHO"], "service")).toBe(50);
    const stats = trainingStats([{ id: "1", name: "Ana", skills: ["SERVICIO"] }, { id: "2", name: "Luis", skills: ["SERVICIO", "DESPACHO"] }], "service");
    expect(stats.totalCertifications).toBe(3);
    expect(stats.leaders[0].name).toBe("Luis");
  });
});
