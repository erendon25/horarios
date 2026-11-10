import assert from 'node:assert/strict';
import test from 'node:test';
import { getShiftAvailability as availability, filterShiftsByAvailability as filter } from './shiftAvailability.js';
import { getAvailableApprovedBukOptions } from './bukSchedule.js';

const date = '2026-10-26'; // Monday, independent of the process time zone.
const shift = { start: '12:00', end: '16:00' };
const check = (studySchedule, candidate = shift, selectedDate = date) => availability({
  date: selectedDate, shift: candidate, studySchedule,
});
const blocks = (...ranges) => ({ free: false, blocks: ranges.map(([start, end]) => ({ start, end })) });

test('sin horario de estudios o bloques no existen restricciones inventadas', () => {
  for (const studySchedule of [undefined, null, {}, { monday: blocks() }]) {
    assert.deepEqual(check(studySchedule), { available: true, reasons: [] });
  }
});

test('el solapamiento es semiabierto: tocar la entrada o salida de estudio sí es compatible', () => {
  const study = { monday: blocks(['10:00', '12:00']) };
  assert.equal(check(study).available, true);
  assert.equal(check(study, { start: '06:00', end: '10:00' }).available, true);
  const conflict = check(study, { start: '11:45', end: '16:00' });
  assert.equal(conflict.available, false);
  assert.equal(conflict.reasons[0].code, 'study_overlap');
  assert.match(conflict.reasons[0].message, /10:00–12:00/);
});

test('comprueba todos los bloques y conserva la precisión de intervalos de quince minutos', () => {
  const study = { monday: blocks(['07:30', '11:30'], ['16:00', '19:00']) };
  assert.equal(check(study, { start: '11:30', end: '16:00' }).available, true);
  assert.equal(check(study, { start: '15:45', end: '16:15' }).available, false);
  assert.equal(check(study, { start: '11:15', end: '15:45' }).available, false);
});

test('free significa solicitar día libre y bloquea la jornada completa', () => {
  const study = { monday: { free: true, blocks: [] } };
  const result = check(study);
  assert.equal(result.available, false);
  assert.equal(result.reasons[0].code, 'requested_day_off');
  assert.equal(result.reasons[0].date, date);
  assert.match(result.reasons[0].message, /Día libre solicitado/);
  assert.equal(check(study, { start: '23:45', end: '01:00' }).available, false);
  assert.equal(check({ monday: { free: false, blocks: [] } }).available, true);
});

test('tolera arrays históricos y alias de horas y días sin cambiar sus restricciones', () => {
  const study = { Monday: [{ startTime: '13:00', endTime: '14:00' }] };
  assert.equal(check(study, { startTime: '12:00', endTime: '16:00' }).available, false);
  assert.equal(check({ monday: { requests_day_off: true } }).available, false);
  assert.equal(check({ monday: { free: 'true', blocks: [] } }).available, false);
});

test('un turno nocturno comprueba clases y días libres del día siguiente', () => {
  const overnight = { start: '22:00', end: '02:00' };
  const result = check({ tuesday: blocks(['01:00', '03:00']) }, overnight);
  assert.equal(result.available, false);
  assert.equal(result.reasons[0].day, 'tuesday');
  assert.equal(result.reasons[0].date, '2026-10-27');
  assert.equal(check({ tuesday: blocks(['02:00', '04:00']) }, overnight).available, true);
  assert.equal(check({ tuesday: { free: true } }, overnight).available, false);
  assert.equal(check({ tuesday: { free: true } }, { start: '20:00', end: '00:00' }).available, true);
});

test('las clases que cruzan medianoche también afectan el turno del día posterior', () => {
  const study = { monday: blocks(['22:00', '02:00']) };
  assert.equal(check(study, { start: '21:00', end: '23:00' }).available, false);
  const result = check(study, { start: '01:00', end: '05:00' }, '2026-10-27');
  assert.equal(result.available, false);
  assert.equal(result.reasons[0].date, '2026-10-26');
  assert.equal(check(study, { start: '02:00', end: '06:00' }, '2026-10-27').available, true);
});

test('el cruce domingo-lunes y de año usa fechas calendario correctas', () => {
  const monday = check({ monday: blocks(['01:00', '02:00']) }, { start: '22:00', end: '02:00' }, '2026-11-01');
  assert.equal(monday.available, false);
  assert.equal(monday.reasons[0].date, '2026-11-02');
  const friday = check({ friday: blocks(['01:00', '02:00']) }, { start: '22:00', end: '02:00' }, '2026-12-31');
  assert.equal(friday.available, false);
  assert.equal(friday.reasons[0].date, '2027-01-01');
});

test('la fecha elegida no cambia de día por la zona horaria del dispositivo', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['America/Lima', 'Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = zone;
      const result = check({ monday: blocks(['13:00', '14:00']) });
      assert.equal(result.available, false, zone);
      assert.equal(result.reasons[0].day, 'monday', zone);
      assert.equal(result.reasons[0].date, date, zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('un turno partido comprueba cada tramo sin ocupar el hueco intermedio', () => {
  const split = { start: '06:00', end: '10:00', splitShift: true, start2: '14:00', end2: '18:00' };
  assert.equal(check({ monday: blocks(['10:00', '14:00']) }, split).available, true);
  assert.equal(check({ monday: blocks(['16:00', '17:00']) }, split).available, false);
  const nightSplit = { start: '23:00', end: '01:00', splitShift: true, start2: '02:00', end2: '04:00' };
  assert.equal(check({ tuesday: blocks(['01:00', '02:00']) }, nightSplit).available, true);
  assert.equal(check({ tuesday: blocks(['03:00', '04:00']) }, nightSplit).available, false);
});

test('las horas extra previas y posteriores forman parte de la ocupación real', () => {
  assert.equal(check({ monday: blocks(['11:45', '12:00']) }, { ...shift, extraHoursPre: 0.25 }).available, false);
  assert.equal(check({ monday: blocks(['16:00', '16:15']) }, { ...shift, extraHoursPost: '0,25' }).available, false);
  assert.equal(check({ monday: blocks(['16:00', '16:15']) }, { ...shift, extraHours: 0.25 }).available, false);
  assert.equal(check({ monday: blocks(['16:00', '16:15']) }, { ...shift, extraHoursPost: 0, extraHours: 0.25 }).available, true);
  assert.equal(check({ monday: blocks(['11:00', '12:00']) }, { ...shift, extraHoursPre: -1 }).available, true);
});

test('las extras antes de las cero horas comprueban el día anterior', () => {
  const candidate = { start: '00:30', end: '04:00', extraHoursPre: 1 };
  const result = check({ monday: blocks(['23:30', '23:45']) }, candidate, '2026-10-27');
  assert.equal(result.available, false);
  assert.equal(result.reasons[0].date, '2026-10-26');
  assert.equal(check({ monday: { free: true } }, candidate, '2026-10-27').available, false);
});

test('un break no habilita trabajar durante una clase dentro del turno', () => {
  const candidate = { ...shift, breakStart: '13:00', breakMinutes: 45, bukBreakMinutes: 45 };
  assert.equal(check({ monday: blocks(['13:00', '13:45']) }, candidate).available, false);
});

test('días no laborables y turnos vacíos no generan conflictos; rangos incompletos sí se rechazan', () => {
  const study = { monday: { free: true } };
  for (const candidate of [null, {}, { ...shift, off: true }, { ...shift, feriado: true }, { ...shift, holiday: true }]) {
    assert.equal(check(study, candidate).available, true);
  }
  for (const candidate of [{ start: '12:00' }, { ...shift, end: '12:00' }, { ...shift, splitShift: true }]) {
    assert.equal(check(study, candidate).reasons[0].code, 'invalid_shift');
  }
  assert.equal(check({}, shift, '2026-02-30').reasons[0].code, 'invalid_date');
  assert.equal(check({}, shift, '').reasons[0].code, 'invalid_date');
});

test('bloques de estudio vacíos o incompletos no inventan restricciones', () => {
  assert.equal(check({ monday: { blocks: [
    { start: '', end: '' }, { start: '13:00' }, { start: 'incorrecto', end: '14:00' }, { start: '13:00', end: '13:00' },
  ] } }).available, true);
});

test('filtrar conserva referencias y orden sin modificar las opciones ni los estudios', () => {
  const options = [{ id: 'after', start: '12:00', end: '16:00' }, { id: 'overlap', start: '11:45', end: '16:00' },
    { id: 'before', start: '06:00', end: '10:00' }];
  const studySchedule = { monday: blocks(['10:00', '12:00']) };
  const original = structuredClone({ options, studySchedule });
  const result = filter(options, { date, studySchedule });
  assert.deepEqual(result.map((option) => option.id), ['after', 'before']);
  assert.equal(result[0], options[0]);
  assert.equal(result[1], options[2]);
  assert.deepEqual({ options, studySchedule }, original);
});

test('el filtro del editor conserva extras y limpia el estado libre, feriado o partido anterior', () => {
  const options = [{ ...shift, id: 'approved' }];
  const shiftPatch = { off: true, feriado: true, holiday: true, splitShift: true,
    start2: '20:00', end2: '23:00', extraHoursPre: 0.25, extraHoursPost: 0.25 };
  assert.deepEqual(filter(options, { date, studySchedule: { monday: blocks(['11:45', '12:00']) }, shiftPatch }), []);
  assert.deepEqual(filter(options, { date, studySchedule: { monday: blocks(['16:00', '16:15']) }, shiftPatch }), []);
  assert.deepEqual(filter(options, { date, studySchedule: { monday: blocks(['20:00', '21:00']) }, shiftPatch }), options);
});

test('la disponibilidad se combina con las cuotas BUK sin reemplazar las duraciones restantes', () => {
  const week = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    .map((key) => [key, { start: '12:00', end: '16:00' }]));
  const options = getAvailableApprovedBukOptions('Part-Time', 1, week, 'sunday');
  assert.ok(options.length > 0);
  assert.ok(options.every((option) => option.duration === 225));
  const context = { date: '2026-11-01', studySchedule: { sunday: blocks(['21:00', '23:00']) } };
  const result = filter(options, context);
  assert.ok(result.length > 0 && result.length < options.length);
  assert.ok(result.every((option) => option.duration === 225));
  assert.ok(result.every((option) => availability({ ...context, shift: option }).available));
});
