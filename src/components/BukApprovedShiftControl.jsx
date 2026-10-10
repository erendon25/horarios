import { isBukScheduleExempt } from '../services/scheduleStaffOrder.js';
import React, { useState } from 'react';
import { getApprovedBukOptions, makeApprovedBukPatch } from '../services/bukSchedule';

export default function BukApprovedShiftControl({ person, shift, schedule, day, onApply }) {
  const full = String(person.modality || '').toLowerCase() === 'full-time';
  const actualRests = Object.values(schedule || {}).filter(item => item?.off).length;
  const rests = full ? 1 : Math.min(4, Math.max(1, shift?.bukRestDays || Number(shift?.bukApprovedShiftId?.match(/^PT([1-4])-/)?.[1]) || actualRests));
  const [error, setError] = useState('');
  const options = getApprovedBukOptions(person.modality, full ? 1 : rests);
  const selected = options.find(item => item.start === shift?.start && item.end === shift?.end);
  const manual = !selected && Boolean(shift?.start || shift?.end) && !shift?.off;
  if (isBukScheduleExempt(person)) return <p className="text-[10px] text-gray-600">Horario libre · no se envía a BUK</p>;
  return <div className="rounded border border-blue-200 bg-blue-50 p-1 text-[10px]">
    {!full && <label className="block">Descansos del plan
      <select aria-label={`Descansos BUK de ${person.name}`} value={rests} onChange={event => onApply({ bukRestDays: +event.target.value })} className="w-full border rounded">
        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} día{n === 1 ? '' : 's'}</option>)}
      </select>
    </label>}
    <label className="block">Ingreso / salida aprobados
      <select aria-label={`Horario aprobado BUK de ${person.name}`} value={selected?.id || ''}
        disabled={shift?.feriado}
        onChange={event => {
          if (!event.target.value) return;
          try { onApply(makeApprovedBukPatch(event.target.value, shift, day)); setError(''); }
          catch (cause) { setError(cause.message); }
        }} className="w-full border rounded">
        <option value="">{manual ? 'Horario manual' : 'Elegir ingreso…'}</option>
        {options.map(item => <option key={item.id} value={item.id}>{item.start} → {item.end}</option>)}
      </select>
    </label>
    {full && <span>Plan de 1 descanso</span>}
    {manual && <p className="text-amber-700">Fuera del plan aprobado: revisa ingreso y salida.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
