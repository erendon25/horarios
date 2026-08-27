const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const EMPTY_DOCUMENT_MARKERS = new Set([
  "-",
  "--",
  ".",
  "N/A",
  "NA",
  "NO APLICA",
  "NO DEFINIDO",
  "NULL",
  "S/N",
  "SIN DOC",
  "SIN DOC.",
  "SIN COMPROBANTE",
  "SIN DOCUMENTO",
  "UNDEFINED",
  "VACIO",
  "VACÍO",
]);

const DOCUMENT_HEADERS = new Set([
  "comprobante",
  "documento",
  "n comprobante",
  "nro comprobante",
  "nro documento",
  "numero comprobante",
  "numero documento",
]);

const normalizeColumnName = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export function normalizeTransactionDocument(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const zeroLike = normalized.replace(/[.,\s]/g, "");
  if (!normalized || /^0+$/.test(zeroLike) || EMPTY_DOCUMENT_MARKERS.has(normalized)) return "";
  return normalized;
}

export function isCreditNoteTransaction(documentValue, rowText = "") {
  const document = normalizeTransactionDocument(documentValue);
  const text = String(rowText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /^(NC|BC|FC|FN)/.test(document)
    || text.includes("nota de credito")
    || text.includes("devolucion");
}

export function hasSalesDocumentColumn(rows) {
  return Array.isArray(rows) && rows.some((row) => row && typeof row === "object" && !Array.isArray(row)
    && Object.keys(row).some((key) => DOCUMENT_HEADERS.has(normalizeColumnName(key))));
}

export function allowsOrderTransactionFallback(hasDocumentColumn, channel) {
  return !hasDocumentColumn || String(channel ?? "").trim().toUpperCase() === "SERV. FILA";
}

export function hasExplicitSalesAmount(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value).trim() !== "";
}

export function parseExplicitSalesAmount(value) {
  if (!hasExplicitSalesAmount(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{2}\/\d{2}\/\d{4}/.test(text)) return null;
  if (/\d{2}:\d{2}:\d{2}/.test(text) || /^\d{2}:\d{2}$/.test(text)) return null;

  const accountingNegative = text.includes("(") && text.includes(")");
  text = text.replace(/[^\d.,-]/g, "");
  if (!text) return null;
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
  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;
  return accountingNegative ? -Math.abs(amount) : amount;
}

export function salesBlockAmountEntries(block, fallbackParsedDate) {
  if (block?.totalPedido !== null && block?.totalPedido !== undefined && Number.isFinite(block.totalPedido)) {
    return [{ amount: block.totalPedido, parsedDate: fallbackParsedDate, channel: block.canalRaw }];
  }
  return Array.isArray(block?.items)
    ? block.items
      .filter((item) => Number.isFinite(item?.amount))
      .map((item) => ({
        amount: item.amount,
        parsedDate: item.parsedDate ?? fallbackParsedDate,
        channel: item.canalRaw || block.canalRaw,
      }))
    : [];
}

const timeParts = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [value.getHours(), value.getMinutes(), value.getSeconds()];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 0 && value <= 23) return [value, 0, 0];
    const totalSeconds = Math.round((((value % 1) + 1) % 1) * 86400) % 86400;
    return [
      Math.floor(totalSeconds / 3600),
      Math.floor((totalSeconds % 3600) / 60),
      totalSeconds % 60,
    ];
  }
  const match = String(value ?? "").trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const modifier = String(match[4] ?? "").toLowerCase();
  if (modifier.includes("p") && hour < 12) hour += 12;
  if (modifier.includes("a") && hour === 12) hour = 0;
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return [hour, minute, second];
};

export function parseSalesTimestamp(dateValue, hourValue) {
  let year;
  let month;
  let day;
  let embeddedTime = null;

  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    year = dateValue.getFullYear();
    month = dateValue.getMonth() + 1;
    day = dateValue.getDate();
    embeddedTime = [dateValue.getHours(), dateValue.getMinutes(), dateValue.getSeconds()];
  } else if (typeof dateValue === "number" && Number.isFinite(dateValue) && dateValue >= 60) {
    // Excel's modern 1900 date system is day-based from 1899-12-30. Read
    // the calendar through UTC, then construct the final Date in local time
    // so a Lima browser cannot shift an ISO business day backwards.
    const wholeDays = Math.floor(dateValue);
    const excelDate = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86_400_000);
    year = excelDate.getUTCFullYear();
    month = excelDate.getUTCMonth() + 1;
    day = excelDate.getUTCDate();
    embeddedTime = timeParts(dateValue);
  } else {
    const text = String(dateValue ?? "").trim().replace(/\s+/g, " ");
    const iso = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](.*))?$/);
    const latin = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s+(.*))?$/);
    if (iso) {
      year = Number(iso[1]);
      month = Number(iso[2]);
      day = Number(iso[3]);
      embeddedTime = timeParts(iso[4]);
    } else if (latin) {
      year = Number(latin[3].length === 2 ? `20${latin[3]}` : latin[3]);
      month = Number(latin[2]);
      day = Number(latin[1]);
      embeddedTime = timeParts(latin[4]);
    } else {
      return null;
    }
  }

  const explicitTime = hourValue === null || hourValue === undefined || hourValue === ""
    ? null
    : timeParts(hourValue);
  const [hour, minute, second] = explicitTime ?? embeddedTime ?? [0, 0, 0];
  const timestamp = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(timestamp.getTime())
    || timestamp.getFullYear() !== year
    || timestamp.getMonth() !== month - 1
    || timestamp.getDate() !== day) return null;

  const business = new Date(timestamp);
  if (hour < 6) business.setDate(business.getDate() - 1);
  return {
    timestamp,
    hour,
    businessDate: `${business.getFullYear()}-${String(business.getMonth() + 1).padStart(2, "0")}-${String(business.getDate()).padStart(2, "0")}`,
  };
}

export function salesTransactionScopeKey(transactionId, dateValue, hourValue, fallbackBusinessDate = "") {
  const normalizedId = normalizeTransactionDocument(transactionId);
  if (!normalizedId) return "";
  const businessDate = parseSalesTimestamp(dateValue, hourValue)?.businessDate || fallbackBusinessDate;
  return businessDate ? `${businessDate}\u0000${normalizedId}` : "";
}

export function assignCanonicalTransactionBucket(bucketMap, transactionId, candidate) {
  const key = String(transactionId ?? "").trim();
  if (!(bucketMap instanceof Map) || !key || !candidate) return;
  const normalized = {
    hour: Number(candidate.hour),
    channel: String(candidate.channel || "SIN CLASIFICAR"),
    timestamp: Number(candidate.timestamp),
  };
  if (!Number.isInteger(normalized.hour) || normalized.hour < 0 || normalized.hour > 23) return;
  if (!Number.isFinite(normalized.timestamp)) normalized.timestamp = Number.MAX_SAFE_INTEGER;
  const current = bucketMap.get(key);
  if (!current
    || normalized.timestamp < current.timestamp
    || (normalized.timestamp === current.timestamp
      && `${normalized.hour}:${normalized.channel}` < `${current.hour}:${current.channel}`)) {
    bucketMap.set(key, normalized);
  }
}

export function buildCanonicalHourlyTransactions(hourlyData, transactionBuckets) {
  const result = Object.fromEntries(Object.keys(object(hourlyData)).map((hour) => [hour, {}]));
  const buckets = transactionBuckets instanceof Map ? transactionBuckets.values() : [];
  for (const bucket of buckets) {
    const hour = String(bucket.hour);
    const channel = String(bucket.channel || "SIN CLASIFICAR");
    if (!result[hour]) result[hour] = {};
    result[hour][channel] = (result[hour][channel] || 0) + 1;
  }
  return result;
}

const SALES_CHANNEL_KEYS = ["canal venta", "canal vta", "canal", "canal de venta", "tipo pedido", "origen", "modalidad"];
const SALES_AMOUNT_KEYS = ["total", "monto", "venta", "ventas", "importe", "neto"];

const findSalesValue = (row, possibleKeys) => {
  const keys = Object.keys(object(row));
  for (const possibleKey of possibleKeys) {
    const exact = keys.find((key) => key.trim().toLowerCase() === possibleKey);
    if (exact) return row[exact];
  }
  for (const possibleKey of possibleKeys) {
    const normalized = possibleKey.replace(/[^a-z]/g, "");
    const semiExact = keys.find((key) => key.toLowerCase().replace(/[^a-z]/g, "") === normalized);
    if (semiExact) return row[semiExact];
  }
  for (const possibleKey of possibleKeys) {
    const match = keys.find((key) => {
      const clean = key.trim().toLowerCase();
      if (["total", "monto", "importe"].includes(possibleKey)
        && ["sub", "dscto", "descuento", "igv", "impuesto", "propina", "recargo"].some((marker) => clean.includes(marker))) return false;
      if (["pedido", "comprobante", "ticket"].includes(possibleKey)
        && ["tipo", "estado", "fecha", "hora"].some((marker) => clean.includes(marker))) return false;
      return clean.includes(possibleKey);
    });
    if (match) return row[match];
  }
  return undefined;
};

export function canonicalSalesChannel(value) {
  const channel = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (["DELIVERY", "RAPPI", "PEDIDOS YA", "PEDIDOSYA", "DIDI", "UBER", "CALL CENTER"].some((marker) => channel.includes(marker))) return "DELIVERY";
  if (channel.includes("DRIVE") || channel.includes("AUTO")) return "DRIVE THRU";
  if (channel.includes("FILA") || channel.includes("MODULO")) return "SERV. FILA";
  if (channel.includes("LOCAL") || channel.includes("SALON")) return "SALÓN";
  return "SIN CLASIFICAR";
}

const invalidSalesState = (value) => {
  const state = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return ["ANULAD", "CANCELAD", "VOID", "NULO", "INACTIV", "PENDIENTE", "ABIERTO", "NO COBRADO", "ELIMINAD"].some((marker) => state.includes(marker));
};

export function parseCanonicalSalesRows(data) {
  const rows = Array.isArray(data) ? data : [];
  const reportHasDocumentColumn = hasSalesDocumentColumn(rows);
  const blocks = new Map();
  const invalidBlockKeys = new Set();
  let currentBlockKey = "";
  let currentBusinessDate = "";
  let currentBlockIsValid = false;
  let parsedRows = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rowText = Object.values(row).join(" ");
    const normalizedRowText = rowText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (normalizedRowText.includes("total general") || normalizedRowText.includes("resumen") || normalizedRowText.includes("total periodo")) {
      currentBlockKey = "";
      currentBlockIsValid = false;
      continue;
    }

    const dateValue = findSalesValue(row, ["fecha", "fechapedido", "fecha pedido", "date", "fec.", "fecha/hora"]);
    const hourValue = findSalesValue(row, ["hora", "time", "horapedido", "hr", "hora pedido"]);
    const parsedDate = parseSalesTimestamp(dateValue, hourValue);
    const rawOrder = findSalesValue(row, ["nro. pedido", "nro pedido", "nro de pedido", "numero pedido", "numero de pedido", "pedido", "ticket", "correlativo"]);
    const orderId = normalizeTransactionDocument(rawOrder);
    const documentId = normalizeTransactionDocument(findSalesValue(row, ["documento", "comprobante"]));
    const currentBlock = currentBlockKey ? blocks.get(currentBlockKey) : null;
    const attachDocument = !orderId && documentId && currentBlock?.identitySource === "pedido" && !currentBlock.documento;
    const identity = orderId || (attachDocument ? "" : documentId);
    const totalRow = String(rawOrder ?? "").toLowerCase().includes("total ped") || normalizedRowText.includes("total pedido");

    if (!totalRow && identity) {
      currentBusinessDate = parsedDate?.businessDate || currentBusinessDate;
      currentBlockKey = salesTransactionScopeKey(identity, dateValue, hourValue, currentBusinessDate);
      if (!currentBlockKey) {
        currentBlockIsValid = false;
        continue;
      }
      currentBlockIsValid = !invalidBlockKeys.has(currentBlockKey);
      if (currentBlockIsValid && !blocks.has(currentBlockKey)) {
        blocks.set(currentBlockKey, {
          pedidoId: identity,
          identitySource: orderId ? "pedido" : "documento",
          fechaRaw: dateValue,
          horaRaw: hourValue,
          parsedDate,
          canalRaw: findSalesValue(row, SALES_CHANNEL_KEYS),
          documento: documentId,
          items: [],
          totalPedido: null,
          isNC: isCreditNoteTransaction(documentId, rowText),
        });
      }
    }

    const activeBlock = currentBlockKey ? blocks.get(currentBlockKey) : null;
    if (activeBlock && documentId && !activeBlock.documento) activeBlock.documento = documentId;
    if (activeBlock && isCreditNoteTransaction(documentId || activeBlock.documento, rowText)) activeBlock.isNC = true;
    if (invalidSalesState(findSalesValue(row, ["estadoitem", "estado item", "estado", "status", "estado pedido", "condicion", "situacion"]))) {
      if (currentBlockKey) {
        invalidBlockKeys.add(currentBlockKey);
        blocks.delete(currentBlockKey);
        currentBlockIsValid = false;
      }
      continue;
    }

    const rowChannel = findSalesValue(row, SALES_CHANNEL_KEYS);
    if (activeBlock && parsedDate && (!activeBlock.parsedDate || parsedDate.timestamp.getTime() < activeBlock.parsedDate.timestamp.getTime())) {
      activeBlock.fechaRaw = dateValue;
      activeBlock.horaRaw = hourValue;
      activeBlock.parsedDate = parsedDate;
      activeBlock.canalRaw = rowChannel;
    } else if (activeBlock && !activeBlock.canalRaw && rowChannel) {
      activeBlock.canalRaw = rowChannel;
    }

    if (totalRow) {
      if (activeBlock && currentBlockIsValid) {
        const total = parseExplicitSalesAmount(findSalesValue(row, SALES_AMOUNT_KEYS));
        if (total !== null) activeBlock.totalPedido = total;
      }
      continue;
    }
    if (!activeBlock || !currentBlockIsValid) continue;
    const amount = parseExplicitSalesAmount(findSalesValue(row, SALES_AMOUNT_KEYS));
    if (amount === null) continue;
    activeBlock.items.push({ amount, parsedDate, canalRaw: rowChannel });
    parsedRows += 1;
  }

  const days = {};
  for (const block of blocks.values()) {
    const parsedDate = block.parsedDate || parseSalesTimestamp(block.fechaRaw, block.horaRaw);
    if (!parsedDate) continue;
    const transactionChannel = canonicalSalesChannel(block.canalRaw);
    const documentId = normalizeTransactionDocument(block.documento);
    const hasDocument = Boolean(documentId);
    if (!hasDocument && !allowsOrderTransactionFallback(reportHasDocumentColumn, transactionChannel)) continue;
    const transactionId = hasDocument ? documentId : normalizeTransactionDocument(block.pedidoId);
    if (!transactionId) continue;
    const entries = salesBlockAmountEntries(block, parsedDate);
    if (entries.length === 0) continue;

    for (const entry of entries) {
      if (!entry.parsedDate) continue;
      const amount = block.isNC ? -Math.abs(entry.amount) : entry.amount;
      const date = entry.parsedDate.businessDate;
      const hour = String(entry.parsedDate.hour);
      const channel = canonicalSalesChannel(entry.channel);
      if (!days[date]) days[date] = { totalSales: 0, hourlyData: {}, transactionBuckets: new Map() };
      const day = days[date];
      day.totalSales += amount;
      if (!day.hourlyData[hour]) day.hourlyData[hour] = {};
      day.hourlyData[hour][channel] = (day.hourlyData[hour][channel] || 0) + amount;
    }

    const transactionDay = days[parsedDate.businessDate];
    if (!transactionDay) continue;
    assignCanonicalTransactionBucket(transactionDay.transactionBuckets, transactionId, {
      hour: parsedDate.hour,
      channel: transactionChannel,
      timestamp: parsedDate.timestamp.getTime(),
    });
  }

  const history = Object.entries(days).sort(([left], [right]) => left.localeCompare(right)).map(([date, day]) => ({
    date,
    totalSales: day.totalSales,
    totalTxs: day.transactionBuckets.size,
    hourlyData: day.hourlyData,
    hourlyTxs: buildCanonicalHourlyTransactions(day.hourlyData, day.transactionBuckets),
  }));
  const dailyHourlyParts = {};
  const realSalesData = {};
  for (const day of history) {
    dailyHourlyParts[day.date] = {};
    for (let offset = 0; offset < 24; offset += 1) {
      const hour = (offset + 6) % 24;
      const label = `${String(hour).padStart(2, "0")}:00`;
      const hourSales = Object.values(day.hourlyData[String(hour)] ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
      dailyHourlyParts[day.date][label] = day.totalSales > 0 ? ((hourSales / day.totalSales) * 100).toFixed(2) : "0.00";
    }
    realSalesData[day.date] = { vta: day.totalSales, txs: day.totalTxs };
  }
  return {
    history,
    dailyHourlyParts,
    realSalesData,
    parsedRows,
    dates: history.map((day) => day.date),
    totalSales: history.reduce((sum, day) => sum + day.totalSales, 0),
    totalTxs: history.reduce((sum, day) => sum + day.totalTxs, 0),
  };
}

export function mapSalesHistoryRow(row) {
  const canonicalTransactions = object(row?.hourly_transactions);
  return {
    ...(object(row?.legacy_data)),
    totalSales: row?.sales_amount ?? null,
    totalTxs: row?.transactions ?? null,
    hourlyData: object(row?.hourly_data),
    hourlyTxs: Object.keys(canonicalTransactions).length
      ? canonicalTransactions
      : object(object(row?.source_data).hourlyTxs),
    date: row?.sales_date,
    updatedAt: row?.updated_at,
  };
}

export function salesHistoryDayPayload(date, data = {}) {
  return {
    date,
    totalSales: Number(data.totalSales ?? 0),
    totalTxs: Number(data.totalTxs ?? 0),
    hourlyData: object(data.hourlyData),
    hourlyTxs: object(data.hourlyTxs),
  };
}

export function salesConfigurationRpcArgs(storeId, month, data = {}) {
  return {
    p_store_id: storeId,
    p_month_start: `${month}-01`,
    p_monthly_data: object(data.monthlyData),
    p_daily_hourly_parts: object(data.dailyHourlyParts),
    p_real_sales_data: {
      ...object(data.realSalesData),
      hourlyParticipation: data.hourlyParticipation ?? data.realSalesData?.hourlyParticipation ?? null,
    },
    p_days: Array.isArray(data.pendingHistory) ? data.pendingHistory : [],
  };
}
