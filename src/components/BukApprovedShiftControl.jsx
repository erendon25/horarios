import { isBukScheduleExempt } from '../services/scheduleStaffOrder.js';
import React, { useState } from 'react';
import { getApprovedBukOptions, getAvailableApprovedBukOptions, getBukWeeklyShiftQuota, makeApprovedBukPatch, getBukRestDays, approvedBukShiftLabel, getBukCatalogShift } from '../services/bukSchedule';
import { formatScheduleMinutes } from '../services/scheduleHours';
import { filterShiftsByAvailability, getShiftAvailability } from '../services/shiftAvailability';
import ApprovedShiftPicker from './ApprovedShiftPicker';

export default function BukApprovedShiftControl({ person, shift, schedule, day, date, onApply, onRetryAvailability }) {
  const full = String(person.modality || '').toLowerCase() === 'full-time';
  const rests = getBukRestDays(person.modality, schedule);
  const holiday = Boolean(shift?.feriado ?? shift?.holiday);
  const locked = Boolean(shift?.off || holiday);
  const [error, setError] = useState('');
  const allOptions = getApprovedBukOptions(person.modality, full ? 1 : rests);
  const quotaOptions = getAvailableApprovedBukOptions(person.modality, full ? 1 : rests, schedule, day);
  const availabilityStatus = person.studyAvailabilityStatus || 'loading';
  const options = availabilityStatus === 'ready'
    ? filterShiftsByAvailability(quotaOptions, { date, studySchedule: person.study_schedule, shiftPatch: shift }) : [];
  const quota = getBukWeeklyShiftQuota(person.modality, rests, schedule, day);
  const selected = !shift?.splitShift && allOptions.find(item => item.start === shift?.start && item.end === shift?.end);
  const overQuota = selected && !quotaOptions.some(item => item.id === selected.id);
  const availability = availabilityStatus === 'ready' ? getShiftAvailability({ date, shift, studySchedule: person.study_schedule }) : null;
  const studyConflict = !locked && availability && !availability.available;
  const unavailableSelection = selected && (overQuota || studyConflict || availabilityStatus !== 'ready');
  const buk = getBukCatalogShift(shift, day);
  const manual = !locked && !selected && Boolean(shift?.start || shift?.end);
  if (isBukScheduleExempt(person)) return <p className="text-[10px] text-gray-600">Horario libre · no se envía a BUK</p>;
  return <div className="rounded border border-blue-200 bg-blue-50 p-1 text-[10px]">
    {!full && <label className="block">Descansos de la semana
      <select aria-label={`Descansos BUK de ${person.name}`} value={rests} onChange={event => { onApply({ bukRestDays: +event.target.value }); setError(''); }} className="w-full border rounded">
        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} día{n === 1 ? '' : 's'}</option>)}
      </select>
    </label>}
    <div className="block">Ingreso / salida aprobados
      <ApprovedShiftPicker label={`Horario aprobado BUK de ${person.name}`} value={locked ? '' : selected?.id || ''}
        options={options}
        placeholder={shift?.off ? 'Día libre' : holiday ? 'Feriado compensado' : manual ? 'Horario manual' : 'Elegir ingreso…'}
        currentLabel={!locked && unavailableSelection ? `${approvedBukShiftLabel(selected)} · ${studyConflict ? 'No disponible por estudios' : availabilityStatus !== 'ready' ? 'Disponibilidad pendiente' : 'Revisar distribución'}` : undefined}
        contextLabel={`${[person.name, person.lastName].filter(Boolean).join(' ')} · ${date ? date.split('-').reverse().join('/') : day}`}
        contextKey={JSON.stringify([person.id, person.storeId, day, date, person.modality, full ? 1 : rests])}
        disabled={locked || availabilityStatus !== 'ready'}
        onChange={optionId => {
          if (locked || availabilityStatus !== 'ready' || !optionId) return false;
          if (!options.some(item => item.id === optionId)) { setError('Ese turno ya no está disponible en la distribución semanal.'); return false; }
          try {
            const result = onApply(makeApprovedBukPatch(optionId, shift, day));
            if (result === false) return false;
            setError(''); return true;
          } catch (cause) { setError(cause.message); throw cause; }
        }} />
    </div>
    {buk && <p className="text-gray-700">Refrigerio BUK: {buk.breakStart ? `${buk.breakStart}–${buk.breakEnd}` : 'sin refrigerio'}.</p>}
    {full && <span>Plan de 1 descanso</span>}
    {!full && rests === 1 && <p className="text-blue-800">5 turnos de 4 h y 1 de 3 h 45 min. Sin break.</p>}
    {!full && rests === 2 && <p className="text-blue-800">5 turnos de 4 h 45 min. Sin break.</p>}
    {!full && rests === 3 && <p className="text-blue-800">3 turnos de 6 h 45 min con break de 45 min y 1 de 5 h 45 min sin break.</p>}
    {!full && rests === 4 && <p className="text-blue-800">2 turnos de 8 h 45 min y 1 de 8 h 30 min. Todos con break de 45 min.</p>}
    {!full && !locked && options.length > 0 && <p className="text-blue-800">Por completar, sin contar este día: {quota.filter(slot => slot.remaining > 0).map(slot => `${slot.remaining} de ${formatScheduleMinutes(slot.duration)} h`).join(' y ')}.</p>}
    {!locked && availabilityStatus === 'loading' && <p className="text-blue-800">Cargando disponibilidad…</p>}
    {!locked && availabilityStatus === 'error' && <p role="alert" className="text-red-700">No se pudo consultar la disponibilidad. {onRetryAvailability && <button type="button" onClick={onRetryAvailability} className="underline">Reintentar disponibilidad</button>}</p>}
    {!full && !locked && availabilityStatus === 'ready' && !quotaOptions.length && <p className="text-amber-700">Los turnos del plan ya están asignados en los otros días. Revisa los descansos o modifica otro día.</p>}
    {!locked && availabilityStatus === 'ready' && quotaOptions.length > 0 && !options.length && <p className="text-amber-700">No hay turnos aprobados compatibles con su disponibilidad para este día.</p>}
    {studyConflict && <p className="text-amber-700">El horario actual tiene un conflicto: {availability.reasons[0]?.message} Elige otro turno; no se ha borrado el horario guardado.</p>}
    {!locked && overQuota && <p className="text-amber-700">Este turno supera la distribución semanal. Elige uno de los turnos disponibles.</p>}
    {manual && <p className="text-amber-700">{shift?.splitShift ? 'Turno partido conservado. Elige un horario BUK para reemplazar ambos tramos.' : 'Fuera del plan aprobado: revisa ingreso y salida.'}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
