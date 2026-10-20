import { salesHistoryDayPayload } from '../lib/supabase/salesHistoryCompat.js';

const DATE_BATCH_SIZE = 100;
const checkResult = result => {
    if (result.error) throw result.error;
    return result.data || [];
};
const stableJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

const hasExpectedProducts = (source, expected) => source
    && source.productSalesRecorded === expected.productSalesRecorded
    && source.productRevenueRecorded === expected.productRevenueRecorded
    && stableJson(source.productSales) === stableJson(expected.productSales);

// The deployed legacy RPC validates totals but ignores newer product metadata.
// Verify its saved result before deciding whether a compatible archive is needed.
async function preserveProductDetail(client, storeId, payload) {
    const withProducts = payload.filter(day => Array.isArray(day.productSales));
    if (!withProducts.length) return;
    const requests = [];
    for (let offset = 0; offset < withProducts.length; offset += DATE_BATCH_SIZE) {
        requests.push(client.from('sales_daily_history')
            .select('sales_date,sales_amount,transactions,source_data,updated_at')
            .eq('store_id', storeId).in('sales_date', withProducts.slice(offset, offset + DATE_BATCH_SIZE).map(day => day.date)));
    }
    const results = await Promise.all(requests);
    const stored = new Map(results.flatMap(checkResult).map(day => [day.sales_date, day]));
    const missing = [];
    for (const expected of withProducts) {
        const saved = stored.get(expected.date);
        if (!saved || !Number.isFinite(Number(saved.sales_amount))
            || Math.abs(Number(saved.sales_amount) - expected.totalSales) > 0.005000001
            || Number(saved.transactions) !== expected.totalTxs) {
            throw new Error('El historial cambió mientras se guardaban las ventas. Vuelve a importar el reporte.');
        }
        if (!hasExpectedProducts(saved.source_data, expected)) missing.push({ expected, saved });
    }
    if (!missing.length) return;

    const months = [...new Set(missing.map(({ expected }) => `${expected.date.slice(0, 7)}-01`))];
    const previous = checkResult(await client.from('sales_month_configs')
        .select('month_start,real_sales_data').eq('store_id', storeId).in('month_start', months));
    const byMonth = new Map(previous.map(month => [month.month_start, { ...(month.real_sales_data || {}) }]));
    for (const { expected, saved } of missing) {
        const month = `${expected.date.slice(0, 7)}-01`;
        if (!byMonth.has(month)) byMonth.set(month, {});
        // Prefer the server clock in either direction: a fast browser clock
        // must not leave an archive that hides a later canonical import.
        const savedAt = Date.parse(saved.updated_at);
        const importedAt = new Date(Number.isFinite(savedAt) ? savedAt + 1 : Date.now()).toISOString();
        byMonth.get(month)[expected.date] = { ...expected, vta: expected.totalSales, txs: expected.totalTxs, importedAt };
    }
    // Deliberately omit monthly_data and daily_hourly_parts. A product archive
    // must never replace sales goals or the existing hourly participation form.
    const archiveRows = months.map(month_start => ({ store_id: storeId, month_start, real_sales_data: byMonth.get(month_start) }));
    checkResult(await client.from('sales_month_configs').upsert(archiveRows, { onConflict: 'store_id,month_start' }));
}

// Both upload screens write the same daily history. A new report replaces only
// its business dates, so other previously imported dates remain available.
export async function writeSalesHistoryDays(client, storeId, days) {
    if (!storeId) throw new Error('No se encontró la tienda para guardar las ventas.');
    const entries = days instanceof Map ? [...days] : Object.entries(days || {});
    if (!entries.length) return [];
    if (entries.length > 1000) throw new Error('Importa como máximo 1000 jornadas por archivo.');
    const payload = entries.map(([date, values]) => salesHistoryDayPayload(date, values));
    const { error } = await client.rpc('save_sales_history_batch', {
        p_store_id: storeId,
        p_days: payload,
    });
    if (error) throw error;
    try {
        await preserveProductDetail(client, storeId, payload);
    } catch (cause) {
        const failure = new Error('Los totales de ventas ya se guardaron, pero no se pudo conservar o verificar el detalle de productos e importes. Reintenta la importación antes de evaluar la venta sugestiva.', { cause });
        failure.salesTotalsSaved = true;
        throw failure;
    }
    return entries.map(([date]) => date).sort();
}
