import { isBukScheduleExempt } from '../services/scheduleStaffOrder.js';
import React, { useState } from 'react';
import { getApprovedBukOptions, getAvailableApprovedBukOptions, getBukWeeklyShiftQuota, makeApprovedBukPatch, getBukRestDays, approvedBukShiftLabel, getBukCatalogShift } from '../services/bukSchedule';
import { formatScheduleMinutes } from '../services/scheduleHours';

export default function BukApprovedShiftControl({ person, shift, schedule, day, onApply }) {
  const full = String(person.modality || '').toLowerCase() === 'full-time';
  const rests = getBukRestDays(person.modality, schedule);
  const holiday = Boolean(shift?.feriado ?? shift?.holiday);
  const locked = Boolean(shift?.off || holiday);
  const [error, setError] = useState('');
  const allOptions = getApprovedBukOptions(person.modality, full ? 1 : rests);
  const options = getAvailableApprovedBukOptions(person.modality, full ? 1 : rests, schedule, day);
  const quota = getBukWeeklyShiftQuota(person.modality, rests, schedule, day);
  const selected = allOptions.find(item => item.start === shift?.start && item.end === shift?.end);
  const overQuota = selected && !options.some(item => item.id === selected.id);
  const buk = getBukCatalogShift(shift, day);
  const manual = !locked && !selected && Boolean(shift?.start || shift?.end);
  if (isBukScheduleExempt(person)) return <p className="text-[10px] text-gray-600">Horario libre · no se envía a BUK</p>;
  return <div className="rounded border border-blue-200 bg-blue-50 p-1 text-[10px]">
    {!full && <label className="block">Descansos de la semana
      <select aria-label={`Descansos BUK de ${person.name}`} value={rests} onChange={event => { onApply({ bukRestDays: +event.target.value }); setError(''); }} className="w-full border rounded">
        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} día{n === 1 ? '' : 's'}</option>)}
      </select>
    </label>}
    <label className="block">Ingreso / salida aprobados
      <select aria-label={`Horario aprobado BUK de ${person.name}`} value={locked ? '' : selected?.id || ''}
        disabled={locked}
        title={shift?.off ? 'Quita la marca Libre para asignar un turno.' : undefined}
        onChange={event => {
          if (locked || !event.target.value) return;
          if (!options.some(item => item.id === event.target.value)) { setError('Ese turno ya no está disponible en la distribución semanal.'); return; }
          try { onApply(makeApprovedBukPatch(event.target.value, shift, day)); setError(''); }
          catch (cause) { setError(cause.message); }
        }} className="w-full border rounded">
        <option value="">{shift?.off ? 'Día libre' : holiday ? 'Feriado compensado' : manual ? 'Horario manual' : 'Elegir ingreso…'}</option>
        {!locked && overQuota && <option value={selected.id} disabled>{approvedBukShiftLabel(selected)} · Revisar distribución</option>}
        {options.map(item => <option key={item.id} value={item.id}>{approvedBukShiftLabel(item)}</option>)}
      </select>
    </label>
    {buk && <p className="text-gray-700">Refrigerio BUK: {buk.breakStart ? `${buk.breakStart}–${buk.breakEnd}` : 'sin refrigerio'}.</p>}
    {full && <span>Plan de 1 descanso</span>}
    {!full && rests === 1 && <p className="text-blue-800">5 turnos de 4 h y 1 de 3 h 45 min. Sin break.</p>}
    {!full && rests === 2 && <p className="text-blue-800">5 turnos de 4 h 45 min. Sin break.</p>}
    {!full && rests === 3 && <p className="text-blue-800">3 turnos de 6 h 45 min con break de 45 min y 1 de 5 h 45 min sin break.</p>}
    {!full && rests === 4 && <p className="text-blue-800">2 turnos de 8 h 45 min y 1 de 8 h 30 min. Todos con break de 45 min.</p>}
    {!full && !locked && options.length > 0 && <p className="text-blue-800">Por completar, sin contar este día: {quota.filter(slot => slot.remaining > 0).map(slot => `${slot.remaining} de ${formatScheduleMinutes(slot.duration)} h`).join(' y ')}.</p>}
    {!full && !locked && !options.length && <p className="text-amber-700">Los turnos del plan ya están asignados en los otros días. Revisa los descansos o modifica otro día.</p>}
    {!locked && overQuota && <p className="text-amber-700">Este turno supera la distribución semanal. Elige uno de los turnos disponibles.</p>}
    {manual && <p className="text-amber-700">Fuera del plan aprobado: revisa ingreso y salida.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
