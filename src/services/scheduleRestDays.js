import { isStaffActive } from '../components/Training/staffStatus.js';

const isTrue = value => value === true || value === 1 || value === 'true';

// Count assigned days off from the current draft, independently of list/map
// filters. A study preference, missing shift or compensated holiday is not off.
export function countAssignedRestDays({ staff = [], schedules = {}, day, date } = {}) {
  if (!/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(day || '')) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const [year, month, number] = date.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, number);
  if (selectedDate.getFullYear() !== year || selectedDate.getMonth() !== month - 1 || selectedDate.getDate() !== number) return null;

  const counted = new Set();
  for (const person of staff) {
    if (!person?.id || !isStaffActive(person, selectedDate)) continue;
    const shift = schedules[person.id]?.[day];
    if (isTrue(shift?.off) && !isTrue(shift?.feriado ?? shift?.holiday)) counted.add(person.id);
  }
  return counted.size;
}
