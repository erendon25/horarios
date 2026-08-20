import type { Json } from "@/types/database";
import { normalizeHeader, type SheetCell } from "./geo-victoria";
import { normalizeNumericInput, parseDelimitedText } from "./sales-config";

export const PROJECTION_DAYS = [
  { key: "lunes", label: "Lunes", weekday: "monday" },
  { key: "martes", label: "Martes", weekday: "tuesday" },
  { key: "miercoles", label: "Miércoles", weekday: "wednesday" },
  { key: "jueves", label: "Jueves", weekday: "thursday" },
  { key: "viernes", label: "Viernes", weekday: "friday" },
  { key: "sabado", label: "Sábado", weekday: "saturday" },
  { key: "domingo", label: "Domingo", weekday: "sunday" },
] as const;

export const PROJECTION_HOURS = Array.from({ length: 15 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`);
export const REQUIREMENT_HOURS = Array.from({ length: 21 }, (_, index) => `${String((index + 8) % 24).padStart(2, "0")}:00`);

export type ProjectionLogic = "sales" | "service" | "driver" | "fixed";
export type ProjectionPosition = {
  id: string;
  name: string;
  logic: ProjectionLogic;
  capacity: number | string;
  ticketAverage: number | string;
  transactionsPerCollaborator: number | string;
  factor: number | string;
  fixedStaff: number | string;
};
export type SalesByDay = Record<string, Record<string, number>>;
export type ManualStaffByDay = Record<string, Record<string, Record<string, number>>>;

export const DEFAULT_PROJECTION_POSITIONS: ProjectionPosition[] = [
  { id: "cocina", name: "Cocina", logic: "sales", capacity: 780, factor: 1, ticketAverage: "", transactionsPerCollaborator: "", fixedStaff: "" },
  { id: "sheetout", name: "Sheetout", logic: "sales", capacity: 780, factor: 0.7, ticketAverage: "", transactionsPerCollaborator: "", fixedStaff: "" },
  { id: "masa", name: "Masa", logic: "sales", capacity: 780, factor: 0.55, ticketAverage: "", transactionsPerCollaborator: "", fixedStaff: "" },
  { id: "landing", name: "Landing", logic: "sales", capacity: 780, factor: 0.5, ticketAverage: "", transactionsPerCollaborator: "", fixedStaff: "" },
  { id: "punto_venta", name: "Punto de Venta", logic: "service", capacity: "", ticketAverage: 35, transactionsPerCollaborator: 23, factor: 1, fixedStaff: "" },
  { id: "driver_modulo", name: "Driver", logic: "driver", capacity: "", ticketAverage: 35, transactionsPerCollaborator: "", factor: 1, fixedStaff: "" },
  { id: "limpieza", name: "Limpieza", logic: "fixed", capacity: "", ticketAverage: "", transactionsPerCollaborator: "", factor: "", fixedStaff: 1 },
  { id: "horno", name: "Horno", logic: "fixed", capacity: "", ticketAverage: "", transactionsPerCollaborator: "", factor: "", fixedStaff: 1 },
  { id: "lavado", name: "Lavado", logic: "fixed", capacity: "", ticketAverage: "", transactionsPerCollaborator: "", factor: "", fixedStaff: 1 },
  { id: "do_sheet", name: "Do Sheet", logic: "fixed", capacity: "", ticketAverage: "", transactionsPerCollaborator: "", factor: "", fixedStaff: 1 },
];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown) {
  if (value === "" || value === null || value === undefined) return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

export function emptySalesByDay(): SalesByDay {
  return Object.fromEntries(PROJECTION_DAYS.map((day) => [day.key, Object.fromEntries(PROJECTION_HOURS.map((hour) => [hour, 0]))]));
}

export function normalizeProjectionPositions(value: Json | undefined): ProjectionPosition[] {
  const rows = Array.isArray(value) ? value : [];
  const positions = rows.map((raw, index) => {
    const row = object(raw);
    const logic = ["sales", "service", "driver", "fixed"].includes(String(row.logic)) ? String(row.logic) as ProjectionLogic : "sales";
    return {
      id: String(row.id || `position_${index}`), name: String(row.name || `Posición ${index + 1}`), logic,
      capacity: numeric(row.capacity), ticketAverage: numeric(row.ticketAverage), transactionsPerCollaborator: numeric(row.transactionsPerCollaborator),
      factor: numeric(row.factor), fixedStaff: numeric(row.fixedStaff),
    };
  });
  if (!positions.length) return DEFAULT_PROJECTION_POSITIONS.map((position) => ({ ...position }));
  const ids = new Set(positions.map((position) => position.id));
  return positions.concat(DEFAULT_PROJECTION_POSITIONS.filter((position) => position.logic === "fixed" && !ids.has(position.id)).map((position) => ({ ...position })));
}

export function normalizeSalesByDay(value: Json | undefined): SalesByDay {
  const source = object(value);
  const empty = emptySalesByDay();
  PROJECTION_DAYS.forEach((day) => {
    const hours = object(source[day.key]);
    PROJECTION_HOURS.forEach((hour) => { empty[day.key][hour] = Number(hours[hour]) || 0; });
  });
  return empty;
}

export function normalizeManualStaff(value: Json | undefined): ManualStaffByDay {
  const result: ManualStaffByDay = {};
  Object.entries(object(value)).forEach(([day, positions]) => {
    result[day] = {};
    Object.entries(object(positions)).forEach(([position, hours]) => {
      result[day][position] = Object.fromEntries(Object.entries(object(hours)).map(([hour, count]) => [hour, Math.max(0, Number(count) || 0)]));
    });
  });
  return result;
}

export function calculatePositionStaff(sale: number, position: ProjectionPosition) {
  if (position.logic === "fixed") return Math.max(0, Number(position.fixedStaff) || 0);
  if (!sale) return 0;
  const factor = Number(position.factor);
  if (!Number.isFinite(factor)) return 0;
  if (position.logic === "service") {
    const ticket = Number(position.ticketAverage);
    const transactions = Number(position.transactionsPerCollaborator);
    return ticket > 0 && transactions > 0 ? Math.ceil(((sale / ticket) / transactions) * factor) : 0;
  }
  if (position.logic === "driver") {
    const ticket = Number(position.ticketAverage);
    return ticket > 0 ? Math.ceil(((sale / ticket) / 45) * factor) : 0;
  }
  const capacity = Number(position.capacity);
  return capacity > 0 ? Math.ceil((sale / capacity) * factor) : 0;
}

export function buildDayMatrix(sales: Record<string, number>, positions: ProjectionPosition[], manual: Record<string, Record<string, number>> = {}) {
  return PROJECTION_HOURS.map((hour) => {
    const sale = Number(sales[hour]) || 0;
    const requiredByPosition = Object.fromEntries(positions.map((position) => {
      const calculated = calculatePositionStaff(sale, position);
      const override = manual[position.id]?.[hour];
      return [position.id, override === undefined ? calculated : Math.max(0, Number(override) || 0)];
    }));
    return { hour, sale, requiredByPosition, totalStaff: Object.values(requiredByPosition).reduce((sum, value) => sum + value, 0) };
  });
}

export function buildProjectionRequirements(salesByDay: SalesByDay, positions: ProjectionPosition[], manual: ManualStaffByDay) {
  return Object.fromEntries(PROJECTION_DAYS.map((day) => {
    const matrix = buildDayMatrix(salesByDay[day.key] ?? {}, positions, manual[day.key]);
    const rows = positions.map((position) => Object.fromEntries(REQUIREMENT_HOURS.map((hour, index) => [index, matrix.find((column) => column.hour === hour)?.requiredByPosition[position.id] ?? 0])));
    return [day.weekday, { positions: positions.map((position) => position.name), matrix: Object.fromEntries(rows.map((row, index) => [index, row])) }];
  }));
}

export function weeklyRequiredHours(salesByDay: SalesByDay, positions: ProjectionPosition[], manual: ManualStaffByDay) {
  return PROJECTION_DAYS.reduce((total, day) => total + buildDayMatrix(salesByDay[day.key] ?? {}, positions, manual[day.key]).reduce((sum, column) => sum + column.totalStaff, 0), 0);
}

export function projectedTargets(monthlyConfigs: Array<{ month_start: string; monthly_data: Json }>, weekStart: string) {
  const configs = new Map(monthlyConfigs.map((config) => [config.month_start.slice(0, 7), object(config.monthly_data)]));
  return Object.fromEntries(PROJECTION_DAYS.map((day, index) => {
    const date = new Date(`${weekStart}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
    const iso = date.toISOString().slice(0, 10);
    const target = object(configs.get(iso.slice(0, 7))?.[String(Number(iso.slice(8, 10)))]).vta;
    return [day.key, Number(target) || 0];
  }));
}

export function positionLogicLabel(logic: ProjectionLogic) {
  return { sales: "Venta / capacidad", service: "Servicio / caja", driver: "Driver", fixed: "Fijo" }[logic];
}

export function contractHours(staff: Array<{ modality: string | null; cessation_date: string | null; status: string }>, date: string) {
  return staff.filter((person) => person.status !== "inactive" && (!person.cessation_date || person.cessation_date >= date)).reduce((hours, person) => {
    const modality = String(person.modality ?? "").toLocaleLowerCase("es");
    return hours + (modality.includes("full") ? 48 : modality.includes("part") ? 24 : 0);
  }, 0);
}

function projectionDayKey(value: SheetCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return PROJECTION_DAYS[(value.getDay() + 6) % 7].key;
  const text = normalizeHeader(value);
  const day = PROJECTION_DAYS.find((candidate) => text.startsWith(normalizeHeader(candidate.label).slice(0, 3)));
  if (day) return day.key;
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : PROJECTION_DAYS[(parsed.getDay() + 6) % 7].key;
}

function projectionHourKey(value: SheetCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${String(value.getHours()).padStart(2, "0")}:00`;
  const match = String(value ?? "").match(/(\d{1,2}):\d{2}/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:00` : null;
}

export function parseProjectionMatrix(matrix: SheetCell[][]) {
  let headerIndex = -1;
  let indexes: { day: number; hour: number; sale: number } | null = null;
  matrix.slice(0, 30).some((row, rowIndex) => {
    const headers = row.map(normalizeHeader);
    const day = headers.findIndex((header) => header === "dia" || header.includes("fecha"));
    const hour = headers.findIndex((header) => header.includes("horario") || header === "hora");
    const sale = headers.findIndex((header) => header === "venta" || header.includes("venta") || header === "importe");
    if (day >= 0 && hour >= 0 && sale >= 0) { headerIndex = rowIndex; indexes = { day, hour, sale }; return true; }
    return false;
  });
  if (!indexes || headerIndex < 0) throw new Error("No se encontraron las columnas Día/Fecha, Horario/Hora y Venta.");
  const found = indexes as { day: number; hour: number; sale: number };
  const salesByDay = emptySalesByDay();
  let rows = 0;
  matrix.slice(headerIndex + 1).forEach((row) => {
    const day = projectionDayKey(row[found.day]);
    const hour = projectionHourKey(row[found.hour]);
    const sale = Number(normalizeNumericInput(row[found.sale]));
    if (!day || !hour || !PROJECTION_HOURS.includes(hour) || !Number.isFinite(sale)) return;
    salesByDay[day][hour] += sale;
    rows += 1;
  });
  return { salesByDay, rows };
}

export { parseDelimitedText };
