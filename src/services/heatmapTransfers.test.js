import test from 'node:test';
import assert from 'node:assert/strict';
import { getHeatmapAssignments, getPositionTimeline } from './scheduleExportData.js';
import { validateHeatmapTransfer, replacePositionInterval } from './heatmapTransfers.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { createScheduleDraft } from './scheduleDraft.js';

const staff = [{ id: 'a', name: 'Ana', modality: 'Full-Time' }, { id: 'b', name: 'Beto', modality: 'Full-Time' }];
const shift = { start: '09:00', end: '17:45', position: 'Caja', breakStart: '13:00' };
const schedules = { a: { monday: shift }, b: { monday: { ...shift, breakStart: '14:00' } } };
const requirements = { positions: ['Caja', 'Cocina', 'Despacho'], matrix: [Array(21).fill(1), Array(21).fill(1), Array(21).fill(1)] };
const assignments = data => getHeatmapAssignments(staff, data, 'monday', requirements.positions, '2026-09-28');
const move = { staffId: 'a', source: 'Caja', position: 'Cocina', start: 600, end: 720 };

test('agrupa tramos consecutivos del mismo puesto sin unirlos a través de breaks', () => {
  const fragmented = { ...shift, positionAssignments: Array.from({ length: 8 }, (_, index) => ({ start: 720 + index * 15, end: 735 + index * 15, position: 'Cocina' })) };
  assert.deepEqual(getPositionTimeline(fragmented, 'Full-Time').map(item => item.label), [
    '09:00-12:00 · Caja', '12:00-13:00 · Cocina', '13:45-14:00 · Cocina', '14:00-17:45 · Caja',
  ]);
  const cleared = { ...fragmented, positionAssignments: replacePositionInterval(fragmented, { start: 720, end: 780, position: 'Caja' }) };
  assert.equal(getPositionTimeline(cleared, 'Full-Time')[0].label, '09:00-13:00 · Caja');
  assert.equal(fragmented.positionAssignments.length, 8);
});

test('mueve solo el intervalo seleccionado, cubre el faltante y regresa sin doble conteo', () => {
  assert.equal(validateHeatmapTransfer(assignments(schedules), requirements, move), '');
  const updated = { ...shift, positionAssignments: replacePositionInterval(shift, move) };
  const rows = buildHeatmapRows(assignments({ ...schedules, a: { monday: updated } }), requirements);
  const color = (position, time) => rows.find(row => row.name === position).cells[HOURS.indexOf(time)].color;
  assert.equal(color('Cocina', '09:45'), 'bg-yellow-300');
  assert.equal(color('Cocina', '10:00'), 'bg-blue-500');
  assert.equal(color('Cocina', '11:45'), 'bg-blue-500');
  assert.equal(color('Cocina', '12:00'), 'bg-yellow-300');
  assert.equal(color('Caja', '10:00'), 'bg-blue-500');
  const excess = rows.find(row => row.name === 'Caja' && row.slot === 1);
  assert.equal(excess.cells[HOURS.indexOf('10:00')].color, 'bg-white');
  assert.equal(excess.cells[HOURS.indexOf('12:00')].color, 'bg-red-500');
});

test('rechaza intervalos con break, sin excedente, sin faltante o fuera del turno', () => {
  const current = assignments(schedules);
  assert.match(validateHeatmapTransfer(current, requirements, { ...move, end: 810 }), /disponible/);
  assert.match(validateHeatmapTransfer(current.filter(item => item.staffId === 'a'), requirements, move), /origen/);
  assert.match(validateHeatmapTransfer(current, { ...requirements, matrix: [Array(21).fill(1), Array(21).fill(0)] }, move), /destino/);
  assert.match(validateHeatmapTransfer(current, requirements, { ...move, start: 1050, end: 1080 }), /horario|disponible/);
});

test('permite encadenar destinos y terminar en otro puesto; sustituye sin solapes', () => {
  const first = { ...shift, breakStart: '', positionAssignments: replacePositionInterval(shift, move) };
  const second = { ...first, positionAssignments: replacePositionInterval(first, { ...move, position: 'Despacho', start: 720, end: 1065 }) };
  assert.deepEqual(getPositionTimeline(second, 'Full-Time').map(item => item.label), [
    '09:00-10:00 · Caja', '10:00-12:00 · Cocina', '12:00-17:45 · Despacho',
  ]);
  const restored = replacePositionInterval(second, { ...move, position: 'Caja', start: 690, end: 750 });
  assert.deepEqual(restored, [{ start: 600, end: 690, position: 'Cocina' }, { start: 750, end: 1065, position: 'Despacho' }]);
});

test('turnos nocturnos, partidos y break mantienen sus huecos', () => {
  const night = { start: '16:00', end: '01:00', position: 'Caja', breakStart: '23:45', positionAssignments: [{ start: 1440, end: 1500, position: 'Cocina' }] };
  assert.deepEqual(getPositionTimeline(night, 'Full-Time').map(item => item.label), ['16:00-23:45 · Caja', '24:30-25:00 · Cocina']);
  const split = { start: '09:00', end: '12:00', splitShift: true, start2: '16:00', end2: '20:00', position: 'Caja', positionAssignments: [{ start: 660, end: 1020, position: 'Cocina' }] };
  assert.deepEqual(getPositionTimeline(split, 'Full-Time').map(item => item.position), ['Caja', 'Caja']);
});

test('el borrador conserva cambios de puesto al recargar y al confirmar guardado', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const scope = { userId: 'admin', storeId: 'store', weekKey: '2026-09-28_to_2026-10-04' };
  const draft = createScheduleDraft(scope, () => storage);
  draft.hydrate(schedules);
  draft.edit(previous => ({ ...previous, a: { monday: { ...shift, positionAssignments: replacePositionInterval(shift, move) } } }));
  const reloaded = createScheduleDraft(scope, () => storage);
  reloaded.hydrate(schedules);
  assert.equal(reloaded.getSnapshot().schedules.a.monday.positionAssignments[0].position, 'Cocina');
  const saved = reloaded.beginSave();
  reloaded.acknowledgeSave(saved);
  assert.equal(reloaded.getSnapshot().schedules.a.monday.positionAssignments[0].start, 600);
});
