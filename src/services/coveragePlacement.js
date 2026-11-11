import { getAvailableApprovedBukOptions, getBukRestDays, makeApprovedBukPatch } from './bukSchedule.js';
import { effectiveModality, getExportShiftSegments, getWeekDates, isActiveOnDate, SCHEDULE_DAYS, clockFromMinutes, normalizeSchedulePosition } from './scheduleExportData.js';
import { isBukScheduleExempt } from './scheduleStaffOrder.js';
import { getShiftAvailability } from './shiftAvailability.js';
import { getScheduleBreakOptions } from './scheduleHours.js';
import { getHeatmapCoverageCandidates } from './heatmapCoverageCandidates.js';
import { workCategory } from './coverageInsights.js';
export const placementFingerprint = (schedules, id) => JSON.stringify(schedules[id] || {});
const clock = value => clockFromMinutes((value + 2880) % 1440);
const overlaps = (a, b) => a.start < b.end && a.end > b.start;
export function planCoveragePlacement(context, request) {
  const {
    staff,
    schedules,
    day,
    date,
    requirements,
    weekStart,
    previousWeekSchedules,
    nextWeekSchedules,
    positionDefinitions
  } = context;
  const person = staff.find(item => item.id === request.staffId);
  if (!person || !isActiveOnDate(person, date) || ['inactive', 'archived', 'ceased', 'terminated'].includes(String(person.status).toLowerCase())) throw Error('El colaborador ya no está activo para esta fecha.');
  if (request.sourceFingerprint !== placementFingerprint(schedules, person.id)) throw Error('El horario cambió. Vuelve a seleccionar al colaborador.');
  const position = requirements.positions?.find(item => item === request.position);
  if (!position || !Number.isInteger(request.start) || request.start % 15 || request.start < 420 || request.start >= 1560) throw Error('Elige posición y hora en el mapa.');
  const current = schedules[person.id]?.[day] || {};
  if (current.off || current.feriado || current.holiday) throw Error('Retira primero el descanso o feriado desde la tarjeta.');
  if (person.studyAvailabilityStatus !== 'ready') throw Error('No se pudo comprobar la disponibilidad. Reintenta.');
  const modality = effectiveModality(person, date),
    existing = getExportShiftSegments(current);
  if (!existing.length) {
    const selection = {
      position,
      start: request.start,
      end: request.start + 15,
      date
    };
    const result = getHeatmapCoverageCandidates({
      ...context,
      selection
    });
    const candidate = result.available.find(item => item.id === person.id);
    if (!result.valid || !candidate) throw Error(result.reason || result.blocked.find(item => item.id === person.id)?.reason || 'No hay un turno compatible con este destino.');
    const options = candidate.options;
    if (request.optionId && !options.some(item => item.id === request.optionId)) throw Error('El turno aprobado seleccionado ya no está disponible. Revisa una nueva propuesta.');
    const option = options.find(item => item.id === request.optionId) || options[0];
    const patch = option.manual ? {
      start: option.start,
      end: option.end,
      off: false,
      feriado: false,
      holiday: false,
      splitShift: false,
      start2: '',
      end2: '',
      bukApprovedShiftId: '',
      bukBreakMinutes: 0
    } : {
      ...makeApprovedBukPatch(option.id, current, day),
      feriado: false,
      holiday: false,
      breakStart: option.breakStart
    };
    return {
      operation: 'add',
      person,
      options,
      optionId: option.id,
      patch: {
        ...patch,
        position,
        positionAssignments: [],
        positionRangesOnly: false
      },
      selection
    };
  }
  const definition = positionDefinitions?.find(item => normalizeSchedulePosition(item.name) === normalizeSchedulePosition(position));
  if (positionDefinitions && (!definition?.department || ![definition.department, 'multifunctional'].includes(workCategory(person)))) throw Error('La categoría del colaborador no es compatible con el área del destino. Revisa su ficha y la configuración de Proyección.');
  if (!isBukScheduleExempt(person) && current.splitShift) throw Error('Este turno partido histórico se conserva. Revísalo en el editor antes de moverlo.');
  const baseStart = Number(current.start.slice(0, 2)) * 60 + Number(current.start.slice(3));
  const delta = request.start - baseStart;
  let patch = {
    ...current,
    position,
    positionAssignments: [],
    positionRangesOnly: false
  };
  if (delta) {
    if (current.splitShift) throw Error('No se desplazan automáticamente turnos partidos.');
    const duration = (Number(current.end.slice(0, 2)) * 60 + Number(current.end.slice(3)) - baseStart + 1440) % 1440;
    if (isBukScheduleExempt(person)) patch = {
      ...patch,
      start: clock(request.start),
      end: clock(request.start + duration),
      bukApprovedShiftId: '',
      bukBreakMinutes: 0
    };else {
      const options = getAvailableApprovedBukOptions(modality, getBukRestDays(modality, schedules[person.id]), schedules[person.id], day);
      const option = options.find(item => item.start === clock(request.start) && item.duration === duration);
      if (!option) throw Error('No hay un turno aprobado de la misma duración con ese ingreso. Elige otra hora o utiliza el editor.');
      patch = {
        ...patch,
        ...makeApprovedBukPatch(option.id, current, day)
      };
    }
    if (current.breakStart) {
      const start = Number(current.breakStart.slice(0, 2)) * 60 + Number(current.breakStart.slice(3));
      patch.breakStart = clock(start + delta);
    }
    if (!getScheduleBreakOptions(patch, modality).includes(patch.breakStart)) patch.breakStart = getScheduleBreakOptions(patch, modality)[0] || '';
  }
  const segments = getExportShiftSegments(patch);
  if (segments.some(item => item.start < 420 || item.end > 1560)) throw Error('El turno quedaría fuera del rango operativo de 07:00 a 26:00.');
  const availability = getShiftAvailability({
    date,
    shift: patch,
    studySchedule: person.study_schedule
  });
  if (!availability.available) throw Error(availability.reasons.map(item => item.message).join(' '));
  const dayIndex = SCHEDULE_DAYS.indexOf(day),
    dates = getWeekDates(weekStart);
  if (dates[dayIndex] !== date) throw Error('La fecha cambió. Selecciona otra vez al colaborador.');
  if (dayIndex === 0 && previousWeekSchedules === undefined || dayIndex === 6 && nextWeekSchedules === undefined) throw Error('Falta comprobar la semana contigua. Reintenta.');
  for (const [week, offset] of [[previousWeekSchedules, -7], [schedules, 0], [nextWeekSchedules, 7]]) {
    for (const [index, key] of SCHEDULE_DAYS.entries()) {
      if (!week || !offset && index === dayIndex) continue;
      for (const segment of getExportShiftSegments(week[person.id]?.[key])) {
        const neighbor = {
          start: segment.start + (offset + index - dayIndex) * 1440,
          end: segment.end + (offset + index - dayIndex) * 1440
        };
        if (segments.some(item => overlaps(item, neighbor))) throw Error('El movimiento se superpone con otro turno del colaborador.');
      }
    }
  }
  return {
    operation: 'move',
    person,
    options: [],
    patch
  };
}
