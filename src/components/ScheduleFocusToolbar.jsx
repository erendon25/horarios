import React from 'react';
import { AlertCircle, Calendar, ChevronDown, ClipboardList, Download, Filter, MoreHorizontal, Save, Users } from 'lucide-react';

const button = 'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const menu = 'absolute right-0 z-50 mt-2 max-h-[calc(100dvh-250px)] w-72 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-3 shadow-xl';

function ActionMenu({ label, icon: Icon, children }) {
  return <details className="relative" onClick={event => {
    if (event.target.closest('button,a')) event.currentTarget.open = false;
  }}>
    <summary aria-label={label} className={`${button} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
      <Icon size={16} aria-hidden="true" /><span className="hidden sm:inline">{label}</span><ChevronDown size={14} aria-hidden="true" className="hidden sm:block" />
    </summary>
    <div className={`${menu} flex flex-col gap-2 [&_button]:min-h-10 [&_button]:w-full [&_button]:justify-start [&_button]:text-left [&_a]:min-h-10`}>{children}</div>
  </details>;
}

export default function ScheduleFocusToolbar({
  week, onWeekChange, day, days, dayLabels, onDayChange,
  ready, saving, saved, dirtyCount, hasUnsavedChanges, onSave,
  onOpenStaff, staffCount, staffButtonRef, panelOpen,
  onOpenRequests, requestCount, onOpenConflicts, conflictCount,
  exportControls, extraControls, filters, filterActive,
}) {
  return <header data-testid="focus-toolbar" className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-sm font-black text-orange-700 sm:flex" aria-hidden="true">LC</span>
        <div className="min-w-0"><h1 className="text-base font-bold text-gray-900 sm:text-lg"><span className="sm:hidden">Horario</span><span className="hidden sm:inline">Horario semanal</span></h1><p className="hidden text-xs text-gray-500 sm:block">Cobertura por posición</p></div>
      </div>
      <div className="flex items-center gap-2">
        <span role="status" className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${hasUnsavedChanges ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
          {hasUnsavedChanges ? `Borrador · ${dirtyCount} cambio${dirtyCount === 1 ? '' : 's'}` : 'Sin cambios pendientes'}
        </span>
        <button type="button" onClick={onSave} disabled={saving || !ready} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          <Save size={16} aria-hidden="true" />{saving ? 'Guardando…' : saved ? 'Guardado' : 'Guardar'}{hasUnsavedChanges && <span className="rounded bg-white/20 px-1.5 text-xs sm:hidden">{dirtyCount}</span>}
        </button>
        <button ref={staffButtonRef} type="button" onClick={onOpenStaff} aria-expanded={panelOpen} aria-controls="focus-staff-panel" className={`${button} ${panelOpen ? 'border-blue-300 bg-blue-50 text-blue-700' : ''}`}>
          <Users size={16} aria-hidden="true" /><span className="hidden sm:inline">Colaboradores</span><span className="sm:hidden">Equipo</span><span className="rounded bg-gray-100 px-1.5 text-xs">{staffCount}</span>
        </button>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-2 text-sm text-gray-700"><Calendar size={16} aria-hidden="true" /><span className="sr-only">Semana comenzando el</span>
          <input aria-label="Semana comenzando el" type="date" value={week} onChange={event => onWeekChange(event.target.value)} disabled={saving} className="min-w-0 w-[135px] bg-white text-sm" />
        </label>
        <select aria-label="Día del horario" value={day} onChange={event => onDayChange(event.target.value)} className="min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 sm:hidden">{days.map(key => <option key={key} value={key}>{dayLabels[key]}</option>)}</select>
        <nav aria-label="Día del horario" className="hidden max-w-[calc(100vw-24px)] items-center overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 sm:flex">
          {days.map(key => <button key={key} type="button" aria-current={day === key ? 'date' : undefined} onClick={() => onDayChange(key)}
            className={`min-h-10 shrink-0 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${day === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{dayLabels[key].slice(0, 3)}</button>)}
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <details className="relative"><summary className={`${button} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Filter size={16} aria-hidden="true" />Filtros{filterActive && <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="Vista filtrada" />}</summary>
          <div className={`${menu} space-y-3 text-sm`}>{filters}</div>
        </details>
        <button type="button" aria-label={`Solicitudes ${requestCount}`} onClick={onOpenRequests} className={button}><ClipboardList size={16} aria-hidden="true" /><span className="hidden sm:inline">Solicitudes</span><span className="rounded bg-blue-50 px-1.5 text-xs text-blue-700">{requestCount}</span></button>
        <button type="button" aria-label={`Conflictos ${conflictCount}`} onClick={onOpenConflicts} className={`${button} ${conflictCount ? 'border-amber-200 text-amber-800' : ''}`}><AlertCircle size={16} aria-hidden="true" /><span className="hidden sm:inline">Conflictos</span>{conflictCount > 0 && <span className="rounded bg-amber-50 px-1.5 text-xs">{conflictCount}</span>}</button>
        <ActionMenu label="Exportar" icon={Download}>{exportControls}</ActionMenu>
        <ActionMenu label="Más" icon={MoreHorizontal}>{extraControls}</ActionMenu>
      </div>
    </div>
  </header>;
}
