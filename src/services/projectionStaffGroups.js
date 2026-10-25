export const PROJECTION_DEPARTMENTS = Object.freeze({
  production: 'Producción',
  service: 'Servicio',
});

export function getProjectionDepartment(value) {
  return Object.hasOwn(PROJECTION_DEPARTMENTS, value) ? value : null;
}

export function summarizeProjectionStaffGroups(positions = [], requiredByPosition = {}) {
  const departments = new Map(positions.map(position => [position.id, getProjectionDepartment(position.department)]));
  const totals = { production: 0, service: 0, unclassified: 0, total: 0 };
  for (const [id, rawCount] of Object.entries(requiredByPosition)) {
    const parsed = Number(rawCount);
    const count = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    const department = departments.get(id) || 'unclassified';
    totals[department] += count;
    totals.total += count;
  }
  return totals;
}
