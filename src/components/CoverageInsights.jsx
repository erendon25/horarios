import React, { useMemo, useState } from 'react';
import { coverageInsights } from '../services/coverageInsights';
import { clockFromMinutes } from '../services/scheduleExportData';
export default function CoverageInsights({
  assigned,
  requirements,
  positions,
  status = 'ready',
  filtered = false,
  onSelectPerson
}) {
  const value = useMemo(() => coverageInsights(assigned, requirements, positions), [assigned, requirements, positions]);
  const [hour, setHour] = useState(null),
    detail = value.hours.find(item => item.minute === hour);
  return <div data-testid="coverage-insights" className="mt-2 text-xs text-slate-100">
    <details><summary className="min-h-8 cursor-pointer py-1 font-semibold">Faltan {status === 'ready' ? value.missing.toFixed(2) : '—'} h · Sobran {status === 'ready' ? value.excess.toFixed(2) : '—'} h<span className="hidden sm:inline"> {filtered ? '· Cobertura filtrada' : '· Toda la tienda'}</span></summary>
      {status !== 'ready' ? <p role="status">{status === 'error' ? 'No se pudo cargar la proyección.' : 'Cargando proyección y horarios…'}</p> : <ul>{Object.entries(value.groups).map(([key, group]) => <li key={key}>{{
            production: 'Producción',
            service: 'Servicio',
            unclassified: 'Sin clasificar'
          }[key]}: faltan {group.missing.toFixed(2)} h · sobran {group.excess.toFixed(2)} h</li>)}</ul>}
    </details>
    <details><summary className="min-h-8 cursor-pointer py-1 font-semibold">Personas por hora</summary><p className="mb-2">Mínimo–máximo de los cuatro cuartos; no incluye breaks ni marcas de salida.</p><div className="flex flex-wrap gap-1">{value.hours.map(item => <button type="button" aria-label={`Personas a las ${clockFromMinutes(item.minute)}`} key={item.minute} onClick={() => setHour(hour === item.minute ? null : item.minute)} className="rounded border border-white/30 px-2 py-1">{clockFromMinutes(item.minute)} · {item.min === item.max ? item.min : `${item.min}–${item.max}`}</button>)}</div>
      {detail && <div role="region" aria-label="Personas por cuarto de hora" className="mt-2 space-y-2 rounded bg-slate-800 p-2">{detail.quarters.map(quarter => <div key={quarter.minute}><strong>{clockFromMinutes(quarter.minute)} · {quarter.people.length} personas</strong><div className="flex flex-wrap gap-2">{quarter.people.map(person => <button key={person.staffId} type="button" onClick={() => onSelectPerson?.(person.staffId)} className="min-h-8 underline">{person.staffName} · {person.position}</button>)}</div></div>)}</div>}
    </details>
  </div>;
}
