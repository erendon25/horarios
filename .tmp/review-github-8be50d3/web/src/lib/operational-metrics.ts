import { addIsoDays, effectiveModality, mondayOf, segmentMinutes } from "./weekly-schedule";

export type PeriodType = "day" | "week" | "month";

export type MetricsStaff = {
  id: string;
  first_name: string;
  last_name: string;
  modality: string | null;
  modality_change_date: string | null;
  next_modality: string | null;
  is_trainee: boolean;
  cessation_date: string | null;
};

export type MetricsShift = {
  id: number;
  staff_id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  is_day_off: boolean;
  is_holiday: boolean;
  metadata: Record<string, unknown>;
};

export type MetricsExtra = {
  id: number;
  staff_id: string | null;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  pre_shift_minutes: number;
  post_shift_minutes: number;
  activity: string | null;
  source: string;
  daily_details: unknown[];
};

export type MetricsHoliday = {
  id: number;
  staff_id: string;
  holiday_date: string;
  name: string;
  balance_type: "ganado" | "compensado";
};

export type MetricsSalesDay = {
  sales_date: string;
  sales_amount: number | null;
  transactions: number | null;
};

export type StaffOperationalMetric = {
  staffId: string;
  name: string;
  shifts: number;
  fullTimeShifts: number;
  partTimeShifts: number;
  standardMinutes: number;
  scheduledMinutes: number;
  nightMinutes: number;
  plannedExtraMinutes: number;
  registeredExtraMinutes: number;
  holidaysEarned: number;
  holidaysCompensated: number;
  holidayBalance: number;
};

export type OperationalMetrics = {
  rows: StaffOperationalMetric[];
  standardMinutes: number;
  scheduledMinutes: number;
  nightMinutes: number;
  plannedExtraMinutes: number;
  registeredExtraMinutes: number;
  holidaysEarned: number;
  holidaysCompensated: number;
  holidayBalance: number;
  sales: number;
  transactions: number;
};

export function periodBounds(type: PeriodType, selectedDate: string) {
  if (type === "day") return { start: selectedDate, end: selectedDate };
  if (type === "week") {
    const start = mondayOf(selectedDate);
    return { start, end: addIsoDays(start, 6) };
  }
  const [year, month] = selectedDate.slice(0, 7).split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${year}-${String(month).padStart(2, "0")}-${last}` };
}

export function nightMinutes(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const from = startHour * 60 + startMinute;
  let to = endHour * 60 + endMinute;
  if (to <= from) to += 1440;
  let result = 0;
  for (let minute = from; minute < to; minute++) {
    const clockMinute = minute % 1440;
    if (clockMinute >= 1320 || clockMinute < 360) result++;
  }
  return result;
}

function numberFromMetadata(metadata: Record<string, unknown>, key: string, fallbackKey?: string) {
  const raw = metadata[key] ?? (fallbackKey ? metadata[fallbackKey] : undefined);
  const number = Number(raw ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function extraMinutesInPeriod(extra: MetricsExtra, start: string, end: string): number {
  if (Array.isArray(extra.daily_details) && extra.daily_details.length) {
    return extra.daily_details.reduce<number>((total, raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return total;
      const detail = raw as Record<string, unknown>;
      const date = typeof detail.fecha === "string" ? detail.fecha : "";
      if (date < start || date > end) return total;
      const totalMinutes = Number(detail.totalExtraMinutes ?? 0);
      if (Number.isFinite(totalMinutes) && totalMinutes > 0) return total + totalMinutes;
      const pre = Number(detail.extraMinutesPre ?? 0);
      const post = Number(detail.extraMinutesPost ?? 0);
      return total + (Number.isFinite(pre) ? Math.max(pre, 0) : 0) + (Number.isFinite(post) ? Math.max(post, 0) : 0);
    }, 0);
  }
  if (extra.work_date < start || extra.work_date > end) return 0;
  if (extra.duration_minutes > 0) return extra.duration_minutes;
  const components = extra.pre_shift_minutes + extra.post_shift_minutes;
  if (components > 0) return components;
  return segmentMinutes(extra.start_time ?? "", extra.end_time ?? "");
}

export function calculateOperationalMetrics(input: {
  staff: MetricsStaff[];
  shifts: MetricsShift[];
  extras: MetricsExtra[];
  holidays: MetricsHoliday[];
  salesDays: MetricsSalesDay[];
  start: string;
  end: string;
  excludeTrainees: boolean;
}): OperationalMetrics {
  const { start, end } = input;
  const staffById = new Map(input.staff.map((person) => [person.id, person]));
  const included = new Map<string, StaffOperationalMetric>();
  const row = (staffId: string) => {
    const person = staffById.get(staffId);
    if (!person || (input.excludeTrainees && person.is_trainee)) return null;
    if (person.cessation_date && person.cessation_date < start) return null;
    let value = included.get(staffId);
    if (!value) {
      value = {
        staffId,
        name: `${person.first_name} ${person.last_name}`.trim(),
        shifts: 0,
        fullTimeShifts: 0,
        partTimeShifts: 0,
        standardMinutes: 0,
        scheduledMinutes: 0,
        nightMinutes: 0,
        plannedExtraMinutes: 0,
        registeredExtraMinutes: 0,
        holidaysEarned: 0,
        holidaysCompensated: 0,
        holidayBalance: 0,
      };
      included.set(staffId, value);
    }
    return value;
  };

  for (const shift of input.shifts) {
    if (shift.work_date < start || shift.work_date > end || shift.is_day_off || shift.is_holiday || !shift.start_time || !shift.end_time) continue;
    const person = staffById.get(shift.staff_id);
    const current = row(shift.staff_id);
    if (!person || !current || (person.cessation_date && shift.work_date > person.cessation_date)) continue;
    const modality = effectiveModality(person, shift.work_date).toLocaleLowerCase("es");
    current.shifts++;
    if (modality.includes("full")) {
      current.fullTimeShifts++;
      current.standardMinutes += 8 * 60;
    } else if (modality.includes("part")) {
      current.partTimeShifts++;
      current.standardMinutes += 4 * 60;
    }
    current.scheduledMinutes += segmentMinutes(shift.start_time, shift.end_time);
    current.nightMinutes += nightMinutes(shift.start_time, shift.end_time);
    const splitStart = typeof shift.metadata.start2 === "string" ? shift.metadata.start2 : "";
    const splitEnd = typeof shift.metadata.end2 === "string" ? shift.metadata.end2 : "";
    if (shift.metadata.splitShift === true && splitStart && splitEnd) {
      current.scheduledMinutes += segmentMinutes(splitStart, splitEnd);
      current.nightMinutes += nightMinutes(splitStart, splitEnd);
    }
    current.plannedExtraMinutes += Math.round(numberFromMetadata(shift.metadata, "extraHoursPre") * 60);
    current.plannedExtraMinutes += Math.round(numberFromMetadata(shift.metadata, "extraHoursPost", "extraHours") * 60);
  }

  for (const extra of input.extras) {
    if (!extra.staff_id) continue;
    const current = row(extra.staff_id);
    if (current) current.registeredExtraMinutes += extraMinutesInPeriod(extra, start, end);
  }

  for (const holiday of input.holidays) {
    const current = row(holiday.staff_id);
    if (!current) continue;
    current.holidayBalance += holiday.balance_type === "ganado" ? 1 : -1;
    if (holiday.holiday_date < start || holiday.holiday_date > end) continue;
    if (holiday.balance_type === "ganado") current.holidaysEarned++;
    else current.holidaysCompensated++;
  }

  const rows = [...included.values()]
    .filter((item) => item.shifts || item.registeredExtraMinutes || item.holidaysEarned || item.holidaysCompensated || item.holidayBalance)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const sum = (field: keyof StaffOperationalMetric) => rows.reduce((total, item) => total + Number(item[field]), 0);
  return {
    rows,
    standardMinutes: sum("standardMinutes"),
    scheduledMinutes: sum("scheduledMinutes"),
    nightMinutes: sum("nightMinutes"),
    plannedExtraMinutes: sum("plannedExtraMinutes"),
    registeredExtraMinutes: sum("registeredExtraMinutes"),
    holidaysEarned: sum("holidaysEarned"),
    holidaysCompensated: sum("holidaysCompensated"),
    holidayBalance: sum("holidayBalance"),
    sales: input.salesDays.reduce((total, day) => total + Number(day.sales_amount ?? 0), 0),
    transactions: input.salesDays.reduce((total, day) => total + Number(day.transactions ?? 0), 0),
  };
}
