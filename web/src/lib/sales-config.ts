import { normalizeHeader, type SheetCell } from "./geo-victoria";

export type DailySalesTarget = { vta: string; txs: string };
export type MonthlySalesData = Record<string, DailySalesTarget>;
export type HourlyParticipation = Record<string, Record<string, number>>;
export type RealSalesData = Record<string, DailySalesTarget>;

export const BUSINESS_HOURS = Array.from({ length: 24 }, (_, index) => `${String((index + 6) % 24).padStart(2, "0")}:00`);

export function normalizeNumericInput(value: unknown) {
  let text = String(value ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!text) return "";
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const commaCount = (text.match(/,/g) ?? []).length;
  const dotCount = (text.match(/\./g) ?? []).length;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    text = text.replaceAll(decimalSeparator === "," ? "." : ",", "");
    if (decimalSeparator === ",") text = text.replace(",", ".");
  } else if (commaCount > 1 || dotCount > 1) {
    const separator = commaCount > 1 ? "," : ".";
    const parts = text.split(separator);
    const decimalPart = parts.pop();
    text = `${parts.join("")}.${decimalPart}`;
  } else if (lastComma >= 0) {
    text = /^-?\d{1,3}(,\d{3})+$/.test(text) ? text.replaceAll(",", "") : text.replace(",", ".");
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replaceAll(".", "");
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? String(numeric) : "";
}

export function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return [];
  return Array.from({ length: new Date(year, monthNumber, 0).getDate() }, (_, index) => index + 1);
}

export function sanitizeMonthlyData(value: unknown): MonthlySalesData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => /^\d{1,2}$|^\d{4}-\d{2}-\d{2}$/.test(key)).map(([day, row]) => {
    const record = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {};
    return [day, { vta: normalizeNumericInput(record.vta), txs: normalizeNumericInput(record.txs) }];
  }));
}

export function sanitizeHourlyParticipation(value: unknown): HourlyParticipation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([date, hours]) => {
    const record = hours && typeof hours === "object" && !Array.isArray(hours) ? hours as Record<string, unknown> : {};
    return [date, Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, Number(record[hour]) || 0]))];
  }));
}

function cellText(value: SheetCell) {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "").trim();
}

export function parseDelimitedText(text: string): SheetCell[][] {
  const delimiter = text.split(/\r?\n/, 1)[0]?.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function bestHeaderIndex(matrix: SheetCell[][]) {
  const keywords = ["fecha", "hora", "pedido", "documento", "correlativo", "estado", "total", "importe", "venta"];
  let bestIndex = 0;
  let bestScore = -1;
  matrix.slice(0, 20).forEach((row, index) => {
    const values = row.map(normalizeHeader);
    const score = keywords.filter((keyword) => values.some((value) => value.includes(keyword))).length;
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  });
  return bestIndex;
}

function rowValue(row: Record<string, SheetCell>, labels: string[]) {
  const targets = labels.map(normalizeHeader);
  const key = Object.keys(row).find((candidate) => targets.includes(normalizeHeader(candidate)));
  return key ? row[key] : undefined;
}

function dateAndHour(dateValue: SheetCell, hourValue: SheetCell) {
  let date: Date | null = null;
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) date = new Date(dateValue);
  else {
    const text = cellText(dateValue);
    const latin = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (latin) {
      const year = Number(latin[3].length === 2 ? `20${latin[3]}` : latin[3]);
      date = new Date(year, Number(latin[2]) - 1, Number(latin[1]), Number(latin[4] ?? 0), Number(latin[5] ?? 0));
    } else {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }
  }
  if (!date) return null;
  if (hourValue instanceof Date && !Number.isNaN(hourValue.getTime())) date.setHours(hourValue.getHours(), hourValue.getMinutes(), 0, 0);
  else {
    const match = cellText(hourValue).match(/(\d{1,2}):(\d{2})/);
    if (match) date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  }
  return date;
}

function isoLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseSalesMatrix(matrix: SheetCell[][]) {
  if (!matrix.length) return { hourly: {}, real: {}, rows: 0 } as { hourly: HourlyParticipation; real: RealSalesData; rows: number };
  const headerIndex = bestHeaderIndex(matrix);
  const headers = matrix[headerIndex].map((value, index) => cellText(value) || `_${index}`);
  const salesByDateHour = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  const orders = new Map<string, Set<string>>();
  let parsedRows = 0;
  matrix.slice(headerIndex + 1).forEach((cells, rowIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]])) as Record<string, SheetCell>;
    const state = cellText(rowValue(row, ["estadoitem", "estado item", "estado"])).toLocaleLowerCase("es");
    if (state.includes("anulad") || state.includes("cancel")) return;
    const order = cellText(rowValue(row, ["pedido", "documento", "correlativo"])) || `fila-${rowIndex}`;
    if (order.toLocaleLowerCase("es").includes("total pedido")) return;
    const amountText = normalizeNumericInput(rowValue(row, ["total", "monto", "venta", "ventas", "importe"]));
    const amount = Number(amountText);
    const stamp = dateAndHour(rowValue(row, ["fecha", "fechapedido", "fecha pedido", "date"]), rowValue(row, ["hora", "time"]));
    if (!stamp || !Number.isFinite(amount)) return;
    const rawHour = stamp.getHours();
    const businessDate = new Date(stamp);
    if (rawHour < 6) businessDate.setDate(businessDate.getDate() - 1);
    const date = isoLocal(businessDate);
    const hour = `${String(rawHour).padStart(2, "0")}:00`;
    const byHour = salesByDateHour.get(date) ?? new Map<string, number>();
    byHour.set(hour, (byHour.get(hour) ?? 0) + amount);
    salesByDateHour.set(date, byHour);
    totals.set(date, (totals.get(date) ?? 0) + amount);
    const uniqueOrders = orders.get(date) ?? new Set<string>();
    uniqueOrders.add(order);
    orders.set(date, uniqueOrders);
    parsedRows += 1;
  });
  const hourly: HourlyParticipation = {};
  const real: RealSalesData = {};
  totals.forEach((total, date) => {
    const byHour = salesByDateHour.get(date) ?? new Map<string, number>();
    hourly[date] = Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, total > 0 ? ((byHour.get(hour) ?? 0) / total) * 100 : 0]));
    real[date] = { vta: total.toFixed(2), txs: String(orders.get(date)?.size ?? 0) };
  });
  return { hourly, real, rows: parsedRows };
}

export function totalsForMonth(monthly: MonthlySalesData) {
  return Object.values(monthly).reduce((total, row) => ({
    sales: total.sales + (Number(normalizeNumericInput(row.vta)) || 0),
    transactions: total.transactions + (Number(normalizeNumericInput(row.txs)) || 0),
  }), { sales: 0, transactions: 0 });
}

export function weekdayAverages(real: RealSalesData, hourly: HourlyParticipation) {
  const labels = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const rows = labels.map((name, weekday) => ({ name, weekday, count: 0, sales: 0, transactions: 0, hourly: Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, 0])) }));
  new Set([...Object.keys(real), ...Object.keys(hourly)]).forEach((date) => {
    const [year, month, day] = date.split("-").map(Number);
    const row = rows[new Date(year, month - 1, day).getDay()];
    const actual = real[date];
    if (actual) { row.sales += Number(actual.vta) || 0; row.transactions += Number(actual.txs) || 0; row.count += 1; }
    BUSINESS_HOURS.forEach((hour) => { row.hourly[hour] += Number(hourly[date]?.[hour]) || 0; });
  });
  return rows.slice(1).concat(rows[0]).map((row) => ({ ...row, sales: row.count ? row.sales / row.count : 0, transactions: row.count ? row.transactions / row.count : 0, hourly: Object.fromEntries(BUSINESS_HOURS.map((hour) => [hour, row.count ? row.hourly[hour] / row.count : 0])) }));
}
