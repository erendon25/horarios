import { getProjectionPositionDemand, resolveVestidoPositionId } from './projectionDemand.js';
import { isExcludedProjectionStaffRole } from './projectionLabor.js';

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const timeToMinutes = (value) => {
  if (!value || typeof value !== 'string') return null;
  const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
};

const segmentMinutes = (start, end) => {
  const startMinutes = timeToMinutes(start);
  let endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null) return 0;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return endMinutes - startMinutes;
};

export const getScheduledShiftMinutes = (shift) => {
  if (!shift || shift.off || shift.feriado || shift.holiday || !shift.start || !shift.end) return 0;

  let minutes = segmentMinutes(shift.start, shift.end);
  if (shift.splitShift && shift.start2 && shift.end2) {
    minutes += segmentMinutes(shift.start2, shift.end2);
  }
  return minutes;
};

export const calculateHistoricalGeneralVhl = ({ totalSales, schedules = [], staff = [] }) => {
  const excludedStaffIds = new Set(
    staff
      .filter((member) => isExcludedProjectionStaffRole(member)
        || member?.isTrainee === true || member?.isTrainee === 'true' || member?.isTrainee === 1)
      .map((member) => member.id)
  );

  const totalMinutes = schedules.reduce((weekMinutes, schedule) => {
    const staffId = schedule?.staffId ?? schedule?.id?.split('_')[0];
    if (excludedStaffIds.has(staffId)) return weekMinutes;

    return weekMinutes + WEEKDAYS.reduce(
      (dayMinutes, weekday) => dayMinutes + getScheduledShiftMinutes(schedule?.[weekday]),
      0
    );
  }, 0);

  const totalHours = totalMinutes / 60;
  const normalizedSales = Number(totalSales) || 0;

  return {
    totalHours,
    generalVhl: totalHours > 0 ? normalizedSales / totalHours : 0,
  };
};

const clampByBounds = (value, position, { isOperativeHour = true } = {}) => {
  const rawMin = Number(position.minStaff);
  const rawMax = Number(position.maxStaff);
  const min = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 0;
  const max = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : null;

  let result = value;
  if (isOperativeHour && min > 0) result = Math.max(result, min);
  if (max !== null) result = Math.min(result, max);
  return Math.max(0, result);
};

export const calculatePositionStaffByGeneralVhl = ({
  sale,
  generalVhl,
  positions = [],
  vestidoPositionId,
  manualByPosition = {},
  getPositionDemand,
  isOperativeHour = true,
}) => {
  const finiteNonnegative = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  const normalizedSale = finiteNonnegative(sale);
  const normalizedVhl = finiteNonnegative(generalVhl);
  const generalRequiredStaff = normalizedVhl > 0 && normalizedSale > 0
    ? finiteNonnegative(normalizedSale / normalizedVhl)
    : 0;

  const requiredByPosition = {};
  const resolvedVestidoId = resolveVestidoPositionId(positions, vestidoPositionId);
  const vestido = resolvedVestidoId ? positions.find((position) => position.id === resolvedVestidoId) : undefined;
  const allocate = (position, demand) => {
    const manualValue = manualByPosition[position.id];
    if (manualValue !== undefined) return finiteNonnegative(manualValue);
    // Legacy production caps treat an explicit zero as zero demand before the
    // minimum is applied. Other area types keep their existing zero-cap rules.
    const zeroProductionCap = (position === vestido || position.logic === 'sales')
      && position.maxStaff !== '' && position.maxStaff !== null && position.maxStaff !== undefined
      && Number(position.maxStaff) === 0;
    const safeDemand = zeroProductionCap ? 0 : finiteNonnegative(demand);
    // Staffing demand is fractional. Keep it through dependent factors, bounds
    // and hour totals rather than rounding each area up to a whole person.
    return clampByBounds(safeDemand, position, { isOperativeHour });
  };

  // Allocate the designated base first, regardless of position order, logic or
  // factor. All dependent areas receive its bounded/manual final headcount.
  const vestidoStaff = vestido ? allocate(vestido, generalRequiredStaff) : 0;
  if (vestido) requiredByPosition[vestido.id] = vestidoStaff;

  positions.forEach((position) => {
    if (position === vestido) return;
    if (manualByPosition[position.id] !== undefined) {
      requiredByPosition[position.id] = allocate(position, 0);
      return;
    }
    const context = { sale: normalizedSale, vestidoStaff };
    const demand = typeof getPositionDemand === 'function'
      ? getPositionDemand(position, context) : getProjectionPositionDemand(position, context);
    requiredByPosition[position.id] = allocate(position, demand);
  });

  const totalStaffAtHour = Object.values(requiredByPosition).reduce(
    (sum, required) => sum + (Number(required) || 0),
    0
  );

  return {
    generalRequiredStaff,
    vestidoStaff,
    vestidoPositionId: resolvedVestidoId,
    requiredByPosition,
    totalStaffAtHour,
  };
};
