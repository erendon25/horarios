import { coversTransferMinute } from './heatmapTransfers.js';
import { normalizeSchedulePosition } from './scheduleExportData.js';
import { HOURS } from './heatmapModel.js';
import { projectionQuantityAtMinute } from './projectionTimeline.js';
import { operationalStaffCount } from './projectionStaffCount.js';
export const WORK_CATEGORIES = {
  production: 'Producción',
  service: 'Servicio',
  multifunctional: 'Multifuncional'
};
export const workCategory = person => {
  const raw = person && Object.hasOwn(person, 'workCategory') ? person.workCategory : person?.legacy_data?.workCategory;
  const value = String(raw ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return {
    production: 'production',
    produccion: 'production',
    cocina: 'production',
    service: 'service',
    servicio: 'service',
    multifunctional: 'multifunctional',
    multifuncional: 'multifunctional'
  }[value] || '';
};
export function coveragePeopleAt(assigned, minute, position) {
  return [...new Map(assigned.filter(item => (!position || normalizeSchedulePosition(item.position) === normalizeSchedulePosition(position)) && coversTransferMinute(item, minute)).map(item => [item.staffId, item])).values()];
}
export function coverageInsights(assigned, requirements, positions = []) {
  const groups = {
    production: {
      missing: 0,
      excess: 0
    },
    service: {
      missing: 0,
      excess: 0
    },
    unclassified: {
      missing: 0,
      excess: 0
    }
  };
  const names = new Map(positions.map(item => [normalizeSchedulePosition(item.name), item.department]));
  const hours = [];
  let missing = 0,
    excess = 0;
  for (let minute = 420; minute < 1560; minute += 15) {
    requirements.positions?.forEach((position, index) => {
      const need = operationalStaffCount(projectionQuantityAtMinute(requirements, index, minute));
      const count = coveragePeopleAt(assigned, minute, position).length;
      const gap = Math.max(0, need - count) * .25,
        extra = Math.max(0, count - need) * .25;
      const group = groups[names.get(normalizeSchedulePosition(position))] || groups.unclassified;
      missing += gap;
      excess += extra;
      group.missing += gap;
      group.excess += extra;
    });
  }
  for (let minute = 420; minute < 1560; minute += 60) {
    const quarters = [0, 15, 30, 45].map(offset => ({
      minute: minute + offset,
      people: coveragePeopleAt(assigned, minute + offset)
    }));
    const counts = quarters.map(item => item.people.length);
    hours.push({
      minute,
      min: Math.min(...counts),
      max: Math.max(...counts),
      quarters
    });
  }
  return {
    missing,
    excess,
    groups,
    hours
  };
}

// Match the same visual allocation order as the matrix. Exit markers have no duration.
export function cellOccupants(assigned, rows) {
  const map = new Map();
  const minuteOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const starts = new Set(assigned.map(item => `${normalizeSchedulePosition(item.position)}:${minuteOf(item.start) % 1440}`));
  const cohorts = new Map();
  const norms = new Set(rows.map(row => row.positionKey));
  for (const norm of norms) for (const [index, hour] of HOURS.entries()) {
    const minute = minuteOf(hour);
    const people = assigned.filter(item => {
      if (normalizeSchedulePosition(item.position) !== norm) return false;
      const start = minuteOf(item.start);
      let end = minuteOf(item.end);
      if (end <= start) end += 1440;
      return minute >= start && (minute < end || minute === end && !item.endExclusive && !starts.has(`${norm}:${end % 1440}`)) && !(minute >= item.breakStartMinutes && minute < item.breakEndMinutes);
    });
    cohorts.set(`${norm}:${index}`, people);
  }
  for (const row of rows) for (const [index, hour] of HOURS.entries()) {
    const minute = minuteOf(hour);
    const people = cohorts.get(`${row.positionKey}:${index}`) || [];
    const person = people[row.slot];
    if (person) map.set(`${row.positionKey}-${row.slot}:${index}`, {
      ...person,
      exit: minute === Number(person.end.slice(0, 2)) * 60 + Number(person.end.slice(3))
    });
  }
  return map;
}
