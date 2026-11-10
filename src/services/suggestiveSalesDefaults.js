import { exactReportProductName } from './productMatching.js';

export const DEFAULT_SUGGESTIVE_PARTICIPATION = 0.30;

// Keep the literal report names separate. No inferred product families or aliases.
export const INITIAL_SUGGESTIVE_PRODUCTS = Object.freeze([
    ['borderLto', 'LTO BORDE QUESO PEPPE'],
    ['borderYape', 'YAPE LTO BDQ PEPPE'],
    ['cheeseBorder', 'VS Borde de queso'],
    ['hazloCrazyV3', 'VS HAZLO CMB V3 CRAZY'],
    ['hazloCanelitasV3', 'VS HAZLO CMB V3 CANELITAS'],
].map(([id, reportName]) => Object.freeze({ id, label: reportName, reportName, price: '',
    participation: DEFAULT_SUGGESTIVE_PARTICIPATION, enabled: true, locked: false, default: true })));

// Compatibility for existing consumers; these are editable starting suggestions.
export const PROTECTED_SUGGESTIVE_PRODUCTS = INITIAL_SUGGESTIVE_PRODUCTS;

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

/** An explicit array is the complete catalogue, including an intentionally empty one.
 * Only the absence of a catalogue initializes suggestions; removed rows stay removed.
 */
export function mergeSuggestiveSalesDefaults(savedProducts) {
    if (savedProducts === undefined || savedProducts === null) return INITIAL_SUGGESTIVE_PRODUCTS.map(product => ({ ...product }));
    if (!Array.isArray(savedProducts)) return [];
    return savedProducts.filter(object).map(product => {
        const wasInitial = product.default === true || INITIAL_SUGGESTIVE_PRODUCTS.some(initial =>
            initial.id === product.id || initial.reportName === savedName(product));
        const editable = { ...product, locked: false,
            ...(wasInitial && product.participation === undefined ? { participation: DEFAULT_SUGGESTIVE_PARTICIPATION } : {}) };
        // The single-name editor must not retain an invisible former family.
        if (wasInitial) delete editable.reportNames;
        return editable;
    });
}
