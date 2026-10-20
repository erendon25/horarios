import { exactReportProductName } from './productMatching.js';
import { suggestiveChannelSettings } from './suggestiveChannels.js';
import { mergeSuggestiveSalesDefaults } from './suggestiveSalesDefaults.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const validParticipation = value => value !== '' && value !== null && value !== undefined
    && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
const validMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '');
const clone = value => JSON.parse(JSON.stringify(value));

export function suggestiveSalesConfigurationKeys(month) {
    if (!validMonth(month)) throw new Error('Selecciona un mes válido para la configuración.');
    return { defaults: 'suggestive_sales_goals:defaults', month: `suggestive_sales_goals:${month}` };
}

export function resolveSuggestiveSalesConfiguration({ defaultConfiguration, monthConfiguration } = {}) {
    const defaults = object(defaultConfiguration), monthly = object(monthConfiguration);
    const participation = validParticipation(monthly.participation) ? Number(monthly.participation)
        : validParticipation(defaults.participation) ? Number(defaults.participation) : 0.30;
    return { ...defaults, ...monthly, calculationVersion: 'revenue-v1', participation,
        // Each saved list is a complete selection. An empty list records the
        // user's deletion and must not inherit products from another month.
        products: mergeSuggestiveSalesDefaults(Array.isArray(monthly.products) ? monthly.products
            : Array.isArray(defaults.products) ? defaults.products : undefined),
        channels: suggestiveChannelSettings(Array.isArray(monthly.channels) && monthly.channels.length
            ? monthly.channels : defaults.channels), unitTargets: null };
}

export function buildSuggestiveSalesDraft(configuration) {
    const saved = resolveSuggestiveSalesConfiguration({ monthConfiguration: configuration });
    return { participation: String(saved.participation * 100),
        products: saved.products.map(product => ({ ...product, price: product.price ?? '',
            participation: product.participation === undefined ? saved.participation : product.participation,
            label: exactReportProductName(product.reportName) || product.label || '',
            reportName: exactReportProductName(product.reportName) })), channels: saved.channels };
}

export function serializeSuggestiveSalesConfiguration(draft) {
    return { calculationVersion: 'revenue-v1', participation: Number(draft.participation) / 100,
        products: mergeSuggestiveSalesDefaults(draft.products).map(product => ({ ...product,
            reportName: exactReportProductName(product.reportName),
            price: product.price === '' ? '' : Number(product.price),
            ...(product.participation !== undefined ? { participation: product.participation === '' ? '' : Number(product.participation) } : {}) })),
        channels: suggestiveChannelSettings(draft.channels), unitTargets: null };
}

// The callbacks keep this module independent from the database adapter. Both
// documents use the existing store_configs JSON value; no schema change is needed.
export async function loadSuggestiveSalesConfiguration({ month, read }) {
    const keys = suggestiveSalesConfigurationKeys(month);
    const [defaultConfiguration, monthConfiguration] = await Promise.all([read(keys.defaults), read(keys.month)]);
    return resolveSuggestiveSalesConfiguration({ defaultConfiguration, monthConfiguration });
}

export async function saveSuggestiveSalesConfiguration({ month, configuration, write }) {
    const keys = Object.values(suggestiveSalesConfigurationKeys(month));
    // A callback may queue writes. Snapshot now so subsequent typing cannot
    // mutate an in-flight save or either of its two document payloads.
    const snapshot = clone(configuration);
    const results = await Promise.allSettled(keys.map(key => Promise.resolve().then(() => write(key, clone(snapshot)))));
    const savedKeys = keys.filter((_key, index) => results[index].status === 'fulfilled');
    const failedKeys = keys.filter((_key, index) => results[index].status === 'rejected');
    if (failedKeys.length) {
        const failure = new Error('No se pudo guardar toda la configuración. Tus cambios siguen en el borrador; vuelve a intentarlo.',
            { cause: results.find(result => result.status === 'rejected').reason });
        failure.savedKeys = savedKeys;
        failure.failedKeys = failedKeys;
        throw failure;
    }
    return { savedKeys };
}

const validScope = scope => Boolean(scope?.userId && scope?.storeId && validMonth(scope?.month));
export const suggestiveSalesDraftCacheKey = scope => `suggestive_sales_draft_v1:${encodeURIComponent(scope?.userId || '')}:${encodeURIComponent(scope?.storeId || '')}:${encodeURIComponent(scope?.month || '')}`;
const sameScope = (left, right) => validScope(left) && validScope(right)
    && left.userId === right.userId && left.storeId === right.storeId && left.month === right.month;

export function readSuggestiveSalesDraftCache(storage, scope) {
    if (!storage || !validScope(scope)) return null;
    try {
        const saved = JSON.parse(storage.getItem(suggestiveSalesDraftCacheKey(scope)));
        if (saved?.version !== 1 || !sameScope(saved.scope, scope) || !saved.draft
            || !Array.isArray(saved.draft.products) || !Array.isArray(saved.draft.channels)) return null;
        const draft = clone(saved.draft);
        // Keep the complete local selection, including intentional deletions
        // and unfinished fields, until the user finishes editing.
        const participation = String(draft.participation ?? '').trim() !== '' && validParticipation(Number(draft.participation) / 100)
            ? Number(draft.participation) / 100 : 0.30;
        draft.products = mergeSuggestiveSalesDefaults(draft.products).map(product => ({ ...product,
            participation: product.participation === undefined ? participation : product.participation }));
        draft.channels = suggestiveChannelSettings(draft.channels);
        return { draft, dirty: saved.dirty === true, revision: Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0,
            updatedAt: saved.updatedAt || null };
    } catch { return null; }
}

export function writeSuggestiveSalesDraftCache(storage, scope, { draft, dirty, revision }) {
    if (!storage || !validScope(scope)) return false;
    try {
        storage.setItem(suggestiveSalesDraftCacheKey(scope), JSON.stringify({ version: 1,
            scope: { userId: scope.userId, storeId: scope.storeId, month: scope.month },
            draft, dirty: Boolean(dirty), revision, updatedAt: new Date().toISOString() }));
        return true;
    } catch (cause) {
        throw new Error('No se pudo proteger el borrador en este navegador. Conserva la página abierta y reintenta guardar.', { cause });
    }
}

export function canApplySuggestiveSalesConfigurationLoad({ requestScope, activeScope, requestRevision, currentRevision, dirty }) {
    return !dirty && sameScope(requestScope, activeScope) && requestRevision === currentRevision;
}
