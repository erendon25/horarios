import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getDatesInRange, getComparisonDates, getComparisonAvailability, datesForWeekday, comparisonDatesForWeekday,
    getHourlyDateSelection, sumHourlyValues, getWeekdayAverages, mergeSalesAverageSources,
} from './salesAnalysis.js';

test('lunes 12 de octubre compara con lunes 5 y con lunes 13 de octubre de 2025', () => {
    const dates = getDatesInRange('2026-10-12', '2026-10-12');
    assert.deepEqual(getComparisonDates(dates, 'week'), ['2026-10-05']);
    assert.deepEqual(getComparisonDates(dates, 'year'), ['2025-10-13']);
    assert.deepEqual(comparisonDatesForWeekday(dates, 'week', 1), ['2026-10-05']);
    assert.deepEqual(comparisonDatesForWeekday(dates, 'year', 1), ['2025-10-13']);
    assert.deepEqual(comparisonDatesForWeekday(dates, 'year', 2), []);
});

test('mes anterior se bloquea cuando el día 12 anterior no es el mismo día de semana', () => {
    const dates = ['2026-10-12'];
    const availability = getComparisonAvailability(dates, 'month');
    assert.equal(availability.enabled, false);
    assert.match(availability.reason, /12\/10\/2026/);
    assert.match(availability.reason, /12\/09\/2026/);
    assert.deepEqual(getComparisonDates(dates, 'month'), []);
    assert.deepEqual(comparisonDatesForWeekday(dates, 'month', 1), []);
});

test('un rango parcial conserva días homólogos en semana y año anteriores', () => {
    const dates = getDatesInRange('2026-10-12', '2026-10-13');
    assert.deepEqual(getComparisonDates(dates, 'week'), ['2026-10-05', '2026-10-06']);
    assert.deepEqual(getComparisonDates(dates, 'year'), ['2025-10-13', '2025-10-14']);
    assert.deepEqual(getComparisonDates(dates, 'month'), []);
});

test('mes anterior se habilita solo si todas las fechas conservan el día de semana', () => {
    const dates = getDatesInRange('2026-03-12', '2026-03-14');
    assert.equal(getComparisonAvailability(dates, 'month').enabled, true);
    assert.deepEqual(getComparisonDates(dates, 'month'), ['2026-02-12', '2026-02-13', '2026-02-14']);
    assert.deepEqual(comparisonDatesForWeekday(dates, 'month', 5), ['2026-02-13']);
    const monthEnd = getDatesInRange('2026-03-28', '2026-03-31');
    assert.equal(getComparisonAvailability(monthEnd, 'month').enabled, false);
    assert.deepEqual(getComparisonDates(monthEnd, 'month'), []);
});

test('la comparación anual resta 52 semanas y conserva weekdays también alrededor de año bisiesto', () => {
    assert.deepEqual(getComparisonDates(['2024-02-29'], 'year'), ['2023-03-02']);
    const dates = getDatesInRange('2024-02-27', '2024-03-02');
    const previous = getComparisonDates(dates, 'year');
    assert.equal(previous.length, dates.length);
    previous.forEach((date, index) => {
        assert.equal(new Date(`${date}T12:00:00`).getDay(), new Date(`${dates[index]}T12:00:00`).getDay());
    });
    assert.equal(getComparisonAvailability([], 'month').enabled, false);
    assert.equal(getComparisonAvailability(['invalid'], 'year').enabled, false);
});

test('los filtros por día distinguen lunes y domingo y aceptan rangos entre meses', () => {
    const dates = getDatesInRange('2026-09-27', '2026-10-05');
    assert.deepEqual(datesForWeekday(dates, 0), ['2026-09-27', '2026-10-04']);
    assert.deepEqual(datesForWeekday(dates, 1), ['2026-09-28', '2026-10-05']);
    assert.deepEqual(getDatesInRange('2026-10-06', '2026-10-05'), []);
    assert.deepEqual(getDatesInRange('2026-02-30', '2026-03-01'), []);
});

test('la tendencia se fija al único día y descarta selecciones fuera del rango', () => {
    assert.equal(getHourlyDateSelection(['2026-10-16'], '2026-10-15'), '2026-10-16');
    const dates = getDatesInRange('2026-10-15', '2026-10-17');
    assert.equal(getHourlyDateSelection(dates, '2026-10-16'), '2026-10-16');
    assert.equal(getHourlyDateSelection(dates, '2026-10-14'), 'all');
    const totals = sumHourlyValues({
        '2026-10-14': { 10: 100 },
        '2026-10-15': { 10: 3, 23: 1, 0: 2 },
        '2026-10-16': { 10: 4, 1: 2 },
    }, ['2026-10-15', '2026-10-16', '2026-10-16']);
    assert.equal(totals[10], 7);
    assert.equal(totals[23], 1);
    assert.equal(totals[0], 2);
    assert.equal(totals[1], 2);
    assert.equal(totals[6], 0);
});

test('promedios usan solo el mes elegido, incluyen registros cero y excluyen días sin datos', () => {
    const averages = getWeekdayAverages('2026-10', {
        '2026-10-02': { vta: 200, txs: 10 },
        '2026-10-09': { vta: 0, txs: 0 },
        '2026-10-16': { vta: 100, txs: 5 },
        '2026-09-25': { vta: 9000, txs: 900 },
        '2026-11-06': { vta: 9000, txs: 900 },
        '2026-10-23': { vta: 'incorrecto', txs: 1 },
        '2026-10-30': { vta: '', txs: '' },
        '2026-10-03': { vta: null, txs: null },
    }, {
        '2026-10-02': { '10:00': 20, '11:00': 80 },
        '2026-10-09': { '10:00': 0, '11:00': 0 },
        '2026-09-25': { '10:00': 100 },
        '2026-10-30': {},
    });
    const friday = averages.find((day) => day.id === 5);
    assert.equal(friday.count, 3);
    assert.equal(friday.avgVta, 100);
    assert.equal(friday.avgTxs, 5);
    assert.equal(friday.partsCount, 2);
    assert.equal(friday.parts['10:00'], 10);
    assert.equal(friday.parts['11:00'], 40);
    const monday = averages.find((day) => day.id === 1);
    assert.equal(monday.count, 0);
    assert.equal(monday.avgVta, 0);
    assert.equal(averages.find(day => day.id === 6).count, 0);
});


test('los promedios conservan el archivo importado más reciente y adoptan nuevas ventas del historial', () => {
    const imported = { vta: 300, txs: 30, importedAt: '2026-10-18T12:00:00Z' };
    const savedSales = { '2026-10-16': imported };
    const savedParts = { '2026-10-16': { '10:00': 100 } };
    const olderHistory = { '2026-10-16': { vta: 100, txs: 10, updatedAt: '2026-10-17T12:00:00Z' } };
    const current = mergeSalesAverageSources(savedSales, savedParts, olderHistory, {});
    assert.deepEqual(current.sales['2026-10-16'], imported);
    assert.deepEqual(current.parts['2026-10-16'], { '10:00': 100 });
    const updatedHistory = { '2026-10-16': { vta: 500, txs: 50, updatedAt: '2026-10-19T12:00:00Z' } };
    const updated = mergeSalesAverageSources(savedSales, savedParts, updatedHistory, { '2026-10-16': { '11:00': 100 } });
    assert.deepEqual(updated.sales['2026-10-16'], updatedHistory['2026-10-16']);
    assert.deepEqual(updated.parts['2026-10-16'], { '11:00': 100 });
});
