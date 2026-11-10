import assert from 'node:assert/strict';
import test from 'node:test';
import { isExcludedProjectionStaffRole, summarizeProjectionAvailableHours } from './projectionLabor.js';
import { calculateHistoricalGeneralVhl } from './projectionVhl.js';

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const person = (id, extra = {}) => ({ id, name: id, status: 'active', modality: 'Full-Time', position: 'COLABORADOR', ...extra });
const week = (staffId, shift, extra = {}) => ({
  id: `${staffId}_2026-10-19_to_2026-10-25`, staffId,
  ...Object.fromEntries(weekdays.map(day => [day, { ...shift }])), ...extra,
});

test('solo gerente y asistente se excluyen por puesto normalizado, sin excluir entrenadores', () => {
  for (const position of ['GERENTE', '  gerente  ', '\tGérénte\n', 'ASISTENTE', ' asisténte ']) {
    assert.equal(isExcludedProjectionStaffRole({ position }), true, position);
  }
  for (const position of ['ENTRENADOR', 'Trainer', 'COLABORADOR', 'GERENTE AUXILIAR', '', null, undefined]) {
    assert.equal(isExcludedProjectionStaffRole({ position }), false, String(position));
  }
  assert.equal(isExcludedProjectionStaffRole({ role: 'admin', position: 'ENTRENADOR' }), false,
    'El rol de acceso no reemplaza al puesto laboral');
});

test('bolsa de HH mantiene FT48/PT24 y separa gerenciales sin mutar perfiles', () => {
  const staff = [person('trainer', { position: 'ENTRENADOR' }),
    person('part', { modality: 'Part-Time' }),
    person('gerente', { position: '  gérente ' }),
    person('asistente', { position: 'asistente', modality: 'Part-Time' }),
    person('full-contract', { modality: null, contractType: 'Full Time' }),
    person('part-contract', { modality: null, contractType: 'Part Time' }),
    person('trainee-actual', { modality: 'Part Time', isTrainee: true, trainingEndDate: '2026-11-01' })];
  const original = structuredClone(staff);
  const summary = summarizeProjectionAvailableHours(staff, new Date('2026-10-25T12:00:00'));
  assert.equal(summary.totalHours, 168);
  assert.deepEqual(summary.fullTime.map(item => item.id), ['trainer', 'full-contract']);
  assert.deepEqual(summary.partTime.map(item => item.id), ['part', 'part-contract', 'trainee-actual']);
  assert.deepEqual(summary.gerenciales.map(item => item.id), ['gerente', 'asistente']);
  assert.deepEqual(staff, original);
});

test('conserva exclusiones previas y sus límites de fecha para cese y entrenamiento', () => {
  const staff = [person('inactivo', { status: 'inactive', position: 'GERENTE' }),
    person('reconstruido', { reconstructed_from_history: true }),
    person('historico', { name: 'Histórico Apellido' }),
    person('cesado', { cessationDate: '2026-10-24' }),
    person('cese-hoy', { cessationDate: '2026-10-25', modality: 'Part-Time' }),
    person('entrenamiento-vencido', { isTrainee: 'true', trainingEndDate: '2026-10-24' }),
    person('entrenamiento-hoy', { isTrainee: 1, trainingEndDate: '2026-10-25' }),
    person('sin-modalidad', { modality: '' })];
  const summary = summarizeProjectionAvailableHours(staff, new Date('2026-10-25T12:00:00'));
  assert.equal(summary.totalHours, 72);
  assert.equal(summary.gerenciales.length, 0, 'Prevalece el motivo previo de exclusión de un inactivo');
  assert.deepEqual(summary.inactivos.map(item => item.id), ['inactivo', 'reconstruido', 'historico']);
  assert.deepEqual(summary.cesados.map(item => item.id), ['cesado']);
  assert.deepEqual(summary.traineeVencido.map(item => item.id), ['entrenamiento-vencido']);
  assert.deepEqual(summary.sinModalidad.map(item => item.id), ['sin-modalidad']);
});

test('HH históricas y VHL excluyen schedules gerenciales resueltos por staffId o id legado', () => {
  const staff = [person('trainer', { position: 'TRAINER' }), person('part', { modality: 'Part-Time' }),
    person('manager', { position: 'GÉRENTE' }), person('assistant', { position: ' asistente ' }),
    person('trainee', { isTrainee: true })];
  const schedules = [week('trainer', { start: '10:00', end: '14:00' }),
    week('part', { start: '22:00', end: '01:00' }),
    week('manager', { start: '08:00', end: '16:00' }),
    week('assistant', { start: '08:00', end: '16:00' }, { staffId: undefined }),
    week('trainee', { start: '10:00', end: '11:00' }),
    week('historical-unknown', { start: '10:00', end: '11:00' }, { staffId: undefined })];
  const original = structuredClone({ staff, schedules });
  assert.deepEqual(calculateHistoricalGeneralVhl({ totalSales: 14000, staff, schedules }), { totalHours: 56, generalVhl: 250 });
  assert.deepEqual({ staff, schedules }, original);
});

test('el histórico conserva descansos, feriados, partidos y perfiles desconocidos como antes', () => {
  const schedules = [week('unknown', { start: '08:00', end: '12:00', splitShift: true, start2: '16:00', end2: '18:00' }),
    week('off', { start: '08:00', end: '16:00', off: true }),
    week('feriado', { start: '08:00', end: '16:00', feriado: true }),
    week('holiday', { start: '08:00', end: '16:00', holiday: true })];
  assert.deepEqual(calculateHistoricalGeneralVhl({ totalSales: 4200, schedules }), { totalHours: 42, generalVhl: 100 });
  assert.deepEqual(calculateHistoricalGeneralVhl({ totalSales: 4200, schedules: [schedules[1]] }), { totalHours: 0, generalVhl: 0 });
});
