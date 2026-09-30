const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const FULL_TIME_BREAK_THRESHOLD = 8 * 60 + 45;

const clockMinutes = value => {
  const match = String(value ?? '').match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const duration = (start, end) => {
  const from = clockMinutes(start), to = clockMinutes(end);
  if (from === null || to === null) return 0;
  return (to - from + 1440) % 1440;
};

export function requiresScheduleBreak(shift, modality) {
  return Boolean(shift && !shift.off && !shift.feriado && !shift.holiday && !shift.splitShift
    && String(modality ?? '').trim().toLowerCase() === 'full-time'
    && duration(shift.start, shift.end) >= FULL_TIME_BREAK_THRESHOLD);
}

const breakClock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function getScheduleBreak(shift, modality) {
  if (!requiresScheduleBreak(shift, modality)) return null;
  const start = clockMinutes(shift.breakStart);
  if (start === null || start % 15 !== 0) return null;
  const shiftStart = clockMinutes(shift.start);
  const offset = (start - shiftStart + 1440) % 1440;
  if (offset + 45 > duration(shift.start, shift.end)) return null;
  return { start: shift.breakStart, end: breakClock(start + 45), startMinutes: shiftStart + offset, endMinutes: shiftStart + offset + 45 };
}

export function getScheduleBreakOptions(shift, modality) {
  if (!requiresScheduleBreak(shift, modality)) return [];
  const start = clockMinutes(shift.start);
  const end = start + duration(shift.start, shift.end);
  const options = [];
  for (let minute = Math.ceil(start / 15) * 15; minute + 45 <= end; minute += 15) options.push(breakClock(minute));
  return options;
}

export function scheduleBreakLabel(shift, modality) {
  if (!requiresScheduleBreak(shift, modality)) return '';
  const rest = getScheduleBreak(shift, modality);
  return rest ? `Break: ${rest.start}-${rest.end}` : 'Break: pendiente';
}

const extraMinutes = value => {
  const hours = Number(value ?? 0);
  return Number.isFinite(hours) ? Math.max(0, Math.round(hours * 60)) : 0;
};

export const formatScheduleMinutes = minutes => {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

export function calculateScheduleDay(shift, modality) {
  const empty = { grossMinutes: 0, baseMinutes: 0, breakMinutes: 0, extraMinutes: 0, holidayMinutes: 0, totalMinutes: 0 };
  if (!shift || shift.off || !shift.start || !shift.end) return empty;
  const grossMinutes = duration(shift.start, shift.end)
    + (shift.splitShift ? duration(shift.start2, shift.end2) : 0);
  // Conservar el crédito de feriados del PDF, separado de las horas trabajadas.
  if (shift.feriado || shift.holiday) {
    return { ...empty, holidayMinutes: grossMinutes, totalMinutes: grossMinutes };
  }
  const fullTime = String(modality ?? '').trim().toLowerCase() === 'full-time';
  // Las extras no convierten un turno base corto en una jornada con refrigerio.
  // Se conserva la excepción existente para turnos partidos y Part-Time.
  const breakMinutes = fullTime && !shift.splitShift && grossMinutes >= FULL_TIME_BREAK_THRESHOLD ? 45 : 0;
  const extras = extraMinutes(shift.extraHoursPre)
    + extraMinutes(shift.extraHoursPost ?? shift.extraHours);
  const baseMinutes = grossMinutes - breakMinutes;
  return { ...empty, grossMinutes, baseMinutes, breakMinutes, extraMinutes: extras, totalMinutes: baseMinutes + extras };
}

export function calculateScheduleTotals(schedule, person, weekStart) {
  const totals = { grossMinutes: 0, baseMinutes: 0, breakMinutes: 0, extraMinutes: 0, holidayMinutes: 0, totalMinutes: 0 };
  DAYS.forEach((day, index) => {
    let modality = person?.modality;
    if (weekStart && person?.modalityChangeDate && person?.nextModality) {
      const date = new Date(`${weekStart.slice(0, 10)}T12:00:00Z`);
      if (Number.isFinite(date.getTime())) {
        date.setUTCDate(date.getUTCDate() + index);
        if (date.toISOString().slice(0, 10) >= person.modalityChangeDate) modality = person.nextModality;
      }
    }
    const values = calculateScheduleDay(schedule?.[day], modality);
    for (const key of Object.keys(totals)) totals[key] += values[key];
  });
  return totals;
}
