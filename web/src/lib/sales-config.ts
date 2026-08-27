import { normalizeHeader, type SheetCell } from "./geo-victoria";
import { normalizeSalesChannel } from "./sales-channels";

export type DailySalesTarget = { vta: string; txs: string };
export type MonthlySalesData = Record<string, DailySalesTarget>;
export type HourlyParticipation = Record<string, Record<string, number>>;
export type RealSalesData = Record<string, DailySalesTarget>;
export type SalesHistoryDayPayload = {
  date: string;
  totalSales: number;
  totalTxs: number;
  hourlyData: Record<string, Record<string, number>>;
  hourlyTxs: Record<string, Record<string, number>>;
};

export const BUSINESS_HOURS = Array.from({ length: 24 }, (_, index) => `${String((index + 6) % 24).padStart(2, "0")}:00`);

export function normalizeNumericInput(value: unknown) {
  const source = String(value ?? "").trim();
  const accountingNegative = source.includes("(") && source.includes(")");
  let text = source.replace(/[^\d.,-]/g, "");
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
  return Number.isFinite(numeric) ? String(accountingNegative ? -Math.abs(numeric) : numeric) : "";
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
  const matches = Object.keys(row).filter((candidate) => targets.includes(normalizeHeader(candidate)));
  const key = matches.find((candidate) => cellText(row[candidate]) !== "") ?? matches[0];
  return key ? row[key] : undefined;
}

function timeParts(value: SheetCell): [number, number, number] | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return [value.getHours(), value.getMinutes(), value.getSeconds()];
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 0 && value <= 23) return [value, 0, 0];
    const totalSeconds = Math.round((((value % 1) + 1) % 1) * 86_400) % 86_400;
    return [Math.floor(totalSeconds / 3600), Math.floor((totalSeconds % 3600) / 60), totalSeconds % 60];
  }
  const match = cellText(value).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const modifier = String(match[4] ?? "").toLocaleLowerCase("es");
  if (modifier.includes("p") && hour < 12) hour += 12;
  if (modifier.includes("a") && hour === 12) hour = 0;
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  return hour <= 23 && minute <= 59 && second <= 59 ? [hour, minute, second] : null;
}

function dateAndHour(dateValue: SheetCell, hourValue: SheetCell) {
  let year: number;
  let month: number;
  let day: number;
  let embeddedTime: [number, number, number] | null = null;
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    year = dateValue.getFullYear(); month = dateValue.getMonth() + 1; day = dateValue.getDate();
    embeddedTime = [dateValue.getHours(), dateValue.getMinutes(), dateValue.getSeconds()];
  } else if (typeof dateValue === "number" && Number.isFinite(dateValue) && dateValue >= 60) {
    const wholeDays = Math.floor(dateValue);
    const excelDate = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86_400_000);
    year = excelDate.getUTCFullYear(); month = excelDate.getUTCMonth() + 1; day = excelDate.getUTCDate();
    embeddedTime = timeParts(dateValue);
  } else {
    const text = cellText(dateValue).replace(/\s+/g, " ");
    const iso = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](.*))?$/);
    const latin = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s+(.*))?$/);
    if (iso) {
      year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); embeddedTime = timeParts(iso[4]);
    } else if (latin) {
      year = Number(latin[3].length === 2 ? `20${latin[3]}` : latin[3]);
      month = Number(latin[2]); day = Number(latin[1]); embeddedTime = timeParts(latin[4]);
    } else return null;
  }
  const explicitTime = hourValue === null || hourValue === undefined || hourValue === "" ? null : timeParts(hourValue);
  const [hour, minute, second] = explicitTime ?? embeddedTime ?? [0, 0, 0];
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function isoLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const EMPTY_TRANSACTION_IDS = new Set(["-", "--", ".", "0", "00", "000", "N/A", "NA", "NO APLICA", "NO DEFINIDO", "NULL", "S/N", "SIN DOC", "SIN DOC.", "SIN DOCUMENTO", "SIN COMPROBANTE", "UNDEFINED", "VACIO", "VACÍO"]);

function normalizeTransactionId(value: SheetCell) {
  const normalized = cellText(value).toLocaleUpperCase("es").replace(/\s+/g, " ").trim();
  const zeroLike = normalized.replace(/[.,\s]/g, "");
  return !normalized || /^0+$/.test(zeroLike) || EMPTY_TRANSACTION_IDS.has(normalized) ? "" : normalized;
}

function isCreditNote(document: string, rowText: string) {
  const text = rowText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  return /^(NC|BC|FC|FN)/.test(document) || text.includes("nota de credito") || text.includes("devolucion");
}

function isInvalidState(value: SheetCell) {
  const state = cellText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es");
  return ["ANULAD", "CANCELAD", "VOID", "NULO", "INACTIV", "PENDIENTE", "ABIERTO", "NO COBRADO", "ELIMINAD"].some((marker) => state.includes(marker));
}

function businessDate(stamp: Date) {
  const date = new Date(stamp);
  if (date.getHours() < 6) date.setDate(date.getDate() - 1);
  return isoLocal(date);
}

type ParsedOrder = {
  id: string;
  identitySource: "order" | "document";
  scopeDate: string;
  document: string;
  stamp: Date | null;
  channel: SheetCell;
  invalid: boolean;
  creditNote: boolean;
  total: number | null;
  items: Array<{ amount: number; stamp: Date | null; channel: SheetCell }>;
};

export function parseSalesMatrix(matrix: SheetCell[][]) {
  if (!matrix.length) return { hourly: {}, real: {}, history: [], rows: 0 } as { hourly: HourlyParticipation; real: RealSalesData; history: SalesHistoryDayPayload[]; rows: number };
  const headerIndex = bestHeaderIndex(matrix);
  const headers = matrix[headerIndex].map((value, index) => cellText(value) || `_${index}`);
  const documentLabels = ["documento", "comprobante", "n° comprobante", "nro. comprobante", "nro comprobante", "numero comprobante", "número comprobante", "nro. documento", "nro documento", "numero documento", "número documento"].map(normalizeHeader);
  const hasDocumentColumn = headers.some((header) => documentLabels.includes(normalizeHeader(header)));
  const blocks = new Map<string, ParsedOrder>();
  let currentKey = "";
  let parsedRows = 0;

  matrix.slice(headerIndex + 1).forEach((cells, rowIndex) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]])) as Record<string, SheetCell>;
    const rowText = cells.map(cellText).join(" ");
    const normalizedRowText = rowText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
    if (normalizedRowText.includes("total general") || normalizedRowText.includes("total periodo") || normalizedRowText.includes("resumen")) {
      currentKey = "";
      return;
    }

    const dateValue = rowValue(row, ["fecha", "fechapedido", "fecha pedido", "date", "fec.", "fecha/hora"]);
    const hourValue = rowValue(row, ["hora", "time", "horapedido", "hora pedido", "hr"]);
    const rowStamp = dateAndHour(dateValue, hourValue);
    const rowBusinessDate = rowStamp ? businessDate(rowStamp) : "";
    const rawOrder = rowValue(row, ["nro. pedido", "nro pedido", "nro de pedido", "numero pedido", "numero de pedido", "número pedido", "número de pedido", "pedido", "ticket", "correlativo"]);
    const rawDocument = rowValue(row, ["documento", "comprobante", "n° comprobante", "nro. comprobante", "nro comprobante", "numero comprobante", "número comprobante", "nro. documento", "nro documento", "numero documento", "número documento"]);
    const orderId = normalizeTransactionId(rawOrder);
    const documentId = normalizeTransactionId(rawDocument);
    const totalRow = normalizedRowText.includes("total pedido") || orderId.toLocaleLowerCase("es").includes("total pedido");
    let current = currentKey ? blocks.get(currentKey) : undefined;
    const attachDocument = !orderId && Boolean(documentId) && current?.identitySource === "order" && !current.document;
    const identity = orderId || (attachDocument ? "" : documentId);

    if (!totalRow && identity) {
      const scope = rowBusinessDate || (current?.id === identity ? current.scopeDate : "") || `sin-fecha-${rowIndex}`;
      currentKey = `${scope}\u0000${identity}`;
      current = blocks.get(currentKey);
      if (!current) {
        current = {
          id: identity,
          identitySource: orderId ? "order" : "document",
          scopeDate: rowBusinessDate,
          document: documentId,
          stamp: rowStamp,
          channel: rowValue(row, ["canal", "canal venta", "canalventa", "tipo venta", "tipoventa", "modalidad", "servicio"]),
          invalid: false,
          creditNote: false,
          total: null,
          items: [],
        };
        blocks.set(currentKey, current);
      }
    }
    if (!current) return;

    if (!current.document && documentId) current.document = documentId;
    current.creditNote ||= isCreditNote(documentId || current.document, rowText);
    if (isInvalidState(rowValue(row, ["estadoitem", "estado item", "estado", "status", "estado pedido", "condicion", "situacion"]))) {
      current.invalid = true;
      return;
    }
    const channel = rowValue(row, ["canal", "canal venta", "canalventa", "tipo venta", "tipoventa", "modalidad", "servicio"]);
    if (rowStamp && (!current.stamp || rowStamp.getTime() < current.stamp.getTime())) {
      current.stamp = rowStamp;
      current.scopeDate = rowBusinessDate;
      current.channel = channel;
    } else if (!cellText(current.channel) && cellText(channel)) current.channel = channel;

    const amountText = normalizeNumericInput(rowValue(row, ["total", "monto", "venta", "ventas", "importe", "neto"]));
    if (totalRow) {
      if (amountText) current.total = Number(amountText);
      return;
    }
    if (!amountText) return;
    const amount = Number(amountText);
    if (!Number.isFinite(amount)) return;
    current.items.push({ amount, stamp: rowStamp, channel });
    parsedRows += 1;
  });

  const salesByDateHour = new Map<string, Map<string, Map<string, number>>>();
  const totals = new Map<string, number>();
  const orders = new Map<string, Set<string>>();
  const orderAssignments = new Map<string, Map<string, { hour: string; channel: string; timestamp: number }>>();
  blocks.forEach((block) => {
    if (block.invalid || !block.stamp || (block.total === null && block.items.length === 0)) return;
    const transactionChannel = normalizeSalesChannel(block.channel);
    if (!block.document && hasDocumentColumn && transactionChannel !== "SERV. FILA") return;
    const transactionId = block.document || block.id;
    const transactionDate = businessDate(block.stamp);
    const transactionHour = `${String(block.stamp.getHours()).padStart(2, "0")}:00`;
    const entries = block.total === null
      ? block.items.map((item) => ({ ...item, stamp: item.stamp ?? block.stamp, channel: cellText(item.channel) ? item.channel : block.channel }))
      : [{ amount: block.total, stamp: block.stamp, channel: block.channel }];

    entries.forEach((entry) => {
      const stamp = entry.stamp ?? block.stamp!;
      const date = businessDate(stamp);
      const hour = `${String(stamp.getHours()).padStart(2, "0")}:00`;
      const channel = normalizeSalesChannel(entry.channel);
      const amount = block.creditNote ? -Math.abs(entry.amount) : entry.amount;
      const byHour = salesByDateHour.get(date) ?? new Map<string, Map<string, number>>();
      const byChannel = byHour.get(hour) ?? new Map<string, number>();
      byChannel.set(channel, (byChannel.get(channel) ?? 0) + amount);
      byHour.set(hour, byChannel);
      salesByDateHour.set(date, byHour);
      totals.set(date, (totals.get(date) ?? 0) + amount);
    });

    const uniqueOrders = orders.get(transactionDate) ?? new Set<string>();
    uniqueOrders.add(transactionId);
    orders.set(transactionDate, uniqueOrders);
    const assignments = orderAssignments.get(transactionDate) ?? new Map<string, { hour: string; channel: string; timestamp: number }>();
    const existing = assignments.get(transactionId);
    if (!existing || block.stamp.getTime() < existing.timestamp) {
      assignments.set(transactionId, { hour: transactionHour, channel: transactionChannel, timestamp: block.stamp.getTime() });
    }
    orderAssignments.set(transactionDate, assignments);
  });
  const hourly: HourlyParticipation = {};
  const real: RealSalesData = {};
  const history: SalesHistoryDayPayload[] = [];
  totals.forEach((total, date) => {
    const byHour = salesByDateHour.get(date) ?? new Map<string, Map<string, number>>();
    hourly[date] = Object.fromEntries(BUSINESS_HOURS.map((hour) => {
      const hourTotal = [...(byHour.get(hour)?.values() ?? [])].reduce((sum, value) => sum + value, 0);
      return [hour, total > 0 ? (hourTotal / total) * 100 : 0];
    }));
    real[date] = { vta: total.toFixed(2), txs: String(orders.get(date)?.size ?? 0) };
    const hourlyTxs = new Map<string, Map<string, number>>(
      [...byHour.keys()].map((hour) => [hour, new Map<string, number>()]),
    );
    orderAssignments.get(date)?.forEach(({ hour, channel }) => {
      const byChannel = hourlyTxs.get(hour) ?? new Map<string, number>();
      byChannel.set(channel, (byChannel.get(channel) ?? 0) + 1);
      hourlyTxs.set(hour, byChannel);
    });
    const hourKey = (hour: string) => String(Number(hour.slice(0, 2)));
    history.push({
      date,
      totalSales: total,
      totalTxs: orders.get(date)?.size ?? 0,
      hourlyData: Object.fromEntries([...byHour.entries()].map(([hour, channels]) => [hourKey(hour), Object.fromEntries(channels)])),
      hourlyTxs: Object.fromEntries([...hourlyTxs.entries()].map(([hour, channels]) => [hourKey(hour), Object.fromEntries(channels)])),
    });
  });
  history.sort((a, b) => a.date.localeCompare(b.date));
  return { hourly, real, history, rows: parsedRows };
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
