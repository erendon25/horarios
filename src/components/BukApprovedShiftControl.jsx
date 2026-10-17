import { isBukScheduleExempt } from '../services/scheduleStaffOrder.js';
import React, { useState } from 'react';
import { getApprovedBukOptions, makeApprovedBukPatch, getBukRestDays, approvedBukShiftLabel } from '../services/bukSchedule';

export default function BukApprovedShiftControl({ person, shift, schedule, day, onApply }) {
  const full = String(person.modality || '').toLowerCase() === 'full-time';
  const rests = getBukRestDays(person.modality, schedule);
  const holiday = Boolean(shift?.feriado ?? shift?.holiday);
  const locked = Boolean(shift?.off || holiday);
  const [error, setError] = useState('');
  const options = getApprovedBukOptions(person.modality, full ? 1 : rests);
  const selected = options.find(item => item.start === shift?.start && item.end === shift?.end);
  const manual = !locked && !selected && Boolean(shift?.start || shift?.end);
  if (isBukScheduleExempt(person)) return <p className="text-[10px] text-gray-600">Horario libre · no se envía a BUK</p>;
  return <div className="rounded border border-blue-200 bg-blue-50 p-1 text-[10px]">
    {!full && <label className="block">Descansos de la semana
      <select aria-label={`Descansos BUK de ${person.name}`} value={rests} onChange={event => onApply({ bukRestDays: +event.target.value })} className="w-full border rounded">
        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} día{n === 1 ? '' : 's'}</option>)}
      </select>
    </label>}
    <label className="block">Ingreso / salida aprobados
      <select aria-label={`Horario aprobado BUK de ${person.name}`} value={locked ? '' : selected?.id || ''}
        disabled={locked}
        title={shift?.off ? 'Quita la marca Libre para asignar un turno.' : undefined}
        onChange={event => {
          if (locked || !event.target.value) return;
          try { onApply(makeApprovedBukPatch(event.target.value, shift, day)); setError(''); }
          catch (cause) { setError(cause.message); }
        }} className="w-full border rounded">
        <option value="">{shift?.off ? 'Día libre' : holiday ? 'Feriado compensado' : manual ? 'Horario manual' : 'Elegir ingreso…'}</option>
        {options.map(item => <option key={item.id} value={item.id}>{approvedBukShiftLabel(item)}</option>)}
      </select>
    </label>
    {full && <span>Plan de 1 descanso</span>}
    {!full && rests === 1 && <p className="text-blue-800">5 turnos de 4 h y 1 de 3 h 45 min. Sin break.</p>}
    {!full && rests === 2 && <p className="text-blue-800">5 turnos de 4 h 45 min. Sin break.</p>}
    {!full && rests === 3 && <p className="text-blue-800">3 turnos de 6 h 45 min con break de 45 min y 1 de 5 h 45 min sin break.</p>}
    {!full && rests === 4 && <p className="text-blue-800">2 turnos de 8 h 45 min y 1 de 8 h 30 min. Todos con break de 45 min.</p>}
    {manual && <p className="text-amber-700">Fuera del plan aprobado: revisa ingreso y salida.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
