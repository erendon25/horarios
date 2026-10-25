// Projection calculations and HH retain their precision. Only operational
// coverage uses the same whole-person rounding already shown in the UI.
export const operationalStaffCount = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
};
