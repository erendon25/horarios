import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SUGGESTIVE_PARTICIPATION, PROTECTED_SUGGESTIVE_PRODUCTS,
    mergeSuggestiveSalesDefaults, suggestiveProductParticipation } from './suggestiveSalesDefaults.js';

test('configuración vacía restaura los cinco nombres exactos, separados y protegidos con meta 30%', () => {
    const defaults = mergeSuggestiveSalesDefaults();
    assert.equal(defaults.length, 5);
    assert.deepEqual(defaults.map(product => product.id), ['borderLto', 'borderYape', 'cheeseBorder', 'hazloCrazyV3', 'hazloCanelitasV3']);
    assert.deepEqual(defaults.map(product => product.reportName), ['LTO BORDE QUESO PEPPE', 'YAPE LTO BDQ PEPPE',
        'VS Borde de queso', 'VS HAZLO CMB V3 CRAZY', 'VS HAZLO CMB V3 CANELITAS']);
    assert.ok(defaults.every(product => product.label === product.reportName && product.price === ''
        && product.participation === 0.30 && product.enabled && product.locked && product.default));
    assert.equal(DEFAULT_SUGGESTIVE_PARTICIPATION, 0.30);
    defaults[0].price = 10;
    assert.equal(PROTECTED_SUGGESTIVE_PRODUCTS[0].price, '');
});

test('los defaults reaparecen aunque un guardado antiguo los deshabilite o cambie su nombre por id', () => {
    const defaults = mergeSuggestiveSalesDefaults([{ id: 'cheeseBorder', label: 'Borde de queso antiguo',
        reportName: '', price: 3.5, participation: 0.42, enabled: false, locked: false, default: false, note: 'conservar' }]);
    const product = defaults.find(product => product.id === 'cheeseBorder');
    assert.deepEqual(product, { id: 'cheeseBorder', label: 'VS Borde de queso', reportName: 'VS Borde de queso',
        price: 3.5, participation: 0.42, enabled: true, locked: true, default: true, note: 'conservar' });
});

test('el alias custom con nombre literal se fusiona al default sin duplicar sus ventas ni perder precio o meta', () => {
    const products = mergeSuggestiveSalesDefaults([{ id: 'custom-1', label: 'Nombre anterior', reportName: ' VS Borde de queso ',
        price: '2.90', participation: 0.25 }, { id: 'cheeseBorder', enabled: false, color: 'blue' }]);
    assert.equal(products.length, 5);
    const product = products.find(product => product.id === 'cheeseBorder');
    assert.equal(product.price, '2.90');
    assert.equal(product.participation, 0.25);
    assert.equal(product.color, 'blue');
    assert.equal(product.reportName, 'VS Borde de queso');
});

test('customs adicionales se conservan y sólo se deduplican por nombre literal, respetando mayúsculas y signos', () => {
    const products = mergeSuggestiveSalesDefaults([
        { id: 'a', label: 'Uno', reportName: 'OTRO', price: 10 },
        { id: 'b', label: 'Dos', reportName: 'OTRO', price: 20 },
        { id: 'lowercase', label: 'Minúsculas', reportName: 'vs borde de queso', participation: 0.15 },
        { id: 'punctuation', label: 'Signo', reportName: 'VS Borde de queso.' },
    ]);
    assert.equal(products.length, 8);
    assert.equal(products.find(product => product.reportName === 'OTRO').price, 20);
    assert.ok(products.find(product => product.id === 'lowercase'));
    assert.ok(products.find(product => product.id === 'punctuation'));
    assert.equal(products.find(product => product.id === 'lowercase').participation, 0.15);
});

test('una meta explícitamente vacía sigue pendiente y no vuelve silenciosamente a 30%', () => {
    const product = mergeSuggestiveSalesDefaults([{ id: 'borderLto', participation: '', price: '' }])[0];
    assert.equal(product.participation, '');
    assert.equal(suggestiveProductParticipation(product, 0.80), null);
    assert.equal(mergeSuggestiveSalesDefaults([{ id: 'borderLto', participation: undefined }])[0].participation, 0.30);
    assert.equal(suggestiveProductParticipation({ participation: 0 }, 0.80), 0);
    assert.equal(suggestiveProductParticipation({}, 0.80), 0.80);
    assert.equal(suggestiveProductParticipation({ participation: '0.42' }), 0.42);
    for (const participation of [null, '', ' ', false, {}, NaN, -0.1, 1.1]) {
        assert.equal(suggestiveProductParticipation({ participation }), null);
    }
});

test('una lista antigua de familia no convierte un default literal en varios productos', () => {
    const product = mergeSuggestiveSalesDefaults([{ id: 'cheeseBorder', reportName: 'VS Borde de queso',
        reportNames: ['VS Borde de queso', 'LTO BORDE QUESO PEPPE'], participation: 0.30 }])
        .find(product => product.id === 'cheeseBorder');
    assert.equal(product.reportName, 'VS Borde de queso');
    assert.equal(Object.hasOwn(product, 'reportNames'), false);
});

test('mezclar, serializar y cargar otro reporte es idempotente y no muta la configuración original', () => {
    const source = [{ id: 'custom-old', reportName: 'YAPE LTO BDQ PEPPE', price: 28.9, participation: 0.35, enabled: false }];
    const before = structuredClone(source);
    const first = mergeSuggestiveSalesDefaults(source);
    const afterReload = mergeSuggestiveSalesDefaults(JSON.parse(JSON.stringify(first)));
    assert.deepEqual(afterReload, first);
    assert.deepEqual(source, before);
    assert.equal(afterReload.find(product => product.id === 'borderYape').price, 28.9);
    assert.equal(afterReload.find(product => product.id === 'borderYape').participation, 0.35);
});
