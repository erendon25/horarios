import React from 'react';
import BukApprovedShiftControl from './BukApprovedShiftControl';
import ScheduleBreakControl from './ScheduleBreakControl';
import SchedulePositionControl from './SchedulePositionControl';
import { canLimitPositionCoverage, normalizeSchedulePosition } from '../services/scheduleExportData';
import { requiresScheduleBreak } from '../services/scheduleHours';
import { isBukScheduleExempt } from '../services/scheduleStaffOrder';

const TIME_FIELDS = new Set(['start', 'end', 'start2', 'end2', 'extraHours', 'extraHoursPre', 'extraHoursPost']);

export default function ScheduleFocusShiftEditor({
  person, shift = {}, schedule = {}, day, date, positions = [], draftReady = false,
  onChange, onApply, onRetryAvailability, dailyHours, weeklyHours, closingCounts, ceased = false,
}) {
  if (!person) return null;
  const name = [person.name, person.lastName].filter(Boolean).join(' ').trim();
  const dni = person.dni ?? person.DNI;
  const holiday = Boolean(shift.feriado ?? shift.holiday);
  const locked = Boolean(shift.off || holiday);
  const disabled = !draftReady || ceased;
  const availabilityReady = person.studyAvailabilityStatus === 'ready';
  const timeDisabled = disabled || locked || !availabilityReady;
  const modality = person.modality;
  const controlKey = JSON.stringify([person.id, day, date, disabled]);
  const visiblePosition = positions.find((position) =>
    normalizeSchedulePosition(position) === normalizeSchedulePosition(shift.position)) || '';
  const rangesAllowed = canLimitPositionCoverage(person);
  const showRanges = !disabled && !locked && shift.start && shift.end
    && (rangesAllowed || shift.positionAssignments?.length > 0);
  const hasBreak = !ceased && requiresScheduleBreak(shift, modality);

  // The parent owns all draft updates and existing schedule rules. These guards
  // also protect callbacks from a child dialog when its context becomes locked.
  const change = (field, value) => {
    if (disabled || (TIME_FIELDS.has(field) && timeDisabled)) return false;
    if (field === 'off' && holiday) return false;
    if (locked && ['position', 'positionAssignments', 'positionRangesOnly', 'breakStart'].includes(field)) return false;
    return onChange?.(field, value);
  };
  const apply = (patch) => {
    if (disabled) return false;
    if (Object.keys(patch).some((field) => TIME_FIELDS.has(field)) && timeDisabled) return false;
    return onApply?.(patch);
  };

  const clockField = (field, label, testId) => <label className="block min-w-0 text-xs font-semibold text-slate-600">
    {label}
    <input type="time" aria-label={label} title={label} data-testid={testId}
      value={shift[field] || ''} disabled={timeDisabled}
      onChange={(event) => change(field, event.target.value)}
      className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base font-bold tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500" />
  </label>;

  return <section aria-label="Editor de turno" data-testid="focus-shift-editor" className="min-w-0 space-y-4 text-sm">
    {dni !== undefined && dni !== null && String(dni).trim() && <p data-testid="focus-shift-dni" className="text-xs text-slate-500">DNI: <span className="font-semibold tabular-nums text-slate-700">{dni}</span></p>}
    {ceased && <p role="status" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">Colaborador cesado para esta fecha. El turno no se puede editar.</p>}
    {!draftReady && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Cargando el borrador del horario…</p>}

    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Horas del día</p><p data-testid="focus-shift-daily-hours" className="mt-1 text-xl font-bold tabular-nums text-slate-900">{dailyHours ?? '—'}</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Horas de la semana</p><p data-testid="focus-shift-weekly-hours" className="mt-1 text-xl font-bold tabular-nums text-slate-900">{weeklyHours ?? '—'}</p></div>
    </div>

    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="sr-only">Datos del turno</legend>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
          <input type="checkbox" aria-label="Libre" data-testid="focus-shift-off" checked={Boolean(shift.off)}
            disabled={disabled || holiday} onChange={(event) => change('off', event.target.checked)}
            className="h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 disabled:cursor-not-allowed disabled:opacity-50" />
          Libre
        </label>
        <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-900">
          <input type="checkbox" aria-label="Feriado compensado" data-testid="focus-shift-holiday" checked={holiday}
            disabled={disabled} onChange={(event) => change('feriado', event.target.checked)}
            className="h-5 w-5 shrink-0 rounded border-purple-300 text-purple-600 disabled:cursor-not-allowed disabled:opacity-50" />
          Feriado compensado
        </label>
      </div>

      {!ceased && <div data-testid="focus-shift-approved">
        <BukApprovedShiftControl key={controlKey} person={person} shift={shift} schedule={schedule}
          day={day} date={date} onApply={apply} onRetryAvailability={onRetryAvailability} />
      </div>}

      {!ceased && isBukScheduleExempt(person) && !availabilityReady && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <p role={person.studyAvailabilityStatus === 'error' ? 'alert' : 'status'}>{person.studyAvailabilityStatus === 'error'
          ? 'No se pudo consultar la disponibilidad del colaborador.' : 'Cargando disponibilidad…'}</p>
        {person.studyAvailabilityStatus === 'error' && onRetryAvailability && <button type="button" onClick={onRetryAvailability} className="mt-2 min-h-10 rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Reintentar disponibilidad</button>}
      </div>}

      <div className="grid grid-cols-2 gap-3" data-testid="focus-shift-clocks">
        {clockField('start', 'Entrada', 'focus-shift-start')}
        {clockField('end', 'Salida', 'focus-shift-end')}
      </div>

      {shift.splitShift && <div data-testid="focus-shift-historical-split" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-semibold text-amber-900">Segundo tramo conservado</p>
        <div className="grid grid-cols-2 gap-3">
          {clockField('start2', 'Entrada del segundo tramo', 'focus-shift-start2')}
          {clockField('end2', 'Salida del segundo tramo', 'focus-shift-end2')}
        </div>
        <p className="text-xs text-amber-800">Los dos tramos se mantienen hasta que elijas expresamente un horario BUK.</p>
      </div>}

      <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div><p className="text-xs font-bold text-amber-900">Break</p>{!hasBreak && <p className="mt-1 text-xs text-amber-800">Sin break en este turno.</p>}</div>
        {hasBreak && <div className="[&_button]:min-h-10 [&_button]:rounded-lg [&_button]:px-3 [&_button]:text-sm">
          <ScheduleBreakControl key={controlKey} shift={shift} modality={modality} name={name}
            onChange={(value) => change('breakStart', value)} />
        </div>}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-600">Posición
          <select aria-label="Posición del turno" data-testid="focus-shift-position" value={visiblePosition}
            disabled={disabled || locked} onChange={(event) => change('position', event.target.value)}
            className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500">
            <option value="">Sin posición</option>
            {positions.map((position) => <option key={position} value={position}>{position}</option>)}
          </select>
        </label>
        {shift.position && !visiblePosition && <p className="text-xs text-amber-800">Posición guardada: {shift.position}. No está en la proyección de este día.</p>}
        {showRanges && <div className="[&_button]:min-h-10 [&_button]:px-2 [&_button]:text-sm">
          <SchedulePositionControl key={controlKey} shift={shift} modality={modality} name={name} positions={positions}
            allowRangesOnly={rangesAllowed} onModeChange={(value) => change('positionRangesOnly', value)}
            onChange={(value) => change('positionAssignments', value)} />
        </div>}
      </div>

      <details data-testid="focus-shift-extras" className="rounded-xl border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-700">Horas extra y cierres</summary>
        <div className="space-y-3 border-t border-slate-200 p-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['extraHoursPre', 'Horas extra antes', 'focus-shift-extra-pre', shift.extraHoursPre ?? ''],
              ['extraHoursPost', 'Horas extra después', 'focus-shift-extra-post', shift.extraHoursPost ?? shift.extraHours ?? ''],
            ].map(([field, label, testId, value]) => <label key={field} className="block min-w-0 text-xs font-semibold text-slate-600">
              {label}
              <input type="number" min="0" max="12" step="0.5" value={value} placeholder="0"
                aria-label={label} title={label} data-testid={testId} disabled={timeDisabled}
                onChange={(event) => change(field, event.target.value)}
                className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500" />
            </label>)}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div><dt className="font-medium text-slate-500">Pre-cierres</dt><dd data-testid="focus-shift-pre-closings" className="mt-1 font-bold text-orange-700">{closingCounts?.preCierres === undefined ? '—' : `${closingCounts.preCierres}/4`}</dd></div>
            <div><dt className="font-medium text-slate-500">Cierres</dt><dd data-testid="focus-shift-closings" className="mt-1 font-bold text-red-700">{closingCounts?.cierres === undefined ? '—' : `${closingCounts.cierres}/4`}</dd></div>
          </dl>
        </div>
      </details>
    </fieldset>

    <p className="text-xs leading-relaxed text-slate-500">Cada cambio se conserva en el borrador. Usa Guardar en la barra superior para publicarlo.</p>
  </section>;
}
