import type { Json } from "@/types/database";

export const SALES_CHANNELS = ["SALÓN", "DELIVERY", "DRIVE THRU", "SERV. FILA"] as const;
export const SALES_SHIFTS = ["Apertura", "Día", "Cierre"] as const;
export const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

export type SalesHistoryInput = {
  sales_date: string;
  sales_amount: number | null;
  transactions: number | null;
  hourly_data: Json;
  source_data: Json;
};

export type SalesMonthConfigInput = { month_start: string; monthly_data: Json };

export type SalesAggregate = {
  sales: number;
  transactions: number;
  daysWithData: number;
  channelsSales: Record<string, number>;
  channelsTransactions: Record<string, number>;
  shiftsSales: Record<string, number>;
  shiftsTransactions: Record<string, number>;
  weekdaysSales: Record<string, number>;
  weekdaysTransactions: Record<string, number>;
  hourlyTransactions: Record<string, number>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberRecord(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).map(([key, raw]) => [key, Number(raw) || 0]));
}

export function addIsoDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string) {
  return Math.max(0, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1);
}

export function previousPeriod(start: string, end: string) {
  const length = daysBetween(start, end);
  return { start: addIsoDays(start, -length), end: addIsoDays(start, -1) };
}

export function previousYearPeriod(start: string, end: string) {
  const previousYear = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    const value = new Date(Date.UTC(year - 1, month - 1, day, 12));
    if (value.getUTCMonth() !== month - 1) value.setUTCDate(0);
    return value.toISOString().slice(0, 10);
  };
  return { start: previousYear(start), end: previousYear(end) };
}

function weekdayLabel(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return WEEKDAYS[(day + 6) % 7];
}

function shiftLabel(hour: number) {
  if (hour >= 6 && hour < 12) return SALES_SHIFTS[0];
  if (hour >= 12 && hour < 18) return SALES_SHIFTS[1];
  return SALES_SHIFTS[2];
}

export function aggregateSales(rows: SalesHistoryInput[], start: string, end: string): SalesAggregate {
  const result: SalesAggregate = {
    sales: 0,
    transactions: 0,
    daysWithData: 0,
    channelsSales: Object.fromEntries(SALES_CHANNELS.map((channel) => [channel, 0])),
    channelsTransactions: Object.fromEntries(SALES_CHANNELS.map((channel) => [channel, 0])),
    shiftsSales: Object.fromEntries(SALES_SHIFTS.map((shift) => [shift, 0])),
    shiftsTransactions: Object.fromEntries(SALES_SHIFTS.map((shift) => [shift, 0])),
    weekdaysSales: Object.fromEntries(WEEKDAYS.map((day) => [day, 0])),
    weekdaysTransactions: Object.fromEntries(WEEKDAYS.map((day) => [day, 0])),
    hourlyTransactions: Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [`${String(hour).padStart(2, "0")}:00`, 0])),
  };

  rows.filter((row) => row.sales_date >= start && row.sales_date <= end).forEach((row) => {
    const daySales = Number(row.sales_amount) || 0;
    const dayTransactions = Number(row.transactions) || 0;
    result.sales += daySales;
    result.transactions += dayTransactions;
    result.daysWithData += 1;
    const weekday = weekdayLabel(row.sales_date);
    result.weekdaysSales[weekday] += daySales;
    result.weekdaysTransactions[weekday] += dayTransactions;

    const hourlySales = record(row.hourly_data);
    const hourlyTransactions = record(record(row.source_data).hourlyTxs);
    new Set([...Object.keys(hourlySales), ...Object.keys(hourlyTransactions)]).forEach((hourKey) => {
      const hour = Number.parseInt(hourKey, 10);
      if (!Number.isFinite(hour)) return;
      const salesByChannel = numberRecord(hourlySales[hourKey]);
      const transactionsByChannel = numberRecord(hourlyTransactions[hourKey]);
      const shift = shiftLabel(hour);
      const hourLabel = `${String(hour).padStart(2, "0")}:00`;
      Object.entries(salesByChannel).forEach(([channel, amount]) => {
        result.channelsSales[channel] = (result.channelsSales[channel] || 0) + amount;
        result.shiftsSales[shift] += amount;
      });
      Object.entries(transactionsByChannel).forEach(([channel, count]) => {
        result.channelsTransactions[channel] = (result.channelsTransactions[channel] || 0) + count;
        result.shiftsTransactions[shift] += count;
        result.hourlyTransactions[hourLabel] += count;
      });
    });
  });
  return result;
}

export function salesGoal(configs: SalesMonthConfigInput[], start: string, end: string) {
  const byMonth = new Map(configs.map((config) => [config.month_start.slice(0, 7), record(config.monthly_data)]));
  let date = start;
  let total = 0;
  while (date <= end) {
    const month = date.slice(0, 7);
    const day = String(Number(date.slice(8, 10)));
    total += Number(record(byMonth.get(month)?.[day]).vta) || 0;
    date = addIsoDays(date, 1);
  }
  return total;
}

export function variation(current: number, previous: number) {
  return previous ? ((current - previous) / previous) * 100 : current ? 100 : 0;
}

export function businessHourEntries(values: Record<string, number>) {
  const hours = [...Array.from({ length: 18 }, (_, index) => index + 6), 0, 1, 2, 3, 4, 5];
  const entries = hours.map((hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, value: values[`${String(hour).padStart(2, "0")}:00`] || 0 }));
  const first = entries.findIndex((entry) => entry.value > 0);
  const last = entries.reduce((index, entry, current) => entry.value > 0 ? current : index, -1);
  return first >= 0 ? entries.slice(first, last + 1) : entries;
}
