import { getAvailableApprovedBukOptions, getBukRestDays, makeApprovedBukPatch } from './bukSchedule.js';
import {
  SCHEDULE_DAYS, getWeekDates, isActiveOnDate, effectiveModality, getExportShiftSegments,
  getHeatmapAssignments, normalizeSchedulePosition, clockFromMinutes,
} from './scheduleExportData.js';
import { getScheduleBreakOptions, getScheduleBreak, requiresScheduleBreak } from './scheduleHours.js';
import { isBukScheduleExempt } from './scheduleStaffOrder.js';
import { getShiftAvailability } from './shiftAvailability.js';
import { buildHeatmapRows, HOURS } from './heatmapModel.js';
import { workCategory, WORK_CATEGORIES } from './coverageInsights.js';

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
// Count actual work in the selected quarters, excluding breaks and exit markers.
const coverageFor = (segments, selection, rest = null) => {
  const coverageRanges = [], uncoveredRanges = [];
  let coveredMinutes = 0;
  for (let time = selection.start; time < selection.end; time += 15) {
    const covered = segments.some(segment => segment.start <= time && segment.end >= time + 15)
      && !(rest && overlap({ start: time, end: time + 15 }, { start: rest.startMinutes, end: rest.endMinutes }));
    const ranges = covered ? coverageRanges : uncoveredRanges;
    if (ranges.at(-1)?.end === time) ranges.at(-1).end += 15;
    else ranges.push({ start: time, end: time + 15 });
    if (covered) coveredMinutes += 15;
  }
  return { coverageRanges, uncoveredRanges, coveredMinutes, remainingMinutes: selection.end - selection.start - coveredMinutes,
    fullCoverage: coveredMinutes === selection.end - selection.start };
};
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
  positionDefinitions,
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
    || selection.start % 15 || selection.end % 15 || selection.start < 420 || selection.end > 1560 || selection.start >= selection.end
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
  const allRows=buildHeatmapRows(assigned,projection);
  const rows = allRows.filter((row) => row.positionKey === key
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
  const department=positionDefinitions?.find(item=>normalizeSchedulePosition(item.name)===key)?.department;
  if(positionDefinitions && !['production','service'].includes(department)) return fail('Configura el área de esta posición en Proyección antes de buscar colaboradores.');
  result.positionDepartmentLabel=WORK_CATEGORIES[department];
  result.uncategorizedStaffCount=0; result.incompatibleStaffCount=0;
  result.coverageNeed=[];
  for(let minute=selection.start;minute<selection.end;minute+=15){
    const index=HOURS.indexOf(clockFromMinutes(minute));
    const missing=allRows.filter(row=>row.positionKey===key && row.cells[index]?.color==='bg-yellow-300').length;
    result.coverageNeed.push({minute,missing});
  }
  result.selection = { ...selection, position: target };
  result.limitations.push('Agregar turno cambia el borrador; Guardar publica los horarios para los colaboradores.');
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
    if(positionDefinitions && !workCategory(person)) {
      result.uncategorizedStaffCount++; block('missing_category','No tiene categoría de trabajo asignada. Edítala en su ficha.'); continue;
    }
    if(positionDefinitions && ![department,'multifunctional'].includes(workCategory(person))) {
      result.incompatibleStaffCount++; block('incompatible_category','Su categoría de trabajo no corresponde al área de esta posición.'); continue;
    }
    if (!positionDefinitions && (!Array.isArray(skills) || !skills.some((skill) => normalizeSchedulePosition(skill) === key))) {
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
    let rejected = { code: 'no_compatible_shift', reason: 'No tiene turnos aprobados disponibles que coincidan con este tramo, ni siquiera parcialmente.' };
    for (const option of catalog) {
      const patch = option.manual ? { start: option.start, end: option.end, off: false, feriado: false, holiday: false,
        splitShift: false, start2: '', end2: '', bukApprovedShiftId: '', bukBreakMinutes: 0, breakStart: '' }
        : { ...makeApprovedBukPatch(option.id, current, day), feriado: false, holiday: false };
      const proposed = { ...current, ...patch, position: target };
      const segments = workSegments(proposed);
      if (!coverageFor(segments, selection).coveredMinutes) continue;
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
        const rankedBreaks = getScheduleBreakOptions(proposed, modality).map(breakStart => ({
          breakStart, coverage: coverageFor(segments, selection, getScheduleBreak({ ...proposed, breakStart }, modality)),
        })).filter(item => item.coverage.coveredMinutes > 0)
          .sort((a, b) => b.coverage.coveredMinutes - a.coverage.coveredMinutes
            || Number(b.breakStart === proposed.breakStart) - Number(a.breakStart === proposed.breakStart));
        breakOptions = rankedBreaks.map(item => item.breakStart);
        if (!breakOptions.length) { rejected = { code: 'break_required', reason: 'No quedan cuartos de hora cubiertos después del break requerido.' }; continue; }
        proposed.breakStart = breakOptions[0];
      }
      const coverage = coverageFor(segments, selection, getScheduleBreak(proposed, modality));
      options.push({ ...option, breakStart: proposed.breakStart || '', breakOptions,
        breakMinutes: requiresScheduleBreak(proposed, modality) ? 45 : 0, ...coverage,
        outsideMinutes: segments.reduce((sum, segment) => sum + segment.end - segment.start, 0)
          - (requiresScheduleBreak(proposed, modality) ? 45 : 0) - coverage.coveredMinutes });
    }
    options.sort((a, b) => b.coveredMinutes - a.coveredMinutes || a.outsideMinutes - b.outsideMinutes
      || Math.abs(minute(a.start) - selection.start) - Math.abs(minute(b.start) - selection.start)
      || a.id.localeCompare(b.id));
    if (options.length) result.available.push({ id: person.id, person, kind: 'new-shift', source: null, options });
    else block(rejected.code, rejected.reason);
  }
  result.available.sort((a, b) => b.options[0].coveredMinutes - a.options[0].coveredMinutes
    || a.options[0].outsideMinutes - b.options[0].outsideMinutes
    || `${a.person.name || ''} ${a.person.lastName || ''}`.localeCompare(`${b.person.name || ''} ${b.person.lastName || ''}`, 'es'));
  return result;
};
