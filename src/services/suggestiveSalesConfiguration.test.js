import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTECTED_SUGGESTIVE_PRODUCTS } from './suggestiveSalesDefaults.js';
import {
    buildSuggestiveSalesDraft, serializeSuggestiveSalesConfiguration, resolveSuggestiveSalesConfiguration,
    loadSuggestiveSalesConfiguration, saveSuggestiveSalesConfiguration, suggestiveSalesConfigurationKeys,
    suggestiveSalesDraftCacheKey, readSuggestiveSalesDraftCache, writeSuggestiveSalesDraftCache,
    canApplySuggestiveSalesConfigurationLoad,
} from './suggestiveSalesConfiguration.js';

const scope = { userId: 'user-a', storeId: 'store-a', month: '2026-10' };
const custom = { id: 'custom-a', label: 'MI PRODUCTO', reportName: 'MI PRODUCTO', price: 12.5,
    enabled: true, participation: 0.4, locked: false, default: false };
const settings = { calculationVersion: 'revenue-v1', participation: 0.35,
    products: [{ ...PROTECTED_SUGGESTIVE_PRODUCTS[0], price: 8, participation: 0.2 }, custom],
    channels: [{ id: 'SALÓN', enabled: false }, { id: 'SERV. FILA', enabled: true }] };
const memoryStorage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('sin configuración ni reportes muestra siempre el catálogo protegido al 30%', () => {
    const draft = buildSuggestiveSalesDraft();
    assert.equal(draft.participation, '30');
    assert.equal(draft.products.length, 5);
    assert.ok(draft.products.every(product => product.locked && product.default && product.enabled
        && product.participation === 0.30 && product.price === ''));
    assert.deepEqual(draft.products.map(product => product.reportName), PROTECTED_SUGGESTIVE_PRODUCTS.map(product => product.reportName));
});

test('el mes combina valores legítimos guardados con defaults de tienda y conserva productos nuevos', () => {
    const resolved = resolveSuggestiveSalesConfiguration({ defaultConfiguration: settings,
        monthConfiguration: { participation: 0.45, products: [{ ...PROTECTED_SUGGESTIVE_PRODUCTS[0], price: 9, participation: 0.25 }],
            channels: [{ id: 'DRIVE THRU', enabled: true }] } });
    assert.equal(resolved.participation, 0.45);
    assert.equal(resolved.products[0].price, 9);
    assert.equal(resolved.products[0].participation, 0.25);
    assert.deepEqual(resolved.products.find(product => product.id === custom.id), custom);
    assert.equal(resolved.channels.find(channel => channel.id === 'DRIVE THRU').enabled, true);
    assert.equal(resolved.channels.find(channel => channel.id === 'SERV. FILA').enabled, false);
    assert.equal(resolved.products.filter(product => product.default).length, 5);
});

test('un mes nuevo conserva productos, porcentajes, precios y canales de los defaults de tienda', async () => {
    const calls = [];
    const loaded = await loadSuggestiveSalesConfiguration({ month: '2026-11', read: async key => {
        calls.push(key);
        return key.endsWith(':defaults') ? settings : null;
    } });
    assert.deepEqual(calls, ['suggestive_sales_goals:defaults', 'suggestive_sales_goals:2026-11']);
    const draft = buildSuggestiveSalesDraft(loaded);
    assert.equal(draft.participation, '35');
    assert.equal(draft.products[0].participation, 0.2);
    assert.equal(draft.products[0].price, 8);
    assert.deepEqual(draft.products.find(product => product.id === custom.id), custom);
    assert.equal(draft.channels.find(channel => channel.id === 'SERV. FILA').enabled, true);
});

test('catálogo vacío o deshabilitado guardado no elimina los productos protegidos', () => {
    const draft = buildSuggestiveSalesDraft({ products: [{ ...PROTECTED_SUGGESTIVE_PRODUCTS[0], enabled: false }], participation: 0 });
    assert.equal(draft.participation, '0');
    assert.equal(draft.products.length, 5);
    assert.ok(draft.products.every(product => product.enabled && product.locked));
    assert.equal(serializeSuggestiveSalesConfiguration({ participation: '30', products: [], channels: [] }).products.length, 5);
});

test('serializa campos por producto sin perder precio opcional o porcentaje temporalmente vacío', () => {
    const draft = buildSuggestiveSalesDraft(settings);
    draft.products[0] = { ...draft.products[0], participation: '', price: '' };
    const serialized = serializeSuggestiveSalesConfiguration(draft);
    assert.equal(serialized.participation, 0.35);
    assert.equal(serialized.products[0].participation, '');
    assert.equal(serialized.products[0].price, '');
    assert.equal(serialized.products[0].locked, true);
    assert.equal(serialized.products[0].reportName, PROTECTED_SUGGESTIVE_PRODUCTS[0].reportName);
    assert.deepEqual(serialized.products.find(product => product.id === custom.id), custom);
});

test('custom antiguo sin porcentaje hereda la meta global y el catálogo protegido conserva el 30%', () => {
    const { participation: _unused, ...legacyCustom } = custom;
    const draft = buildSuggestiveSalesDraft({ participation: 0.25, products: [legacyCustom] });
    assert.equal(draft.products.find(product => product.id === custom.id).participation, 0.25);
    assert.ok(draft.products.filter(product => product.default).every(product => product.participation === 0.30));
    const storage = memoryStorage();
    const legacyDraft = { ...draft, products: [legacyCustom] };
    writeSuggestiveSalesDraftCache(storage, scope, { draft: legacyDraft, dirty: true, revision: 1 });
    assert.equal(readSuggestiveSalesDraftCache(storage, scope).draft.products.find(product => product.id === custom.id).participation, 0.25);
    for (const participation of ['', 'invalid']) {
        writeSuggestiveSalesDraftCache(storage, scope, { draft: { ...legacyDraft, participation }, dirty: true, revision: 2 });
        assert.equal(readSuggestiveSalesDraftCache(storage, scope).draft.products.find(product => product.id === custom.id).participation, 0.30);
    }
    writeSuggestiveSalesDraftCache(storage, scope, { draft: { ...legacyDraft,
        products: [{ ...legacyCustom, participation: '' }] }, dirty: true, revision: 3 });
    assert.equal(readSuggestiveSalesDraftCache(storage, scope).draft.products.find(product => product.id === custom.id).participation, '');
});

test('guardar conserva la misma configuración para la tienda y el mes sin depender del reporte importado', async () => {
    const writes = new Map();
    const draft = buildSuggestiveSalesDraft(settings);
    const configuration = serializeSuggestiveSalesConfiguration(draft);
    const result = await saveSuggestiveSalesConfiguration({ month: scope.month, configuration,
        write: async (key, value) => { writes.set(key, value); } });
    assert.deepEqual(result.savedKeys, ['suggestive_sales_goals:defaults', 'suggestive_sales_goals:2026-10']);
    assert.deepEqual(writes.get(result.savedKeys[0]), configuration);
    assert.deepEqual(writes.get(result.savedKeys[1]), configuration);
    configuration.products[0].price = 100;
    assert.equal(writes.get(result.savedKeys[0]).products[0].price, 8);
    const reloaded = await loadSuggestiveSalesConfiguration({ month: '2026-11', read: async key => writes.get(key) });
    assert.equal(reloaded.products[0].price, 8);
});

test('errores de lectura no se convierten en una configuración vacía para guardar', async () => {
    await assert.rejects(loadSuggestiveSalesConfiguration({ month: scope.month,
        read: async () => { throw new Error('Sin conexión'); } }), /Sin conexión/);
    assert.throws(() => suggestiveSalesConfigurationKeys('2026-13'), /mes válido/);
});

test('fallos de uno o ambos guardados se propagan con claves parciales y el borrador queda intacto', async () => {
    const configuration = serializeSuggestiveSalesConfiguration(buildSuggestiveSalesDraft(settings));
    const before = structuredClone(configuration);
    for (const failureCount of [1, 2]) {
        let writes = 0;
        await assert.rejects(saveSuggestiveSalesConfiguration({ month: scope.month, configuration, write: async () => {
            writes++;
            if (writes <= failureCount) throw new Error('Sin conexión');
        } }), error => error.failedKeys.length === failureCount && error.savedKeys.length === 2 - failureCount
            && /borrador/.test(error.message));
        assert.equal(writes, 2);
        assert.deepEqual(configuration, before);
    }
});

test('cache restaura inmediatamente cambios pendientes, incluidos campos vacíos y catálogo protegido', () => {
    const storage = memoryStorage();
    const draft = buildSuggestiveSalesDraft(settings);
    draft.products[0].participation = '';
    draft.products[0].price = '';
    writeSuggestiveSalesDraftCache(storage, scope, { draft, dirty: true, revision: 4 });
    const recovered = readSuggestiveSalesDraftCache(storage, scope);
    assert.deepEqual(recovered.draft, draft);
    assert.equal(recovered.dirty, true);
    assert.equal(recovered.revision, 4);
    writeSuggestiveSalesDraftCache(storage, scope, { draft: { ...draft, products: [] }, dirty: true, revision: 5 });
    assert.equal(readSuggestiveSalesDraftCache(storage, scope).draft.products.length, 5);
});

test('cache separa usuario, tienda y mes y descarta envelopes ajenos o dañados', () => {
    const storage = memoryStorage();
    const draft = buildSuggestiveSalesDraft(settings);
    writeSuggestiveSalesDraftCache(storage, scope, { draft, dirty: true, revision: 1 });
    for (const other of [{ ...scope, userId: 'user-b' }, { ...scope, storeId: 'store-b' }, { ...scope, month: '2026-11' }]) {
        assert.equal(readSuggestiveSalesDraftCache(storage, other), null);
        assert.notEqual(suggestiveSalesDraftCacheKey(scope), suggestiveSalesDraftCacheKey(other));
    }
    storage.setItem(suggestiveSalesDraftCacheKey(scope), JSON.stringify({ version: 1, scope: { ...scope, userId: 'user-b' }, draft }));
    assert.equal(readSuggestiveSalesDraftCache(storage, scope), null);
    storage.setItem(suggestiveSalesDraftCacheKey(scope), '{broken');
    assert.equal(readSuggestiveSalesDraftCache(storage, scope), null);
});

test('un error al proteger cache es visible y no se presenta como guardado exitoso', () => {
    const storage = { setItem() { throw new Error('Quota exceeded'); } };
    assert.throws(() => writeSuggestiveSalesDraftCache(storage, scope, { draft: buildSuggestiveSalesDraft(), dirty: true, revision: 1 }), /No se pudo proteger/);
    assert.equal(writeSuggestiveSalesDraftCache(storage, { ...scope, userId: '' }, { draft: {}, dirty: true, revision: 1 }), false);
});

test('una carga atrasada no pisa cambios pendientes ni la tienda o el mes actual', () => {
    const request = { requestScope: scope, activeScope: scope, requestRevision: 1, currentRevision: 1, dirty: false };
    assert.equal(canApplySuggestiveSalesConfigurationLoad(request), true);
    assert.equal(canApplySuggestiveSalesConfigurationLoad({ ...request, dirty: true }), false);
    assert.equal(canApplySuggestiveSalesConfigurationLoad({ ...request, currentRevision: 2 }), false);
    assert.equal(canApplySuggestiveSalesConfigurationLoad({ ...request, activeScope: { ...scope, month: '2026-11' } }), false);
    assert.equal(canApplySuggestiveSalesConfigurationLoad({ ...request, activeScope: { ...scope, userId: 'user-b' } }), false);
    assert.equal(canApplySuggestiveSalesConfigurationLoad({ ...request, activeScope: { ...scope, storeId: 'store-b' } }), false);
});
