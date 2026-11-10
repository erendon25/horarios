import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import {
    importSalesRows, parseSalesDateTime, parseSalesWorkbook, parseSalesNumber,
    normalizeSalesBusinessDates, SALES_DAY_BASIS, parseSalesFile,
} from './salesImport.js';

const row = (overrides = {}) => ({
    Pedido: 'p1', FechaPedido: '2026-10-12 10:00:00', Documento: 'B001-1',
    EstadoPedido: 'FACTURADO', EstadoItem: 'Pagado', CANAL: 'EN LOCAL',
    Item: '1', Producto: 'Pizza', Cantidad: 1, Total: 20,
    ...overrides,
});
const sumHours = hours => Object.values(hours).reduce((sum, channels) => sum + Object.values(channels).reduce((part, value) => part + value, 0), 0);

test('la jornada mantiene madrugada en horas 0 a 5 del día comercial anterior y conserva el siguiente día diurno', () => {
    const { days } = importSalesRows([
        row({ FechaPedido: '2026-10-12 23:30:00' }),
        row({ Pedido: 'p2', Documento: 'B001-2', FechaPedido: '2026-10-13 00:30:00', Total: 30 }),
        row({ Pedido: 'p3', Documento: 'B001-3', FechaPedido: '2026-10-13 05:59:00', Total: 40 }),
        row({ Pedido: 'p4', Documento: 'B001-4', FechaPedido: '2026-10-13 06:00:00', Total: 50 }),
    ]);
    assert.deepEqual([...days.keys()], ['2026-10-12', '2026-10-13']);
    assert.equal(days.get('2026-10-12').totalSales, 90);
    assert.equal(days.get('2026-10-12').totalTxs, 3);
    assert.deepEqual(Object.keys(days.get('2026-10-12').hourlyData), ['0', '5', '23']);
    assert.equal(days.get('2026-10-13').totalSales, 50);
    assert.equal(days.get('2026-10-12').salesDayBasis, SALES_DAY_BASIS);
});

test('fecha y hora Excel numéricas, reloj AM/PM y fechas sin reloj se interpretan sin confundir seriales', () => {
    const serial = 46308; // 2026-10-13 in Excel's 1900 date system.
    const parsed = XLSX.SSF.parse_date_code(serial);
    const calendar = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    assert.equal(parseSalesDateTime(serial).businessDate, calendar);
    assert.equal(parseSalesDateTime(serial, 1 / 24).hour, 1);
    assert.equal(parseSalesDateTime(serial, 0).hasTime, true);
    assert.equal(parseSalesDateTime('13/10/2026', '1:15 a.m.').businessDate, '2026-10-12');
    assert.equal(parseSalesDateTime('13/10/2026', '1:15 p.m.').hour, 13);
    assert.equal(parseSalesDateTime('13/10/2026').businessDate, '2026-10-13');
    assert.equal(parseSalesDateTime('31/02/2026 10:00:00'), null);
    assert.equal(parseSalesDateTime(new Date(2026, 9, 13, 1)).businessDate, '2026-10-12');
    assert.equal(parseSalesDateTime(1, 12 / 24, { date1904: true }).calendarDate, '1904-01-02');
});

test('transacciones se deduplican por comprobante incluso con pedidos distintos y conservan cortesías reales', () => {
    const { days } = importSalesRows([
        row({ Total: 20 }),
        row({ Pedido: 'p2', Item: '2', FechaPedido: '2026-10-12 11:00:00', Total: 10 }),
        row({ Pedido: 'p3', Documento: 'B001-3', Total: 0 }),
        row({ Pedido: 'p4', Documento: '', Total: 30 }),
        row({ Pedido: 'p5', Documento: '', CANAL: 'MÓDULO', Total: 40 }),
    ]);
    const day = days.get('2026-10-12');
    assert.equal(day.totalSales, 70);
    assert.equal(day.totalTxs, 3);
    assert.equal(sumHours(day.hourlyTxs), day.totalTxs);
    assert.equal(day.hourlyTxs[10]['SERV. FILA'], 1);
});

test('las cantidades sugestivas y montos sobreviven múltiples ítems, líneas repetidas, y resumen de pedido', () => {
    const detail = row({ Producto: 'VS Borde de queso', Cantidad: 2, Total: 6 });
    const { days } = importSalesRows([
        detail, { ...detail },
        row({ Item: '2', Producto: 'VS HAZLO CMB V3 CANELITAS', Cantidad: 3, Total: 0 }),
        { Pedido: 'Total Pedido :', Total: 15 },
        row({ Pedido: 'p2', Documento: 'B001-2', EstadoPedido: 'ANULADO', Total: 100 }),
        row({ Pedido: 'p3', Documento: 'B001-3', EstadoItem: 'Anulado', Total: 100 }),
        { Pedido: 'Total General', Total: 999 },
    ]);
    const day = days.get('2026-10-12');
    assert.equal(day.totalSales, 15);
    assert.equal(day.totalTxs, 1);
    assert.equal(day.suggestiveProducts.cheeseBorder[10]['SALÓN'], 2);
    assert.equal(day.suggestiveProducts.hazloCanelitasV3[10]['SALÓN'], 3);
});

test('facturado con ítem En Proceso mantiene venta y un canal nuevo conserva su nombre', () => {
    const { days } = importSalesRows([row({ EstadoItem: 'En Proceso', CANAL: 'Canal nuevo', Total: 32.9 })]);
    const day = days.get('2026-10-12');
    assert.equal(day.totalSales, 32.9);
    assert.equal(day.totalTxs, 1);
    assert.equal(day.hourlyData[10]['CANAL NUEVO'], 32.9);
    assert.equal(day.hourlyData[10]['SALÓN'], undefined);
});

test('un identificador de pedido reutilizado otro día no mezcla las ventas', () => {
    const { days } = importSalesRows([row(), row({ FechaPedido: '2026-10-13 10:00:00', Documento: 'B001-2', Total: 30 })]);
    assert.equal(days.get('2026-10-12').totalSales, 20);
    assert.equal(days.get('2026-10-13').totalSales, 30);
});

test('dos comprobantes del mismo pedido son dos transacciones y sus continuaciones no se mezclan', () => {
    const { days } = importSalesRows([
        row({ Documento: 'B001-1', Total: 20 }),
        row({ Documento: 'B001-2', Total: 30 }),
        row({ Documento: '', Item: '2', Total: 10 }),
    ]);
    const day = days.get('2026-10-12');
    assert.equal(day.totalSales, 60);
    assert.equal(day.totalTxs, 2);
    assert.equal(sumHours(day.hourlyTxs), 2);
});

test('el lector detecta cabeceras y procesa todas las hojas, preservando el formato fecha sin hora', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
        ['Reporte'],
        ['Fecha', 'Hora', 'Pedido', 'Documento', 'Total', 'CANAL'],
        [46308, 1 / 24, 'one', 'B1', 20, 'DRIVE THRU'],
    ]);
    sheet.A3.z = 'dd/mm/yyyy';
    XLSX.utils.book_append_sheet(workbook, sheet, 'A');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row({ Pedido: 'p2', Documento: 'B2' })]), 'B');
    const { days, stats } = parseSalesWorkbook(workbook);
    assert.equal(stats.inputRows, 2);
    assert.equal([...days.values()].reduce((sum, day) => sum + day.totalSales, 0), 40);
    assert.equal([...days.values()].reduce((sum, day) => sum + day.totalTxs, 0), 2);
});

test('los números monetarios no interpretan fechas, horas ni nombres como montos', () => {
    assert.equal(parseSalesNumber('S/ 1,500.50'), 1500.5);
    assert.equal(parseSalesNumber('1.500,50'), 1500.5);
    assert.equal(parseSalesNumber('12/10/2026'), null);
    assert.equal(parseSalesNumber('01:30:00'), null);
    assert.equal(parseSalesNumber('PEDIDO 123'), null);
    assert.equal(parseSalesNumber(0), 0);
});

test('el ingreso real por producto usa el importe de línea y conserva cantidades y cortesías de precio cero', () => {
    const { days } = importSalesRows([
        row({ Producto: 'Nombre EXACTO', Cantidad: 2, Total: 25 }),
        row({ Item: '2', Producto: 'Regalo', Cantidad: 1, Total: 0 }),
        row({ Pedido: 'p2', Documento: 'B001-2', Producto: 'Nombre EXACTO', Cantidad: 1, Total: 7.5 }),
    ]);
    const day = days.get('2026-10-12');
    assert.equal(day.productRevenueRecorded, true);
    assert.deepEqual(day.productSales, [
        { name: 'Nombre EXACTO', hour: 10, channel: 'SALÓN', quantity: 3, revenue: 32.5 },
        { name: 'Regalo', hour: 10, channel: 'SALÓN', quantity: 1, revenue: 0 },
    ]);
    assert.equal(day.productSales.reduce((sum, product) => sum + product.revenue, 0), day.totalSales);
});

test('no inventa importes de producto cuando faltan líneas o el total de pedido no concilia', () => {
    const partial = importSalesRows([row({ Producto: 'Detalle sin importe', Total: '' }), { Pedido: 'Total Pedido :', Total: 20 }]).days.get('2026-10-12');
    assert.equal(partial.productSalesRecorded, true);
    assert.equal(partial.productRevenueRecorded, false);
    assert.equal(partial.productSales[0].revenue, null);
    const mismatch = importSalesRows([row({ Total: 10 }), { Pedido: 'Total Pedido :', Total: 20 }]).days.get('2026-10-12');
    assert.equal(mismatch.totalSales, 20);
    assert.equal(mismatch.productRevenueRecorded, false);
    assert.equal(mismatch.productSales[0].revenue, 10);
});

test('los descuentos firmados se acumulan sólo en su producto, hora y canal; no generan ingresos supuestos', () => {
    const { days } = importSalesRows([
        row({ Producto: 'Combo', Total: 22.9 }),
        row({ Item: '2', Producto: 'Combo', Total: -5.9 }),
        row({ Item: '3', Producto: 'Cortesía', Total: -0.0000008 }),
    ]);
    const day = days.get('2026-10-12');
    assert.equal(day.productRevenueRecorded, true);
    assert.equal(day.productSales.find(product => product.name === 'Combo').revenue, 17);
    assert.equal(day.productSales.find(product => product.name === 'Cortesía').revenue, 0);
    const negative = importSalesRows([row({ Total: -5.9 })]).days.get('2026-10-12');
    assert.equal(negative.productRevenueRecorded, false);
    assert.equal(negative.productSales[0].revenue, null);
});

const fileLike = (bytes, name) => ({ name, arrayBuffer: async () => bytes });

test('detecta XLSX por contenido aunque la extensión cambie y no repite un ítem del mismo pedido', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row(), row(), row({ Item: '2', Total: 5 })]), 'Ventas');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const result = await parseSalesFile(fileLike(bytes, 'reporte.xls'));
    assert.equal(result.fileFormat, 'xlsx');
    assert.equal(result.days.get('2026-10-12').totalSales, 25);
    assert.equal(result.days.get('2026-10-12').totalTxs, 1);
    assert.equal(result.days.get('2026-10-12').productRevenueRecorded, true);
});

test('lee Inforest BIFF de varias hojas con páginas, resumen de pedido, cancelaciones y madrugada', async () => {
    const headers = ['Pedido', 'Fecha / Hora', 'Caja', 'Usuario', 'Estado', 'Itm', 'Producto', 'Cant', 'Monto', 'Documento', 'Canal Venta'];
    const detail = ['p1', '2026-10-13 00:30:00', '1', '', 'FACTURADO', '1', 'Producto Literal', 2, 10, 'B1', 'SERV. AUTO'];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['INFOREST', '', 'Correlativo Pedidos Detallado'], [], headers, detail, [],
        ['Página :', '', '', '', '', '', '', '', '', '', 1], headers,
        ['', '', '', '', '', '2', 'Producto Cero', 1, 0],
        ['', '', '', '', '', '', 'Total Pedido :', '', 10],
        ['cancelado', '2026-10-13 01:00:00', '1', '', 'ANULADO', '1', 'Producto cancelado', 1, 90, 'B2', 'SALÓN'],
        ['', '', '', '', '', '', 'Total Pedido :', '', 90],
    ]), 'Sheet1');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['INFOREST'], headers, detail, // A repeated page/order must not duplicate it.
        ['p2', '2026-10-13 09:00:00', '1', '', 'FACTURADO', '1', 'Otro producto', 1, 20, 'B3', 'DRIVE THRU'],
        ['', '', '', '', '', '', 'Total Pedido :', '', 20],
    ]), 'Sheet2');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' });
    const result = await parseSalesFile(fileLike(bytes, 'archivo.xls'));
    assert.equal(result.fileFormat, 'xls');
    assert.deepEqual([...result.days.keys()], ['2026-10-12', '2026-10-13']);
    assert.equal(result.days.get('2026-10-12').totalSales, 10);
    assert.equal(result.days.get('2026-10-12').totalTxs, 1);
    assert.equal(result.days.get('2026-10-12').hourlyData[0]['SERV. AUTO'], 10);
    assert.equal(result.days.get('2026-10-12').productRevenueRecorded, true);
    assert.equal(result.days.get('2026-10-13').totalSales, 20);
});

test('un XLS de HTML mantiene todas sus tablas y un CSV conserva nombres literales y fechas', async () => {
    const table = (order, date, product, amount) => `<table><tr><th>Pedido</th><th>FechaPedido</th><th>EstadoPedido</th><th>Documento</th><th>Producto</th><th>Cantidad</th><th>Total</th><th>CANAL</th></tr><tr><td>${order}</td><td>${date}</td><td>FACTURADO</td><td>${order}</td><td>${product}</td><td>2</td><td>${amount}</td><td>EN LOCAL</td></tr></table>`;
    const html = '<html><body>' + table('b1', '2026-10-12 23:30:00', 'Producto Á', 10) + table('b2', '2026-10-13 00:30:00', 'Producto á', 20) + '</body></html>';
    const result = await parseSalesFile(fileLike(new TextEncoder().encode(html), 'reporte.xls'));
    assert.equal(result.fileFormat, 'html');
    assert.equal(result.days.size, 1);
    assert.equal(result.days.get('2026-10-12').totalSales, 30);
    assert.deepEqual(result.days.get('2026-10-12').productSales.map(product => product.name), ['Producto Á', 'Producto á']);
    const csv = 'Pedido;FechaPedido;Documento;Producto;Cantidad;Total;CANAL\r\np1;2026-10-12 10:00:00;B1;Piñón exacto;2;12,50;SERV. FILA\r\n';
    const csvResult = await parseSalesFile(fileLike(Buffer.from(csv, 'latin1'), 'reporte.csv'));
    assert.equal(csvResult.fileFormat, 'csv');
    assert.equal(csvResult.days.get('2026-10-12').productSales[0].name, 'Piñón exacto');
    assert.equal(csvResult.days.get('2026-10-12').productSales[0].revenue, 12.5);
});

test('el historial desconocido se conserva y el normalizado no desplaza otra vez la madrugada', () => {
    const unknown = { totalSales: 20, totalTxs: 1, hourlyData: { 1: { 'SALÓN': 20 } }, hourlyTxs: { 1: { 'SALÓN': 1 } } };
    const preserved = normalizeSalesBusinessDates({ '2026-10-12': unknown });
    assert.deepEqual(preserved.get('2026-10-12').hourlyData, unknown.hourlyData);
    assert.equal(preserved.has('2026-10-11'), false);
    const normalized = importSalesRows([row({ FechaPedido: '2026-10-13 01:00:00' })]).days;
    assert.deepEqual(normalizeSalesBusinessDates(normalized), normalized);
    assert.deepEqual(normalizeSalesBusinessDates(normalized, { legacyDateMode: 'calendar' }), normalized);
});

test('la conversión explícita calendario mueve sólo 0 a 5 y es pura, acumulativa e idempotente', () => {
    const input = {
        '2026-10-12': { salesDayBasis: 'calendar', totalSales: 20, totalTxs: 1, hourlyData: { 22: { 'SALÓN': 20 } }, hourlyTxs: { 22: { 'SALÓN': 1 } }, suggestiveProducts: {} },
        '2026-10-13': { salesDayBasis: 'calendar', totalSales: 50, totalTxs: 2, hourlyData: { 1: { 'SALÓN': 30 }, 9: { DELIVERY: 20 } }, hourlyTxs: { 1: { 'SALÓN': 1 }, 9: { DELIVERY: 1 } }, suggestiveProducts: { cheeseBorder: { 1: { 'SALÓN': 2 } } } },
    };
    const saved = JSON.stringify(input);
    const result = normalizeSalesBusinessDates(input);
    assert.equal(result.get('2026-10-12').totalSales, 50);
    assert.equal(result.get('2026-10-12').totalTxs, 2);
    assert.equal(result.get('2026-10-13').totalSales, 20);
    assert.equal(result.get('2026-10-13').totalTxs, 1);
    assert.equal(result.get('2026-10-12').suggestiveProducts.cheeseBorder[1]['SALÓN'], 2);
    assert.deepEqual(normalizeSalesBusinessDates(result), result);
    assert.equal(JSON.stringify(input), saved);
});

test('el reporte tabular local opcional reconcilia días, comprobantes e importes sin guardar datos privados', { skip: !process.env.SALES_IMPORT_FIXTURE }, async () => {
    const { days } = await parseSalesFile(readFileSync(process.env.SALES_IMPORT_FIXTURE));
    assert.ok(days.size > 0);
    for (const day of days.values()) {
        assert.ok(Math.abs(sumHours(day.hourlyData) - day.totalSales) < 0.000001);
        assert.equal(sumHours(day.hourlyTxs), day.totalTxs);
        assert.equal(day.salesDayBasis, SALES_DAY_BASIS);
        assert.equal(day.businessDateVersion, 1);
    }
});

test('el reporte Inforest local opcional conserva ambas hojas y concilia ingreso real por producto', { skip: !process.env.SALES_IMPORT_XLS_FIXTURE }, async () => {
    const { days, fileFormat } = await parseSalesFile(readFileSync(process.env.SALES_IMPORT_XLS_FIXTURE));
    assert.equal(fileFormat, 'xls');
    assert.ok(days.size > 0);
    for (const day of days.values()) {
        assert.equal(day.productSalesRecorded, true);
        assert.equal(day.productRevenueRecorded, true);
        assert.ok(Math.abs(day.productSales.reduce((sum, product) => sum + product.revenue, 0) - day.totalSales) < 0.01);
        assert.equal(sumHours(day.hourlyTxs), day.totalTxs);
        assert.ok(day.productSales.every(product => product.revenue >= 0 && Number.isFinite(product.revenue)));
    }
});
