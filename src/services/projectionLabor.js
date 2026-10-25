const normalizePosition = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

// This exclusion belongs to projection labor calculations. Managers can still
// have schedules and cover positions in the editor and coverage map.
export const isExcludedProjectionStaffRole = member =>
  ['GERENTE', 'ASISTENTE'].includes(normalizePosition(member?.position));

export function summarizeProjectionAvailableHours(staff = [], currentDate = new Date()) {
  const today = new Date(currentDate);
  today.setHours(0, 0, 0, 0);
  const isTraineeFlag = member =>
    member?.isTrainee === true || member?.isTrainee === 'true' || member?.isTrainee === 1;
  const isFullTime = member =>
    member.modality === 'Full Time' || member.modality === 'Full-Time' || member.contractType?.includes?.('Full');
  const isPartTime = member =>
    member.modality === 'Part Time' || member.modality === 'Part-Time' || member.contractType?.includes?.('Part');
  const buckets = {
    fullTime: [], partTime: [], gerenciales: [], traineeVencido: [],
    cesados: [], inactivos: [], sinModalidad: [],
  };

  staff.forEach(member => {
    const normalizedName = `${member.name || ''} ${member.lastName || ''}`
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const displayName = normalizedName || member.email || member.id || 's/nombre';
    const isTrainee = isTraineeFlag(member);
    const entry = {
      id: member.id, name: displayName,
      modality: member.modality || member.contractType || '—', isTrainee,
    };

    if (member.status === 'inactive' || member.reconstructed_from_history === true
      || displayName.toLowerCase().startsWith('historico ')) {
      buckets.inactivos.push(entry);
      return;
    }
    if (member.cessationDate && new Date(`${member.cessationDate}T00:00:00`) < today) {
      buckets.cesados.push({ ...entry, cessationDate: member.cessationDate });
      return;
    }
    if (isTrainee && member.trainingEndDate && new Date(`${member.trainingEndDate}T00:00:00`) < today) {
      buckets.traineeVencido.push({ ...entry, trainingEndDate: member.trainingEndDate });
      return;
    }
    if (isExcludedProjectionStaffRole(member)) {
      buckets.gerenciales.push(entry);
      return;
    }
    if (isFullTime(member)) {
      buckets.fullTime.push({ ...entry, hours: 48 });
      return;
    }
    if (isPartTime(member)) {
      buckets.partTime.push({ ...entry, hours: 24 });
      return;
    }
    buckets.sinModalidad.push(entry);
  });

  return { ...buckets, totalHours: buckets.fullTime.length * 48 + buckets.partTime.length * 24 };
}
