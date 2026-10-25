import React from 'react';

const hoursFormatter = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });
const formatHours = (value) => `${hoursFormatter.format(value)} h`;

export default function ProjectionHoursSummary({ summary, dayLabel = 'Día' }) {
  if (!summary) return null;
  const { dayHours, status = 'ready' } = summary;
  const display = (value) => status === 'loading' ? 'Cargando…'
    : status === 'error' ? 'No disponible'
      : value === null ? 'Sin proyección' : formatHours(value);

  return (
    <div data-testid="projection-hours-summary" className="mt-2 min-w-0">
      <dl aria-label="Horas hombre de proyección del día seleccionado" className="grid min-w-0 grid-cols-1 gap-2">
        <div data-testid="projection-hours-day" className="min-w-0 rounded-lg border border-violet-300/30 bg-violet-400/10 px-2 py-1.5">
          <dt className="text-[10px] font-semibold text-violet-100">HH proyección · {dayLabel}</dt>
          <dd className="mt-0.5 break-words text-sm font-bold text-white">{display(dayHours)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-[10px] text-slate-300">Según la proyección guardada de esta tienda para el día seleccionado.</p>
    </div>
  );
}
