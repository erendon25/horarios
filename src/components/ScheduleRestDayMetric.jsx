import React from 'react';

export default function ScheduleRestDayMetric({ count, ready, dayLabel = 'Día' }) {
  const available = ready && Number.isInteger(count);
  return <dl data-testid="schedule-rest-day-metric" aria-label={`Descansos asignados · ${dayLabel}`}
    title="Colaboradores activos de toda la tienda con día libre asignado en el borrador de esta fecha. No incluye feriados compensados, preferencias de estudio ni personas sin turno."
    className="min-w-[120px] flex-1 text-slate-700">
    <dt className="text-[11px] font-semibold uppercase text-gray-500">Descansos asignados</dt>
    <dd data-testid="schedule-rest-day-count" role="status" className="mt-0.5 text-sm font-bold tabular-nums text-teal-700">
      {!ready ? 'Cargando…' : available ? `${count} ${count === 1 ? 'persona' : 'personas'}` : 'No disponible'}
    </dd>
  </dl>;
}
