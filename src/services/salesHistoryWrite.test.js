import test from 'node:test';
import assert from 'node:assert/strict';
import { writeSalesHistoryDays } from './salesHistoryWrite.js';
import { readSalesHistoryDates } from './salesHistoryRead.js';
import { getDatesInRange } from './salesAnalysis.js';

test('ambas cargas conservan días previos y repetir un día lo reemplaza sin duplicarlo', async () => {
    const saved = new Map();
    const calls = [];
    const client = { rpc: async (name, args) => {
        calls.push([name, args]);
        for (const day of args.p_days) saved.set(day.date, day);
        return { data: args.p_days.length, error: null };
    } };
    const day = amount => ({ totalSales: amount, totalTxs: 1, hourlyData: { 0: { 'SALÓN': amount } },
        hourlyTxs: { 0: { 'SALÓN': 1 } }, businessDateVersion: 1, salesDayBasis: 'business-06:00' });
    await writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-05', day(100)], ['2026-10-06', day(200)]]));
    await writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', day(300)]]));
    await writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', day(350)]]));
    assert.equal(saved.size, 3);
    assert.equal(saved.get('2026-10-05').totalSales, 100);
    assert.equal(saved.get('2026-10-12').totalSales, 350);
    assert.equal(saved.get('2026-10-12').salesDayBasis, 'business-06:00');
    assert.equal(saved.get('2026-10-12').businessDateVersion, 1);
    assert.ok(calls.every(([name, args]) => name === 'save_sales_history_batch' && args.p_store_id === 'store-a'));
});

test('cargas vacías no escriben y los fallos de persistencia se propagan', async () => {
    let calls = 0;
    const error = { message: 'Error local de prueba' };
    const client = { rpc: async () => { calls++; return { error }; } };
    assert.deepEqual(await writeSalesHistoryDays(client, 'store-a', new Map()), []);
    assert.equal(calls, 0);
    await assert.rejects(writeSalesHistoryDays(client, '', new Map()), /tienda/);
    await assert.rejects(writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', {}]])), value => value === error);
});

const productDay = amount => ({ totalSales: amount, totalTxs: 1, hourlyData: { 10: { 'SALÓN': amount } },
    hourlyTxs: { 10: { 'SALÓN': 1 } }, suggestiveProducts: {},
    productSales: [{ name: 'PRODUCTO EXACTO', hour: 10, channel: 'SALÓN', quantity: 2, revenue: amount }],
    productSalesRecorded: true, productRevenueRecorded: true, businessDateVersion: 1, salesDayBasis: 'business-06:00' });

const clientWithHistory = ({ modern = false, configs = [], history = [], fail = null } = {}) => {
    const calls = [];
    const daily = new Map(history.map(row => [`${row.store_id}|${row.sales_date}`, structuredClone(row)]));
    const monthly = new Map(configs.map(row => [`${row.store_id}|${row.month_start}`, structuredClone(row)]));
    return {
        calls, daily, monthly,
        async rpc(name, args) {
            calls.push({ action: 'rpc', name, args });
            for (const day of args.p_days) {
                const previous = daily.get(`${args.p_store_id}|${day.date}`);
                const fixed = { date: day.date, totalSales: day.totalSales, totalTxs: day.totalTxs, hourlyData: day.hourlyData, hourlyTxs: day.hourlyTxs };
                daily.set(`${args.p_store_id}|${day.date}`, { store_id: args.p_store_id, sales_date: day.date,
                    sales_amount: Number(day.totalSales.toFixed(2)), transactions: day.totalTxs, hourly_data: day.hourlyData,
                    hourly_transactions: day.hourlyTxs, suggestive_products: day.suggestiveProducts,
                    source_data: modern ? structuredClone(day) : { ...previous?.source_data, ...fixed },
                    updated_at: '2040-01-01T00:00:00.000Z' });
            }
            return { data: args.p_days.length, error: null };
        },
        from(table) {
            const call = { action: 'select', table, filters: [] };
            calls.push(call);
            return {
                select(columns) { call.columns = columns; return this; },
                eq(field, value) { call.filters.push({ field, value }); return this; },
                in(field, values) { call.filters.push({ field, values }); return this; },
                async upsert(rows, options) {
                    call.action = 'upsert'; call.rows = structuredClone(rows); call.options = options;
                    if (fail === 'archive-write') return { error: { message: 'Archivo no disponible' } };
                    for (const row of rows) {
                        const key = `${row.store_id}|${row.month_start}`;
                        monthly.set(key, { ...monthly.get(key), ...structuredClone(row) });
                    }
                    return { data: [], error: null };
                },
                then(resolve, reject) {
                    const failed = fail === 'canonical-read' && table === 'sales_daily_history'
                        || fail === 'archive-read' && table === 'sales_month_configs';
                    const values = [...(table === 'sales_daily_history' ? daily : monthly).values()];
                    const data = values.filter(row => call.filters.every(filter => filter.values
                        ? filter.values.includes(row[filter.field]) : row[filter.field] === filter.value));
                    return Promise.resolve({ data, error: failed ? { message: 'Lectura no disponible' } : null }).then(resolve, reject);
                },
            };
        },
    };
};

test('RPC antiguo archiva el detalle y una recarga lo recupera sin tocar metas, participación ni otras fechas/tiendas', async () => {
    const previousDate = { vta: 15, txs: 1, importedAt: '2026-10-01T00:00:00Z' };
    const client = clientWithHistory({ configs: [
        { store_id: 'store-a', month_start: '2026-10-01', monthly_data: { 12: { vta: 1000 } }, daily_hourly_parts: { '2026-10-05': { '10:00': 100 } },
            real_sales_data: { '2026-10-05': previousDate, hourlyParticipation: { '10:00': 100 } } },
        { store_id: 'store-b', month_start: '2026-10-01', monthly_data: { 12: { vta: 9000 } }, real_sales_data: { unrelated: true } },
    ] });
    const day = productDay(29.9);
    assert.deepEqual(await writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', day]])), ['2026-10-12']);
    const archive = client.monthly.get('store-a|2026-10-01');
    assert.deepEqual(archive.monthly_data, { 12: { vta: 1000 } });
    assert.deepEqual(archive.daily_hourly_parts, { '2026-10-05': { '10:00': 100 } });
    assert.deepEqual(archive.real_sales_data['2026-10-05'], previousDate);
    assert.deepEqual(archive.real_sales_data.hourlyParticipation, { '10:00': 100 });
    assert.deepEqual(client.monthly.get('store-b|2026-10-01').real_sales_data, { unrelated: true });
    assert.ok(Date.parse(archive.real_sales_data['2026-10-12'].importedAt) > Date.parse('2040-01-01T00:00:00.000Z'), 'Server clock ahead of browser remains supported');
    const upsert = client.calls.find(call => call.action === 'upsert');
    assert.deepEqual(Object.keys(upsert.rows[0]).sort(), ['month_start', 'real_sales_data', 'store_id']);
    assert.deepEqual(upsert.options, { onConflict: 'store_id,month_start' });
    const reloaded = await readSalesHistoryDates(client, 'store-a', ['2026-10-12']);
    assert.deepEqual(reloaded.get('2026-10-12').productSales, day.productSales);
    assert.equal(reloaded.get('2026-10-12').productRevenueRecorded, true);
    assert.equal(reloaded.get('2026-10-12').totalSales, 29.9);
    assert.equal(reloaded.get('2026-10-12').totalTxs, 1);
});

test('RPC moderno conserva detalle y flags y no escribe un archivo adicional', async () => {
    const client = clientWithHistory({ modern: true });
    await writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', productDay(29.9)]]));
    assert.equal(client.calls.filter(call => call.table === 'sales_month_configs').length, 0);
    assert.equal(client.monthly.size, 0);
    assert.ok(client.calls.filter(call => call.action === 'select').every(call => call.filters.some(filter => filter.field === 'store_id' && filter.value === 'store-a')));
});

test('el archivo usa el reloj canónico aunque el cliente esté adelantado', async () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse('2050-01-01T00:00:00.000Z');
    try {
        const client = clientWithHistory();
        await writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', productDay(29.9)]]));
        assert.equal(client.monthly.get('store-a|2026-10-01').real_sales_data['2026-10-12'].importedAt, '2040-01-01T00:00:00.001Z');
    } finally {
        Date.now = originalNow;
    }
});

test('no considera preservado el detalle antiguo aunque sus flags guardados sean verdaderos', async () => {
    const stale = productDay(10);
    const client = clientWithHistory({ history: [{ store_id: 'store-a', sales_date: '2026-10-12', source_data: stale }] });
    const replacement = productDay(30);
    replacement.productSales[0].name = 'OTRO PRODUCTO';
    await writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', replacement]]));
    const reloaded = await readSalesHistoryDates(client, 'store-a', ['2026-10-12']);
    assert.deepEqual(reloaded.get('2026-10-12').productSales, replacement.productSales);
});

test('verifica como máximo 100 fechas por consulta y conserva todos los meses importados', async () => {
    const dates = getDatesInRange('2026-01-01', '2026-07-24');
    const client = clientWithHistory();
    await writeSalesHistoryDays(client, 'store-a', new Map(dates.map(date => [date, productDay(1)])));
    const checks = client.calls.filter(call => call.table === 'sales_daily_history');
    assert.deepEqual(checks.map(call => call.filters.find(filter => filter.field === 'sales_date').values.length), [100, 100, 5]);
    assert.equal(client.monthly.size, 7);
});

test('fallos tras RPC declaran que los totales se guardaron y el detalle todavía no es durable', async () => {
    for (const fail of ['canonical-read', 'archive-read', 'archive-write']) {
        const client = clientWithHistory({ fail });
        await assert.rejects(writeSalesHistoryDays(client, 'store-a', new Map([['2026-10-12', productDay(29.9)]])), error =>
            error.salesTotalsSaved === true && /totales.*ya se guardaron/i.test(error.message) && /detalle de productos e importes/.test(error.message));
        assert.equal(client.daily.get('store-a|2026-10-12').sales_amount, 29.9);
        assert.equal(client.monthly.size, 0);
    }
});
