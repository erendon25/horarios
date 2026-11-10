import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvedBukShifts, getApprovedBukOptions, getAvailableApprovedBukOptions,
  getBukWeeklyShiftQuota, findApprovedBukShiftByStart, makeApprovedBukPatch, applyBukSchedulePatch,
} from './bukSchedule.js';
import { calculateScheduleTotals } from './scheduleHours.js';
import { SCHEDULE_DAYS } from './scheduleExportData.js';

const modality = 'Part-Time';
const durations = options => [...new Set(options.map(option => option.duration))].sort((a, b) => a - b);
const available = (rests, schedule, day) => getAvailableApprovedBukOptions(modality, rests, schedule, day);
const range = (rests, duration) => approvedBukShifts.find(option => option.group === `PT${rests}` && option.duration === duration);
const shift = (rests, duration, day = 'monday') => makeApprovedBukPatch(range(rests, duration).id, {}, day);
const planned = rests => applyBukSchedulePatch({}, 'monday', { bukRestDays: rests });

test('PT1: cinco días de 4:00 dejan solo 3:45; el turno que se edita no se cuenta dos veces', () => {
  const schedule = { sunday: { off: true } };
  for (const day of SCHEDULE_DAYS.slice(0, 5)) schedule[day] = { start: '20:00', end: '00:00', extraHoursPost: 2 };
  const original = structuredClone(schedule);
  assert.deepEqual(durations(available(1, schedule, 'saturday')), [225]);
  schedule.saturday = shift(1, 225, 'saturday');
  assert.deepEqual(durations(available(1, schedule, 'monday')), [240]);
  assert.deepEqual(durations(available(1, schedule, 'saturday')), [225]);
  delete schedule.saturday;
  assert.deepEqual(schedule, original);
  schedule.saturday = shift(1, 240, 'saturday');
  const invalid = structuredClone(schedule);
  assert.deepEqual(durations(available(1, schedule, 'saturday')), [225], 'An excess existing shift can be corrected');
  assert.deepEqual(schedule, invalid, 'Reading availability must preserve saved shifts');
});

test('PT1: asignar primero el día de 3:45 deja únicamente opciones de 4:00 para los demás días', () => {
  const schedule = { wednesday: shift(1, 225, 'wednesday') };
  assert.deepEqual(durations(available(1, schedule, 'monday')), [240]);
  assert.deepEqual(durations(available(1, schedule, 'wednesday')), [225, 240]);
});

test('PT3 y PT4 cuentan jornadas brutas; el break y las extras no alteran sus cantidades', () => {
  for (const [rests, longDuration, shortDuration, longCount] of [[3, 405, 345, 3], [4, 525, 510, 2]]) {
    const schedule = planned(rests);
    for (const day of SCHEDULE_DAYS.slice(0, longCount)) {
      schedule[day] = { ...shift(rests, longDuration, day), extraHoursPre: 1, extraHoursPost: 2, bukBreakIncludedInHours: true };
    }
    assert.deepEqual(durations(available(rests, schedule, 'saturday')), [shortDuration]);
    schedule.saturday = shift(rests, shortDuration, 'saturday');
    assert.deepEqual(durations(available(rests, schedule, 'monday')), [longDuration]);
    assert.deepEqual(available(rests, schedule, 'sunday'), [], `PT${rests}: all working days are already used`);
  }
  const night = { monday: { start: '20:15', end: '03:00' }, tuesday: shift(3, 405), wednesday: shift(3, 405) };
  assert.deepEqual(durations(available(3, night, 'thursday')), [345]);
});

test('PT2 deja de ofrecer turnos en un día extra y vuelve a ofrecerlos al liberar otro día', () => {
  const schedule = planned(2);
  for (const day of SCHEDULE_DAYS.slice(0, 5)) schedule[day] = shift(2, 285, day);
  assert.deepEqual(available(2, schedule, 'saturday'), []);
  assert.deepEqual(durations(available(2, schedule, 'monday')), [285]);
  schedule.monday = { ...schedule.monday, off: true };
  assert.deepEqual(durations(available(2, schedule, 'saturday')), [285]);
});

test('los descansos y rangos incompletos no ocupan turnos; una compensación sí ocupa su rango acreditado', () => {
  const schedule = {
    monday: { ...shift(1, 225), off: true },
    tuesday: { start: '08:00', end: '' },
    wednesday: { start: '', end: '12:00' },
    thursday: { start: '08:00', end: '08:00' },
    friday: { ...shift(1, 225), splitShift: true },
  };
  assert.deepEqual(getBukWeeklyShiftQuota(modality, 1, schedule, 'saturday').map(slot => slot.used), [0, 0]);
  schedule.monday = { ...shift(1, 225), off: false, feriado: true, holiday: true };
  assert.deepEqual(durations(available(1, schedule, 'saturday')), [240]);
  assert.deepEqual(durations(available(1, schedule, 'monday')), [225, 240]);
});

test('ingreso manual autocompleta la única duración disponible y no reutiliza un turno agotado', () => {
  const schedule = planned(1);
  const longStart = range(1, 240).start, shortStart = range(1, 225).start;
  assert.equal(findApprovedBukShiftByStart(modality, 1, longStart, schedule, 'saturday').duration, 240);
  for (const day of SCHEDULE_DAYS.slice(0, 5)) schedule[day] = shift(1, 240, day);
  assert.equal(findApprovedBukShiftByStart(modality, 1, shortStart, schedule, 'saturday').duration, 225);
  assert.equal(findApprovedBukShiftByStart(modality, 1, longStart, schedule, 'saturday'), null);
  schedule.saturday = shift(1, 225, 'saturday');
  assert.equal(findApprovedBukShiftByStart(modality, 1, longStart, schedule, 'monday').duration, 240);
  assert.equal(findApprovedBukShiftByStart(modality, 1, shortStart, schedule, 'monday'), null);
  assert.equal(findApprovedBukShiftByStart(modality, 1, shortStart, schedule, 'sunday'), null);
});

test('las distribuciones completas cierran en 23:45 en cualquier orden de sus duraciones', () => {
  const plans = [[1, [240, 240, 240, 240, 240, 225]], [2, [285, 285, 285, 285, 285]], [3, [405, 405, 405, 345]], [4, [525, 525, 510]]];
  for (const [rests, distribution] of plans) {
    // Place the shorter duration in each possible day, including first and last.
    for (let shortIndex = 0; shortIndex < distribution.length; shortIndex++) {
      const remaining = [...distribution];
      const [short] = remaining.splice(remaining.length - 1, 1);
      remaining.splice(shortIndex, 0, short);
      let schedule = planned(rests);
      remaining.forEach((duration, index) => {
        const day = SCHEDULE_DAYS[index];
        const option = available(rests, schedule, day).find(option => option.duration === duration);
        assert.ok(option, `PT${rests}, day ${index}, duration ${duration}`);
        schedule = applyBukSchedulePatch(schedule, day, makeApprovedBukPatch(option.id, {}, day));
      });
      for (const day of SCHEDULE_DAYS.slice(remaining.length)) schedule[day] = { ...schedule[day], off: true };
      assert.equal(calculateScheduleTotals(schedule, { modality }, '2026-10-19').baseMinutes, 1425);
      for (const [index, duration] of remaining.entries()) assert.deepEqual(durations(available(rests, schedule, SCHEDULE_DAYS[index])), [duration]);
      assert.deepEqual(available(rests, schedule, SCHEDULE_DAYS.at(-1)), []);
    }
  }
});

test('cambiar el plan no borra horarios incompatibles y Full-Time conserva sus opciones', () => {
  const schedule = { monday: { ...shift(1, 240), position: 'Masa', extraHoursPost: 1 }, sunday: { off: true } };
  const changed = applyBukSchedulePatch(schedule, 'wednesday', { bukRestDays: 3 });
  const before = structuredClone(changed);
  assert.deepEqual(durations(available(3, changed, 'wednesday')), [345, 405]);
  assert.deepEqual(changed, before);
  assert.deepEqual(getAvailableApprovedBukOptions('Full-Time', 1, changed, 'monday'), getApprovedBukOptions('Full-Time', 1));
});
