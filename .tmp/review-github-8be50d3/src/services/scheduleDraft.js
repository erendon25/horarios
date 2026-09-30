// Local drafts are scoped to an account, store and week. Only edited days are
// persisted; loading the server is never a write to the draft.
export const DRAFT_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const scheduleDraftKey = ({ userId, storeId, weekKey }) =>
    `schedule_draft_v2:${encodeURIComponent(userId)}:${encodeURIComponent(storeId)}:${encodeURIComponent(weekKey)}`;

const mergeDays = (base, changes) => {
    const result = { ...base };
    for (const [id, days] of Object.entries(changes)) result[id] = { ...result[id], ...days };
    return result;
};

function validChanges(changes) {
    return isObject(changes) && Object.values(changes).every(days => isObject(days)
        && Object.entries(days).every(([day, value]) => DRAFT_DAYS.includes(day) && isObject(value)));
}

export function createScheduleDraft(scope, getStorage = () => window.localStorage) {
    const key = scheduleDraftKey(scope);
    const enabled = Boolean(scope.userId && scope.storeId && scope.weekKey);
    const listeners = new Set();
    let base = {};
    let changes = {};
    // A completed save must also win over an older in-flight server response.
    let sessionOverrides = {};
    let hasScopedDraft = false;
    let state = { schedules: {}, dirtyStaff: new Set(), ready: false, updatedAt: null,
        recovered: false, persistenceError: '', loadError: '', legacyChanges: {} };

    function parse(raw) {
        const data = JSON.parse(raw);
        if (data?.version !== 2 || data.userId !== scope.userId || data.storeId !== scope.storeId
            || data.weekKey !== scope.weekKey || !validChanges(data.changes)) throw new Error('Invalid draft');
        return data;
    }
    if (enabled) {
        try {
            const storage = getStorage();
            const raw = storage.getItem(key);
            hasScopedDraft = raw !== null;
            let restored;
            if (raw !== null) {
                try { restored = parse(raw); }
                catch {
                    const backup = storage.getItem(`${key}:backup`);
                    if (!backup) throw new Error('Invalid draft');
                    restored = parse(backup);
                    state.persistenceError = 'Se recuperó la copia de respaldo porque el borrador principal no se pudo leer. Revisa los horarios antes de guardar.';
                }
            }
            if (restored) {
                changes = restored.changes;
                state.updatedAt = restored.updatedAt;
                state.recovered = Object.keys(changes).length > 0;
            }
        } catch {
            state.persistenceError = 'No se pudo leer el borrador local. No borres los datos del navegador; conserva una copia en Excel antes de salir.';
        }
    }
    state = { ...state, schedules: mergeDays(base, changes), dirtyStaff: new Set(Object.keys(changes)) };

    function emit(patch = {}) {
        state = { ...state, ...patch, schedules: mergeDays(mergeDays(base, sessionOverrides), changes),
            dirtyStaff: new Set(Object.keys(changes)) };
        listeners.forEach(listener => listener());
    }
    function persist() {
        try {
            const storage = getStorage();
            const previous = storage.getItem(key);
            // Keep a second copy, but never back up malformed content or let a
            // full backup quota prevent writing the primary draft.
            if (previous) {
                try { parse(previous); storage.setItem(`${key}:backup`, previous); } catch { /* best effort */ }
            }
            const updatedAt = new Date().toISOString();
            storage.setItem(key, JSON.stringify({ version: 2, ...scope, updatedAt, changes }));
            hasScopedDraft = true;
            return { updatedAt, persistenceError: '' };
        } catch {
            return { persistenceError: 'No se pudo proteger el último cambio en este navegador. No actualices ni cierres la página: guarda en el servidor o descarga un Excel de respaldo.' };
        }
    }
    return {
        key,
        getSnapshot: () => state,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        hydrate(remote, allowedStaffIds = Object.keys(remote)) {
            if (!enabled) return;
            base = remote;
            const legacyChanges = {};
            if (!hasScopedDraft) {
                try {
                    const legacy = JSON.parse(getStorage().getItem(`draft_schedule_${scope.weekKey}`));
                    // The old format had no account/store namespace. Never apply
                    // it automatically or expose staff outside this loaded store.
                    for (const id of allowedStaffIds) {
                        const schedule = legacy?.[id];
                        if (!isObject(schedule) || (schedule.storeId && schedule.storeId !== scope.storeId)) continue;
                        for (const day of DRAFT_DAYS) {
                            if (isObject(schedule[day]) && !equal(schedule[day], remote[id]?.[day])) {
                                legacyChanges[id] = { ...legacyChanges[id], [day]: schedule[day] };
                            }
                        }
                    }
                } catch { /* Leave the original legacy key untouched for recovery. */ }
            }
            emit({ ready: true, loadError: '', legacyChanges });
        },
        failLoad() {
            emit({ loadError: 'No se pudo completar la carga del servidor. Tu borrador se conserva; reintenta antes de guardar.', ready: false });
        },
        edit(producer) {
            if (!enabled) return;
            const current = state.schedules;
            const next = producer(current);
            let edited = false;
            for (const [id, schedule] of Object.entries(next)) {
                for (const day of DRAFT_DAYS) {
                    if (isObject(schedule[day]) && !equal(schedule[day], current[id]?.[day])) {
                        changes = { ...changes, [id]: { ...changes[id], [day]: clone(schedule[day]) } };
                        edited = true;
                    }
                }
            }
            // Synchronous storage inside the user action, not a delayed effect.
            if (edited) emit(persist());
        },
        restoreLegacy() {
            // Current edits always take precedence over an explicitly recovered
            // legacy copy. Keep that original file in storage for inspection.
            changes = mergeDays(state.legacyChanges, changes);
            emit({ ...persist(), recovered: true, legacyChanges: {} });
        },
        beginSave() {
            if (!state.ready) return null;
            return { changes: clone(changes), schedules: clone(Object.fromEntries(
                Object.keys(changes).map(id => [id, state.schedules[id]])
            )) };
        },
        acknowledgeSave(saved) {
            base = { ...base, ...saved.schedules };
            sessionOverrides = mergeDays(sessionOverrides, saved.changes);
            const remaining = clone(changes);
            for (const [id, days] of Object.entries(saved.changes)) {
                for (const [day, value] of Object.entries(days)) {
                    if (equal(remaining[id]?.[day], value)) delete remaining[id][day];
                }
                if (remaining[id] && Object.keys(remaining[id]).length === 0) delete remaining[id];
            }
            changes = remaining;
            // An empty envelope is intentional: it prevents an old backup or
            // unscoped legacy draft from reappearing after a successful save.
            emit({ ...persist(), recovered: false, legacyChanges: {} });
        },
    };
}
