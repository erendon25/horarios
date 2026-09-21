import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScheduleDay, calculateScheduleTotals, formatScheduleMinutes } from './scheduleHours.js';

const nashira = {
  monday: { start: '14:15', end: '01:00' },
  tuesday: { start: '13:00', end: '23:00' },
  wednesday: { start: '16:15', end: '01:00' },
  thursday: { start: '10:00', end: '19:30' },
  friday: { start: '13:00', end: '21:45', extraHoursPost: 2 },
  saturday: { off: true },
  sunday: { start: '10:30', end: '14:30' },
};

test('Nashira: cinco refrigerios, domingo corto sin descuento, 48:00 base + 2:00 extras = 50:00', () => {
  const totals = calculateScheduleTotals(nashira, { modality: 'Full-Time' }, '2026-09-14');
  assert.equal(formatScheduleMinutes(totals.grossMinutes), '51:45');
  assert.equal(formatScheduleMinutes(totals.breakMinutes), '3:45');
  assert.equal(formatScheduleMinutes(totals.baseMinutes), '48:00');
  assert.equal(formatScheduleMinutes(totals.extraMinutes), '2:00');
  assert.equal(formatScheduleMinutes(totals.totalMinutes), '50:00');
  assert.equal(calculateScheduleDay(nashira.sunday, 'Full-Time').baseMinutes, 240);
});

test('el umbral se evalúa en minutos: 8:44 no descuenta, 8:45 y turnos más largos sí', () => {
  for (const [end, expectedBreak, expectedBase] of [['16:44', 0, 524], ['16:45', 45, 480], ['17:00', 45, 495]]) {
    const total = calculateScheduleDay({ start: '08:00', end }, 'Full-Time');
    assert.equal(total.breakMinutes, expectedBreak);
    assert.equal(total.baseMinutes, expectedBase);
  }
});

test('las extras no activan el refrigerio en un turno base corto y un cero explícito no revive extras antiguas', () => {
  const total = calculateScheduleDay({ start: '08:00', end: '16:00', extraHoursPre: 1, extraHoursPost: 0, extraHours: 2 }, 'Full-Time');
  assert.equal(total.breakMinutes, 0);
  assert.equal(total.extraMinutes, 60);
  assert.equal(total.totalMinutes, 540);
});

test('mantiene Part-Time y turnos partidos sin descuento automático', () => {
  assert.equal(calculateScheduleDay({ start: '08:00', end: '17:00' }, 'Part-Time').breakMinutes, 0);
  const split = calculateScheduleDay({ start: '08:00', end: '12:00', splitShift: true, start2: '16:00', end2: '21:00' }, 'Full-Time');
  assert.equal(split.baseMinutes, 540);
  assert.equal(split.breakMinutes, 0);
});

test('incluye turnos nocturnos y conserva por separado el crédito de feriados del PDF', () => {
  assert.equal(calculateScheduleDay({ start: '16:15', end: '01:00' }, 'Full-Time').baseMinutes, 480);
  const holiday = calculateScheduleDay({ start: '08:00', end: '16:45', feriado: true, extraHoursPost: 2 }, 'Full-Time');
  assert.equal(holiday.holidayMinutes, 525);
  assert.equal(holiday.baseMinutes, 0);
  assert.equal(holiday.extraMinutes, 0);
  assert.equal(holiday.breakMinutes, 0);
});

test('usa la modalidad efectiva de cada día cuando cambia a mitad de semana', () => {
  const totals = calculateScheduleTotals({ monday: { start: '08:00', end: '16:45' }, tuesday: { start: '08:00', end: '16:45' } }, {
    modality: 'Full-Time', nextModality: 'Part-Time', modalityChangeDate: '2026-09-15',
  }, '2026-09-14_to_2026-09-20');
  assert.equal(totals.breakMinutes, 45);
  assert.equal(totals.baseMinutes, 480 + 525);
});

test('ignora descansos, días sin asignar y metadatos de la semana', () => {
  const totals = calculateScheduleTotals({ monday: { off: true, start: '08:00', end: '16:45' }, tuesday: {}, staffId: 'test', uid: 'test' }, { modality: 'Full-Time' });
  assert.equal(totals.totalMinutes, 0);
});

test('formatea horas:minutos sin confundir decimales y sin redondeos a décimas', () => {
  assert.equal(formatScheduleMinutes(49.25 * 60), '49:15');
  assert.equal(formatScheduleMinutes(75), '1:15');
  assert.equal(formatScheduleMinutes(0), '0:00');
});
