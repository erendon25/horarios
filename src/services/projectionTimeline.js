export const PROJECTION_INTERVAL_MINUTES = 15;

export const projectionIntervalMinutes = source => source?.intervalMinutes === 15 ? 15 : 60;
export const projectionStartMinutes = source => Number.isInteger(source?.startMinutes)
  && source.startMinutes >= 0 ? source.startMinutes : 8 * 60;

const clock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const expandProjectionHours = hours => hours.flatMap(hour => {
  const start = Number(hour.split(':')[0]) * 60;
  return [0, 15, 30, 45].map(offset => ({ hour: clock(start + offset), sourceHour: hour }));
});

// Old manual edits applied to an entire hour. Expand them once on load so a
// subsequent edit at :00 does not silently overwrite the other three quarters.
export const normalizeProjectionManualStaff = (byDay = {}, intervalMinutes = 60) => {
  if (intervalMinutes === 15) return byDay;
  return Object.fromEntries(Object.entries(byDay).map(([day, positions]) => [day,
    Object.fromEntries(Object.entries(positions || {}).map(([id, values]) => [id,
      Object.fromEntries(Object.entries(values || {}).flatMap(([hour, value]) =>
        expandProjectionHours([hour]).map(slot => [slot.hour, value]))),
    ])),
  ]));
};

// Unlabelled legacy matrices are hourly and begin at 08:00. New matrices
// explicitly record their first interval, including stores that open later.
export const projectionQuantityAtMinute = (source, rowIndex, minute) => {
  const column = Math.floor((minute - projectionStartMinutes(source)) / projectionIntervalMinutes(source));
  const value = column >= 0 ? source?.matrix?.[rowIndex]?.[column] : 0;
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
};
