import { mapSalesHistoryRow } from '../lib/supabase/salesHistoryCompat.js';

const SALES_DATE_BATCH_SIZE = 100;

const checkResult = (result) => {
    if (result.error) throw result.error;
    return result.data || [];
};

const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const savedArchiveDates = rows => rows.flatMap(row => Object.keys(row.real_sales_data || {}).filter(isoDate));

const addMonthlyArchives = (history, configs, requestedDates) => {
    const requested = new Set(requestedDates);
    for (const config of configs) {
        for (const [date, saved] of Object.entries(config.real_sales_data || {})) {
            if (!requested.has(date) || !saved || typeof saved !== 'object') continue;
            if (![saved.vta, saved.txs].some(value => value !== null && value !== undefined && value !== '')) continue;
            const current = history.get(date);
            const sameTotals = current && Math.abs(Number(current.totalSales) - Number(saved.vta)) < 0.005
                && Number(current.totalTxs) === Number(saved.txs);
            // Saving the averages cache milliseconds after an import must not
            // hide the exact product detail already stored in daily history.
            if (sameTotals && current.productRevenueRecorded === true && saved.productRevenueRecorded !== true) continue;
            if (sameTotals && current.productSalesRecorded === true && saved.productSalesRecorded !== true) continue;
            if (current && !((Date.parse(saved.importedAt) || 0) > (Date.parse(current.updatedAt) || 0))) continue;
            // Older uploads were saved only in the month configuration. Their
            // totals are usable; channel and transaction-hour detail cannot be
            // reconstructed from sales percentages and must remain unavailable.
            history.set(date, {
                date, totalSales: saved.vta === null ? null : Number(saved.vta ?? 0),
                totalTxs: saved.txs === null ? null : Number(saved.txs ?? 0),
                hourlyData: saved.hourlyData || {}, hourlyTxs: saved.hourlyTxs || {},
                suggestiveProducts: saved.suggestiveProducts || {},
                ...(Array.isArray(saved.productSales) ? {
                    productSales: saved.productSales,
                    productSalesRecorded: saved.productSalesRecorded === true,
                    productRevenueRecorded: saved.productRevenueRecorded === true,
                } : {}),
                hourlyParticipation: config.daily_hourly_parts?.[date] || {},
                updatedAt: saved.importedAt || null, importedAt: saved.importedAt,
                monthlyArchive: true,
                businessDateVersion: saved.businessDateVersion,
                salesDayBasis: saved.salesDayBasis,
            });
        }
    }
    return history;
};

// Scope on the server before Supabase's result limit. The compatibility
// adapter filters collection results in the browser, which can omit dates
// once a store's history exceeds the server's row limit.
export const readSalesHistoryDates = async (client, storeId, dates) => {
    if (!storeId) return new Map();
    const uniqueDates = [...new Set(dates)].filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date));
    const requests = [];
    for (let offset = 0; offset < uniqueDates.length; offset += SALES_DATE_BATCH_SIZE) {
        requests.push(client.from('sales_daily_history').select('*')
            .eq('store_id', storeId)
            .in('sales_date', uniqueDates.slice(offset, offset + SALES_DATE_BATCH_SIZE)));
    }
    if (!uniqueDates.length) return new Map();
    const months = [...new Set(uniqueDates.map(date => `${date.slice(0, 7)}-01`))];
    const archiveRequest = client.from('sales_month_configs')
        .select('month_start,real_sales_data,daily_hourly_parts')
        .eq('store_id', storeId).in('month_start', months);
    const [results, archives] = await Promise.all([Promise.all(requests), archiveRequest]);
    const history = new Map(results.flatMap(checkResult).map(row => [row.sales_date, mapSalesHistoryRow(row)]));
    return addMonthlyArchives(history, checkResult(archives), uniqueDates);
};

export const readSalesHistoryRange = async (client, storeId) => {
    if (!storeId) return { min: null, max: null };
    const query = () => client.from('sales_daily_history').select('sales_date').eq('store_id', storeId);
    const [first, last, archives] = await Promise.all([
        query().order('sales_date', { ascending: true }).limit(1),
        query().order('sales_date', { ascending: false }).limit(1),
        client.from('sales_month_configs').select('real_sales_data').eq('store_id', storeId),
    ]);
    const dates = [...savedArchiveDates(checkResult(archives)),
        checkResult(first)[0]?.sales_date, checkResult(last)[0]?.sales_date].filter(isoDate).sort();
    return {
        min: dates[0] || null,
        max: dates.at(-1) || null,
    };
};
