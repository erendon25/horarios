import { getAvailableApprovedBukOptions, getBukRestDays } from './bukSchedule.js';
import { placementFingerprint, placementPlanFingerprint, compatiblePlacementPositions } from './coveragePlacement.js';
import { SCHEDULE_DAYS, getWeekDates, isActiveOnDate, effectiveModality, getExportShiftSegments,
  getPositionSegments, getHeatmapAssignments, normalizeSchedulePosition } from './scheduleExportData.js';
import { getScheduleBreak, requiresScheduleBreak } from './scheduleHours.js';
import { getShiftAvailability } from './shiftAvailability.js';
import { isBukScheduleExempt } from './scheduleStaffOrder.js';
import { replacePositionInterval, validatePositionRange } from './heatmapTransfers.js';

const minute = value => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  return match && +match[1] < 24 && +match[2] < 60 ? +match[1] * 60 + +match[2] : null;
};
const clock = value => `${String(Math.floor(((value % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((value % 60) + 60) % 60).padStart(2, '0')}`;
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

export function planHeatmapMove(context, request, { preview = false } = {}) {
  const { staff, schedules, day, date, weekStart, requirements,
    previousWeekSchedules, nextWeekSchedules, verifiedSchedule } = context;
  const person = staff.find(item => item.id === request.staffId);
  if (!person || !isActiveOnDate(person, date) || ['inactive', 'archived', 'ceased', 'terminated'].includes(String(person.status).toLowerCase())) throw Error('El colaborador ya no está activo para esta fecha.');
  const dayIndex = SCHEDULE_DAYS.indexOf(day);
  if (dayIndex < 0 || getWeekDates(weekStart)[dayIndex] !== date || request.date !== date) throw Error('La fecha cambió. Selecciona el turno nuevamente.');
  if (request.sourceFingerprint !== placementFingerprint(schedules, person.id)) throw Error('El horario o los descansos cambiaron. Selecciona el turno nuevamente.');
  if (verifiedSchedule && placementFingerprint({ [person.id]: verifiedSchedule }, person.id) !== request.sourceFingerprint) throw Error('El horario guardado cambió en otra sesión. Recarga antes de moverlo.');
  if (request.planFingerprint !== placementPlanFingerprint(context, person.id)) throw Error('La modalidad o el plan semanal cambiaron. Selecciona el turno nuevamente.');
  const current = schedules[person.id]?.[day];
  if (!current || current.off || current.feriado || current.holiday) throw Error('Selecciona un turno de trabajo.');
  const delta = request.deltaMinutes ?? 0;
  if (!Number.isInteger(delta) || delta % 15 || !Number.isFinite(request.anchorMinute)) throw Error('Desplaza el turno en bloques de 15 minutos.');
  const positions = requirements.positions || [];
  const source = getPositionSegments(current).find(segment => normalizeSchedulePosition(segment.position) === normalizeSchedulePosition(request.sourcePosition)
    && (request.anchorMinute >= segment.start && request.anchorMinute < segment.end || !segment.endExclusive && request.anchorMinute === segment.end));
  if (!source) throw Error('La persona ya no ocupa esa celda. Selecciona el turno nuevamente.');
  const original = getExportShiftSegments(current);
  if (!original.length || minute(current.start) === null || minute(current.end) === null) throw Error('Revisa la entrada y salida del turno antes de moverlo.');
  const scope = request.positionScope || (current.positionRangesOnly || current.positionAssignments?.length ? 'segment' : 'base');
  if (!['base', 'segment'].includes(scope)) throw Error('Selecciona el alcance del cambio de puesto.');
  const destination = positions.find(name => normalizeSchedulePosition(name) === normalizeSchedulePosition(request.position || request.sourcePosition));
  if (!destination) throw Error('Selecciona un puesto del mapa como destino.');
  if (!compatiblePlacementPositions(context, person.id).includes(destination)) throw Error('La categoría del colaborador no corresponde al puesto destino. Revisa su ficha.');
  const modality = effectiveModality(person, date), previousBreak = getScheduleBreak(current, modality);
  const patch = { ...current };
  if (delta) {
    const start = minute(current.start) + delta;
    if (start < 0 || start >= 1440) throw Error('La entrada debe permanecer en el mismo día operativo.');
    patch.start = clock(start); patch.end = clock(minute(current.end) + delta);
    if (current.splitShift) {
      if (minute(current.start2) === null || minute(current.end2) === null) throw Error('Revisa el segundo tramo antes de moverlo.');
      patch.start2 = clock(minute(current.start2) + delta); patch.end2 = clock(minute(current.end2) + delta);
    }
    if (minute(current.breakStart) !== null) patch.breakStart = clock(minute(current.breakStart) + delta);
    patch.positionAssignments = (current.positionAssignments || []).map(item => ({ ...item, start: item.start + delta, end: item.end + delta }));
    const shifted = getExportShiftSegments(patch);
    if (shifted.length !== original.length || shifted.some((segment, index) => segment.start !== original[index].start + delta || segment.end !== original[index].end + delta)) throw Error('El movimiento cambiaría la duración o el día de un tramo. Revísalo en la ficha.');
    const option = !current.splitShift && getAvailableApprovedBukOptions(modality, getBukRestDays(modality, schedules[person.id]), schedules[person.id], day)
      .find(item => item.start === patch.start && item.end === patch.end);
    patch.bukApprovedShiftId = isBukScheduleExempt(person) ? '' : option?.id || '';
    patch.bukBreakMinutes = isBukScheduleExempt(person) ? 0 : option?.breakMinutes || 0;
  }
  if (scope === 'base') patch.position = destination;
  else if (normalizeSchedulePosition(destination) !== normalizeSchedulePosition(source.position)) {
    const range = { start: source.start + delta, end: source.end + delta, position: destination };
    const error = validatePositionRange(patch, positions, range);
    if (error) throw Error(error);
    patch.positionAssignments = replacePositionInterval(patch, range);
  }
  const rest = getScheduleBreak(patch, modality);
  if (previousBreak && (!rest || rest.startMinutes !== previousBreak.startMinutes + delta || rest.endMinutes - rest.startMinutes !== previousBreak.endMinutes - previousBreak.startMinutes)) throw Error('El movimiento perdería el break del turno. Elige un horario que conserve su duración y refrigerio.');
  const warnings = [];
  if (delta && !patch.bukApprovedShiftId && !isBukScheduleExempt(person)) warnings.push('Horario fuera del catálogo aprobado. Revisa el plan BUK antes de exportar.');
  if (requiresScheduleBreak(patch, modality) && !rest) warnings.push('El turno requiere un break válido. Revísalo en la ficha.');
  const segments = getExportShiftSegments(patch);
  if (segments.some(segment => segment.start < 420 || segment.end > 1560)) warnings.push('Parte del turno queda fuera del mapa 07:00–26:00; se conserva completa.');
  if (person.studyAvailabilityStatus !== 'ready') throw Error('No se pudo verificar la disponibilidad. Reintenta antes de moverlo.');
  const availability = getShiftAvailability({ date, shift: patch, studySchedule: person.study_schedule });
  if (!availability.available && !preview) throw Error(availability.reasons.map(item => item.message).join(' '));
  const academicIntervals = availability.reasons.flatMap(reason => {
    const offset = (Date.parse(`${reason.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 60000;
    if (!Number.isFinite(offset)) return [];
    const ranges = reason.code === 'requested_day_off' ? [{ start: offset, end: offset + 1440 }]
      : reason.code === 'study_overlap' ? getExportShiftSegments({ start: reason.start, end: reason.end }).map(range => ({ start: range.start + offset, end: range.end + offset })) : [];
    return ranges.flatMap(range => segments.map(segment => ({ start: Math.max(range.start, segment.start), end: Math.min(range.end, segment.end) })).filter(range => range.end > range.start));
  });
  if (!previousWeekSchedules || !nextWeekSchedules) throw Error('Falta comprobar los turnos de las semanas vecinas. Reintenta.');
  for (const [week, offset] of [[previousWeekSchedules, -7], [schedules, 0], [nextWeekSchedules, 7]]) {
    for (const [index, key] of SCHEDULE_DAYS.entries()) {
      if (!offset && index === dayIndex) continue;
      for (const segment of getExportShiftSegments(week[person.id]?.[key])) {
        const neighbor = { start: segment.start + (offset + index - dayIndex) * 1440, end: segment.end + (offset + index - dayIndex) * 1440 };
        if (segments.some(item => overlaps(item, neighbor))) throw Error('El movimiento se superpone con otro turno del colaborador.');
      }
    }
  }
  const nextSchedules = { ...schedules, [person.id]: { ...schedules[person.id], [day]: patch } };
  return { patch, person, source, positionScope: scope, warnings, academicIntervals, valid: availability.available,
    error: availability.reasons.map(item => item.message).join(' '),
    noChange: JSON.stringify(patch) === JSON.stringify(current),
    proposedAssignments: getHeatmapAssignments(context.displayStaff || staff, nextSchedules, day, positions, date) };
}
