import { emptyStaffWeek, mondayOf, type StaffWeek, type Weekday } from "./weekly-schedule";

export type OwnShiftRow = {
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  position: string | null;
  is_day_off: boolean;
  is_holiday: boolean;
  notes: string | null;
  metadata: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clock = (value: string | null) => value?.slice(0, 5) ?? "";

export function limaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function hydrateOwnWeek(weekStart: string, rows: OwnShiftRow[]): StaffWeek {
  const week = emptyStaffWeek(mondayOf(weekStart));
  for (const row of rows) {
    const index = Math.round((Date.parse(`${row.work_date}T12:00:00Z`) - Date.parse(`${mondayOf(weekStart)}T12:00:00Z`)) / 86_400_000);
    const day = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][index] as Weekday | undefined;
    if (!day) continue;
    const metadata = isObject(row.metadata) ? row.metadata : {};
    week[day] = {
      date: row.work_date,
      start: clock(row.start_time), end: clock(row.end_time), position: row.position ?? "",
      off: row.is_day_off, holiday: row.is_holiday, notes: row.notes ?? "",
      splitShift: metadata.splitShift === true,
      start2: clock(typeof metadata.start2 === "string" ? metadata.start2 : null),
      end2: clock(typeof metadata.end2 === "string" ? metadata.end2 : null),
      extraHoursPre: typeof metadata.extraHoursPre === "number" ? metadata.extraHoursPre : Number(metadata.extraHoursPre) || 0,
      extraHoursPost: typeof metadata.extraHoursPost === "number" ? metadata.extraHoursPost : Number(metadata.extraHoursPost) || 0,
    };
  }
  return week;
}

export function holidayBalance(rows: Array<{ balance_type: "ganado" | "compensado" }>) {
  return rows.reduce((total, row) => total + (row.balance_type === "ganado" ? 1 : -1), 0);
}

export function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)} h ${String(safe % 60).padStart(2, "0")} min`;
}
