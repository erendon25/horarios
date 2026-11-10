import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SUGGESTIVE_PARTICIPATION, INITIAL_SUGGESTIVE_PRODUCTS, PROTECTED_SUGGESTIVE_PRODUCTS,
    mergeSuggestiveSalesDefaults, suggestiveProductParticipation } from './suggestiveSalesDefaults.js';
import { buildWeeklySuggestiveSalesReport } from './weeklySuggestiveSales.js';

test('sólo una configuración ausente ofrece cinco productos iniciales editables, cada uno con meta 30%', () => {
    const initial = mergeSuggestiveSalesDefaults();
    assert.equal(initial.length, 5);
    assert.deepEqual(initial.map(product => product.id), ['borderLto', 'borderYape', 'cheeseBorder', 'hazloCrazyV3', 'hazloCanelitasV3']);
    assert.deepEqual(initial.map(product => product.reportName), ['LTO BORDE QUESO PEPPE', 'YAPE LTO BDQ PEPPE',
        'VS Borde de queso', 'VS HAZLO CMB V3 CRAZY', 'VS HAZLO CMB V3 CANELITAS']);
    assert.ok(initial.every(product => product.label === product.reportName && product.price === ''
        && product.participation === 0.30 && product.enabled && !product.locked && product.default));
    assert.deepEqual(mergeSuggestiveSalesDefaults(null), initial);
    assert.equal(PROTECTED_SUGGESTIVE_PRODUCTS, INITIAL_SUGGESTIVE_PRODUCTS);
    assert.equal(DEFAULT_SUGGESTIVE_PARTICIPATION, 0.30);
    initial[0].price = 10;
    assert.equal(INITIAL_SUGGESTIVE_PRODUCTS[0].price, '');
});

test('una lista explícita vacía permanece vacía después de guardar y recargar, sin reinsertar sugerencias', () => {
    assert.deepEqual(mergeSuggestiveSalesDefaults([]), []);
    assert.deepEqual(mergeSuggestiveSalesDefaults(JSON.parse(JSON.stringify(mergeSuggestiveSalesDefaults([])))), []);
    for (const invalid of [{}, '', false, 0]) assert.deepEqual(mergeSuggestiveSalesDefaults(invalid), []);
});

test('eliminar por id o nombre reduce la lista y los productos quitados no reaparecen', () => {
    const byId = mergeSuggestiveSalesDefaults().filter(product => product.id !== 'borderLto');
    const byName = byId.filter(product => product.reportName !== 'VS HAZLO CMB V3 CRAZY');
    const reloaded = mergeSuggestiveSalesDefaults(JSON.parse(JSON.stringify(byName)));
    assert.equal(reloaded.length, 3);
    assert.ok(reloaded.every(product => product.id !== 'borderLto' && product.reportName !== 'VS HAZLO CMB V3 CRAZY'));
    assert.deepEqual(reloaded.map(product => product.id), ['borderYape', 'cheeseBorder', 'hazloCanelitasV3']);
});

test('los antiguos defaults quedan desbloqueados sin restaurar nombres, precios, metas ni enabled editados', () => {
    const saved = [{ id: 'cheeseBorder', label: 'Mi producto editado', reportName: 'NOMBRE NUEVO', price: 3.5,
        participation: 0.42, enabled: false, locked: true, default: true, note: 'conservar' }];
    assert.deepEqual(mergeSuggestiveSalesDefaults(saved), [{ ...saved[0], locked: false }]);
    assert.equal(saved[0].locked, true, 'The saved input is not mutated');
    assert.equal(mergeSuggestiveSalesDefaults(saved).length, 1);
});

test('una lista custom completa conserva orden, identidad y nombres exactos sin fusionarla con el catálogo inicial', () => {
    const saved = [
        { id: 'custom-b', label: 'Nombre exacto anterior', reportName: 'VS Borde de queso', price: '2.90', participation: 0.25 },
        { id: 'custom-a', label: 'Minúsculas', reportName: 'vs borde de queso', participation: 0.15 },
        { id: 'custom-c', label: 'Signo', reportName: 'VS Borde de queso.' },
    ];
    const actual = mergeSuggestiveSalesDefaults(saved);
    assert.deepEqual(actual.map(product => product.id), ['custom-b', 'custom-a', 'custom-c']);
    assert.deepEqual(actual.map(product => product.reportName), saved.map(product => product.reportName));
    assert.equal(actual[0].price, '2.90');
    assert.equal(actual[0].participation, 0.25);
    assert.ok(actual.every(product => !product.locked));
});

test('editar el nombre de un default antiguo elimina su familia oculta y cuenta sólo el nombre nuevo', () => {
    const legacy = { id: 'cheeseBorder', label: 'NUEVO', reportName: 'NUEVO', locked: true, default: true,
        reportNames: ['VS Borde de queso', 'LTO BORDE QUESO PEPPE'], participation: 0.30 };
    const products = mergeSuggestiveSalesDefaults([legacy]);
    assert.equal(products.length, 1);
    assert.equal(products[0].reportName, 'NUEVO');
    assert.equal(Object.hasOwn(products[0], 'reportNames'), false);
    assert.deepEqual(legacy.reportNames, ['VS Borde de queso', 'LTO BORDE QUESO PEPPE']);
    const report = buildWeeklySuggestiveSalesReport({ today: '2026-10-19', products, channels: ['SALÓN'], history: [{
        date: '2026-10-18', totalSales: 100, hourlyData: { 12: { SALÓN: 100 } },
        productSalesRecorded: true, productRevenueRecorded: true, productSales: [
            { name: 'NUEVO', hour: 12, channel: 'SALÓN', quantity: 1, revenue: 10 },
            { name: 'VS Borde de queso', hour: 12, channel: 'SALÓN', quantity: 2, revenue: 20 },
            { name: 'LTO BORDE QUESO PEPPE', hour: 12, channel: 'SALÓN', quantity: 3, revenue: 30 },
        ],
    }] });
    const actual = report.weeks.find(week => week.id === '2026-W42').channels[0].products[0];
    assert.equal(actual.revenue, 10);
    assert.equal(actual.units, 1);
    assert.equal(actual.percentage, 10);
    const customFamily = { id: 'custom-family', reportName: 'Familia elegida', reportNames: ['A', 'B'] };
    assert.deepEqual(mergeSuggestiveSalesDefaults([customFamily])[0].reportNames, ['A', 'B']);
});

test('sólo metas ausentes de filas iniciales antiguas heredan 30%; los custom conservan la herencia global', () => {
    const rows = mergeSuggestiveSalesDefaults([
        { id: 'borderLto' }, { id: 'old-custom', reportName: 'YAPE LTO BDQ PEPPE' },
        { id: 'old-default', default: true, reportName: 'RENOMBRADO' },
        { id: 'custom', reportName: 'OTRO NOMBRE' },
        { id: 'borderYape', participation: 0.40 },
    ]);
    assert.deepEqual(rows.slice(0, 3).map(product => product.participation), [0.30, 0.30, 0.30]);
    assert.equal(Object.hasOwn(rows[3], 'participation'), false);
    assert.equal(suggestiveProductParticipation(rows[3], 0.75), 0.75);
    assert.equal(rows[4].participation, 0.40);
});

test('una meta explícitamente vacía sigue pendiente y no vuelve silenciosamente a 30%', () => {
    const product = mergeSuggestiveSalesDefaults([{ id: 'borderLto', participation: '', price: '' }])[0];
    assert.equal(product.participation, '');
    assert.equal(suggestiveProductParticipation(product, 0.80), null);
    assert.equal(suggestiveProductParticipation({ participation: 0 }, 0.80), 0);
    assert.equal(suggestiveProductParticipation({}, 0.80), 0.80);
    assert.equal(suggestiveProductParticipation({ participation: '0.42' }), 0.42);
    for (const participation of [null, '', ' ', false, {}, NaN, -0.1, 1.1]) {
        assert.equal(suggestiveProductParticipation({ participation }), null);
    }
});

test('recargar respeta incluso filas duplicadas pendientes de validar en vez de borrarlas o insertar otras', () => {
    const saved = [{ id: 'one', reportName: 'MISMO', price: 5 }, { id: 'two', reportName: 'MISMO', price: 7 }];
    const actual = mergeSuggestiveSalesDefaults(saved);
    assert.equal(actual.length, 2);
    assert.deepEqual(actual.map(product => product.id), ['one', 'two']);
    assert.deepEqual(mergeSuggestiveSalesDefaults(JSON.parse(JSON.stringify(actual))), actual);
});

test('cargar nuevas ventas no modifica el catálogo explícito ni sus datos guardados', () => {
    const saved = [{ id: 'custom-old', reportName: 'YAPE LTO BDQ PEPPE', price: 28.9, participation: 0.35, enabled: false }];
    const before = structuredClone(saved);
    const first = mergeSuggestiveSalesDefaults(saved);
    const afterReload = mergeSuggestiveSalesDefaults(JSON.parse(JSON.stringify(first)));
    assert.deepEqual(afterReload, first);
    assert.deepEqual(saved, before);
    assert.equal(afterReload.length, 1);
    assert.equal(afterReload[0].id, 'custom-old');
    assert.equal(afterReload[0].price, 28.9);
    assert.equal(afterReload[0].participation, 0.35);
    assert.equal(afterReload[0].enabled, false);
});
