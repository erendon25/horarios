import React from 'react';
import { ScheduleDialog } from './ScheduleContextDialogs';

export default function HeatmapMoveAdjustDialog({ movement, positions, onClose, onCancel }) {
  const state = movement.state, plan = state?.plan;
  if (!state) return null;
  return <ScheduleDialog title={`Ajustar movimiento · ${state.name}`} onClose={onClose}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onCancel} className="min-h-10 rounded border px-3">Cancelar movimiento</button>
      <button type="button" disabled={state.busy || state.applying || !plan?.valid || plan.noChange}
        onClick={async () => { if (await movement.apply()) onClose(); }} className="min-h-10 rounded bg-blue-700 px-3 text-white disabled:opacity-50">Aplicar al borrador</button>
    </div>}>
    <p className="text-sm font-semibold">{plan ? `${plan.patch.start}–${plan.patch.end}${plan.patch.splitShift ? ` / ${plan.patch.start2}–${plan.patch.end2}` : ''}` : 'Selecciona el destino del turno.'}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Desplazar horario (minutos)<div className="mt-1 flex items-center gap-1">
        <button type="button" aria-label="Mover 15 minutos antes" disabled={state.applying} onClick={() => movement.preview({ deltaMinutes: state.deltaMinutes - 15 })} className="min-h-10 rounded border px-2">−15</button>
        <input aria-label="Desplazar horario en minutos" type="number" step="15" value={state.deltaMinutes} disabled={state.applying} onChange={event => movement.preview({ deltaMinutes: Number(event.target.value) })} className="min-h-10 w-full min-w-0 rounded border px-2" />
        <button type="button" aria-label="Mover 15 minutos después" disabled={state.applying} onClick={() => movement.preview({ deltaMinutes: state.deltaMinutes + 15 })} className="min-h-10 rounded border px-2">+15</button>
      </div></label>
      <label className="text-sm">Puesto destino<select aria-label="Puesto destino del movimiento" value={state.position} disabled={state.applying} onChange={event => movement.preview({ position: event.target.value })} className="mt-1 block min-h-10 w-full rounded border px-2">{positions.map(position => <option key={position}>{position}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Aplicar puesto a<select aria-label="Alcance del cambio de puesto" value={state.positionScope || plan?.positionScope || 'base'} disabled={state.applying} onChange={event => movement.preview({ positionScope: event.target.value })} className="mt-1 block min-h-10 w-full rounded border px-2">
        <option value="base">Puesto base · conserva las reposiciones</option><option value="segment">Solo el tramo seleccionado</option>
      </select></label>
    </div>
    <p className="mt-3 text-xs text-slate-600">Se conserva la duración del turno y se desplazan su break y reposiciones. El borde azul muestra la propuesta; el rojo señala cruces con estudios.</p>
    {state.busy && <p role="status" className="mt-3 text-blue-800">Verificando turno y disponibilidad…</p>}
    {state.error && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-red-800">{state.error}</p>}
    {plan?.warnings?.length > 0 && <ul className="mt-3 space-y-1 rounded bg-amber-50 p-3 text-xs text-amber-900">{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    <p className="mt-3 text-xs text-slate-600">Aplicar modifica el borrador. Guardar publica el horario.</p>
  </ScheduleDialog>;
}
