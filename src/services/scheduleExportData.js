export const SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const SCHEDULE_DAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function getWeekDates(weekStart) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '')) throw new Error('Selecciona una semana válida.');
  const date = new Date(`${weekStart}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== weekStart) throw new Error('Selecciona una semana válida.');
  return SCHEDULE_DAYS.map((_, index) => {
    const current = new Date(date);
    current.setUTCDate(current.getUTCDate() + index);
    return current.toISOString().slice(0, 10);
  });
}
export const effectiveModality = (person, date) => (
  person.modalityChangeDate && person.nextModality && date >= person.modalityChangeDate
    ? person.nextModality : person.modality
);
export const shortModality = (modality) => ({ 'full-time': 'FT', 'part-time': 'PT' }[String(modality || '').toLowerCase()] || modality || '—');
export const isManagement = (person) => ['GERENTE', 'ASISTENTE', 'LIDER'].includes(
  String(person.position || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase(),
);
export const isActiveOnDate = (person, date) => {
  const end = person.isTrainee ? person.trainingEndDate : (person.cessationDate || person.terminationDate);
  return !end || end.slice(0, 10) >= date;
};
export const normalizeSchedulePosition = (position) => String(position || '').trim().replace(/#\d+$/g, '').replace(/\s+/g, ' ').toLowerCase();

const minutes = (clock) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(clock || ''));
  if (!match || +match[1] > 25 || +match[2] > 59) return null;
  return +match[1] * 60 + +match[2];
};
const extraMinutes = value => Math.max(0, Math.round((Number(String(value ?? 0).replace(',', '.')) || 0) * 60));
export const clockFromMinutes = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

// Same convention as the editor: extras extend the first segment; the second
// segment of a split shift remains separate, never covering the gap.
export function getExportShiftSegments(shift) {
  if (!shift || shift.off || shift.feriado || shift.holiday) return [];
  const from = minutes(shift.start), to = minutes(shift.end);
  if (from === null || to === null) return [];
  const pre = extraMinutes(shift.extraHoursPre);
  const post = extraMinutes(shift.extraHoursPost ?? shift.extraHours);
  const segments = [{ start: Math.max(0, from - pre), end: to + (to <= from ? 1440 : 0) + post }];
  if (shift.splitShift) {
    const start2 = minutes(shift.start2), end2 = minutes(shift.end2);
    if (start2 !== null && end2 !== null) {
      const dayOffset = start2 < from ? 1440 : 0;
      segments.push({ start: start2 + dayOffset, end: end2 + dayOffset + (end2 <= start2 ? 1440 : 0) });
    }
  }
  return segments;
}

export function getHeatmapAssignments(staff, schedules, day, positions, date) {
  const names = new Map(positions.map(position => [normalizeSchedulePosition(position), position]));
  const ordered = staff.slice().sort((a, b) => `${a.name || ''} ${a.lastName || ''} ${a.id}`.localeCompare(`${b.name || ''} ${b.lastName || ''} ${b.id}`, 'es'));
  return ordered.flatMap(person => {
    if (date && !isActiveOnDate(person, date)) return [];
    const shift = schedules[person.id]?.[day];
    const position = names.get(normalizeSchedulePosition(shift?.position));
    if (!position) return [];
    return getExportShiftSegments(shift).map(segment => ({
      position, start: clockFromMinutes(segment.start), end: clockFromMinutes(segment.end),
      isTrainer: person.position === 'ENTRENADOR',
    }));
  });
}

export function getProjectionForDay(requirements, projectionPositions, day) {
  const source = requirements[day] || {};
  const fallback = projectionPositions.map(position => typeof position === 'string' ? position : position?.name).filter(Boolean);
  const positions = Array.isArray(source.positions) && source.positions.length ? source.positions : fallback;
  const asArray = value => Array.isArray(value) ? value : Object.keys(value || {}).sort((a, b) => +a - +b).map(key => value[key]);
  const matrix = asArray(source.matrix).map(asArray);
  return { positions, matrix: positions.map((_, i) => matrix[i] || Array(21).fill(0)) };
}
