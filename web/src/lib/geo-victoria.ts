import type { Json } from "@/types/database";

export type SheetCell = string | number | boolean | Date | null | undefined;
export type SheetRow = Record<string, SheetCell>;
export type GeoVictoriaStaff = {
  id: string;
  firestoreId: string | null;
  userId: string | null;
  dni: string | null;
  firstName: string;
  lastName: string;
  position: string;
  modality: string | null;
  cessationDate: string | null;
};

export type GeoVictoriaExtraRecord = {
  firestore_id: string;
  staff_id: string;
  user_id: string | null;
  store_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  pre_shift_minutes: number;
  post_shift_minutes: number;
  activity: string;
  source: string;
  source_file: string;
  imported_at: string;
  segments: Json;
  daily_details: Json;
  legacy_data: Json;
};

export type GeoVictoriaImportSummary = {
  records: GeoVictoriaExtraRecord[];
  matchedRows: number;
  skippedNoDni: number;
  unmatchedDnis: string[];
  invalidDateRows: number;
  noExtraRows: number;
  totalMinutes: number;
};

export type GeoVictoriaRosterCandidate = { dni: string; firstName: string; lastName: string; email: string; joinDate: string | null };
export type GeoVictoriaRosterSummary = { candidates: GeoVictoriaRosterCandidate[]; existing: number; skipped: number };
export type GeoVictoriaLateRow = { dni: string; name: string; modality: string; date: string; day: string; scheduledStart: string; arrival: string; lateMinutes: number };

export function normalizeHeader(value: SheetCell) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

export function normalizeDni(value: SheetCell) {
  return String(value ?? "").trim().replace(/\.0+$/, "").replace(/\D/g, "");
}

export function rowsFromMatrix(matrix: SheetCell[][]): SheetRow[] {
  const headerIndex = matrix.findIndex((row) => row.some((cell) => String(cell ?? "").trim()));
  if (headerIndex < 0) return [];
  const counts = new Map<string, number>();
  const headers = matrix[headerIndex].map((cell, index) => {
    const base = String(cell ?? "").trim() || `_${index}`;
    const normalized = normalizeHeader(base);
    const count = counts.get(normalized) ?? 0;
    counts.set(normalized, count + 1);
    return count === 0 ? base : `${base}.${count}`;
  });
  return matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function rowValue(row: SheetRow, labels: string[], fallbackIndexes: number[] = []) {
  const targets = labels.map(normalizeHeader);
  const key = Object.keys(row).find((candidate) => targets.includes(normalizeHeader(candidate)));
  if (key && row[key] !== "") return row[key];
  for (const index of fallbackIndexes) {
    const fallback = Object.keys(row)[index];
    if (fallback && row[fallback] !== "") return row[fallback];
  }
  return "";
}

function repeatedValue(row: SheetRow, label: string, index: number) {
  const target = normalizeHeader(label);
  const keys = Object.keys(row).filter((key) => normalizeHeader(key).replace(/[._]\d+$/, "") === target);
  return keys[index] ? row[keys[index]] : "";
}

export function parseDate(value: SheetCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 1) {
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + Math.floor(value));
    return date.toISOString().slice(0, 10);
  }
  const match = String(value ?? "").trim().match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function parseTime(value: SheetCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  if (typeof value === "number") {
    const minutes = Math.round((((value % 1) + 1) % 1) * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = String(value ?? "").trim().match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

export function parseDurationMinutes(value: SheetCell) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.max(0, Math.round(value * 1440));
  if (value instanceof Date && !Number.isNaN(value.getTime())) return Math.max(0, value.getHours() * 60 + value.getMinutes());
  const text = String(value).trim().toLocaleLowerCase("es").replace(",", ".");
  const days = text.match(/(\d+)\s*days?\s+(\d{1,2}):(\d{2})/);
  if (days) return Number(days[1]) * 1440 + Number(days[2]) * 60 + Number(days[3]);
  const clock = text.match(/(\d{1,3}):(\d{2})/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minutes = text.match(/(\d+)\s*m/);
  if (hours || minutes) return Math.round((hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0));
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.max(0, Math.round((numeric <= 1 ? numeric * 24 : numeric) * 60)) : 0;
}

function turnoRange(value: SheetCell) {
  const matches = String(value ?? "").match(/\d{1,2}:\d{2}/g) ?? [];
  return { scheduledStart: parseTime(matches[0]), scheduledEnd: parseTime(matches[1]) };
}

export function parseShiftMap(matrix: SheetCell[][]) {
  const result: Record<string, number> = {};
  for (const row of matrix.slice(2)) {
    const id = Number(row[0]);
    const start = parseTime(row[1]);
    const end = parseTime(row[3]);
    if (Number.isFinite(id) && start && end) result[`${start}-${end}`] = id;
  }
  return result;
}

export function parseRoster(rows: SheetRow[], existingDnis: Array<string | null>): GeoVictoriaRosterSummary {
  const existing = new Set(existingDnis.map(normalizeDni).filter(Boolean));
  const seen = new Set<string>();
  const candidates: GeoVictoriaRosterCandidate[] = [];
  let existingCount = 0, skipped = 0;
  rows.forEach((row) => {
    const state = String(rowValue(row, ["Estado"]) ?? "").trim().toLocaleLowerCase("es");
    if (state && !state.includes("activ")) { skipped += 1; return; }
    const dni = normalizeDni(rowValue(row, ["Identificador", "DNI", "Documento"]));
    if (!dni || seen.has(dni)) { skipped += 1; return; }
    seen.add(dni);
    if (existing.has(dni)) { existingCount += 1; return; }
    const firstName = String(rowValue(row, ["Nombre"]) ?? "").trim();
    const lastName = String(rowValue(row, ["Apellidos", "Apellido"]) ?? "").trim();
    if (!firstName || !lastName) { skipped += 1; return; }
    candidates.push({ dni, firstName, lastName, email: String(rowValue(row, ["Email", "Correo"]) ?? "").trim().toLocaleLowerCase("es"), joinDate: parseDate(rowValue(row, ["Fecha inicio contrato", "Fecha de inicio contrato"])) || null });
  });
  return { candidates, existing: existingCount, skipped };
}

function dayLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  const day = new Intl.DateTimeFormat("es-PE", { weekday: "long", timeZone: "UTC" }).format(parsed);
  return `${day.charAt(0).toLocaleUpperCase("es")}${day.slice(1)} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function parseLateArrivals(rows: SheetRow[], staff: GeoVictoriaStaff[]) {
  const byDni = new Map(staff.map((person) => [normalizeDni(person.dni), person]));
  return rows.flatMap((row): GeoVictoriaLateRow[] => {
    if (String(rowValue(row, ["Justificado por"]) ?? "").trim()) return [];
    const dni = normalizeDni(rowValue(row, ["DNI", "Identificador", "Documento"]));
    const person = byDni.get(dni);
    const date = parseDate(rowValue(row, ["Fecha"]));
    const lateMinutes = parseDurationMinutes(rowValue(row, ["Minutos de Atraso", "Minutos atraso", "Atraso"]));
    const firstName = String(rowValue(row, ["Nombre"]) ?? "").trim();
    const lastName = String(rowValue(row, ["Apellidos", "Apellido"]) ?? "").trim();
    const name = person ? `${person.firstName} ${person.lastName}`.trim() : `${firstName} ${lastName}`.trim();
    if (!name || !date || lateMinutes <= 0) return [];
    const group = String(rowValue(row, ["Grupo Usuario", "Grupo marcacion", "Grupo marcación"]) ?? "").toLocaleUpperCase("es");
    return [{ dni, name, modality: person?.modality || (group.includes("ENTRENADOR") ? "Full-Time" : "Part-Time"), date, day: dayLabel(date), scheduledStart: parseTime(rowValue(row, ["Hora Inicio Turno", "Inicio turno"])), arrival: parseTime(rowValue(row, ["Hora Llegada", "Llegada"])), lateMinutes }];
  }).sort((a, b) => `${a.date}_${a.name}`.localeCompare(`${b.date}_${b.name}`, "es"));
}

type Context = { dni: string; staff: GeoVictoriaStaff; periodStart: string; periodEnd: string; date: string; turno: string; entrada: string; salida: string; scheduledStart: string; scheduledEnd: string; detailRows: number; dailyDetails: Record<string, unknown>[] };
type Group = Context & { pre: number; post: number; total: number; segments: Record<string, unknown>[] };

export function parseExtraHours(rows: SheetRow[], staff: GeoVictoriaStaff[], storeId: string, sourceFile: string, importedAt: string): GeoVictoriaImportSummary {
  const byDni = new Map<string, GeoVictoriaStaff>();
  staff.forEach((person) => {
    const dni = normalizeDni(person.dni);
    if (!dni) return;
    const current = byDni.get(dni);
    if (!current || (current.cessationDate && !person.cessationDate)) byDni.set(dni, person);
  });
  const grouped = new Map<string, Group>();
  const unmatched = new Set<string>();
  let matchedRows = 0, skippedNoDni = 0, invalidDateRows = 0, noExtraRows = 0;
  let context: Context | null = null;

  rows.forEach((row, rowIndex) => {
    const rawDni = normalizeDni(rowValue(row, ["Identificador", "DNI", "Documento"], [3]));
    if (rawDni) {
      const person = byDni.get(rawDni);
      if (!person) { unmatched.add(rawDni); context = null; return; }
      const date = parseDate(rowValue(row, ["Fecha"], [0]));
      if (!date) { invalidDateRows += 1; context = null; return; }
      const turno = String(rowValue(row, ["Turno"], [5]) ?? "").trim();
      const { scheduledStart, scheduledEnd } = turnoRange(turno);
      const entrada = parseTime(rowValue(row, ["Entrada"], [6]));
      const salida = parseTime(rowValue(row, ["Salio", "Salió"], [10]));
      const pre = parseDurationMinutes(repeatedValue(row, "TE", 0) || rowValue(row, ["TE Entrada"], [7]));
      const post = parseDurationMinutes(repeatedValue(row, "TE", 1) || rowValue(row, ["TE Salida"], [11]));
      const detail = pre + post > 0 ? [{ rowIndex: rowIndex + 2, fecha: date, turno, entrada, salida, scheduledStart, scheduledEnd, extraMinutesPre: pre, extraMinutesPost: post, totalExtraMinutes: pre + post }] : [];
      if (context?.dni === rawDni) {
        context.periodStart = date < context.periodStart ? date : context.periodStart;
        context.periodEnd = date > context.periodEnd ? date : context.periodEnd;
        context.date = date; context.turno = turno || context.turno; context.entrada = entrada || context.entrada; context.salida = salida || context.salida;
        context.scheduledStart = scheduledStart || context.scheduledStart; context.scheduledEnd = scheduledEnd || context.scheduledEnd; context.detailRows += 1; context.dailyDetails.push(...detail);
      } else {
        context = { dni: rawDni, staff: person, periodStart: date, periodEnd: date, date, turno, entrada, salida, scheduledStart, scheduledEnd, detailRows: 1, dailyDetails: detail };
      }
      return;
    }

    if (!context) { skippedNoDni += 1; return; }
    const date = parseDate(rowValue(row, ["Fecha"], [0])) || context.date;
    if (!date) { invalidDateRows += 1; return; }
    const turno = String(rowValue(row, ["Turno"], [5]) || context.turno).trim();
    const range = turnoRange(turno);
    const entrada = parseTime(rowValue(row, ["Entrada"], [6])) || context.entrada;
    const salida = parseTime(rowValue(row, ["Salio", "Salió"], [10])) || context.salida;
    const pre = parseDurationMinutes(repeatedValue(row, "TE", 0) || rowValue(row, ["TE Entrada"], [7]));
    const post = parseDurationMinutes(repeatedValue(row, "TE", 1) || rowValue(row, ["TE Salida"], [11]));
    const total = pre + post;
    if (total <= 0) { noExtraRows += 1; context = null; return; }

    matchedRows += 1;
    const key = `${context.staff.id}_${context.periodStart}_${context.periodEnd}`;
    const current = grouped.get(key) ?? { ...context, pre: 0, post: 0, total: 0, segments: [] };
    current.pre += pre; current.post += post; current.total += total;
    current.segments.push({ rowIndex: rowIndex + 2, type: "subtotal", periodStart: context.periodStart, periodEnd: context.periodEnd, detailRows: context.detailRows, turno, entrada, salida, scheduledStart: range.scheduledStart || context.scheduledStart, scheduledEnd: range.scheduledEnd || context.scheduledEnd, extraMinutesPre: pre, extraMinutesPost: post, totalExtraMinutes: total });
    grouped.set(key, current);
    context = null;
  });

  const records = [...grouped.values()].map((item) => {
    const externalStaffId = item.staff.firestoreId || item.staff.id;
    const start = item.periodStart || item.date, end = item.periodEnd || item.date;
    const activityParts = [item.pre > 0 ? `Entrada: ${item.pre} min` : "", item.post > 0 ? `Salida: ${item.post} min` : ""].filter(Boolean).join(" | ");
    return {
      firestore_id: `gvextra_${externalStaffId}_${start}_${end}`,
      staff_id: item.staff.id,
      user_id: item.staff.userId,
      store_id: storeId,
      work_date: end,
      start_time: (item.pre > 0 ? item.entrada || item.scheduledStart : item.scheduledEnd || item.salida) || null,
      end_time: (item.post > 0 ? item.salida || item.scheduledEnd : item.scheduledStart || item.entrada) || null,
      duration_minutes: item.total,
      pre_shift_minutes: item.pre,
      post_shift_minutes: item.post,
      activity: `Tiempo extra GeoVictoria (${activityParts})`,
      source: "geovictoria_extra_hours",
      source_file: sourceFile,
      imported_at: importedAt,
      segments: item.segments as Json,
      daily_details: item.dailyDetails as Json,
      legacy_data: { dni: item.dni, periodStart: start, periodEnd: end, turno: item.turno, importedFrom: "geovictoria_tiempo_extra" } as Json,
    } satisfies GeoVictoriaExtraRecord;
  });

  return { records, matchedRows, skippedNoDni, unmatchedDnis: [...unmatched].sort(), invalidDateRows, noExtraRows, totalMinutes: records.reduce((sum, record) => sum + record.duration_minutes, 0) };
}
