import { normalizeReportChannel, SUGGESTIVE_EVALUATION_CHANNELS } from './suggestiveChannels.js';

// Keep case, punctuation and accents: these identify the literal report product.
export const exactReportProductName = value => String(value ?? '').normalize('NFC').trim();

const selectedChannels = channels => new Set((channels || SUGGESTIVE_EVALUATION_CHANNELS)
    .map(channel => normalizeReportChannel(typeof channel === 'string' ? channel : channel.id))
    .filter(channel => SUGGESTIVE_EVALUATION_CHANNELS.includes(channel)));

export function hasExactReportedProduct(day, reportName, channels) {
    return Boolean(exactReportProductName(reportName) && day?.productSalesRecorded === true
        && Array.isArray(day.productSales) && selectedChannels(channels).size);
}

export function countExactReportedProduct(day, reportName, channels) {
    if (!hasExactReportedProduct(day, reportName, channels)) return null;
    const name = exactReportProductName(reportName);
    const selected = selectedChannels(channels);
    return day.productSales.reduce((sum, product) => {
        const quantity = Number(product.quantity);
        return exactReportProductName(product.name) === name
            && selected.has(normalizeReportChannel(product.channel))
            && Number.isFinite(quantity) && quantity >= 0 ? sum + quantity : sum;
    }, 0);
}

export function getReportedProductNames(history = []) {
    const days = history instanceof Map ? [...history.values()] : history;
    return [...new Set(days.flatMap(day => Array.isArray(day.productSales)
        ? day.productSales.map(product => exactReportProductName(product.name)).filter(Boolean) : []))]
        .sort((left, right) => left.localeCompare(right, 'es'));
}
