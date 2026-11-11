import { getAvailableApprovedBukOptions, getBukRestDays, makeApprovedBukPatch, applyBukSchedulePatch } from './bukSchedule.js';
import { effectiveModality, getExportShiftSegments, getHeatmapAssignments, getWeekDates, isActiveOnDate, SCHEDULE_DAYS, clockFromMinutes, normalizeSchedulePosition } from './scheduleExportData.js';
import { isBukScheduleExempt } from './scheduleStaffOrder.js';
import { getShiftAvailability } from './shiftAvailability.js';
import { getScheduleBreakOptions } from './scheduleHours.js';
import { workCategory } from './coverageInsights.js';

const stableValue = value => Array.isArray(value) ? value.map(stableValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])])) : value;
export const placementFingerprint = (schedules, id) => JSON.stringify(stableValue(Object.fromEntries(
  SCHEDULE_DAYS.filter(day=>schedules[id]?.[day]!==undefined).map(day=>[day,schedules[id][day]])
)));
const clock = value => clockFromMinutes((value + 2880) % 1440);
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

export function compatiblePlacementPositions(context, id) {
  const category = workCategory(context.staff.find(item => item.id === id));
  return (context.requirements.positions || []).filter(position => {
    if (context.positionDefinitions === undefined) return true;
    const definition = context.positionDefinitions.find(item => normalizeSchedulePosition(item.name) === normalizeSchedulePosition(position));
    return ['production', 'service'].includes(definition?.department) && [definition.department, 'multifunctional'].includes(category);
  });
}

export function placementPlanFingerprint(context, id) {
  const person = context.staff.find(item => item.id === id);
  const modality = effectiveModality(person, context.date);
  const schedule = context.schedules[id] || {};
  const rests = getBukRestDays(modality, schedule);
  return JSON.stringify({ modality, rests, exempt: isBukScheduleExempt(person),
    options: getAvailableApprovedBukOptions(modality, rests, schedule, context.day).map(item => item.id) });
}

export function planCoveragePlacement(context, request, {preview=false} = {}) {
  const { staff, schedules, day, date, requirements, weekStart, previousWeekSchedules, nextWeekSchedules } = context;
  const person = staff.find(item => item.id === request.staffId);
  if (!person || !isActiveOnDate(person, date) || ['inactive', 'archived', 'ceased', 'terminated'].includes(String(person.status).toLowerCase())) throw Error('El colaborador ya no está activo para esta fecha.');
  if (request.sourceFingerprint !== placementFingerprint(schedules, person.id)) throw Error('El horario o los descansos cambiaron. Vuelve a seleccionar al colaborador.');
  if (context.verifiedSchedule && placementFingerprint({[person.id]:context.verifiedSchedule},person.id)!==placementFingerprint(schedules,person.id)) throw Error('El horario o los días libres guardados cambiaron en otra sesión. Recarga el horario antes de colocarlo.');
  const position = requirements.positions?.find(item => item === request.position);
  if (!position || !Number.isInteger(request.start) || request.start % 15 || request.start < 420 || request.start >= 1440) throw Error('Elige posición e ingreso antes de medianoche, en bloques de 15 minutos. 24:00–26:00 son la continuación del turno, no un nuevo ingreso.');
  const current = schedules[person.id]?.[day] || {};
  if (current.off || current.feriado || current.holiday) throw Error('Retira primero el descanso o feriado desde la tarjeta.');
  if (person.studyAvailabilityStatus !== 'ready') throw Error('No se pudo comprobar la disponibilidad. Reintenta.');
  if (!compatiblePlacementPositions(context, person.id).includes(position)) throw Error('La categoría del colaborador no es compatible con el área del destino. Revisa su ficha y Proyección.');
  const planFingerprint = placementPlanFingerprint(context, person.id);
  if (request.planFingerprint && request.planFingerprint !== planFingerprint) throw Error('La modalidad o el plan de descansos cambió. Vuelve a revisar la jornada antes de colocarla.');
  const modality = effectiveModality(person, date);
  const restDays = getBukRestDays(modality, schedules[person.id]);
  const exempt = isBukScheduleExempt(person);
  const existing = getExportShiftSegments(current);
  const available = getAvailableApprovedBukOptions(modality, restDays, schedules[person.id], day);
  let patch, optionId, options = [], operation = existing.length ? 'move' : 'add';

  if (!existing.length) {
    if (current.start || current.end || current.start2 || current.end2 || current.splitShift || current.positionAssignments?.length) throw Error('El día tiene un turno incompleto. Revísalo en la ficha antes de reemplazarlo.');
    if (exempt) throw Error('Gerentes y asistentes tienen horario libre. Define primero su jornada completa en la ficha; arrastrar no crea un turno de 15 minutos.');
    if (!['full-time', 'part-time'].includes(String(modality).trim().toLowerCase())) throw Error('Revisa la modalidad del colaborador antes de asignar una jornada.');
    options = available.filter(item => item.start === clock(request.start));
    if (!options.length) throw Error(available.length
      ? 'No hay un ingreso aprobado exactamente a esa hora para su modalidad y plan de descansos. Elige otra hora; no se aproxima el turno.'
      : 'Los cupos del plan semanal ya están usados. Revisa sus días libres y jornadas asignadas.');
    if (request.optionId && !options.some(item => item.id === request.optionId)) throw Error('El turno aprobado seleccionado ya no está disponible. Revisa una nueva propuesta.');
    if (!request.optionId && options.length > 1) throw Object.assign(Error('Hay varias salidas aprobadas para ese ingreso. Elige la jornada antes de aplicarla.'), { options });
    const option = options.find(item => item.id === request.optionId) || options[0];
    optionId = option.id;
    patch = { ...makeApprovedBukPatch(option.id, current, day), feriado: false, holiday: false,
      position, positionAssignments: [], positionRangesOnly: false };
  } else {
    if (current.splitShift) throw Error('Este turno partido histórico se conserva. Revísalo en la ficha antes de moverlo.');
    const baseStart = Number(current.start.slice(0, 2)) * 60 + Number(current.start.slice(3));
    const delta = request.start - baseStart;
    const duration = (Number(current.end.slice(0, 2)) * 60 + Number(current.end.slice(3)) - baseStart + 1440) % 1440;
    patch = { ...current, position, positionAssignments: [], positionRangesOnly: false };
    if (exempt) patch = { ...patch, start: clock(request.start), end: clock(request.start + duration), bukApprovedShiftId: '', bukBreakMinutes: 0 };
    else {
      const option = available.find(item => item.start === clock(request.start) && item.duration === duration);
      if (!option) throw Error('Ese ingreso o duración no cumple el plan BUK de sus días libres. Elige otra hora o revisa la ficha.');
      optionId = option.id;
      patch = { ...patch, ...makeApprovedBukPatch(option.id, current, day) };
    }
    if (current.breakStart) {
      const start = Number(current.breakStart.slice(0, 2)) * 60 + Number(current.breakStart.slice(3));
      patch.breakStart = clock(start + delta);
    }
  }
  const breakOptions = getScheduleBreakOptions(patch, modality);
  if (!breakOptions.includes(patch.breakStart)) patch.breakStart = breakOptions[Math.floor(breakOptions.length / 2)] || '';
  const segments = getExportShiftSegments(patch);
  const availability = getShiftAvailability({ date, shift: patch, studySchedule: person.study_schedule });
  const availabilityError=availability.reasons.map(item=>item.message).join(' ');
  if (!availability.available && !preview) throw Error(availabilityError);
  const academicIntervals=availability.reasons.flatMap(reason=>{
    const offset=(Date.parse(`${reason.date}T00:00:00Z`)-Date.parse(`${date}T00:00:00Z`))/60000;
    if(!Number.isFinite(offset))return [];
    const ranges=reason.code==='requested_day_off'?[{start:offset,end:offset+1440}]
      :reason.code==='study_overlap'?getExportShiftSegments({start:reason.start,end:reason.end}).map(range=>({start:range.start+offset,end:range.end+offset})):[];
    return ranges.flatMap(range=>segments.map(segment=>({start:Math.max(segment.start,range.start),end:Math.min(segment.end,range.end)})).filter(item=>item.end>item.start));
  });
  const dayIndex = SCHEDULE_DAYS.indexOf(day), dates = getWeekDates(weekStart);
  if (dates[dayIndex] !== date) throw Error('La fecha cambió. Selecciona otra vez al colaborador.');
  if (dayIndex === 0 && previousWeekSchedules === undefined || dayIndex === 6 && nextWeekSchedules === undefined) throw Error('Falta comprobar la semana contigua. Reintenta.');
  for (const [week, offset] of [[previousWeekSchedules, -7], [schedules, 0], [nextWeekSchedules, 7]]) {
    for (const [index, key] of SCHEDULE_DAYS.entries()) {
      if (!week || !offset && index === dayIndex) continue;
      for (const segment of getExportShiftSegments(week[person.id]?.[key])) {
        const neighbor = { start: segment.start + (offset + index - dayIndex) * 1440, end: segment.end + (offset + index - dayIndex) * 1440 };
        if (segments.some(item => overlaps(item, neighbor))) throw Error('El movimiento se superpone con otro turno del colaborador.');
      }
    }
  }
  return { operation, person, options, optionId, patch, planFingerprint, modality, restDays,
    valid:availability.available,error:availabilityError,academicIntervals };
}

export function placementPreviewAssignments(context, request, plan) {
  const schedules = { ...context.schedules,
    [request.staffId]: applyBukSchedulePatch(context.schedules[request.staffId], context.day, plan.patch) };
  return getHeatmapAssignments(context.displayStaff || context.staff, schedules, context.day, context.requirements.positions, context.date);
}
