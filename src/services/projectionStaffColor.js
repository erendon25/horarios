const finiteNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function getProjectionStaffColor(value, position = {}) {
  const count = Math.max(0, finiteNumber(value) ?? 0);
  const configuredLimit = finiteNumber(position.logic === 'fixed' ? position.fixedStaff : position.maxStaff);
  const limit = configuredLimit !== null && configuredLimit >= 0 ? configuredLimit : null;
  const description = `${count} ${count === 1 ? 'persona' : 'personas'} · ${limit === null ? 'Sin límite configurado' : `Límite: ${limit}`}`;
  const result = (level, backgroundColor, color) => ({ level, limit, description, style: { backgroundColor, color } });

  if (count === 0) return result('empty', '#f8fafc', '#64748b');
  if (limit !== null && count >= limit) return result('limit', '#fee2e2', '#b91c1c');
  if (count < 2) return result('base', '#eff6ff', '#1d4ed8');
  if (limit === null) return result('unbounded', '#fef3c7', '#92400e');

  // Begin at yellow with two people, moving continuously toward red at this
  // area's configured limit. Each area's scale is independent of the others.
  const progress = Math.max(0, Math.min(1, (count - 2) / (limit - 2)));
  const hue = Number((48 * (1 - progress)).toFixed(3));
  return result('progress', `hsl(${hue}, 95%, 86%)`, `hsl(${hue}, 85%, 25%)`);
}
