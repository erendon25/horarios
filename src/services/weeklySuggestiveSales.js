import { exactReportProductName } from './productMatching.js';
import { normalizeReportChannel, SUGGESTIVE_EVALUATION_CHANNELS } from './suggestiveChannels.js';
import { suggestiveProductParticipation } from './suggestiveSalesDefaults.js';

const DAY_MS = 86400000;
const isoDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
};
const dateText = date => date.toISOString().slice(0, 10);
const shiftDate = (date, days) => new Date(date.getTime() + days * DAY_MS);
const finiteValue = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function getLimaBusinessDate(now = new Date(), cutoffHour = 6) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return Number(parts.hour) < cutoffHour ? dateText(shiftDate(isoDate(date), -1)) : date;
}

export function getSuggestiveIsoWeek(value) {
    const date = isoDate(value);
    if (!date) return null;
    const start = shiftDate(date, -((date.getUTCDay() + 6) % 7));
    const year = shiftDate(start, 3).getUTCFullYear();
    const january4 = isoDate(`${year}-01-04`);
    const firstMonday = shiftDate(january4, -((january4.getUTCDay() + 6) % 7));
    const number = Math.round((start - firstMonday) / (7 * DAY_MS)) + 1;
    return { id: `${year}-W${String(number).padStart(2, '0')}`, year, number, start: dateText(start), end: dateText(shiftDate(start, 6)) };
}

const productConfiguration = products => {
    const selected = (products || []).filter(product => product && product.enabled !== false).map((product, index) => ({
        id: product.id || `product-${index}`,
        label: product.label || product.reportName || `Producto ${index + 1}`,
        participation: product.participation,
        reportNames: [...new Set((Array.isArray(product.reportNames) ? product.reportNames : [product.reportName])
            .map(exactReportProductName).filter(Boolean))],
    }));
    const missingNames = selected.filter(product => !product.reportNames.length).map(product => product.label);
    const seen = new Set(), duplicateNames = new Set();
    for (const product of selected) for (const name of product.reportNames) {
        if (seen.has(name)) duplicateNames.add(name);
        seen.add(name);
    }
    return { selected, missingNames, duplicateNames: [...duplicateNames] };
};

const channelConfiguration = channels => [...new Set((channels === undefined ? SUGGESTIVE_EVALUATION_CHANNELS : channels || [])
    .filter(channel => typeof channel === 'string' || channel?.enabled !== false)
    .map(channel => normalizeReportChannel(typeof channel === 'string' ? channel : channel.id))
    .filter(channel => SUGGESTIVE_EVALUATION_CHANNELS.includes(channel)))];

const historyDays = history => {
    const validDay = day => day && typeof day === 'object';
    const entries = history instanceof Map ? [...history].filter(([, day]) => validDay(day)).map(([date, day]) => ({ ...day, date: day.date || day.sales_date || date }))
        : Array.isArray(history) ? history.filter(validDay).map(day => ({ ...day, date: day.date || day.sales_date }))
        : Object.entries(history || {}).filter(([, day]) => validDay(day)).map(([date, day]) => ({ ...day, date: day.date || day.sales_date || date }));
    return [...new Map(entries.filter(day => isoDate(day.date)).map(day => [day.date, day])).values()];
};

const salesForChannel = (day, channel) => {
    const hours = day.hourlyData || day.hourly_data;
    if (!hours || typeof hours !== 'object' || !Object.keys(hours).length) return { value: null, detail: false };
    let value = 0, observed = false;
    for (const [hour, values] of Object.entries(hours)) {
        if (!Number.isInteger(Number(hour)) || Number(hour) < 0 || Number(hour) > 29) continue;
        if (!values || typeof values !== 'object') continue;
        for (const [name, amount] of Object.entries(values)) {
            if (normalizeReportChannel(name) !== channel) continue;
            const parsed = finiteValue(amount);
            if (parsed === null) return { value: null, detail: false };
            value += parsed; observed = true;
        }
    }
    return { value, detail: true, observed };
};

function summarizeChannel(days, channel, configuration, targetPercentage, weekStart) {
    const { selected: products, missingNames, duplicateNames } = configuration;
    const missingChannelDates = [], missingRevenueDates = [], observedDates = [];
    const productDetails = products.map(product => ({ ...product, knownUnits: 0, knownRevenue: 0,
        unitsComplete: true, revenueComplete: true, missingRevenueDates: [] }));
    let knownChannelSales = 0;
    for (const day of days) {
        const channelSales = salesForChannel(day, channel);
        if (!channelSales.detail) missingChannelDates.push(day.date);
        else {
            knownChannelSales += channelSales.value;
            if (channelSales.observed) observedDates.push(day.date);
        }
        const items = Array.isArray(day.productSales) ? day.productSales : [];
        const quantitiesRecorded = day.productSalesRecorded === true && Array.isArray(day.productSales);
        const revenueRecorded = day.productRevenueRecorded === true && Array.isArray(day.productSales);
        if (!revenueRecorded) missingRevenueDates.push(day.date);
        for (const product of productDetails) {
            if (!quantitiesRecorded) product.unitsComplete = false;
            if (!revenueRecorded) {
                product.revenueComplete = false;
                product.missingRevenueDates.push(day.date);
            }
            const names = new Set(product.reportNames);
            for (const item of items) {
                if (!names.has(exactReportProductName(item.name)) || normalizeReportChannel(item.channel) !== channel) continue;
                const units = finiteValue(item.quantity), revenue = finiteValue(item.revenue);
                if (units === null) product.unitsComplete = false;
                else product.knownUnits += units;
                if (revenue === null) {
                    product.revenueComplete = false;
                    if (!product.missingRevenueDates.includes(day.date)) product.missingRevenueDates.push(day.date);
                    if (!missingRevenueDates.includes(day.date)) missingRevenueDates.push(day.date);
                }
                else product.knownRevenue += revenue;
            }
        }
    }
    const hasReports = days.length > 0;
    const channelSales = hasReports && observedDates.length && !missingChannelDates.length ? money(knownChannelSales) : null;
    const details = productDetails.map(product => {
        const rate = suggestiveProductParticipation(product, targetPercentage === null ? null : targetPercentage / 100);
        const productTargetPercentage = rate === null ? null : rate * 100;
        const validName = product.reportNames.length > 0 && !product.reportNames.some(name => duplicateNames.includes(name));
        const units = hasReports && product.reportNames.length && product.unitsComplete ? product.knownUnits : null;
        const revenue = hasReports && product.reportNames.length && product.revenueComplete ? money(product.knownRevenue) : null;
        const percentage = validName && channelSales !== null && channelSales > 0 && revenue !== null
            ? revenue * 100 / channelSales : null;
        let status = 'ready';
        if (!hasReports) status = 'no-reports';
        else if (!validName) status = 'missing-product-names';
        else if (missingChannelDates.length) status = 'missing-channel-detail';
        else if (revenue === null) status = 'missing-product-revenue';
        else if (channelSales === null || channelSales <= 0) status = 'no-channel-sales';
        return { ...product, units, revenue, knownRevenue: money(product.knownRevenue), percentage,
            targetPercentage: productTargetPercentage, status,
            targetMet: percentage === null || productTargetPercentage === null ? null : percentage >= productTargetPercentage };
    });
    let status = 'ready';
    if (!hasReports) status = 'no-reports';
    else if (!products.length || missingNames.length || duplicateNames.length) status = 'missing-product-names';
    else if (missingChannelDates.length) status = 'missing-channel-detail';
    else if (details.some(product => product.revenue === null)) status = 'missing-product-revenue';
    else if (channelSales === null || channelSales <= 0) status = 'no-channel-sales';
    const reportDates = days.map(day => day.date);
    const missingDates = Array.from({ length: 7 }, (_, index) => dateText(shiftDate(isoDate(weekStart), index)))
        .filter(date => !reportDates.includes(date));
    return {
        id: channel, channelSales, status,
        reportDays: days.length, reportDates, observedDates, missingDates,
        coverage: !days.length ? 'none' : days.length < 7 ? 'partial' : 'complete',
        missingChannelDates, missingRevenueDates, knownChannelSales: money(knownChannelSales),
        products: details,
    };
}

/** Each product's percentage uses its recorded revenue / the channel's weekly sales.
 * Percentages never aggregate different products, use prices or average daily rates.
 * Dates supplied by the importer are already commercial dates (06:00–05:59).
 */
export function buildWeeklySuggestiveSalesReport({ history = [], products = [], channels, participation = 0.30, today = getLimaBusinessDate() } = {}) {
    const current = getSuggestiveIsoWeek(today);
    if (!current) throw new Error('Selecciona una fecha válida para el reporte semanal.');
    const configuration = productConfiguration(products);
    const selectedChannels = channelConfiguration(channels);
    const groups = new Map([[current.id, { ...current, days: [] }]]);
    for (const day of historyDays(history)) {
        const week = getSuggestiveIsoWeek(day.date);
        if (!groups.has(week.id)) groups.set(week.id, { ...week, days: [] });
        groups.get(week.id).days.push(day);
    }
    const targetPercentage = finiteValue(participation) !== null && participation >= 0 && participation <= 1 ? Number(participation) * 100 : null;
    const weeks = [...groups.values()].map(({ days, ...week }) => {
        days.sort((left, right) => left.date.localeCompare(right.date));
        return { ...week, isCurrent: week.id === current.id, reportDays: days.length,
            reportDates: days.map(day => day.date), coverage: !days.length ? 'none' : days.length < 7 ? 'partial' : 'complete',
            channels: selectedChannels.map(channel => summarizeChannel(days, channel, configuration, targetPercentage, week.start)) };
    }).sort((left, right) => right.start.localeCompare(left.start));
    return { today, currentWeekId: current.id, weeks, products: configuration.selected, channels: selectedChannels,
        missingProductNames: configuration.missingNames, duplicateProductNames: configuration.duplicateNames,
        hasProducts: configuration.selected.length > 0, targetPercentage };
}
