import assert from 'node:assert/strict';
import test from 'node:test';
import { getProjectionDepartment, summarizeProjectionStaffGroups as summarize } from './projectionStaffGroups.js';

test('producción y servicio usan el grupo elegido, independientemente del nombre o lógica', () => {
  const positions = [
    { id: 'a', name: 'Salón', logic: 'service', department: 'production' },
    { id: 'b', name: 'Horno', logic: 'sales', department: 'service' },
    { id: 'c', name: 'Fijo', logic: 'fixed', department: 'production' },
  ];
  assert.deepEqual(summarize(positions, { a: 2, b: 3, c: 1 }), { production: 3, service: 3, unclassified: 0, total: 6 });
});

test('áreas antiguas y valores no reconocidos quedan sin clasificar y permanecen en el total', () => {
  const positions = [{ id: 'a' }, { id: 'b', department: '' }, { id: 'c', department: 'otro' }];
  assert.deepEqual(summarize(positions, { a: 2, b: 3, c: 4 }), { production: 0, service: 0, unclassified: 9, total: 9 });
  for (const value of [null, undefined, '', 'otro', 'sales', 'fixed']) assert.equal(getProjectionDepartment(value), null);
});

test('reclasificar un área mueve su subtotal sin cambiar el total ni las asignaciones', () => {
  const positions = [{ id: 'a', department: 'production' }, { id: 'b', department: 'service' }];
  const counts = { a: 4, b: 2 };
  const original = structuredClone(counts);
  const before = summarize(positions, counts);
  const after = summarize(positions.map(position => ({ ...position, department: 'service' })), counts);
  assert.equal(before.total, after.total);
  assert.deepEqual(after, { production: 0, service: 6, unclassified: 0, total: 6 });
  assert.deepEqual(counts, original);
});

test('cada hora se suma por separado, sin duplicar áreas y conservando cantidades decimales', () => {
  const positions = [{ id: 'a', department: 'production' }, { id: 'a', department: 'production' }, { id: 'b', department: 'service' }];
  assert.deepEqual(summarize(positions, { a: 2.5, b: 1 }), { production: 2.5, service: 1, unclassified: 0, total: 3.5 });
  assert.deepEqual(summarize(positions, { a: 0, b: 3 }), { production: 0, service: 3, unclassified: 0, total: 3 });
  assert.deepEqual(summarize([], { old: 2 }), { production: 0, service: 0, unclassified: 2, total: 2 });
  assert.deepEqual(summarize([], {}), { production: 0, service: 0, unclassified: 0, total: 0 });
});
