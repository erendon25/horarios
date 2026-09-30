import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHolidayLedger, holidayMovementLabel, readHolidayLedger } from './holidayBalance.js';

test('suma movimientos, excluye boleta y descuenta compensaciones sin duplicar saldo antiguo', () => {
  const rows = [
    { balance_type: 'ganado', payment_method: 'descanso', balance_delta: 1 },
    { balance_type: 'ganado', payment_method: 'descanso', balance_delta: 1 },
    { balance_type: 'ganado', payment_method: 'boleta', balance_delta: 0 },
    { balance_type: 'compensado', payment_method: 'descanso', balance_delta: -1 },
    { balance_type: 'ganado', payment_method: 'descanso', balance_delta: 0, is_future: true },
  ];
  assert.deepEqual(summarizeHolidayLedger(rows), { balance: 1, earned: 2, compensated: 1, payroll: 1, scheduled: 1 });
});
test('no oculta balances negativos ni confunde destino a boleta con pago realizado', () => {
  assert.equal(summarizeHolidayLedger([{ balance_type: 'compensado', balance_delta: -1 }]).balance, -1);
  assert.equal(holidayMovementLabel({ balance_type: 'ganado', payment_method: 'boleta' }), 'Destinado a boleta');
  assert.equal(holidayMovementLabel({ is_future: true, payment_method: 'boleta' }), 'Programado · boleta');
  assert.equal(summarizeHolidayLedger([]).balance, 0);
});
test('lee todas las páginas con filtros de persona/tienda y ordena el historial', async () => {
  const calls = [];
  const rows = Array.from({ length: 501 }, (_, id) => ({ id, holiday_date: id === 500 ? '2026-08-30' : '2026-07-28' }));
  const client = { from: table => {
    const call = { table, filters: [] }; calls.push(call);
    const query = { select() { return this; }, order() { return this; }, range(a, b) { call.range = [a, b]; return this; }, eq(...filter) { call.filters.push(filter); return this; }, then(resolve) { return Promise.resolve({ data: rows.slice(call.range[0], call.range[1] + 1), error: null }).then(resolve); } };
    return query;
  } };
  const result = await readHolidayLedger(client, { staffId: 'person', storeId: 'store' });
  assert.equal(result.length, 501);
  assert.equal(result[0].id, 500);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].filters, [['staff_id', 'person'], ['store_id', 'store']]);
});
test('un error no se transforma en saldo cero y exige contexto de lectura', async () => {
  await assert.rejects(readHolidayLedger({}, {}), /Falta identificar/);
  const query = { select() { return this; }, order() { return this; }, range() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: null, error: new Error('No permission') }).then(resolve); } };
  await assert.rejects(readHolidayLedger({ from: () => query }, { staffId: 'person' }), /No permission/);
});
