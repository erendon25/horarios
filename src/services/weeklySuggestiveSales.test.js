import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklySuggestiveSalesReport, getLimaBusinessDate, getSuggestiveIsoWeek } from './weeklySuggestiveSales.js';

const product = { id: 'selected', label: 'Producto elegido', reportName: 'PRODUCTO EXACTO', price: '' };
const item = (revenue, quantity = 1, extra = {}) => ({ name: 'PRODUCTO EXACTO', hour: 12, channel: 'SALÓN', quantity, revenue, ...extra });
const day = (date, sales, products = [], extra = {}) => ({ date, totalSales: sales, hourlyData: { 12: { SALÓN: sales } },
    productSales: products, productSalesRecorded: true, productRevenueRecorded: true, ...extra });
const calculate = (history, extra = {}) => buildWeeklySuggestiveSalesReport({ history, products: [product], channels: ['SALÓN'], today: '2026-10-19', ...extra });
const week = (report, id = '2026-W42') => report.weeks.find(value => value.id === id);
const channel = (report, id = '2026-W42', name = 'SALÓN') => week(report, id).channels.find(value => value.id === name);
const selectedProduct = (summary, id = 'selected') => summary.products.find(value => value.id === id);

test('la semana usa ingresos acumulados: 50/100 y 90/900 son 14%, no el promedio diario 30%', () => {
    const report = calculate([day('2026-10-12', 100, [item(50, 2)]), day('2026-10-13', 900, [item(90, 3)])]);
    const summary = channel(report);
    assert.equal(summary.channelSales, 1000);
    assert.equal(selectedProduct(summary).percentage, 14);
    assert.equal(selectedProduct(summary).targetPercentage, 30);
    assert.equal(selectedProduct(summary).targetMet, false);
    assert.equal(summary.products[0].units, 5);
    assert.equal(summary.products[0].revenue, 140);
    assert.equal(week(report).coverage, 'partial');
    assert.equal(week(report).reportDays, 2);
    assert.equal(summary.coverage, 'partial');
    assert.deepEqual(summary.missingDates, ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    for (const field of ['suggestiveSales', 'percentage', 'targetMet', 'knownSuggestiveSales', 'targetPercentage']) {
        assert.equal(Object.hasOwn(summary, field), false, `channel must not expose the aggregate ${field}`);
    }
    assert.deepEqual([week(report).start, week(report).end], ['2026-10-12', '2026-10-18']);
});

test('19 de octubre es la semana 43 y queda sin datos cuando los archivos llegan al 18', () => {
    const report = calculate([day('2026-10-11', 100, [item(30)]), day('2026-10-18', 100, [item(20, 2, { hour: 1 })])]);
    assert.equal(report.currentWeekId, '2026-W43');
    const current = week(report, report.currentWeekId);
    assert.deepEqual([current.start, current.end], ['2026-10-19', '2026-10-25']);
    assert.equal(current.coverage, 'none');
    assert.equal(current.reportDays, 0);
    assert.equal(current.channels[0].channelSales, null);
    assert.equal(selectedProduct(current.channels[0]).revenue, null);
    assert.equal(selectedProduct(current.channels[0]).percentage, null);
    assert.equal(selectedProduct(current.channels[0]).status, 'no-reports');
    assert.equal(current.channels[0].missingDates.length, 7);
    assert.equal(current.channels[0].status, 'no-reports');
    assert.equal(selectedProduct(channel(report)).revenue, 20, 'Already imported commercial dates are not shifted again');
});

test('las semanas ISO y la jornada de Lima resuelven límites de año y el corte 06:00', () => {
    assert.equal(getSuggestiveIsoWeek('2018-12-31').id, '2019-W01');
    assert.equal(getSuggestiveIsoWeek('2021-01-01').id, '2020-W53');
    assert.equal(getSuggestiveIsoWeek('2026-10-18').id, '2026-W42');
    assert.equal(getSuggestiveIsoWeek('2026-10-19').id, '2026-W43');
    assert.equal(getSuggestiveIsoWeek('2026-02-30'), null);
    assert.equal(getLimaBusinessDate(new Date('2026-10-19T10:59:00Z')), '2026-10-18');
    assert.equal(getLimaBusinessDate(new Date('2026-10-19T11:00:00Z')), '2026-10-19');
});

test('cada canal divide por su propia venta real y Auto permanece distinto de Drive y Fila', () => {
    const report = calculate([day('2026-10-12', 999999, [
        item(100, 1), item(30, 2, { channel: 'SERV. FILA' }), item(5, 3, { channel: 'SERV. AUTO' }),
        item(10, 4, { channel: 'DRIVE THRU' }), item(9000, 500, { channel: 'DELIVERY' }),
    ], { hourlyData: { 12: { SALÓN: 800, 'SERV. FILA': 100, 'SERV. AUTO': 50, 'DRIVE THRU': 50, DELIVERY: 9000 } } })],
    { channels: ['SALÓN', 'DRIVE THRU', 'SERV. FILA', 'SERV. AUTO', 'DELIVERY', 'CANAL NUEVO'] });
    assert.deepEqual(report.channels, ['SALÓN', 'DRIVE THRU', 'SERV. FILA', 'SERV. AUTO']);
    assert.equal(selectedProduct(channel(report)).percentage, 12.5);
    assert.equal(selectedProduct(channel(report, '2026-W42', 'SERV. FILA')).percentage, 30);
    assert.equal(selectedProduct(channel(report, '2026-W42', 'SERV. AUTO')).percentage, 10);
    assert.equal(selectedProduct(channel(report, '2026-W42', 'DRIVE THRU')).percentage, 20);
    const selected = calculate([], { channels: [{ id: 'SALÓN', enabled: true }, { id: 'SERV. FILA', enabled: false }] });
    assert.deepEqual(selected.channels, ['SALÓN']);
});

test('los cinco productos de Fila se evalúan por separado sobre S/19202.70, sin sumar sus porcentajes', () => {
    const names = ['LTO BORDE QUESO PEPPE', 'YAPE LTO BDQ PEPPE', 'VS Borde de queso',
        'VS HAZLO CMB V3 CRAZY', 'VS HAZLO CMB V3 CANELITAS'];
    const revenues = [7176, 1554.8, 29.7, 108.9, 148.5];
    const report = calculate([day('2026-10-18', 19202.7, names.map((name, index) =>
        item(revenues[index], index + 1, { name, channel: 'SERV. FILA' })),
    { hourlyData: { 12: { 'SERV. FILA': 19202.7 } } })], {
        channels: ['SERV. FILA'], products: names.map((reportName, index) => ({ id: `sku-${index}`, reportName, price: '' })),
    });
    const summary = channel(report, '2026-W42', 'SERV. FILA');
    assert.equal(summary.channelSales, 19202.7);
    assert.deepEqual(summary.products.map(product => product.revenue), revenues);
    assert.deepEqual(summary.products.map(product => Number(product.percentage.toFixed(2))), [37.37, 8.1, 0.15, 0.57, 0.77]);
    assert.deepEqual(summary.products.map(product => product.targetMet), [true, false, false, false, false]);
    assert.ok(summary.products.every(product => product.status === 'ready' && product.targetPercentage === 30));
    assert.equal(Object.hasOwn(summary, 'percentage'), false);
});

test('un nombre pendiente, uno sin ventas y uno duplicado no anulan un producto válido', () => {
    const summary = channel(calculate([day('2026-10-12', 100, [item(40, 4), item(20, 2, { name: 'DUPLICADO' })])], {
        products: [product, { id: 'pending', reportName: '' }, { id: 'wrong', reportName: 'PRODUCTO EXACTO.' },
            { id: 'duplicate-a', reportName: 'DUPLICADO' }, { id: 'duplicate-b', reportName: 'DUPLICADO' }],
    }));
    assert.equal(selectedProduct(summary).percentage, 40);
    assert.equal(selectedProduct(summary).status, 'ready');
    assert.equal(selectedProduct(summary).targetMet, true);
    assert.equal(selectedProduct(summary, 'pending').percentage, null);
    assert.equal(selectedProduct(summary, 'pending').status, 'missing-product-names');
    assert.equal(selectedProduct(summary, 'wrong').revenue, 0);
    assert.equal(selectedProduct(summary, 'wrong').percentage, 0);
    assert.equal(selectedProduct(summary, 'wrong').status, 'ready');
    assert.equal(selectedProduct(summary, 'duplicate-a').percentage, null);
    assert.equal(selectedProduct(summary, 'duplicate-b').status, 'missing-product-names');
});

test('un importe faltante afecta sólo al producto correspondiente cuando el resto está verificado', () => {
    const summary = channel(calculate([day('2026-10-12', 100, [item(20, 2), item(null, 3, { name: 'OTRO' })])], {
        products: [product, { id: 'other', reportName: 'OTRO' }],
    }));
    assert.equal(selectedProduct(summary).revenue, 20);
    assert.equal(selectedProduct(summary).percentage, 20);
    assert.equal(selectedProduct(summary).status, 'ready');
    assert.deepEqual(selectedProduct(summary).missingRevenueDates, []);
    assert.equal(selectedProduct(summary, 'other').units, 3);
    assert.equal(selectedProduct(summary, 'other').revenue, null);
    assert.equal(selectedProduct(summary, 'other').percentage, null);
    assert.equal(selectedProduct(summary, 'other').status, 'missing-product-revenue');
    assert.deepEqual(selectedProduct(summary, 'other').missingRevenueDates, ['2026-10-12']);
});

test('cada meta semanal usa su participación guardada y sólo la ausente hereda la global', () => {
    const summary = channel(calculate([day('2026-10-12', 100, [item(20)])], { participation: 0.05,
        products: [{ ...product, participation: 0.30 }, { id: 'fallback', reportName: 'SIN VENTAS' },
            { id: 'zero', reportName: 'META CERO', participation: 0 }, { id: 'blank', reportName: 'PENDIENTE', participation: '' }],
    }));
    assert.equal(selectedProduct(summary).targetPercentage, 30);
    assert.equal(selectedProduct(summary).percentage, 20);
    assert.equal(selectedProduct(summary).targetMet, false);
    assert.equal(selectedProduct(summary, 'fallback').targetPercentage, 5);
    assert.equal(selectedProduct(summary, 'zero').targetPercentage, 0);
    assert.equal(selectedProduct(summary, 'zero').targetMet, true);
    assert.equal(selectedProduct(summary, 'blank').targetPercentage, null);
    assert.equal(selectedProduct(summary, 'blank').targetMet, null);
    assert.equal(selectedProduct(summary, 'blank').percentage, 0, 'Actual verified sales do not require a completed target');
});

test('el empalme respeta nombre literal, mayúsculas, signos y NFC; el precio configurado no interviene', () => {
    const report = calculate([day('2026-10-12', 100, [item(10, 2), item(80, 99, { name: 'PRODUCTO EXACTO EXTRA' }),
        item(70, 99, { name: 'producto exacto' }), item(60, 99, { name: 'PRODUCTO EXACTO.' })])],
    { products: [{ ...product, price: 10000 }] });
    assert.equal(selectedProduct(channel(report)).revenue, 10);
    assert.equal(selectedProduct(channel(report)).percentage, 10);
    assert.equal(channel(report).products[0].units, 2);
    const unicode = calculate([day('2026-10-12', 100, [item(15, 1, { name: 'Cafe\u0301' })])],
        { products: [{ ...product, reportName: '  Café  ' }] });
    assert.equal(selectedProduct(channel(unicode)).revenue, 15);
});

test('un reporte monetario completo sin el producto registra 0%; un histórico sin detalle no lo inventa', () => {
    const complete = channel(calculate([day('2026-10-12', 100, [])]));
    assert.equal(selectedProduct(complete).revenue, 0);
    assert.equal(selectedProduct(complete).percentage, 0);
    assert.equal(complete.products[0].units, 0);
    assert.equal(complete.status, 'ready');
    const old = channel(calculate([day('2026-10-12', 100, [], { productSalesRecorded: false, productRevenueRecorded: undefined })]));
    assert.equal(selectedProduct(old).revenue, null);
    assert.equal(selectedProduct(old).percentage, null);
    assert.equal(old.products[0].units, null);
    assert.equal(old.status, 'missing-product-revenue');
});

test('importe incompleto conserva cantidades verificadas y exige recargar antes de calcular porcentajes', () => {
    const report = calculate([day('2026-10-12', 100, [item(10, 2)]),
        day('2026-10-13', 900, [item(null, 3)], { productRevenueRecorded: false })]);
    const summary = channel(report);
    assert.equal(summary.channelSales, 1000);
    assert.equal(selectedProduct(summary).percentage, null);
    assert.equal(summary.products[0].units, 5);
    assert.equal(summary.products[0].revenue, null);
    assert.equal(selectedProduct(summary).knownRevenue, 10);
    assert.deepEqual(selectedProduct(summary).missingRevenueDates, ['2026-10-13']);
    assert.deepEqual(summary.missingRevenueDates, ['2026-10-13']);
    assert.equal(summary.status, 'missing-product-revenue');
    const invalidFlag = channel(calculate([day('2026-10-12', 100, [item(undefined)])]));
    assert.equal(selectedProduct(invalidFlag).percentage, null);
    assert.deepEqual(invalidFlag.missingRevenueDates, ['2026-10-12']);
});

test('los importes verificados son independientes de cantidades faltantes', () => {
    const summary = channel(calculate([day('2026-10-12', 100, [item(20, null)], { productSalesRecorded: false })]));
    assert.equal(selectedProduct(summary).revenue, 20);
    assert.equal(selectedProduct(summary).percentage, 20);
    assert.equal(summary.products[0].units, null);
    assert.equal(summary.products[0].revenue, 20);
    assert.equal(summary.status, 'ready');
});

test('nombres sin configurar, sin productos o duplicados se distinguen de un reporte monetario faltante', () => {
    const history = [day('2026-10-12', 100, [item(10)])];
    const missing = calculate(history, { products: [{ id: 'missing', label: 'Por completar', reportName: '' }] });
    assert.deepEqual(missing.missingProductNames, ['Por completar']);
    assert.equal(channel(missing).status, 'missing-product-names');
    assert.equal(selectedProduct(channel(missing), 'missing').revenue, null);
    assert.equal(selectedProduct(channel(missing), 'missing').percentage, null);
    assert.equal(calculate(history, { products: [] }).hasProducts, false);
    const duplicate = calculate(history, { products: [product, { ...product, id: 'other' }] });
    assert.deepEqual(duplicate.duplicateProductNames, ['PRODUCTO EXACTO']);
    assert.equal(selectedProduct(channel(duplicate)).percentage, null);
    assert.equal(selectedProduct(channel(duplicate), 'other').status, 'missing-product-names');
});

test('familias usan únicamente la lista explícita y no duplican un nombre dentro de la misma familia', () => {
    const report = calculate([day('2026-10-12', 100, [item(10), item(20, 2, { name: 'OTRO EXACTO' }), item(60, 6, { name: 'OTRO EXACTO EXTRA' })])],
        { products: [{ ...product, reportNames: ['PRODUCTO EXACTO', 'OTRO EXACTO', 'OTRO EXACTO'] }] });
    assert.equal(selectedProduct(channel(report)).revenue, 30);
    assert.equal(selectedProduct(channel(report)).percentage, 30);
    assert.equal(channel(report).products[0].units, 3);
});

test('totales sin desglose por canal y canales nunca observados quedan sin porcentaje', () => {
    const noDetail = channel(calculate([day('2026-10-12', 100, [item(10)], { hourlyData: {} })]));
    assert.equal(noDetail.channelSales, null);
    assert.equal(selectedProduct(noDetail).percentage, null);
    assert.equal(noDetail.status, 'missing-channel-detail');
    const missing = calculate([day('2026-10-12', 100, [item(10)])], { channels: ['SALÓN', 'SERV. FILA'] });
    assert.equal(channel(missing, '2026-W42', 'SERV. FILA').channelSales, null);
    assert.equal(selectedProduct(channel(missing, '2026-W42', 'SERV. FILA')).percentage, null);
    const zero = channel(calculate([day('2026-10-12', 0, [])]));
    assert.equal(zero.channelSales, 0);
    assert.equal(selectedProduct(zero).percentage, null);
    assert.equal(zero.status, 'no-channel-sales');
});

test('histórico canónico acepta Map, deduplica fechas y marca una semana completa con siete días', () => {
    const records = Array.from({ length: 7 }, (_, index) => day(`2026-10-${12 + index}`, 100, [item(10)]));
    const report = calculate([...records, day('2026-10-12', 200, [item(20)])]);
    assert.equal(week(report).reportDays, 7);
    assert.equal(week(report).coverage, 'complete');
    assert.equal(channel(report).channelSales, 800);
    assert.equal(selectedProduct(channel(report)).revenue, 80);
    assert.equal(selectedProduct(channel(report)).percentage, 10);
    assert.deepEqual(channel(report).missingDates, []);
    assert.equal(channel(report).coverage, 'complete');
    const mapped = calculate(new Map(records.map(record => [record.date, { ...record, date: undefined }])));
    assert.equal(channel(mapped).channelSales, 700);
    assert.deepEqual(calculate(records, { channels: [] }).channels, []);
});

test('ignora fechas y metadatos inválidos sin sumarlos como ventas por hora', () => {
    const report = calculate([null, { date: '2026-02-30' }, day('2026-10-12', 100, [item(10)],
        { hourlyData: { 12: { SALÓN: 100 }, total: { SALÓN: 500 } } })]);
    assert.equal(channel(report).channelSales, 100);
    assert.equal(selectedProduct(channel(report)).percentage, 10);
    assert.equal(week(report).reportDays, 1);
});
