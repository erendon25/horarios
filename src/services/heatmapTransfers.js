import { normalizeSchedulePosition } from './scheduleExportData.js';

export const heatmapMinutes = time => {
  const [hour, minute] = String(time).split(':').map(Number);
  return hour * 60 + minute;
};

export function coversTransferMinute(assignment, minute) {
  const start = heatmapMinutes(assignment.start);
  let end = heatmapMinutes(assignment.end);
  if (end <= start) end += 1440;
  return minute >= start && minute < end
    && !(minute >= assignment.breakStartMinutes && minute < assignment.breakEndMinutes);
}

export function transferCandidates(assigned, source, minute) {
  return [...new Map(assigned.filter(item => item.staffId
    && normalizeSchedulePosition(item.position) === normalizeSchedulePosition(source)
    && coversTransferMinute(item, minute)).map(item => [item.staffId, item])).values()];
}

function requiredAt(requirements, position, minute) {
  const index = (requirements.positions || []).findIndex(item => normalizeSchedulePosition(item) === normalizeSchedulePosition(position));
  const column = Math.floor((minute - 480) / 60);
  return column < 0 || index < 0 ? 0 : Number(requirements.matrix?.[index]?.[column]) || 0;
}

export function validateHeatmapTransfer(assigned, requirements, transfer) {
  const { staffId, source, position, start, end } = transfer;
  if (!staffId) return 'Selecciona un colaborador.';
  if (!position || normalizeSchedulePosition(source) === normalizeSchedulePosition(position)) return 'Selecciona otro puesto de destino.';
  if (!(requirements.positions || []).some(item => normalizeSchedulePosition(item) === normalizeSchedulePosition(position))) return 'El puesto destino no está en la proyección del día.';
  if (!Number.isInteger(start) || !Number.isInteger(end) || start % 15 || end % 15 || end <= start || start < 420 || end > 1515) return 'Selecciona un intervalo válido en bloques de 15 minutos.';
  for (let minute = start; minute < end; minute += 15) {
    const sourcePeople = transferCandidates(assigned, source, minute);
    if (!sourcePeople.some(item => item.staffId === staffId)) return 'El colaborador no está disponible en el puesto origen durante todo el intervalo. Revisa su turno, break y otros cambios.';
    // Every quarter must fit entirely within a real working segment.
    if (!assigned.some(item => item.staffId === staffId && normalizeSchedulePosition(item.position) === normalizeSchedulePosition(source)
      && coversTransferMinute(item, minute + 14.999))) return 'El intervalo supera el horario disponible del colaborador.';
    if (sourcePeople.length <= requiredAt(requirements, source, minute)) return 'El movimiento dejaría un faltante en el puesto origen. Acorta el intervalo.';
    if (transferCandidates(assigned, position, minute).length >= requiredAt(requirements, position, minute)) return 'El destino no tiene faltantes durante todo el intervalo. Acorta el intervalo o elige otro puesto.';
  }
  return '';
}

export function replacePositionInterval(shift, transfer) {
  const previous = Array.isArray(shift.positionAssignments) ? shift.positionAssignments : [];
  const assignments = previous.flatMap(item => {
    if (item.end <= transfer.start || item.start >= transfer.end) return [item];
    return [{ ...item, end: transfer.start }, { ...item, start: transfer.end }].filter(part => part.start < part.end);
  });
  if (normalizeSchedulePosition(shift.position) !== normalizeSchedulePosition(transfer.position)) {
    assignments.push({ start: transfer.start, end: transfer.end, position: transfer.position });
  }
  return assignments.sort((a, b) => a.start - b.start);
}
