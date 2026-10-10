import test from 'node:test';
import assert from 'node:assert/strict';
import { getScheduleBreak, getScheduleBreakOptions, scheduleBreakLabel, calculateScheduleDay } from './scheduleHours.js';
import { getHeatmapAssignments } from './scheduleExportData.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';

const shift = { start: '09:00', end: '17:45', breakStart: '13:00', position: 'Caja' };
test('solo turnos base FT continuos de 8:45 o más permiten break; no hay doble descuento', () => {
  assert.equal(getScheduleBreak(shift, 'Full-Time').end, '13:45');
  assert.equal(calculateScheduleDay(shift, 'Full-Time').totalMinutes, 480);
  for (const overrides of [{ end: '13:00', extraHoursPost: 5 }, { end: '17:44' }, { splitShift: true }, { off: true }, { feriado: true }, { holiday: true }]) {
    assert.equal(getScheduleBreak({ ...shift, ...overrides }, 'Full-Time'), null);
    assert.deepEqual(getScheduleBreakOptions({ ...shift, ...overrides }, 'Full-Time'), []);
  }
  assert.equal(getScheduleBreak(shift, 'Part-Time'), null);
  for (const breakStart of ['08:45', '17:15', '13:01', '25:00', '']) assert.equal(getScheduleBreak({ ...shift, breakStart }, 'Full-Time'), null);
  assert.equal(scheduleBreakLabel({ ...shift, breakStart: '' }, 'Full-Time'), 'Break: pendiente');
});

test('break nocturno cruza medianoche y sus opciones quedan dentro del turno', () => {
  const night = { start: '16:15', end: '01:00', breakStart: '23:45' };
  assert.deepEqual(getScheduleBreak(night, 'Full-Time'), { start: '23:45', end: '00:30', startMinutes: 1425, endMinutes: 1470 });
  assert.equal(getScheduleBreakOptions(night, 'Full-Time').at(-1), '00:15');
  assert.equal(getScheduleBreak({ ...night, breakStart: '00:30' }, 'Full-Time'), null);
});

test('heatmap excluye tres bloques y vuelve a contar al finalizar; respeta modalidad por fecha', () => {
  const person = { id: 'a', name: 'Ana', modality: 'Full-Time', nextModality: 'Part-Time', modalityChangeDate: '2026-10-01' };
  const assignments = getHeatmapAssignments([person], { a: { monday: shift } }, 'monday', ['Caja'], '2026-09-28');
  const rows = buildHeatmapRows(assignments, { positions: ['Caja'], matrix: [Array(21).fill(1)] });
  for (const time of ['13:00', '13:15', '13:30']) assert.equal(rows[0].cells[HOURS.indexOf(time)].color, 'bg-yellow-300');
  for (const time of ['12:45', '13:45']) assert.equal(rows[0].cells[HOURS.indexOf(time)].color, 'bg-blue-500');
  assert.equal(getHeatmapAssignments([person], { a: { monday: shift } }, 'monday', ['Caja'], '2026-10-01')[0].breakStartMinutes, undefined);
});
