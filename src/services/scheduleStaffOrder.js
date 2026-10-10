const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

export const isBukScheduleExempt = person => ['GERENTE', 'ASISTENTE'].includes(normalize(person?.position));

export function scheduleStaffRank(person, date) {
  const position = normalize(person.position);
  if (position === 'GERENTE') return 0;
  if (position === 'ASISTENTE') return 1;
  if (['ENTRENADOR', 'TRAINER'].includes(position)) return 2;
  const modality = person.modalityChangeDate && person.nextModality && date >= person.modalityChangeDate
    ? person.nextModality : person.modality;
  return normalize(modality).startsWith('FULL') ? 3 : 4;
}

export function compareScheduleStaff(a, b, date) {
  return scheduleStaffRank(a, date) - scheduleStaffRank(b, date)
    || `${a.name || ''} ${a.lastName || ''}`.trim().localeCompare(`${b.name || ''} ${b.lastName || ''}`.trim(), 'es', { sensitivity: 'base' });
}

export const orderScheduleStaff = (staff, date) => [...staff].sort((a, b) => compareScheduleStaff(a, b, date));
