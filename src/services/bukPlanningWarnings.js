import { getAvailableApprovedBukOptions, getBukRestDays } from './bukSchedule.js';
import { effectiveModality, SCHEDULE_DAYS } from './scheduleExportData.js';
import { isBukScheduleExempt } from './scheduleStaffOrder.js';
import { getScheduleBreak, requiresScheduleBreak, calculateScheduleTotals } from './scheduleHours.js';
export function bukPlanningWarnings(staff, schedules, weekStart) {
  return staff.flatMap(person => {
    if (isBukScheduleExempt(person)) return [];
    const schedule = schedules[person.id] || {},
      modality = effectiveModality(person, weekStart),
      rest = getBukRestDays(modality, schedule),
      warnings = [];
    for (const day of SCHEDULE_DAYS) {
      const shift = schedule[day];
      if (!shift || shift.off || !(shift.start || shift.end)) continue;
      const matches = getAvailableApprovedBukOptions(modality, rest, schedule, day).some(option => option.start === shift.start && option.end === shift.end);
      if (!matches || shift.splitShift) warnings.push({
        day,
        message: 'El turno no coincide con los horarios aprobados o la cuota disponible del plan BUK.'
      });
      if (requiresScheduleBreak(shift, modality) && !getScheduleBreak(shift, modality)) warnings.push({
        day,
        message: 'Break pendiente o fuera del turno.'
      });
    }
    const actual = SCHEDULE_DAYS.filter(day => schedule[day]?.off).length;
    if (actual !== rest) warnings.push({
      message: `Plan de ${rest} descansos; hay ${actual} asignados.`
    });
    const total = calculateScheduleTotals(schedule, person, weekStart).totalMinutes;
    const expected = String(modality).toLowerCase() === 'full-time' ? 2880 : 1425;
    if (total !== expected) warnings.push({
      message: `Horas semanales: ${(total / 60).toFixed(2)} h; referencia ${(expected / 60).toFixed(2)} h.`
    });
    return warnings.length ? [{
      id: person.id,
      name: [person.name, person.lastName].filter(Boolean).join(' '),
      warnings
    }] : [];
  });
}
