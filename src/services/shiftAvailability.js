const MINUTES_PER_DAY = 1440;
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const isTrue = (value) => value === true || value === 1 || value === 'true';
const overlaps = (first, second) => first.start < second.end && first.end > second.start;

const parseDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
};

const clockMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!match || +match[1] > 25 || +match[2] > 59 || +(match[3] || 0) > 59) return null;
  return +match[1] * 60 + +match[2] + +(match[3] || 0) / 60;
};

const range = (startValue, endValue) => {
  const start = clockMinutes(startValue);
  let end = clockMinutes(endValue);
  if (start === null || end === null || start === end) return null;
  while (end < start) end += MINUTES_PER_DAY;
  if (end === start) return null;
  return { start, end };
};

const extraMinutes = (value) => {
  const hours = Number(String(value ?? '').replace(',', '.'));
  const minutes = Math.round(hours * 60);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : 0;
};

const shiftSegments = (shift) => {
  const first = range(shift.start ?? shift.startTime ?? shift.start_time, shift.end ?? shift.endTime ?? shift.end_time);
  if (!first) return null;
  const segments = [{
    start: first.start - extraMinutes(shift.extraHoursPre),
    end: first.end + extraMinutes(shift.extraHoursPost ?? shift.extraHours),
  }];
  if (isTrue(shift.splitShift)) {
    const second = range(shift.start2, shift.end2);
    if (!second) return null;
    const dayOffset = second.start < first.start ? MINUTES_PER_DAY : 0;
    segments.push({ start: second.start + dayOffset, end: second.end + dayOffset });
  }
  return segments;
};

const studyDay = (schedule, key) => {
  const value = schedule?.[key] ?? schedule?.[key[0].toUpperCase() + key.slice(1)];
  if (Array.isArray(value)) return { free: false, blocks: value };
  return { free: isTrue(value?.free ?? value?.requests_day_off), blocks: Array.isArray(value?.blocks) ? value.blocks : [] };
};

const failure = (code, message) => ({ available: false, reasons: [{ code, message }] });

// A missing study document means no recorded restriction. Callers must handle
// loading/error states before offering shifts rather than passing an unknown read.
export const getShiftAvailability = ({ date, shift, studySchedule } = {}) => {
  if (!shift || isTrue(shift.off) || isTrue(shift.feriado ?? shift.holiday)) return { available: true, reasons: [] };
  const start = shift.start ?? shift.startTime ?? shift.start_time;
  const end = shift.end ?? shift.endTime ?? shift.end_time;
  if (!start && !end && !isTrue(shift.splitShift)) return { available: true, reasons: [] };

  // HTML date values describe a Lima calendar day. UTC is used only for stable
  // date arithmetic; converting that date through the browser zone shifts days.
  const calendarDate = parseDate(date);
  if (!calendarDate) return failure('invalid_date', 'Selecciona una fecha válida para comprobar la disponibilidad.');
  const segments = shiftSegments(shift);
  if (!segments) return failure('invalid_shift', 'Completa un rango de entrada y salida válido.');

  const offsets = new Set();
  for (const segment of segments) {
    const firstDay = Math.floor(segment.start / MINUTES_PER_DAY) - 1;
    const lastDay = Math.floor(segment.end / MINUTES_PER_DAY);
    // Study availability repeats weekly. A full cycle plus the previous day
    // covers any longer interval without looping over unbounded extra hours.
    for (let offset = firstDay; offset <= Math.min(lastDay, firstDay + 8); offset += 1) offsets.add(offset);
  }

  const reasons = [];
  for (const offset of [...offsets].sort((a, b) => a - b)) {
    const current = new Date(calendarDate.getTime() + offset * 86400000);
    if (!Number.isFinite(current.getTime())) return failure('invalid_shift', 'El rango del turno no corresponde a fechas válidas.');
    const key = DAY_KEYS[current.getUTCDay()];
    const label = DAY_LABELS[current.getUTCDay()];
    const isoDate = current.toISOString().slice(0, 10);
    const displayDate = isoDate.split('-').reverse().join('/');
    const day = studyDay(studySchedule, key);
    const dayStart = offset * MINUTES_PER_DAY;
    if (day.free) {
      if (segments.some((segment) => overlaps(segment, { start: dayStart, end: dayStart + MINUTES_PER_DAY }))) {
        reasons.push({ code: 'requested_day_off', day: key, date: isoDate,
          message: `Día libre solicitado para el ${label} ${displayDate}.` });
      }
      continue;
    }
    day.blocks.forEach((block, blockIndex) => {
      const blockStart = block?.start ?? block?.startTime ?? block?.start_time;
      const blockEnd = block?.end ?? block?.endTime ?? block?.end_time;
      const period = range(blockStart, blockEnd);
      if (!period) return;
      const absolute = { start: dayStart + period.start, end: dayStart + period.end };
      if (segments.some((segment) => overlaps(segment, absolute))) {
        reasons.push({ code: 'study_overlap', day: key, date: isoDate, blockIndex,
          start: blockStart, end: blockEnd,
          message: `Se cruza con el horario de estudio del ${label} ${displayDate} (${blockStart}–${blockEnd}).` });
      }
    });
  }
  return { available: reasons.length === 0, reasons };
};

export const filterShiftsByAvailability = (options, { date, studySchedule, shiftPatch } = {}) => {
  if (!Array.isArray(options)) return [];
  return options.filter((option) => {
    if (!option || typeof option !== 'object') return false;
    // Catalog choices replace the base shift while retaining current extras.
    // They must not inherit a rest/holiday or a stale split-shift segment.
    const shift = shiftPatch ? { ...shiftPatch, ...option,
      off: false, feriado: false, holiday: false, splitShift: false, start2: '', end2: '' } : option;
    return getShiftAvailability({ date, shift, studySchedule }).available;
  });
};
