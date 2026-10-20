import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatesInRange } from './salesAnalysis.js';
import { readSalesHistoryDates, readSalesHistoryRange } from './salesHistoryRead.js';

const mockClient = (rows, error = null) => {
    const calls = [];
    return {
        calls,
        from(table) {
            const call = { table, filters: [], order: null, limit: null };
            calls.push(call);
            return {
                select(columns) { call.columns = columns; return this; },
                eq(field, value) { call.filters.push({ op: 'eq', field, value }); return this; },
                in(field, values) { call.filters.push({ op: 'in', field, values }); return this; },
                order(field, options) { call.order = { field, ...options }; return this; },
                limit(count) { call.limit = count; return this; },
                then(resolve, reject) {
                    const tableRows = Array.isArray(rows) ? (table === 'sales_daily_history' ? rows : []) : (rows[table] || []);
                    let data = tableRows.filter(row => call.filters.every(filter => filter.op === 'eq'
                        ? row[filter.field] === filter.value : filter.values.includes(row[filter.field])));
                    if (call.order) data = data.sort((a, b) =>
                        a[call.order.field].localeCompare(b[call.order.field]) * (call.order.ascending ? 1 : -1));
                    // Model the API's default result limit after its server filters.
                    data = data.slice(0, call.limit ?? 1000);
                    return Promise.resolve({ data, error }).then(resolve, reject);
                },
            };
        },
    };
};

test('consulta fechas únicas en lotes de hasta 100 y filtra la tienda antes del límite del servidor', async () => {
    const oldDates = getDatesInRange('2020-01-01', '2023-12-31');
    const dates = getDatesInRange('2026-01-01', '2026-07-24');
    assert.equal(dates.length, 205);
    const rows = [
        ...oldDates.map(date => ({ store_id: 'store-a', sales_date: date, sales_amount: 1 })),
        ...dates.map(date => ({ store_id: 'store-b', sales_date: date, sales_amount: 999 })),
        ...dates.map(date => ({ store_id: 'store-a', sales_date: date, sales_amount: 100, transactions: 10,
            hourly_data: { 10: { SALÓN: 100 } }, hourly_transactions: { 10: { SALÓN: 10 } } })),
    ];
    const client = mockClient(rows);
    const result = await readSalesHistoryDates(client, 'store-a', [...dates, dates[0], null, 'invalid']);
    assert.equal(result.size, 205);
    assert.equal(result.get('2026-07-24').totalSales, 100);
    assert.equal(result.get('2026-07-24').totalTxs, 10);
    assert.deepEqual(result.get('2026-07-24').hourlyTxs, { 10: { SALÓN: 10 } });
    assert.deepEqual(client.calls.filter(call => call.table === 'sales_daily_history').map(call => call.filters.find(filter => filter.op === 'in').values.length), [100, 100, 5]);
    assert.ok(client.calls.every(call => call.filters.some(filter => filter.op === 'eq' && filter.field === 'store_id' && filter.value === 'store-a')));
});

test('rango histórico consulta extremos reales incluso con más de 1000 días y otras tiendas', async () => {
    const dates = getDatesInRange('2020-01-01', '2026-10-19');
    const client = mockClient([
        { store_id: 'other-store', sales_date: '2010-01-01' },
        { store_id: 'other-store', sales_date: '2030-01-01' },
        ...dates.map(date => ({ store_id: 'store-a', sales_date: date })),
    ]);
    assert.deepEqual(await readSalesHistoryRange(client, 'store-a'), { min: '2020-01-01', max: '2026-10-19' });
    const dailyCalls = client.calls.filter(call => call.table === 'sales_daily_history');
    assert.equal(dailyCalls.length, 2);
    assert.ok(dailyCalls.every(call => call.limit === 1 && call.columns === 'sales_date'));
    assert.deepEqual(dailyCalls.map(call => call.order.ascending), [true, false]);
});

test('recupera importaciones mensuales antiguas sin inventar detalle horario ni perder otros días', async () => {
    const client = mockClient({
        sales_daily_history: [
            { store_id: 'store-a', sales_date: '2026-10-12', sales_amount: 500, transactions: 50, updated_at: '2026-10-19T12:00:00Z' },
            { store_id: 'store-a', sales_date: '2026-10-13', sales_amount: 150, transactions: 15, updated_at: '2026-10-17T12:00:00Z' },
        ],
        sales_month_configs: [{ store_id: 'store-a', month_start: '2026-10-01', real_sales_data: {
            '2026-10-05': { vta: 100, txs: 10 },
            '2026-10-12': { vta: 200, txs: 20, importedAt: '2026-10-18T12:00:00Z' },
            '2026-10-13': { vta: 300, txs: 30, importedAt: '2026-10-18T12:00:00Z' },
            hourlyParticipation: { 10: 100 },
        }, daily_hourly_parts: { '2026-10-05': { '10:00': 100 } } },
        { store_id: 'store-b', month_start: '2026-10-01', real_sales_data: { '2026-10-05': { vta: 9999, txs: 99 } } }],
    });
    const result = await readSalesHistoryDates(client, 'store-a', ['2026-10-05', '2026-10-12', '2026-10-13']);
    assert.equal(result.size, 3);
    assert.equal(result.get('2026-10-05').totalSales, 100);
    assert.equal(result.get('2026-10-05').monthlyArchive, true);
    assert.deepEqual(result.get('2026-10-05').hourlyTxs, {});
    assert.deepEqual(result.get('2026-10-05').hourlyParticipation, { '10:00': 100 });
    assert.equal(result.get('2026-10-12').totalSales, 500);
    assert.equal(result.get('2026-10-13').totalSales, 300);
    assert.deepEqual(await readSalesHistoryRange(client, 'store-a'), { min: '2026-10-05', max: '2026-10-13' });
});

test('ausencia de datos devuelve resultados vacíos y los errores interrumpen la carga', async () => {
    const empty = mockClient([]);
    assert.deepEqual(await readSalesHistoryRange(empty, 'store-a'), { min: null, max: null });
    assert.equal((await readSalesHistoryDates(empty, 'store-a', ['2026-10-16'])).size, 0);
    const noStore = mockClient([]);
    assert.equal((await readSalesHistoryDates(noStore, '', ['2026-10-16'])).size, 0);
    assert.equal(noStore.calls.length, 0);
    const error = { message: 'Error de carga local', code: 'TEST' };
    const failed = mockClient([], error);
    await assert.rejects(readSalesHistoryDates(failed, 'store-a', ['2026-10-16']), value => value === error);
    await assert.rejects(readSalesHistoryRange(failed, 'store-a'), value => value === error);
});

test('el caché de promedios no oculta el detalle exacto del mismo reporte al guardar metas', async () => {
    const productSales = [{ name: 'NOMBRE EXACTO', hour: 10, channel: 'SERV. AUTO', quantity: 3 }];
    const client = mockClient({
        sales_daily_history: [{ store_id: 'store-a', sales_date: '2026-10-18', sales_amount: 300, transactions: 3,
            updated_at: '2026-10-19T12:00:00Z', source_data: { productSales, productSalesRecorded: true } }],
        sales_month_configs: [{ store_id: 'store-a', month_start: '2026-10-01', real_sales_data: {
            '2026-10-18': { vta: 300, txs: 3, importedAt: '2026-10-19T12:00:01Z' },
        } }],
    });
    const result = await readSalesHistoryDates(client, 'store-a', ['2026-10-18']);
    assert.deepEqual(result.get('2026-10-18').productSales, productSales);
    assert.equal(result.get('2026-10-18').productSalesRecorded, true);
});

test('un archivo mensual con las mismas ventas y sin importes de producto no oculta el detalle monetario canónico', async () => {
    const productSales = [{ name: 'VS Borde de queso', hour: 10, channel: 'SALÓN', quantity: 3, revenue: 14.5 }];
    const client = mockClient({
        sales_daily_history: [{ store_id: 'store-a', sales_date: '2026-10-18', sales_amount: 300, transactions: 3,
            updated_at: '2026-10-19T12:00:00Z', source_data: { productSales, productSalesRecorded: true, productRevenueRecorded: true } }],
        sales_month_configs: [{ store_id: 'store-a', month_start: '2026-10-01', real_sales_data: {
            '2026-10-18': { vta: 300, txs: 3, importedAt: '2026-10-19T12:00:01Z', productSalesRecorded: true,
                productSales: [{ name: 'VS Borde de queso', hour: 10, channel: 'SALÓN', quantity: 3 }] },
        } }],
    });
    const result = await readSalesHistoryDates(client, 'store-a', ['2026-10-18']);
    assert.equal(result.get('2026-10-18').productRevenueRecorded, true);
    assert.deepEqual(result.get('2026-10-18').productSales, productSales);
});
