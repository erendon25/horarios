const WEEKDAY_KEYS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getWeekStart = (isoDate) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return date.toISOString().slice(0, 10);
};

const sumNumericValues = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, child) => sum + sumNumericValues(child), 0);
};

const summarizeWeek = (weekStart, recordsByDate) => {
  const expectedDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const storedDates = expectedDates.filter((date) => recordsByDate.has(date));

  return {
    weekStart,
    weekEnd: expectedDates[6],
    storedDays: storedDates.length,
    storedDates,
    expectedDates,
    isComplete: storedDates.length === 7,
  };
};

export const selectLatestCompleteSalesWeek = (records = []) => {
  const weeks = new Map();

  records.forEach((record) => {
    const salesDate = String(record?.salesDate ?? record?.date ?? record?.id ?? '').slice(0, 10);
    if (!ISO_DATE_PATTERN.test(salesDate)) return;

    const weekStart = getWeekStart(salesDate);
    if (!weeks.has(weekStart)) weeks.set(weekStart, new Map());
    weeks.get(weekStart).set(salesDate, { ...record, salesDate });
  });

  const summaries = [...weeks.entries()]
    .map(([weekStart, recordsByDate]) => ({
      ...summarizeWeek(weekStart, recordsByDate),
      recordsByDate,
    }))
    .sort((left, right) => right.weekStart.localeCompare(left.weekStart));

  const selected = summaries.find((week) => week.isComplete);
  if (!selected) {
    return {
      selectedWeek: null,
      latestAvailableWeek: summaries[0] ?? null,
    };
  }

  const days = selected.expectedDates.map((date) => selected.recordsByDate.get(date));
  const totalSales = days.reduce((sum, day) => sum + (Number(day?.totalSales) || 0), 0);
  const totalTransactions = days.reduce((sum, day) => sum + (Number(day?.totalTxs) || 0), 0);

  return {
    selectedWeek: {
      weekStart: selected.weekStart,
      weekEnd: selected.weekEnd,
      storedDays: selected.storedDays,
      days,
      totalSales,
      totalTransactions,
    },
    latestAvailableWeek: summaries[0] ?? null,
  };
};

export const buildProjectionSalesByDay = (selectedWeek, hourKeys) => {
  const allowedHours = new Set(hourKeys);

  return WEEKDAY_KEYS.reduce((salesByDay, dayKey, dayIndex) => {
    const hourlySales = Object.fromEntries(hourKeys.map((hour) => [hour, 0]));
    const day = selectedWeek?.days?.[dayIndex];

    Object.entries(day?.hourlyData ?? {}).forEach(([rawHour, channelSales]) => {
      const parsedHour = Number.parseInt(rawHour, 10);
      if (!Number.isInteger(parsedHour)) return;

      const hourKey = `${String(parsedHour).padStart(2, '0')}:00`;
      if (allowedHours.has(hourKey)) hourlySales[hourKey] = sumNumericValues(channelSales);
    });

    salesByDay[dayKey] = hourlySales;
    return salesByDay;
  }, {});
};
