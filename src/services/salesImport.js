import * as XLSX from 'xlsx';
import { SUGGESTIVE_PRODUCTS, classifySuggestiveProduct } from './suggestiveSalesGoals.js';
import { normalizeReportChannel } from './suggestiveChannels.js';
import { exactReportProductName } from './productMatching.js';

export const SALES_BUSINESS_DATE_VERSION = 1;
export const SALES_DAY_BASIS = 'business-06:00';

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const fieldName = value => normalize(value).replace(/[^a-z0-9]/g, '');
const rowDateHasTime = Symbol('salesDateHasTime');
const aliases = {
    date: ['fechapedido', 'fecha pedido', 'fecha', 'fecha/hora', 'fecha hora', 'fecha de pedido', 'fec.', 'date'],
    time: ['hora pedido', 'horapedido', 'hora', 'time', 'hr'],
    order: ['nro. pedido', 'nro pedido', 'numeropedido', 'pedido', 'ticket', 'comprobante', 'documento'],
    document: ['documento', 'comprobante', 'nro comprobante', 'numero documento', 'nro documento'],
    status: ['estadopedido', 'estado pedido', 'estado', 'status', 'condicion', 'situacion'],
    itemStatus: ['estadoitem', 'estado item'],
    channel: ['canal venta', 'canal vta', 'canal', 'canal de venta', 'tipo pedido', 'origen', 'modalidad'],
    amount: ['total', 'monto', 'venta', 'ventas', 'importe', 'importe total', 'total neto', 'neto'],
    product: ['producto', 'descripcion producto', 'articulo', 'item descripcion'],
    quantity: ['cant', 'cantidad', 'qty', 'unidades'],
    item: ['itm', 'item', 'item nro', 'linea'],
};

const normalizedAliases = new WeakMap();
const readField = (row, names, cache) => {
    let fields = cache?.get(row);
    if (!fields) {
        fields = new Map();
        for (const [key, value] of Object.entries(row)) {
            const normalized = fieldName(key);
            if (value !== '' && value !== null && value !== undefined && !fields.has(normalized)) fields.set(normalized, { key, value });
        }
        cache?.set(row, fields);
    }
    if (!normalizedAliases.has(names)) normalizedAliases.set(names, names.map(fieldName));
    for (const name of normalizedAliases.get(names)) {
        if (fields.has(name)) return fields.get(name);
    }
    return { key: null, value: null };
};

export const parseSalesNumber = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined || value === '' || value instanceof Date) return null;
    let text = String(value).trim();
    if (/\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) return null;
    text = text.replace(/S\s*\/?\.?|PEN|SOLES/gi, '').replace(/\s/g, '');
    if (!/^[\d.,()+-]+$/.test(text)) return null;
    const negative = text.includes('-') || /^\(.*\)$/.test(text);
    text = text.replace(/[()+-]/g, '');
    const comma = text.lastIndexOf(',');
    const dot = text.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
        text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    } else if (comma >= 0) {
        text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
    } else if ((text.match(/\./g) || []).length > 1) {
        text = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text;
    }
    const number = Number(text);
    return Number.isFinite(number) ? (negative ? -number : number) : null;
};

const dateString = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const offsetDate = (value, days) => {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};
const validDateParts = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
};

const parseExcelSerial = (value, date1904) => {
    if (!Number.isFinite(value) || value < 0 || (!date1904 && Math.floor(value) === 60)) return null;
    const wholeDays = Math.floor(value);
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const correctedDays = wholeDays - (!date1904 && wholeDays > 60 ? 1 : 0);
    const seconds = Math.round((value - wholeDays) * 86400);
    const date = new Date(epoch + correctedDays * 86400000 + seconds * 1000);
    if (!Number.isFinite(date.getTime())) return null;
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), H: date.getUTCHours(), M: date.getUTCMinutes() };
};

const parseClock = value => {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) return { hour: value.getHours(), minute: value.getMinutes() };
    if (typeof value === 'number') {
        if (value < 0) return null;
        if (Number.isInteger(value) && value > 0 && value < 24) return { hour: value, minute: 0 };
        const minutes = Math.round((value % 1) * 1440) % 1440;
        return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
    }
    const match = String(value).match(/(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([ap])\.?\s*m\.?|(?:^|[T\s])(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?/i);
    if (!match) return null;
    let hour = Number(match[1] ?? match[4]);
    const minute = Number(match[2] ?? match[5]);
    if (match[3]) {
        if (hour < 1 || hour > 12) return null;
        hour = hour % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0);
    }
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? { hour, minute } : null;
};

export const parseSalesDateTime = (value, timeValue = null, { cutoffHour = 6, date1904 = false, hasTime } = {}) => {
    let year, month, day, clock = null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        year = value.getFullYear(); month = value.getMonth() + 1; day = value.getDate();
        if (hasTime !== false) clock = { hour: value.getHours(), minute: value.getMinutes() };
    } else if (typeof value === 'number') {
        const parts = parseExcelSerial(value, date1904);
        if (!parts) return null;
        year = parts.y; month = parts.m; day = parts.d;
        if (hasTime === true || value % 1 !== 0) clock = { hour: parts.H, minute: parts.M };
    } else {
        const text = String(value ?? '').trim();
        const match = text.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})/);
        if (!match) return null;
        if (match[1].length === 4) [year, month, day] = match.slice(1).map(Number);
        else [day, month, year] = match.slice(1).map(Number);
        if (year < 100) year += 2000;
        clock = parseClock(text);
    }
    if (!validDateParts(year, month, day)) return null;
    clock = parseClock(timeValue) || clock;
    const calendarDate = dateString(year, month, day);
    const hour = clock?.hour ?? 0;
    return {
        calendarDate,
        businessDate: clock && hour < cutoffHour ? offsetDate(calendarDate, -1) : calendarDate,
        hour, minute: clock?.minute ?? 0, hasTime: Boolean(clock),
    };
};

export const normalizeSalesChannel = value => {
    const channel = normalize(value);
    if (/delivery|rappi|pedidos\s*ya|didi|uber|call center/.test(channel)) return 'DELIVERY';
    if (!channel.trim() || /^(?:mesa)(?:\s+\d+)?$/.test(channel)) return 'SALÓN';
    return normalizeReportChannel(value);
};

// Read every matching sheet; formatted date cells retain whether they contain
// an explicit clock, so a date-only Excel serial is not shifted at midnight.
export const rowsFromSalesWorkbook = workbook => {
    const output = [];
    const fieldsCache = new WeakMap();
    for (const sheetName of workbook.SheetNames || []) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        let headerIndex = -1, bestScore = 0;
        for (let index = 0; index < Math.min(rows.length, 30); index++) {
            const names = rows[index].map(fieldName);
            const score = ['date', 'order', 'amount', 'document', 'channel'].reduce((sum, field) =>
                sum + Number(aliases[field].some(name => names.includes(fieldName(name)))), 0);
            if (score > bestScore && score >= 2) { bestScore = score; headerIndex = index; }
        }
        if (headerIndex < 0) continue;
        const usedNames = new Map();
        const headers = rows[headerIndex].map((value, index) => {
            const name = String(value || `__EMPTY_${index}`).trim();
            const duplicate = usedNames.get(name) || 0;
            usedNames.set(name, duplicate + 1);
            return duplicate ? `${name}_${duplicate}` : name;
        });
        const origin = XLSX.utils.decode_range(sheet['!ref'] || 'A1').s;
        for (let index = headerIndex + 1; index < rows.length; index++) {
            if (!rows[index].some(value => value !== '' && value !== null && value !== undefined)) continue;
            const row = Object.fromEntries(headers.map((header, column) => [header, rows[index][column] ?? '']));
            const read = names => readField(row, names, fieldsCache);
            const dateField = read(aliases.date);
            const summary = Object.values(row).some(value => typeof value === 'string' && /^\s*total\s*(?:de[l]?\s*)?pedido(?:\s*:|\s*$)/i.test(value));
            // Inforest repeats titles, headers and page counters between orders.
            // Retain detail/summary rows and order headers, never page decoration.
            const hasDate = parseSalesDateTime(dateField.value, read(aliases.time).value) !== null;
            const hasDetail = parseSalesNumber(read(aliases.amount).value) !== null
                || (read(aliases.product).value !== null && parseSalesNumber(read(aliases.quantity).value) !== null);
            if (!summary && !hasDate && !hasDetail) continue;
            if (dateField.key) {
                const column = headers.indexOf(dateField.key);
                const cell = sheet[XLSX.utils.encode_cell({ r: origin.r + index, c: origin.c + column })];
                const formatted = `${cell?.z || ''} ${cell?.w || ''}`;
                if (formatted.trim()) row[rowDateHasTime] = /[hH].*[mM]|\d{1,2}:\d{2}/.test(formatted);
            }
            output.push(row);
        }
    }
    return output;
};

const invalidOrder = status => /anulad|cancelad|void|nulo|inactiv|pendiente|abierto|no cobrado|eliminad/.test(normalize(status));
// A facturado order can still have an item marked En Proceso in Inforest.
// Preserve that invoice; only cancelled/removed item lines are excluded.
const invalidItem = status => /anulad|cancelad|void|eliminad/.test(normalize(status));
const creditDocument = document => /^(NC|BC|FC|FN)/i.test(String(document));
const emptyDay = () => ({
    totalSales: 0, totalTxs: 0, hourlyData: {}, hourlyTxs: {},
    suggestiveProducts: Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, {}])),
    productSales: [], productSalesRecorded: true, productRevenueRecorded: true,
    businessDateVersion: SALES_BUSINESS_DATE_VERSION, salesDayBasis: SALES_DAY_BASIS,
});
const increment = (hours, hour, channel, amount) => {
    hours[hour] ||= {};
    hours[hour][channel] = (hours[hour][channel] || 0) + amount;
};

export const importSalesRows = (rows, options = {}) => {
    const diagnostics = { inputRows: rows.length, skippedRows: 0, invalidDates: 0, missingDocuments: 0, excludedStatuses: 0, importedOrders: 0 };
    const orders = new Map();
    const fieldsCache = new WeakMap();
    let currentOrder = null;
    const hasDocumentColumn = options.requireDocument ?? rows.some(row => Object.keys(row || {}).some(key => aliases.document.some(name => fieldName(name) === fieldName(key))));
    rows.forEach((row, rowIndex) => {
        if (!row || typeof row !== 'object') return;
        const read = names => readField(row, names, fieldsCache);
        const labels = Object.values(row).filter(value => typeof value === 'string').map(normalize);
        const summary = labels.some(value => /^\s*total\s*(?:de[l]?\s*)?pedido(?:\s*:|\s*$)/.test(value));
        if (labels.some(value => /^\s*(total general|resumen|total periodo)\s*:?\s*$/.test(value))) return;
        if (summary) {
            if (currentOrder) {
                let amount = parseSalesNumber(read(aliases.amount).value);
                if (amount === null) {
                    const candidates = Object.entries(row).filter(([key]) => ![...aliases.date, ...aliases.time, ...aliases.order].some(name => fieldName(name) === fieldName(key)))
                        .map(([, value]) => parseSalesNumber(value)).filter(value => value !== null);
                    amount = candidates.at(-1) ?? null;
                }
                if (amount !== null) currentOrder.total = amount;
            }
            return;
        }
        const orderValue = read(aliases.order).value;
        const dateField = read(aliases.date);
        const time = parseSalesDateTime(dateField.value, read(aliases.time).value, { ...options, hasTime: row[rowDateHasTime] });
        const rawDocument = read(aliases.document).value;
        const document = rawDocument !== null && !['0', 'undefined', 'null', '-'].includes(normalize(rawDocument).trim())
            ? String(rawDocument).trim().toUpperCase() : '';
        const status = read(aliases.status).value;
        if (invalidOrder(status)) { currentOrder = null; diagnostics.excludedStatuses++; return; }
        if (orderValue !== null) {
            const baseKey = `${time?.calendarDate || currentOrder?.time?.calendarDate || ''}|${String(orderValue).trim()}`;
            const baseOrder = orders.get(baseKey);
            const key = !document && currentOrder?.baseKey === baseKey ? currentOrder.key
                : document && baseOrder?.document && baseOrder.document !== document ? `${baseKey}|${document}` : baseKey;
            if (!orders.has(key)) {
                orders.set(key, { key, baseKey, time, document: '', channel: normalizeSalesChannel(read(aliases.channel).value), amount: 0, total: null, products: new Map(), exactProducts: new Map(), productSalesRecorded: true, productRevenueRecorded: true, seenItems: new Set(), hasAmount: false });
            }
            currentOrder = orders.get(key);
        } else if (dateField.value !== null) {
            // A flat report without order IDs can still provide one receipt per row.
            const key = `row:${rowIndex}`;
            currentOrder = { key, time, document: '', channel: normalizeSalesChannel(read(aliases.channel).value), amount: 0, total: null, products: new Map(), exactProducts: new Map(), productSalesRecorded: true, productRevenueRecorded: true, seenItems: new Set(), hasAmount: false };
            orders.set(key, currentOrder);
        }
        if (!currentOrder) { diagnostics.skippedRows++; return; }
        if (invalidItem(read(aliases.itemStatus).value)) { diagnostics.excludedStatuses++; return; }
        if (document) currentOrder.document ||= document;
        currentOrder.time ||= time;
        const amount = parseSalesNumber(read(aliases.amount).value);
        const product = read(aliases.product).value;
        const quantity = parseSalesNumber(read(aliases.quantity).value);
        const item = read(aliases.item).value;
        if (amount === null && product === null && quantity === null && item === null) return;
        // Repeated detail lines in duplicate sheets do not duplicate sales/SKUs.
        const itemKey = item === null ? null : `${item}|${product || ''}|${amount}|${quantity}`;
        if (itemKey && currentOrder.seenItems.has(itemKey)) return;
        if (itemKey) currentOrder.seenItems.add(itemKey);
        if (amount !== null) { currentOrder.amount += amount; currentOrder.hasAmount = true; }
        const productId = classifySuggestiveProduct(product);
        if (productId && quantity > 0) currentOrder.products.set(productId, (currentOrder.products.get(productId) || 0) + quantity);
        const reportName = exactReportProductName(product);
        if (reportName && quantity !== null && quantity >= 0) {
            const existing = currentOrder.exactProducts.get(reportName) || { quantity: 0, revenue: 0 };
            existing.quantity += quantity;
            existing.revenue = existing.revenue === null || amount === null ? null : existing.revenue + amount;
            currentOrder.exactProducts.set(reportName, existing);
        } else currentOrder.productSalesRecorded = false;
        if (!reportName || quantity === null || quantity < 0 || amount === null) currentOrder.productRevenueRecorded = false;
    });

    const days = new Map();
    const dayTransactions = new Map();
    for (const order of orders.values()) {
        if (!order.time) { diagnostics.invalidDates++; continue; }
        if (!order.hasAmount && order.total === null) continue;
        if (hasDocumentColumn && !order.document && order.channel !== 'SERV. FILA') { diagnostics.missingDocuments++; continue; }
        const { businessDate, hour } = order.time;
        if (!days.has(businessDate)) { days.set(businessDate, emptyDay()); dayTransactions.set(businessDate, new Set()); }
        const day = days.get(businessDate);
        const credit = creditDocument(order.document);
        const amount = credit ? -Math.abs(order.total ?? order.amount) : (order.total ?? order.amount);
        day.totalSales += amount;
        increment(day.hourlyData, hour, order.channel, amount);
        day.hourlyTxs[hour] ||= {};
        day.hourlyTxs[hour][order.channel] ||= 0;
        const transaction = order.document || order.key;
        if (!dayTransactions.get(businessDate).has(transaction)) {
            dayTransactions.get(businessDate).add(transaction);
            day.totalTxs++;
            increment(day.hourlyTxs, hour, order.channel, 1);
        }
        if (!credit) for (const [productId, quantity] of order.products) increment(day.suggestiveProducts[productId], hour, order.channel, quantity);
        day.productSalesRecorded &&= order.productSalesRecorded;
        const reconciled = Math.abs(Math.round(order.amount * 100) - Math.round((order.total ?? order.amount) * 100)) === 0;
        day.productRevenueRecorded &&= order.productRevenueRecorded && order.productSalesRecorded && reconciled && !credit;
        if (!credit) for (const [name, product] of order.exactProducts) {
            const existing = day.productSales.find(product => product.name === name && product.hour === hour && product.channel === order.channel);
            if (existing) {
                existing.quantity += product.quantity;
                existing.revenue = existing.revenue === null || product.revenue === null ? null : existing.revenue + product.revenue;
            } else day.productSales.push({ name, hour, channel: order.channel, quantity: product.quantity, revenue: product.revenue });
        }
        diagnostics.importedOrders++;
    }
    for (const day of days.values()) for (const product of day.productSales) {
        if (product.revenue !== null && product.revenue < 0) {
            // Reports contain tiny floating-point negatives and signed discounts.
            // Net them within the exact product/hour/channel. An actual negative
            // remainder cannot be presented as a verified non-negative sale.
            if (Math.round(product.revenue * 100) === 0) product.revenue = 0;
            else { product.revenue = null; day.productRevenueRecorded = false; }
        }
    }
    return { days: new Map([...days].sort(([left], [right]) => left.localeCompare(right))), diagnostics };
};

export const parseSalesRows = importSalesRows;

export const parseSalesWorkbook = (workbook, options = {}) => {
    const result = importSalesRows(rowsFromSalesWorkbook(workbook), {
        date1904: Boolean(workbook.Workbook?.WBProps?.date1904), ...options,
    });
    return { ...result, stats: result.diagnostics };
};

const decodeSalesText = bytes => {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder('windows-1252').decode(bytes); }
};

export const detectSalesFileFormat = bytes => {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
    if ((bytes[0] === 0xd0 && bytes[1] === 0xcf) || (bytes[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(bytes[1]))) return 'xls';
    return /<(?:!doctype\s+html|html|table)\b/i.test(decodeSalesText(bytes.subarray(0, 4096))) ? 'html' : 'csv';
};

/** Shared browser entry point: inspect the contents, not the filename extension.
 * Text reports may contain several HTML tables/pages under an .xls filename.
 */
export const parseSalesFile = async (file, options = {}) => {
    const data = typeof file?.arrayBuffer === 'function' ? await file.arrayBuffer() : file;
    const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null;
    if (!bytes || !bytes.length) throw new Error('El archivo de ventas está vacío o no se pudo leer.');
    const fileFormat = detectSalesFileFormat(bytes);
    let result;
    if (fileFormat === 'html') {
        const text = decodeSalesText(bytes);
        const tables = text.match(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi) || [text];
        const rows = tables.flatMap(table => rowsFromSalesWorkbook(XLSX.read(table, { type: 'string', raw: true, cellDates: false })));
        result = importSalesRows(rows, options);
    } else {
        const workbook = XLSX.read(fileFormat === 'csv' ? decodeSalesText(bytes) : bytes, {
            type: fileFormat === 'csv' ? 'string' : 'array', raw: true, cellDates: false, cellNF: true,
        });
        result = parseSalesWorkbook(workbook, options);
    }
    result.diagnostics.fileFormat = fileFormat;
    return { ...result, fileFormat, stats: result.diagnostics };
};

const historyEntries = records => records instanceof Map ? [...records] : Array.isArray(records)
    ? records.map(record => [record.date || record.sales_date, record]) : Object.entries(records || {});
const sumHours = hours => Object.values(hours || {}).reduce((sum, channels) => sum + Object.values(channels || {}).reduce((part, value) => part + (Number(value) || 0), 0), 0);
const copyHours = hours => Object.fromEntries(Object.entries(hours || {}).map(([hour, channels]) => [hour, { ...channels }]));
const isEarly = (hour, cutoffHour) => Number.parseInt(hour, 10) >= 0 && Number.parseInt(hour, 10) < cutoffHour;
const mergeHours = (target, source) => {
    for (const [hour, channels] of Object.entries(source)) for (const [channel, value] of Object.entries(channels || {})) increment(target, hour, channel, Number(value) || 0);
};

/** Unknown legacy records are preserved: old importers also used business dates.
 * Only an explicit calendar basis (or an audited opt-in) authorizes shifting.
 * This function is pure and its returned business markers make it idempotent.
 */
export const normalizeSalesBusinessDates = (records, { cutoffHour = 6, legacyDateMode = 'preserve' } = {}) => {
    const output = new Map();
    const transfers = [];
    for (const [date, source] of historyEntries(records)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) continue;
        const day = { ...source, hourlyData: copyHours(source.hourlyData), hourlyTxs: copyHours(source.hourlyTxs), suggestiveProducts: Object.fromEntries(Object.entries(source.suggestiveProducts || {}).map(([product, hours]) => [product, copyHours(hours)])),
            ...(Array.isArray(source.productSales) ? { productSales: source.productSales.map(product => ({ ...product })) } : {}) };
        const marked = Number(source.businessDateVersion) >= SALES_BUSINESS_DATE_VERSION || source.salesDayBasis === SALES_DAY_BASIS;
        const calendar = source.salesDayBasis === 'calendar' || (!marked && legacyDateMode === 'calendar');
        if (marked || !calendar) { output.set(date, day); continue; }
        const splitHours = hours => [
            Object.fromEntries(Object.entries(hours).filter(([hour]) => !isEarly(hour, cutoffHour))),
            Object.fromEntries(Object.entries(hours).filter(([hour]) => isEarly(hour, cutoffHour))),
        ];
        const [lateSales, earlySales] = splitHours(day.hourlyData);
        const [lateTxs, earlyTxs] = splitHours(day.hourlyTxs);
        const earlyProducts = {};
        const earlyReportedProducts = (day.productSales || []).filter(product => isEarly(product.hour, cutoffHour));
        if (day.productSales) day.productSales = day.productSales.filter(product => !isEarly(product.hour, cutoffHour));
        for (const [product, hours] of Object.entries(day.suggestiveProducts)) {
            const [late, early] = splitHours(hours);
            day.suggestiveProducts[product] = late;
            earlyProducts[product] = early;
        }
        const movedSales = sumHours(earlySales), movedTxs = sumHours(earlyTxs);
        day.totalSales = (Number(source.totalSales) || 0) - movedSales;
        day.totalTxs = (Number(source.totalTxs) || 0) - movedTxs;
        day.hourlyData = lateSales; day.hourlyTxs = lateTxs;
        day.businessDateVersion = SALES_BUSINESS_DATE_VERSION; day.salesDayBasis = SALES_DAY_BASIS;
        const hadEarly = Object.keys(earlySales).length || Object.keys(earlyTxs).length;
        if (!hadEarly || Object.keys(lateSales).length || Object.keys(lateTxs).length || day.totalSales || day.totalTxs) output.set(date, day);
        if (hadEarly) transfers.push({ date: offsetDate(date, -1), totalSales: movedSales, totalTxs: movedTxs, hourlyData: earlySales, hourlyTxs: earlyTxs, suggestiveProducts: earlyProducts,
            productSales: earlyReportedProducts, productSalesRecorded: day.productSalesRecorded === true,
            productRevenueRecorded: day.productRevenueRecorded === true });
    }
    for (const transfer of transfers) {
        const day = output.get(transfer.date) || emptyDay();
        day.totalSales = (Number(day.totalSales) || 0) + transfer.totalSales;
        day.totalTxs = (Number(day.totalTxs) || 0) + transfer.totalTxs;
        mergeHours(day.hourlyData, transfer.hourlyData); mergeHours(day.hourlyTxs, transfer.hourlyTxs);
        day.productSales = [...(day.productSales || []), ...transfer.productSales];
        day.productSalesRecorded = day.productSalesRecorded === true && transfer.productSalesRecorded;
        day.productRevenueRecorded = day.productRevenueRecorded === true && transfer.productRevenueRecorded;
        for (const [product, hours] of Object.entries(transfer.suggestiveProducts)) {
            day.suggestiveProducts[product] ||= {};
            mergeHours(day.suggestiveProducts[product], hours);
        }
        // Mark receiving days too; returned results must never shift a second time.
        day.businessDateVersion = SALES_BUSINESS_DATE_VERSION; day.salesDayBasis = SALES_DAY_BASIS;
        output.set(transfer.date, day);
    }
    return new Map([...output].sort(([left], [right]) => left.localeCompare(right)));
};
