import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Ejecutar con node --experimental-vm-modules --test. Se prueba la capa real
// con un cliente aislado, sin crear solicitudes en la base de producción.
async function loadCompat(client) {
  const context = vm.createContext({ crypto: globalThis.crypto });
  const source = await readFile(new URL('./firestoreCompat.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => {
    if (specifier === './client') {
      return new vm.SyntheticModule(['supabase'], function () {
        this.setExport('supabase', client);
      }, { context });
    }
    if (specifier === './salesHistoryCompat') {
      return new vm.SyntheticModule(['mapSalesHistoryRow', 'salesHistoryDayPayload'], function () {
        this.setExport('mapSalesHistoryRow', () => {});
        this.setExport('salesHistoryDayPayload', () => {});
      }, { context });
    }
    throw new Error(`Import no esperado: ${specifier}`);
  });
  await module.evaluate();
  return module.namespace;
}

const request = {
  uid: '11111111-1111-4111-8111-111111111111',
  staffId: '22222222-2222-4222-8222-222222222222',
  storeId: '33333333-3333-4333-8333-333333333333',
  date: '2026-09-19', shiftType: 'apertura',
  startTime: null, endTime: null, reason: 'Prueba aislada', status: 'pending',
};

test('crea solicitudes sin identificador externo ni fecha del dispositivo y devuelve el ID nativo', async () => {
  let inserted;
  const compat = await loadCompat({
    from(table) {
      assert.equal(table, 'schedule_requests');
      return { insert(columns) {
        inserted = JSON.parse(JSON.stringify(columns));
        return { select(fields) {
          assert.equal(fields, 'id');
          return { single: async () => ({ data: { id: 42 }, error: null }) };
        } };
      } };
    },
  });
  const ref = await compat.addDoc(compat.collection(compat.db, 'schedule_requests'), {
    ...request, createdAt: compat.serverTimestamp(),
  });
  assert.equal(ref.path, 'schedule_requests/42');
  assert.deepEqual(inserted, {
    user_id: request.uid, staff_id: request.staffId, store_id: request.storeId,
    requested_date: request.date, shift_type: 'apertura', start_time: null,
    end_time: null, reason: request.reason, status: 'pending',
  });
});

test('resuelve el ID legado de Firebase antes de insertar una solicitud', async () => {
  const legacyStaffId = 'fNp7A5HOKb5UwnyqbBLQ';
  const nativeProfile = {
    id: request.staffId,
    user_id: request.uid,
    store_id: request.storeId,
  };
  let inserted;
  const compat = await loadCompat({
    from(table) {
      if (table === 'staff_profiles') {
        return { select(fields) {
          assert.equal(fields, 'id,store_id,user_id');
          return { eq(column, value) {
            assert.equal(column, 'firestore_id');
            assert.equal(value, legacyStaffId);
            return { limit: async (amount) => {
              assert.equal(amount, 1);
              return { data: [nativeProfile], error: null };
            } };
          } };
        } };
      }
      assert.equal(table, 'schedule_requests');
      return { insert(columns) {
        inserted = JSON.parse(JSON.stringify(columns));
        return { select: () => ({ single: async () => ({ data: { id: 43 }, error: null }) }) };
      } };
    },
  });

  const ref = await compat.addDoc(compat.collection(compat.db, 'schedule_requests'), {
    ...request,
    staffId: legacyStaffId,
    storeId: '',
  });

  assert.equal(ref.path, 'schedule_requests/43');
  assert.equal(inserted.staff_id, nativeProfile.id);
  assert.equal(inserted.user_id, nativeProfile.user_id);
  assert.equal(inserted.store_id, nativeProfile.store_id);
});

test('propaga errores de permisos sin simular que la solicitud se guardó', async () => {
  const compat = await loadCompat({ from: () => ({ insert: () => ({
    select: () => ({ single: async () => ({
      data: null, error: { code: '42501', message: 'Solicitud no autorizada' },
    }) }),
  }) }) });
  await assert.rejects(
    compat.addDoc(compat.collection(compat.db, 'schedule_requests'), request),
    { message: 'Solicitud no autorizada', code: 'permission-denied' },
  );
});

test('convierte campos numéricos vacíos de ceses a cero antes de guardar', async () => {
  let upserted;
  const compat = await loadCompat({
    from(table) {
      assert.equal(table, 'cessations');
      return { upsert(columns, options) {
        upserted = JSON.parse(JSON.stringify(columns));
        assert.equal(options.onConflict, 'firestore_id');
        return { select: () => ({ single: async () => ({ data: { id: 51 }, error: null }) }) };
      } };
    },
  });

  await compat.setDoc(compat.doc(compat.db, 'ceses', 'legacy-cese'), {
    diasDescansoMedico: '',
    inasistencias: '',
    horasNocturnas: '',
    horasExtras: '',
    feriados: '',
    descuentos: '',
  });

  assert.deepEqual({
    medical_leave_days: upserted.medical_leave_days,
    absences: upserted.absences,
    night_hours: upserted.night_hours,
    extra_hours: upserted.extra_hours,
    holidays: upserted.holidays,
    discounts: upserted.discounts,
  }, {
    medical_leave_days: 0,
    absences: 0,
    night_hours: 0,
    extra_hours: 0,
    holidays: 0,
    discounts: 0,
  });
});

test('rechaza números negativos en el reporte de cese antes de llamar a la base', async () => {
  const compat = await loadCompat({ from() { throw new Error('No debía consultar la base'); } });
  await assert.rejects(
    compat.setDoc(compat.doc(compat.db, 'ceses', 'legacy-cese'), { descuentos: '-1' }),
    /descuentos debe ser un número mayor o igual a cero/,
  );
});

test('lee la fecha del servidor y conserva el ID nativo para revisar la solicitud', async () => {
  const createdAt = '2026-09-13T17:10:23+00:00';
  const compat = await loadCompat({ from: () => ({ select: async () => ({
    data: [{ id: 42, user_id: request.uid, staff_id: request.staffId,
      store_id: request.storeId, requested_date: request.date, shift_type: 'apertura',
      reason: request.reason, status: 'pending', created_at: createdAt,
      legacy_data: { createdAt: '2000-01-01' } }], error: null,
  }) }) });
  const snapshot = await compat.getDocs(compat.collection(compat.db, 'schedule_requests'));
  assert.equal(snapshot.docs[0].id, '42');
  assert.equal(snapshot.docs[0].data().createdAt, createdAt);
  assert.equal(snapshot.docs[0].data().date, request.date);
});

test('guarda y vuelve a leer participación por tienda y mes sin reemplazar otras configuraciones', async () => {
  const rows = [{ store_id: request.storeId, config_key: 'schedule_lock', value: { locked: true } }];
  const compat = await loadCompat({ from(table) {
    assert.equal(table, 'store_configs');
    return {
      upsert: async (row, options) => {
        assert.equal(options.onConflict, 'store_id,config_key');
        const saved = JSON.parse(JSON.stringify(row));
        const index = rows.findIndex((item) => item.store_id === saved.store_id && item.config_key === saved.config_key);
        if (index < 0) rows.push(saved);
        else rows[index] = saved;
        return { error: null };
      },
      select: () => ({ eq: async (key, value) => ({ data: rows.filter((row) => row[key] === value), error: null }) }),
    };
  } });
  const config = (month) => compat.doc(compat.db, 'stores', request.storeId, 'config', `suggestive_sales_goals:${month}`);
  await compat.setDoc(config('2026-09'), { participation: 0.35 });
  await compat.setDoc(config('2026-10'), { participation: 0.25 });
  assert.equal((await compat.getDoc(config('2026-09'))).data().participation, 0.35);
  assert.equal((await compat.getDoc(config('2026-10'))).data().participation, 0.25);
  await compat.setDoc(config('2026-09'), { participation: 0 });
  assert.equal((await compat.getDoc(config('2026-09'))).data().participation, 0);
  assert.equal(rows.find((row) => row.config_key === 'schedule_lock').value.locked, true);
});
