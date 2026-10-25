import assert from 'node:assert/strict';
import test from 'node:test';
import { getProjectionStaffColor as color } from './projectionStaffColor.js';

test('el color avanza desde dos personas y llega a rojo en el límite propio de cada área', () => {
  const area = { logic: 'sales', maxStaff: 5 };
  assert.equal(color(0, area).level, 'empty');
  assert.equal(color(1, area).level, 'base');
  const intermediate = [2, 3, 4].map(count => color(count, area));
  assert.ok(intermediate.every(value => value.level === 'progress'));
  assert.equal(new Set(intermediate.map(value => value.style.backgroundColor)).size, 3);
  assert.equal(color(5, area).level, 'limit');
  assert.deepEqual(color(6, area).style, color(5, area).style);
  assert.equal(color(3, { logic: 'service', maxStaff: 3 }).level, 'limit');
  assert.equal(color(3, { logic: 'service', maxStaff: 8 }).level, 'progress');
  assert.notDeepEqual(color(4, area).style, color(4, { ...area, maxStaff: 8 }).style);
});

test('límites pequeños y cero se señalan sin crear divisiones inválidas', () => {
  for (const limit of [0, 1, 2]) {
    assert.equal(color(0, { maxStaff: limit }).level, 'empty');
    assert.equal(color(Math.max(1, limit), { maxStaff: limit }).level, 'limit');
    assert.ok(!JSON.stringify(color(2, { maxStaff: limit })).includes('NaN'));
  }
});

test('sin límite no hay un umbral rojo arbitrario de tres personas', () => {
  for (const limit of ['', ' ', null, undefined, -1, 'incorrecto', Infinity]) {
    const result = color(3, { logic: 'driver', maxStaff: limit });
    assert.equal(result.level, 'unbounded');
    assert.equal(result.limit, null);
    assert.match(result.description, /Sin límite/);
  }
});

test('el personal fijo usa su cantidad configurada y admite valores guardados como texto', () => {
  assert.equal(color('2', { logic: 'fixed', fixedStaff: '4', maxStaff: 1 }).level, 'progress');
  assert.equal(color('4', { logic: 'fixed', fixedStaff: '4', maxStaff: 10 }).level, 'limit');
  assert.equal(color('2', { logic: 'sales', maxStaff: '2' }).level, 'limit');
  assert.equal(color(-1, { maxStaff: 5 }).level, 'empty');
  assert.equal(color('incorrecto', { maxStaff: 5 }).level, 'empty');
});
