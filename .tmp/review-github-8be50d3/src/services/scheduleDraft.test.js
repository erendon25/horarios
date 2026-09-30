import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleDraft, scheduleDraftKey } from './scheduleDraft.js';

const scope = { userId: 'manager-1', storeId: 'store-1', weekKey: '2026-09-21_to_2026-09-27' };
const shift = start => ({ start, end: '19:00', position: 'Servicio', extraHoursPre: 1 });
const remote = { alice: { monday: shift('10:00'), saturday: shift('11:00') } };
const memory = () => {
    const data = new Map();
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};
const edit = (draft, day, value, id = 'alice') => draft.edit(current => ({ ...current, [id]: { ...current[id], [day]: value } }));

test('recarga inmediata conserva sábado y domingo, y el servidor no pisa el borrador', () => {
    const storage = memory();
    const first = createScheduleDraft(scope, () => storage);
    first.hydrate(remote);
    edit(first, 'saturday', shift('09:00'));
    edit(first, 'sunday', { ...shift('16:00'), end: '01:00', splitShift: true, start2: '04:00', end2: '06:00' });
    const raw = storage.getItem(first.key);
    const refreshed = createScheduleDraft(scope, () => storage);
    refreshed.hydrate(remote);
    assert.equal(refreshed.getSnapshot().schedules.alice.saturday.start, '09:00');
    assert.equal(refreshed.getSnapshot().schedules.alice.sunday.start2, '04:00');
    assert.deepEqual([...refreshed.getSnapshot().dirtyStaff], ['alice']);
    assert.equal(refreshed.getSnapshot().recovered, true);
    assert.equal(storage.getItem(first.key), raw, 'hidratar no escribe en localStorage');
    assert.equal(refreshed.beginSave().schedules.alice.monday.start, '10:00');
});

test('las ediciones antes de cargar no borran otros días del servidor', () => {
    const draft = createScheduleDraft(scope, memory);
    edit(draft, 'sunday', shift('16:00'));
    assert.equal(draft.beginSave(), null);
    draft.hydrate(remote);
    assert.equal(draft.getSnapshot().schedules.alice.monday.start, '10:00');
    assert.equal(draft.getSnapshot().schedules.alice.sunday.start, '16:00');
});

test('separa semanas, usuarios y tiendas y restaura al volver', () => {
    const storage = memory();
    const draft = createScheduleDraft(scope, () => storage);
    edit(draft, 'saturday', shift('09:00'));
    for (const variant of [{ userId: 'manager-2' }, { storeId: 'store-2' }, { weekKey: '2026-09-28_to_2026-10-04' }]) {
        const other = createScheduleDraft({ ...scope, ...variant }, () => storage);
        assert.equal(other.getSnapshot().dirtyStaff.size, 0);
        assert.deepEqual(other.getSnapshot().schedules, {});
    }
    assert.equal(createScheduleDraft(scope, () => storage).getSnapshot().schedules.alice.saturday.start, '09:00');
});

test('guardado confirma solo lo enviado y conserva ediciones realizadas durante la petición', () => {
    const storage = memory();
    const draft = createScheduleDraft(scope, () => storage);
    draft.hydrate(remote);
    edit(draft, 'saturday', shift('09:00'));
    const saving = draft.beginSave();
    edit(draft, 'saturday', shift('08:00'));
    edit(draft, 'sunday', { off: true, start: '', end: '', position: '' });
    draft.acknowledgeSave(saving);
    assert.equal(draft.getSnapshot().dirtyStaff.size, 1);
    const refreshed = createScheduleDraft(scope, () => storage);
    refreshed.hydrate(saving.schedules);
    assert.equal(refreshed.getSnapshot().schedules.alice.saturday.start, '08:00');
    assert.equal(refreshed.getSnapshot().schedules.alice.sunday.off, true);
});

test('un guardado exitoso no reaparece como pendiente ni revive legado', () => {
    const storage = memory();
    storage.setItem(`draft_schedule_${scope.weekKey}`, JSON.stringify(remote));
    const draft = createScheduleDraft(scope, () => storage);
    draft.hydrate(remote);
    edit(draft, 'saturday', shift('09:00'));
    const saved = draft.beginSave();
    draft.acknowledgeSave(saved);
    draft.hydrate(remote); // older request arriving late
    assert.equal(draft.getSnapshot().schedules.alice.saturday.start, '09:00');
    const refreshed = createScheduleDraft(scope, () => storage);
    refreshed.hydrate(saved.schedules);
    assert.equal(refreshed.getSnapshot().dirtyStaff.size, 0);
    assert.deepEqual(refreshed.getSnapshot().legacyChanges, {});
});

test('una petición fallida mantiene el borrador recuperable', () => {
    const storage = memory();
    const draft = createScheduleDraft(scope, () => storage);
    draft.hydrate(remote);
    edit(draft, 'saturday', shift('09:00'));
    draft.beginSave(); // simulated rejection: no acknowledgement
    draft.failLoad();
    assert.equal(draft.getSnapshot().ready, false);
    assert.ok(draft.getSnapshot().loadError);
    assert.equal(createScheduleDraft(scope, () => storage).getSnapshot().schedules.alice.saturday.start, '09:00');
});

test('detecta almacenamiento bloqueado o lleno sin perder el estado en memoria', () => {
    const storage = memory();
    storage.setItem = () => { throw new Error('QuotaExceeded'); };
    const draft = createScheduleDraft(scope, () => storage);
    draft.hydrate(remote);
    edit(draft, 'saturday', shift('09:00'));
    assert.ok(draft.getSnapshot().persistenceError);
    assert.equal(draft.getSnapshot().updatedAt, null);
    assert.equal(draft.getSnapshot().schedules.alice.saturday.start, '09:00');
    const blocked = createScheduleDraft(scope, () => { throw new Error('SecurityError'); });
    assert.ok(blocked.getSnapshot().persistenceError);
});

test('recupera respaldo si el principal está corrupto y no toca la copia original al cargar', () => {
    const storage = memory();
    const draft = createScheduleDraft(scope, () => storage);
    edit(draft, 'saturday', shift('09:00'));
    edit(draft, 'sunday', shift('16:00'));
    storage.setItem(draft.key, '{bad');
    const restored = createScheduleDraft(scope, () => storage);
    assert.equal(restored.getSnapshot().schedules.alice.saturday.start, '09:00');
    assert.ok(restored.getSnapshot().persistenceError);
    assert.equal(storage.getItem(draft.key), '{bad');
});

test('legado se ofrece solo para personal autorizado y requiere recuperación explícita', () => {
    const storage = memory();
    const original = JSON.stringify({ alice: { saturday: shift('09:00'), sunday: shift('16:00') }, outsider: { saturday: shift('07:00') }, foreignStore: { storeId: 'store-2', saturday: shift('07:00') } });
    storage.setItem(`draft_schedule_${scope.weekKey}`, original);
    const draft = createScheduleDraft(scope, () => storage);
    draft.hydrate(remote, ['alice', 'foreignStore']);
    assert.equal(draft.getSnapshot().schedules.alice.saturday.start, '11:00');
    assert.deepEqual(Object.keys(draft.getSnapshot().legacyChanges), ['alice']);
    edit(draft, 'saturday', shift('08:00'));
    draft.restoreLegacy();
    assert.equal(draft.getSnapshot().schedules.alice.saturday.start, '08:00');
    assert.equal(draft.getSnapshot().schedules.alice.sunday.start, '16:00');
    assert.equal(draft.getSnapshot().dirtyStaff.size, 1);
    assert.equal(storage.getItem(`draft_schedule_${scope.weekKey}`), original);
});

test('generación y replicación masivas guardan todos los días cambiados sin mutar el servidor', () => {
    const storage = memory();
    const draft = createScheduleDraft(scope, () => storage);
    draft.hydrate(remote);
    draft.edit(current => ({ ...current, alice: { ...current.alice, sunday: shift('16:00') }, bob: { saturday: shift('09:00'), sunday: { off: true } } }));
    assert.deepEqual([...draft.getSnapshot().dirtyStaff].sort(), ['alice', 'bob']);
    assert.equal(remote.alice.sunday, undefined);
    const refreshed = createScheduleDraft(scope, () => storage);
    assert.equal(refreshed.getSnapshot().schedules.bob.sunday.off, true);
});

test('no escribe carga limpia ni acepta un sobre que pertenece a otra cuenta', () => {
    const storage = memory();
    const draft = createScheduleDraft(scope, () => storage);
    draft.hydrate(remote);
    assert.equal(storage.getItem(draft.key), null);
    storage.setItem(scheduleDraftKey(scope), JSON.stringify({ version: 2, ...scope, userId: 'other', changes: { alice: { saturday: shift('09:00') } } }));
    const wrong = createScheduleDraft(scope, () => storage);
    assert.equal(wrong.getSnapshot().dirtyStaff.size, 0);
    assert.ok(wrong.getSnapshot().persistenceError);
});
