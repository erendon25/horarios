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
  const traineeIds = new Set(
    staff
      .filter((member) => member?.isTrainee === true || member?.isTrainee === 'true' || member?.isTrainee === 1)
      .map((member) => member.id)
  );

  const totalMinutes = schedules.reduce((weekMinutes, schedule) => {
    const staffId = schedule?.staffId ?? schedule?.id?.split('_')[0];
    if (traineeIds.has(staffId)) return weekMinutes;

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
  positions,
  manualByPosition = {},
  getPositionDemand,
  isOperativeHour = true,
}) => {
  const normalizedSale = Math.max(0, Number(sale) || 0);
  const normalizedVhl = Number(generalVhl) || 0;
  const generalRequiredStaff = normalizedVhl > 0 && normalizedSale > 0
    ? normalizedSale / normalizedVhl
    : 0;

  const requiredByPosition = {};

  positions.forEach((position) => {
    const manualValue = manualByPosition[position.id];
    if (manualValue !== undefined) {
      requiredByPosition[position.id] = Math.max(0, Math.round(Number(manualValue) || 0));
      return;
    }

    const demand = Math.max(0, Number(getPositionDemand(position)) || 0);
    const rounded = demand > 0 ? Math.ceil(demand) : 0;
    requiredByPosition[position.id] = clampByBounds(rounded, position, { isOperativeHour });
  });

  const totalStaffAtHour = Object.values(requiredByPosition).reduce(
    (sum, required) => sum + (Number(required) || 0),
    0
  );

  return {
    generalRequiredStaff,
    requiredByPosition,
    totalStaffAtHour,
  };
};
