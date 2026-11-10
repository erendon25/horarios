import { getAvailableApprovedBukOptions, getBukRestDays, makeApprovedBukPatch } from './bukSchedule.js';
import {
  SCHEDULE_DAYS, getWeekDates, isActiveOnDate, effectiveModality, getExportShiftSegments,
  getHeatmapAssignments, normalizeSchedulePosition, clockFromMinutes,
} from './scheduleExportData.js';
import { getScheduleBreakOptions, getScheduleBreak, requiresScheduleBreak } from './scheduleHours.js';
import { isBukScheduleExempt } from './scheduleStaffOrder.js';
import { getShiftAvailability } from './shiftAvailability.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';

const overlap = (first, second) => first.start < second.end && first.end > second.start;
const minute = (clock) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(clock || ''));
  return match && +match[1] <= 25 && +match[2] < 60 ? +match[1] * 60 + +match[2] : null;
};
const extraMinutes = (value) => {
  const hours = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(hours) ? Math.max(0, Math.round(hours * 60)) : 0;
};
const workSegments = (shift) => {
  const segments = getExportShiftSegments(shift);
  if (!segments.length) return segments;
  // Coverage drawing clips to the work day, but a real extra before midnight
  // must still be checked against the adjacent day's recorded work.
  return segments.map((segment, index) => index ? segment : {
    ...segment, start: minute(shift.start) - extraMinutes(shift.extraHoursPre),
  });
};
const covers = (segments, selection) => segments.some((segment) =>
  segment.start <= selection.start && segment.end >= selection.end);
const active = (person, date) => person.status !== 'inactive' && isActiveOnDate(person, date);

const neighboringWork = (id, schedules, previous, next, dayIndex) => {
  const result = [];
  for (const [week, base] of [[previous, -7], [schedules, 0], [next, 7]]) {
    if (!week) continue;
    SCHEDULE_DAYS.forEach((day, index) => {
      if (base === 0 && index === dayIndex) return;
      for (const segment of workSegments(week[id]?.[day])) {
        const offset = (base + index - dayIndex) * 1440;
        result.push({ start: segment.start + offset, end: segment.end + offset });
      }
    });
  }
  return result;
};

export const getHeatmapCoverageCandidates = ({
  selection, staff = [], schedules = {}, day, date, weekStart, requirements = {},
  previousWeekSchedules, nextWeekSchedules,
} = {}) => {
  const result = { valid: false, reason: null, selection, available: [], transfers: [], blocked: [], limitations: [] };
  const fail = (reason) => ({ ...result, reason });
  const dayIndex = SCHEDULE_DAYS.indexOf(day);
  let dates;
  try {
    if (dayIndex < 0 || !weekStart || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) return fail('Selecciona una semana y un día válidos.');
    dates = getWeekDates(weekStart);
  } catch { return fail('Selecciona una semana y un día válidos.'); }
  if (dates[dayIndex] !== date || (selection?.date && selection.date !== date)) return fail('La selección corresponde a otra fecha. Vuelve a marcar el faltante.');
  const projection = Array.isArray(requirements.positions) ? requirements : requirements[day] || {};
  const positions = Array.isArray(projection.positions) ? projection.positions : [];
  const target = positions.find((position) => normalizeSchedulePosition(position) === normalizeSchedulePosition(selection?.position));
  if (!selection || !target || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
    || selection.start % 15 || selection.end % 15 || selection.start < 420 || selection.end > 1515 || selection.start >= selection.end
    || (selection.slot !== undefined && (!Number.isInteger(selection.slot) || selection.slot < 0))) {
    return fail('Selecciona un intervalo continuo de una posición en bloques de 15 minutos.');
  }
  const key = normalizeSchedulePosition(target);
  if ((selection.positionKey && selection.positionKey !== key)
    || (selection.rowKey && selection.rowKey !== `${key}-${selection.slot}`)) {
    return fail('La fila seleccionada ya no corresponde a este faltante.');
  }
  const people = [...new Map(staff.filter((person) => person?.id).map((person) => [person.id, person])).values()];
  const assigned = getHeatmapAssignments(people.filter((person) => active(person, date)), schedules, day, positions, date);
  const rows = buildHeatmapRows(assigned, projection).filter((row) => row.positionKey === key
    && (selection.slot === undefined || row.slot === selection.slot));
  const yellow = rows.some((row) => {
    for (let time = selection.start; time < selection.end; time += 15) {
      const index = HOURS.indexOf(clockFromMinutes(time));
      if (index < 0 || row.cells[index]?.color !== 'bg-yellow-300') return false;
    }
    return true;
  });
  if (!yellow) return fail('Este intervalo ya no es un faltante de la tienda. Actualiza la selección.');
  result.valid = true;
  result.selection = { ...selection, position: target };
  result.limitations.push('Son opciones de consulta: revisa y confirma el turno en el editor antes de guardar.');
  if (dayIndex === 0 && previousWeekSchedules === undefined) result.limitations.push('No se cargó la semana anterior; no se proponen extras que entren en esa semana.');
  if (dayIndex === 6 && nextWeekSchedules === undefined) result.limitations.push('No se cargó la semana siguiente; no se proponen turnos que entren en esa semana.');

  for (const person of people) {
    const block = (code, reason) => result.blocked.push({ id: person.id, person, code, reason });
    if (!active(person, date)) { block('inactive_staff', 'No está activo para esta fecha.'); continue; }
    const current = schedules[person.id]?.[day] || {};
    if (current.off || current.feriado || current.holiday) { block('non_working_day', 'Tiene un día libre o feriado compensado.'); continue; }
    if (current.start && current.end) { block('already_scheduled', 'Ya tiene un turno ese día.'); continue; }
    if (current.start || current.end || current.start2 || current.end2 || current.splitShift || current.positionAssignments?.length) {
      block('incomplete_shift', 'Tiene datos de un turno que requieren revisión; no se reemplazan automáticamente.'); continue;
    }
    const skills = Array.isArray(person.skills) ? person.skills : person.positionAbilities || [];
    if (!Array.isArray(skills) || !skills.some((skill) => normalizeSchedulePosition(skill) === key)) {
      block('missing_skill', 'No tiene registrada la habilidad para esta posición.'); continue;
    }
    if (person.studyAvailabilityStatus !== 'ready') { block('availability_unknown', 'Su disponibilidad aún no se pudo comprobar.'); continue; }
    const modality = effectiveModality(person, date);
    let catalog;
    if (isBukScheduleExempt(person)) {
      catalog = selection.start < 1440 ? [{ id: `manual:${selection.start}-${selection.end}`, manual: true,
        start: clockFromMinutes(selection.start), end: clockFromMinutes(selection.end % 1440),
        duration: selection.end - selection.start, breakMinutes: 0 }] : [];
    } else {
      const rests = getBukRestDays(modality, schedules[person.id] || {});
      catalog = getAvailableApprovedBukOptions(modality, rests, schedules[person.id] || {}, day);
    }
    const neighbors = neighboringWork(person.id, schedules, previousWeekSchedules, nextWeekSchedules, dayIndex);
    const options = [];
    let rejected = { code: 'no_compatible_shift', reason: 'No tiene turnos disponibles que cubran todo el intervalo.' };
    for (const option of catalog) {
      const patch = option.manual ? { start: option.start, end: option.end, off: false, feriado: false, holiday: false,
        splitShift: false, start2: '', end2: '', bukApprovedShiftId: '', bukBreakMinutes: 0, breakStart: '' }
        : { ...makeApprovedBukPatch(option.id, current, day), feriado: false, holiday: false };
      const proposed = { ...current, ...patch, position: target };
      const segments = workSegments(proposed);
      if (!covers(segments, selection)) continue;
      if ((dayIndex === 0 && previousWeekSchedules === undefined && segments.some((segment) => segment.start < 0))
        || (dayIndex === 6 && nextWeekSchedules === undefined && segments.some((segment) => segment.end > 1440))) {
        rejected = { code: 'adjacent_week_unknown', reason: 'Falta comprobar la semana adyacente que ocuparía este turno.' }; continue;
      }
      if (segments.some((segment) => neighbors.some((neighbor) => overlap(segment, neighbor)))) {
        rejected = { code: 'adjacent_shift_overlap', reason: 'El turno se superpone con otro horario ya registrado.' }; continue;
      }
      const availability = getShiftAvailability({ date, shift: proposed, studySchedule: person.study_schedule });
      if (!availability.available) { rejected = { code: 'study_conflict', reason: availability.reasons[0]?.message || 'Tiene un conflicto de disponibilidad.' }; continue; }
      let breakOptions = [];
      if (requiresScheduleBreak(proposed, modality)) {
        breakOptions = getScheduleBreakOptions(proposed, modality).filter((breakStart) => {
          const rest = getScheduleBreak({ ...proposed, breakStart }, modality);
          return rest && !overlap({ start: rest.startMinutes, end: rest.endMinutes }, selection);
        });
        if (!breakOptions.length) { rejected = { code: 'break_required', reason: 'El break requerido impediría cubrir todo el intervalo.' }; continue; }
        proposed.breakStart = breakOptions.includes(proposed.breakStart) ? proposed.breakStart : breakOptions[0];
      }
      options.push({ ...option, breakStart: proposed.breakStart || '', breakOptions,
        breakMinutes: requiresScheduleBreak(proposed, modality) ? 45 : 0 });
    }
    if (options.length) result.available.push({ id: person.id, person, kind: 'new-shift', source: null, options });
    else block(rejected.code, rejected.reason);
  }
  return result;
};
