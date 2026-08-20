import { KNOWLEDGE_POINTS, PRODUCTION_GENERAL_POINTS, PRODUCTION_STATIONS, SERVICE_GENERAL_POINTS, SERVICE_STATIONS, type TrainingPoint, type TrainingSection, type TrainingStation } from "./training-catalog";

export type TrainingArea = "service" | "production";
export type EvaluationResponse = Record<string, boolean>;
export type EvaluationFeedback = Record<string, string>;
export type EvaluationPoint = TrainingPoint & { key: string };
export type EvaluationGroup = { id: string; title: string; points: EvaluationPoint[] };

export function trainingStations(area: TrainingArea): Record<string, TrainingStation> {
  return area === "service" ? SERVICE_STATIONS : PRODUCTION_STATIONS;
}

export function evaluationGroups(area: TrainingArea, stationCode: string): EvaluationGroup[] {
  const general: TrainingSection[] = area === "service" ? SERVICE_GENERAL_POINTS : PRODUCTION_GENERAL_POINTS;
  const station = trainingStations(area)[stationCode];
  const groups: EvaluationGroup[] = general.map((section) => ({ id: section.id, title: section.title, points: section.points.map((point) => ({ ...point, key: `${section.id}_${point.id}` })) }));
  if (station) groups.push({ id: stationCode, title: station.title, points: station.points.map((point) => ({ ...point, key: `${stationCode}_${point.id}` })) });
  if (area === "service") groups.push({ id: "knowledge", title: "Manejo de situaciones", points: KNOWLEDGE_POINTS.map((point) => ({ ...point, key: `knowledge_${point.id}` })) });
  return groups;
}

export function evaluationScore(responses: EvaluationResponse, expectedKeys?: string[]) {
  const keys = expectedKeys ?? Object.keys(responses);
  if (keys.length === 0) return 0;
  return Math.round((keys.filter((key) => responses[key] === true).length / keys.length) * 100);
}

export function stationProgress(skills: string[], area: TrainingArea) {
  const stationCodes = Object.keys(trainingStations(area));
  if (stationCodes.length === 0) return 0;
  const normalized = new Set(skills.map((skill) => skill.toLocaleUpperCase("es")));
  return Math.round((stationCodes.filter((code) => normalized.has(code)).length / stationCodes.length) * 100);
}

export function trainingStats(staff: Array<{ id: string; name: string; skills: string[] }>, area: TrainingArea) {
  const stations = trainingStations(area);
  const counts = Object.entries(stations).map(([code, station]) => ({ code, name: station.title, count: staff.filter((person) => person.skills.some((skill) => skill.toLocaleUpperCase("es") === code)).length }));
  const leaders = staff.map((person) => ({ ...person, certifiedCount: person.skills.filter((skill) => stations[skill.toLocaleUpperCase("es")]).length })).filter((person) => person.certifiedCount > 0).sort((a, b) => b.certifiedCount - a.certifiedCount || a.name.localeCompare(b.name, "es"));
  return { counts, leaders, totalCertifications: counts.reduce((sum, row) => sum + row.count, 0) };
}
