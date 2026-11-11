import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCHEDULE_DAYS, getWeekDates, effectiveModality, isActiveOnDate, clockFromMinutes } from '../services/scheduleExportData';
import { scheduleBreakLabel, calculateScheduleTotals, formatScheduleMinutes } from '../services/scheduleHours';
import { WORK_CATEGORIES, workCategory } from '../services/coverageInsights';
import { approvedBukShiftLabel } from '../services/bukSchedule';
export function ScheduleDialog({
  title,
  onClose,
  children,
  footer
}) {
  const dialog = useRef(null),
    close = useRef(null);
  useEffect(() => {
    const node = dialog.current,
      previous = document.activeElement;
    const body = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    return () => {
      node.close();
      document.body.style.overflow = body;
      if (previous?.isConnected) previous.focus({
        preventScroll: true
      });
    };
  }, []);
  return createPortal(<dialog ref={dialog} aria-label={title} onCancel={event => {
    event.preventDefault();
    onClose();
  }} className="fixed inset-0 m-auto max-h-[calc(100dvh-24px)] w-[min(1100px,calc(100vw-24px))] max-w-none overflow-hidden rounded-xl border-0 bg-white p-0 shadow-2xl backdrop:bg-black/60">
    <div className="flex max-h-[calc(100dvh-24px)] flex-col"><header className="flex shrink-0 items-center justify-between gap-3 border-b p-3"><h2 className="font-bold">{title}</h2><button type="button" ref={close} aria-label={`Cerrar ${title}`} onClick={onClose} className="min-h-10 rounded border px-3">Cerrar</button></header>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>{footer && <footer className="shrink-0 border-t p-3">{footer}</footer>}
    </div>
  </dialog>, document.body);
}
export function CoveragePlacementDialog({
  placement,
  positions,
  onTarget,
  onOption,
  onApply,
  onClose
}) {
  const [position, setPosition] = useState(placement.position || positions[0] || '');
  const [start, setStart] = useState(placement.start ?? 720);
  const plan = placement.plan;
  return <ScheduleDialog title={`Colocar en cobertura · ${placement.name}`} onClose={onClose} footer={<div className="flex flex-wrap items-center justify-end gap-2"><span className="mr-auto text-xs text-slate-600">Se modifica el borrador. Usa Guardar para publicarlo.</span><button type="button" onClick={onClose} className="min-h-10 rounded border px-3">Cancelar</button><button type="button" disabled={placement.busy || !plan || Boolean(placement.error) || position !== placement.position || start !== placement.start} onClick={onApply} className="min-h-10 rounded bg-blue-700 px-3 text-white disabled:opacity-50">{placement.busy ? 'Comprobando…' : 'Confirmar colocación'}</button></div>}>
    <form onSubmit={event => {
      event.preventDefault();
      onTarget(position, start);
    }} className="flex flex-wrap items-end gap-3">
      <label>Posición<select aria-label="Posición de colocación" className="mt-1 block min-h-10 rounded border px-2" value={position} onChange={event => setPosition(event.target.value)}>{positions.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Ingreso / punto del mapa<select aria-label="Hora de colocación" className="mt-1 block min-h-10 rounded border px-2" value={start} onChange={event => setStart(Number(event.target.value))}>{Array.from({
            length: 76
          }, (_, i) => 420 + i * 15).map(minute => <option key={minute} value={minute}>{clockFromMinutes(minute)}</option>)}</select></label>
      <button type="submit" disabled={placement.busy} className="min-h-10 rounded border border-blue-300 px-3 text-blue-800">Ver propuesta</button>
    </form>
    {placement.busy && <p role="status" className="mt-4">Verificando horario, disponibilidad y semanas contiguas…</p>}
    {placement.error && <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-red-800">{placement.error}</p>}
    {plan && !placement.busy && <div data-testid="coverage-placement-preview" className="mt-4 space-y-3 rounded border border-blue-200 bg-blue-50 p-3">
      <p className="font-semibold">{plan.operation === 'move' ? 'Mover turno' : 'Agregar turno'} · {plan.patch.position} · {plan.patch.start}–{plan.patch.end}</p>
      {plan.options.length > 1 && <label className="block text-sm">Turno aprobado<select aria-label="Turno de colocación" value={plan.optionId} onChange={event => onOption(event.target.value)} className="mt-1 block max-w-full rounded border p-2">{plan.options.map(option => <option key={option.id} value={option.id}>{option.manual ? `${option.start}–${option.end}` : approvedBukShiftLabel(option)}</option>)}</select></label>}
      <p className="text-sm">{plan.patch.breakStart ? `Break: ${plan.patch.breakStart}` : 'Sin break asignado'}</p>
      {plan.operation === 'move' && <p className="text-xs">Se reemplaza el turno de este día y sus asignaciones por tramos. Deshacer permite recuperarlo antes de guardar.</p>}
    </div>}
  </ScheduleDialog>;
}
const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const contextShiftLabel = shift => !shift ? 'Sin asignar' : shift.off ? 'Descanso' : shift.feriado || shift.holiday ? 'Feriado compensado' : shift.start && shift.end ? `${shift.start}–${shift.end}${shift.splitShift ? ` / ${shift.start2}–${shift.end2}` : ''}` : 'Sin turno';
export function ScheduleWeekDialog({
  staff,
  schedules,
  weekStart,
  dirty,
  onClose
}) {
  const [breaks, setBreaks] = useState(false),
    dates = getWeekDates(weekStart);
  return <ScheduleDialog title="Horario semanal" onClose={onClose}><div className="mb-3 flex flex-wrap items-center gap-3"><p className="text-sm">{dirty ? 'Incluye cambios del borrador sin guardar.' : 'Horario del editor.'}</p><button type="button" onClick={() => setBreaks(value => !value)} className="min-h-10 rounded border px-3">{breaks ? 'Ver turnos' : 'Ver breaks'}</button></div>
    <table className="min-w-[900px] text-left text-xs"><thead><tr><th className="p-2">Colaborador / categoría</th>{dates.map((date, i) => <th key={date} className="p-2">{labels[i]} {date.slice(5)}</th>)}</tr></thead>
      <tbody>{['production', 'service', 'multifunctional', ''].flatMap(category => staff.filter(person => workCategory(person) === category).map(person => <tr key={person.id} className="border-t"><th className="p-2">{person.name} {person.lastName}<span className="block font-normal text-slate-500">{WORK_CATEGORIES[category] || 'Sin categorizar'}</span></th>{SCHEDULE_DAYS.map((day, index) => <td key={day} className="whitespace-nowrap p-2">{!isActiveOnDate(person, dates[index]) ? 'Fuera de vigencia' : breaks ? scheduleBreakLabel(schedules[person.id]?.[day], effectiveModality(person, dates[index])) || '—' : contextShiftLabel(schedules[person.id]?.[day])}</td>)}</tr>))}</tbody>
    </table></ScheduleDialog>;
}
export function StaffInfoDialog({
  person,
  schedules,
  weekStart,
  date,
  onClose,
  onCategory
}) {
  const [category, setCategory] = useState(workCategory(person)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const totals = calculateScheduleTotals(schedules[person.id], person, weekStart);
  return <ScheduleDialog title={`Ficha de ${person.name} ${person.lastName || ''}`} onClose={onClose}>
    <p className="text-sm">{effectiveModality(person, date)} · {person.position} · Semana {formatScheduleMinutes(totals.totalMinutes)} h</p>
    <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-sm">Categoría de trabajo<select aria-label="Categoría de trabajo" value={category} onChange={event => setCategory(event.target.value)} className="mt-1 block rounded border p-2"><option value="">Sin categorizar</option>{Object.entries(WORK_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{onCategory && <button type="button" disabled={busy} className="min-h-10 rounded border px-3" onClick={async () => {
        setBusy(true);
        setError('');
        try {
          await onCategory(person.id, category);
        } catch (failure) {
          setError(failure.message);
        } finally {
          setBusy(false);
        }
      }}>{busy ? 'Guardando…' : 'Guardar categoría'}</button>}</div>
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    <p className="mt-3 text-xs text-slate-600">Cumpleaños: {person.birthDate || 'Sin registrar'} · Habilidades: {person.skills?.join(', ') || 'Sin registrar'}</p>
    <table className="mt-4 w-full text-left text-xs"><thead><tr><th>Día</th><th>Turno</th><th>Estudios / preferencia</th><th>Break</th></tr></thead><tbody>{SCHEDULE_DAYS.map((day, i) => <tr key={day} className="border-t"><th className="py-2">{labels[i]}</th><td>{contextShiftLabel(schedules[person.id]?.[day])}</td><td>{person.study_schedule?.[day]?.free ? 'Descanso solicitado. ' : ''}{(person.study_schedule?.[day]?.blocks || []).map(block => `${block.start}–${block.end}`).join(', ') || 'Sin estudios registrados'}</td><td>{scheduleBreakLabel(schedules[person.id]?.[day], effectiveModality(person, date)) || '—'}</td></tr>)}</tbody></table>
  </ScheduleDialog>;
}
