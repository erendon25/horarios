import { exactReportProductName } from './productMatching.js';

export const DEFAULT_SUGGESTIVE_PARTICIPATION = 0.30;

// Keep the literal report names separate. No inferred product families or aliases.
export const PROTECTED_SUGGESTIVE_PRODUCTS = Object.freeze([
    ['borderLto', 'LTO BORDE QUESO PEPPE'],
    ['borderYape', 'YAPE LTO BDQ PEPPE'],
    ['cheeseBorder', 'VS Borde de queso'],
    ['hazloCrazyV3', 'VS HAZLO CMB V3 CRAZY'],
    ['hazloCanelitasV3', 'VS HAZLO CMB V3 CANELITAS'],
].map(([id, reportName]) => Object.freeze({ id, label: reportName, reportName, price: '',
    participation: DEFAULT_SUGGESTIVE_PARTICIPATION, enabled: true, locked: true, default: true })));

/** An explicit empty/invalid target is incomplete; only an absent target uses the fallback. */
export function suggestiveProductParticipation(product, fallback = DEFAULT_SUGGESTIVE_PARTICIPATION) {
    const value = product?.participation === undefined ? fallback : product.participation;
    if (value === null || value === '' || typeof value === 'boolean' || typeof value === 'object'
        || typeof value === 'string' && !value.trim()) return null;
    const rate = Number(value);
    return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const savedName = product => exactReportProductName(product.reportName)
    || exactReportProductName(product.importName) || exactReportProductName(product.label);

/** Restore protected rows without losing saved prices, targets or additional product settings.
 * Match only the exact report name (NFC + trim) or the stable legacy/current id.
 */
export function mergeSuggestiveSalesDefaults(savedProducts = []) {
    const saved = (Array.isArray(savedProducts) ? savedProducts : []).filter(object);
    const matches = new Map(PROTECTED_SUGGESTIVE_PRODUCTS.map(product => [product.id, []]));
    const custom = new Map();
    saved.forEach((product, index) => {
        const name = savedName(product);
        const byName = PROTECTED_SUGGESTIVE_PRODUCTS.find(value => value.reportName === name);
        const byId = PROTECTED_SUGGESTIVE_PRODUCTS.find(value => value.id === product.id);
        const protectedProduct = byName || byId;
        if (protectedProduct) {
            matches.get(protectedProduct.id).push({ product, index,
                priority: product.id === protectedProduct.id ? 1 : 0 });
        } else {
            const key = name ? `name:${name}` : product.id ? `id:${product.id}` : `row:${index}`;
            custom.set(key, { ...product, locked: false, default: false });
        }
    });
    const defaults = PROTECTED_SUGGESTIVE_PRODUCTS.map(product => {
        const rows = matches.get(product.id).sort((left, right) => left.priority - right.priority || left.index - right.index);
        const saved = Object.assign({}, ...rows.map(row => Object.fromEntries(Object.entries(row.product)
            .filter(([, value]) => value !== undefined))));
        const merged = { ...product, ...saved, id: product.id, label: product.label, reportName: product.reportName,
            enabled: true, locked: true, default: true };
        // A legacy family list must not make a protected literal row match other products.
        delete merged.reportNames;
        return { ...merged, price: merged.price ?? '',
            participation: saved.participation === undefined ? product.participation : saved.participation };
    });
    return [...defaults, ...custom.values()];
}
