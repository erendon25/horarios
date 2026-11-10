import { addDays, format, isValid, parseISO, subMonths } from 'date-fns';

export const SALES_WEEKDAYS = [
    { id: 1, name: 'Lunes' }, { id: 2, name: 'Martes' },
    { id: 3, name: 'Miércoles' }, { id: 4, name: 'Jueves' },
    { id: 5, name: 'Viernes' }, { id: 6, name: 'Sábado' },
    { id: 0, name: 'Domingo' },
];

export const SALES_HOURLY_LABELS = Array.from({ length: 24 }, (_, index) =>
    `${String((index + 6) % 24).padStart(2, '0')}:00`
);

const parseDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = parseISO(value);
    return isValid(date) && format(date, 'yyyy-MM-dd') === value ? date : null;
};

export const getDatesInRange = (start, end) => {
    const first = parseDate(start);
    const last = parseDate(end);
    if (!first || !last || first > last) return [];
    const dates = [];
    for (let date = first; date <= last; date = addDays(date, 1)) {
        dates.push(format(date, 'yyyy-MM-dd'));
    }
    return dates;
};

export const shiftComparisonDate = (value, period) => {
    const date = parseDate(value);
    if (!date) return null;
    const previous = period === 'month' ? subMonths(date, 1)
        : period === 'year' ? addDays(date, -364) : addDays(date, -7);
    return format(previous, 'yyyy-MM-dd');
};

export const getComparisonAvailability = (dates, period) => {
    if (!dates.length || dates.some(date => !parseDate(date))) {
        return { enabled: false, reason: 'Selecciona un rango de fechas válido.' };
    }
    if (period !== 'month') return { enabled: true, reason: '' };
    const mismatch = dates.find(date =>
        parseDate(date).getDay() !== parseDate(shiftComparisonDate(date, period)).getDay());
    if (!mismatch) return { enabled: true, reason: '' };
    const current = format(parseDate(mismatch), 'dd/MM/yyyy');
    const previous = format(parseDate(shiftComparisonDate(mismatch, period)), 'dd/MM/yyyy');
    return {
        enabled: false,
        reason: `Mes anterior no disponible: ${current} y ${previous} corresponden a distintos días de la semana.`,
    };
};

// Week and year comparisons use homologous weekdays (-7 and -364 days).
// Calendar-month comparisons are allowed only when every date keeps its weekday.
export const getComparisonDates = (dates, period) => {
    if (!getComparisonAvailability(dates, period).enabled) return [];
    return [...new Set(dates.map((date) => shiftComparisonDate(date, period)))];
};

export const datesForWeekday = (dates, weekday) =>
    dates.filter((date) => parseDate(date)?.getDay() === weekday);

export const comparisonDatesForWeekday = (dates, period, weekday) => {
    if (!getComparisonAvailability(dates, period).enabled) return [];
    const seen = new Set();
    const result = [];
    for (const date of dates) {
        const previous = shiftComparisonDate(date, period);
        if (!previous || seen.has(previous)) continue;
        seen.add(previous);
        if (parseDate(date)?.getDay() === weekday) result.push(previous);
    }
    return result;
};

export const getHourlyDateSelection = (dates, selected) => {
    if (dates.length === 1) return dates[0];
    return dates.includes(selected) ? selected : 'all';
};

export const sumHourlyValues = (valuesByDate, dates) => {
    const hours = Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [hour, 0]));
    for (const date of new Set(dates)) {
        for (let hour = 0; hour < 24; hour++) {
            hours[hour] += Number(valuesByDate?.[date]?.[hour]) || 0;
        }
    }
    return hours;
};

export const getWeekdayAverages = (selectedMonth, realSalesData = {}, dailyHourlyParts = {}) => {
    const result = SALES_WEEKDAYS.map((day) => ({
        ...day, count: 0, vta: 0, txs: 0, parts: {}, partsCount: 0,
    }));
    const byWeekday = new Map(result.map((day) => [day.id, day]));
    const dates = new Set([...Object.keys(realSalesData), ...Object.keys(dailyHourlyParts)]);
    for (const date of dates) {
        if (!date.startsWith(`${selectedMonth}-`)) continue;
        const parsed = parseDate(date);
        if (!parsed) continue;
        const weekday = byWeekday.get(parsed.getDay());
        const real = realSalesData[date];
        if (real && [real.vta, real.txs].some(value => value !== undefined && value !== null && value !== '')) {
            const sales = Number(real.vta ?? 0);
            const transactions = Number(real.txs ?? 0);
            if (Number.isFinite(sales) && Number.isFinite(transactions)) {
                weekday.vta += sales;
                weekday.txs += transactions;
                weekday.count++;
            }
        }
        const parts = dailyHourlyParts[date];
        if (parts && SALES_HOURLY_LABELS.some((hour) => parts[hour] !== undefined)) {
            for (const hour of SALES_HOURLY_LABELS) {
                weekday.parts[hour] = (weekday.parts[hour] || 0) + (Number(parts[hour]) || 0);
            }
            weekday.partsCount++;
        }
    }
    return result.map((weekday) => ({
        ...weekday,
        avgVta: weekday.count ? weekday.vta / weekday.count : 0,
        avgTxs: weekday.count ? weekday.txs / weekday.count : 0,
        parts: Object.fromEntries(SALES_HOURLY_LABELS.map((hour) => [
            hour, weekday.partsCount ? (weekday.parts[hour] || 0) / weekday.partsCount : 0,
        ])),
    }));
};

export const mergeSalesAverageSources = (savedSales, savedParts, historySales, historyParts) => {
    const sales = { ...savedSales };
    const parts = { ...savedParts };
    for (const [date, history] of Object.entries(historySales)) {
        const importedAt = Date.parse(savedSales?.[date]?.importedAt) || 0;
        const historyUpdatedAt = Date.parse(history.updatedAt) || 0;
        if (!savedSales?.[date] || historyUpdatedAt >= importedAt) {
            sales[date] = history;
            parts[date] = historyParts[date] || {};
        }
    }
    return { sales, parts };
};
