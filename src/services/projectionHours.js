const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const isObject = (value) => value !== null && typeof value === 'object';
const isIndex = (key) => /^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key));

const quantity = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const hoursForDay = (source, projectionPositions) => {
  // Do not use getProjectionForDay here: its zero-filled fallback is useful for
  // drawing, but would turn a day without a saved matrix into a zero-hour day.
  if (!isObject(source) || Array.isArray(source) || !isObject(source.matrix)) return null;
  const fallback = Array.isArray(projectionPositions)
    ? projectionPositions.map((position) => typeof position === 'string' ? position : position?.name).filter(Boolean)
    : [];
  const positions = Array.isArray(source.positions) && source.positions.length ? source.positions : fallback;

  let hours = 0;
  for (let index = 0; index < positions.length; index += 1) {
    if (!Object.hasOwn(positions, index) || !Object.hasOwn(source.matrix, index)) continue;
    const row = source.matrix[index];
    if (!isObject(row)) continue;
    for (const [column, value] of Object.entries(row)) {
      if (!isIndex(column)) continue;
      // Each raw cell represents one hour times its required headcount. It is
      // independent of rendered lanes, 15-minute colors and the exit marker.
      hours += quantity(value);
      if (!Number.isFinite(hours)) return null;
    }
  }
  return hours;
};

export const summarizeProjectionHours = (requirements, projectionPositions, selectedDay) => {
  const source = isObject(requirements) ? requirements : {};
  const byDay = Object.fromEntries(DAYS.map((day) => [day, hoursForDay(source[day], projectionPositions)]));
  const available = Object.values(byDay).filter((hours) => hours !== null);
  const total = available.reduce((sum, hours) => sum + hours, 0);
  const weekHours = available.length && Number.isFinite(total) ? total : null;
  return {
    dayHours: byDay[selectedDay] ?? null,
    weekHours,
    availableDays: available.length,
    completeWeek: available.length === DAYS.length && weekHours !== null,
  };
};
