import { normalizePosition, timeMinutes } from "./weekly-schedule";

export const COVERAGE_HOURS = Array.from({ length: 77 }, (_, index) => {
  const minutes = 360 + index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

export type CoverageAssignment = { position: string; start: string; end: string; isTrainer?: boolean };
export type CoverageCell = "empty" | "missing" | "assigned" | "excess" | "trainer";
export type CoverageRow = { name: string; slot: number; cells: CoverageCell[] };

function objectValues(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).sort(([a], [b]) => Number(a) - Number(b)).map(([, item]) => item);
}

export function expandProjectionMatrix(rawMatrix: unknown, positionCount: number) {
  const rows = objectValues(rawMatrix);
  return Array.from({ length: positionCount }, (_, rowIndex) => {
    const source = objectValues(rows[rowIndex]).map((value) => Number(value) || 0);
    if (source.length >= COVERAGE_HOURS.length) return source.slice(0, COVERAGE_HOURS.length);
    const expanded = Array(8).fill(0) as number[];
    for (let index = 0; index < 21; index++) expanded.push(...Array(4).fill(source[index] ?? 0));
    return expanded.slice(0, COVERAGE_HOURS.length);
  });
}

export function buildCoverageRows(positions: string[], expandedMatrix: number[][], assignments: CoverageAssignment[]): CoverageRow[] {
  const normalizedPositions = positions.map(normalizePosition);
  const names = new Map(normalizedPositions.map((key, index) => [key, positions[index].replace(/#\d+$/g, "").trim()]));
  const starts = new Map<string, Set<number>>();
  for (const assignment of assignments) {
    const key = normalizePosition(assignment.position);
    const set = starts.get(key) ?? new Set<number>();
    set.add(timeMinutes(assignment.start) % 1440);
    starts.set(key, set);
  }

  const assigned = new Map<string, number[]>();
  const trainers = new Map<string, boolean[][]>();
  for (const assignment of assignments) {
    const key = normalizePosition(assignment.position);
    if (!names.has(key) || !assignment.start || !assignment.end) continue;
    const counts = assigned.get(key) ?? Array(COVERAGE_HOURS.length).fill(0);
    const trainerSlots = trainers.get(key) ?? Array.from({ length: COVERAGE_HOURS.length }, () => [] as boolean[]);
    const start = timeMinutes(assignment.start);
    let end = timeMinutes(assignment.end);
    if (end <= start) end += 1440;
    for (let index = 0; index < COVERAGE_HOURS.length; index++) {
      const minute = 360 + index * 15;
      if (minute < start || minute > end) continue;
      if (minute === end && starts.get(key)?.has(end % 1440)) continue;
      counts[index]++;
      trainerSlots[index].push(Boolean(assignment.isTrainer));
    }
    assigned.set(key, counts);
    trainers.set(key, trainerSlots);
  }

  const rows: CoverageRow[] = [];
  normalizedPositions.forEach((key, positionIndex) => {
    const required = expandedMatrix[positionIndex] ?? Array(COVERAGE_HOURS.length).fill(0);
    const counts = assigned.get(key) ?? Array(COVERAGE_HOURS.length).fill(0);
    const maxRows = Math.max(1, ...required, ...counts);
    for (let slot = 0; slot < maxRows; slot++) {
      const cells = COVERAGE_HOURS.map((_, index): CoverageCell => {
        const needed = required[index] > slot;
        const present = counts[index] > slot;
        const trainer = trainers.get(key)?.[index]?.[slot] === true;
        if (present && trainer) return "trainer";
        if (needed && present) return "assigned";
        if (needed) return "missing";
        if (present) return "excess";
        return "empty";
      });
      rows.push({ name: names.get(key) ?? key, slot, cells });
    }
  });
  return rows;
}

