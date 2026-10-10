import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clockFromMinutes, getExportShiftSegments, getPositionTimeline, normalizeSchedulePosition } from '../services/scheduleExportData';
import { replacePositionInterval, validatePositionRange } from '../services/heatmapTransfers';
import { scheduleBreakLabel } from '../services/scheduleHours';

export default function SchedulePositionControl({ shift, modality, name, onChange, positions = [], allowRangesOnly = false, onModeChange }) {
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [position, setPosition] = useState('');
    const [error, setError] = useState('');
    const dialog = useRef(null);
    const trigger = useRef(null);
    const timeline = getPositionTimeline(shift, modality);
    const breakText = scheduleBreakLabel(shift, modality);
    const times = [...new Set(getExportShiftSegments(shift).flatMap(segment => {
        const result = [];
        for (let minute = Math.ceil(segment.start / 15) * 15; minute <= segment.end; minute += 15) result.push(minute);
        return result;
    }))].sort((a, b) => a - b);
    const timeLabel = minute => minute >= 1440 ? `${clockFromMinutes(minute - 1440)} (+1 día)` : clockFromMinutes(minute);
    const addRange = event => {
        event.preventDefault();
        const range = { start: from === '' ? NaN : Number(from), end: to === '' ? NaN : Number(to), position };
        const problem = validatePositionRange(shift, positions, range);
        if (problem) return setError(problem);
        onChange(replacePositionInterval(shift, range));
        setError('');
    };
    useEffect(() => {
        if (!open) return;
        dialog.current.showModal();
        return () => trigger.current?.focus();
    }, [open]);
    return <>
        <button ref={trigger} type="button" onClick={() => setOpen(true)}
            aria-label={`${allowRangesOnly ? 'Posición por rangos de' : 'Ver tramos de'} ${name}`}
            className="mt-1 inline-flex whitespace-nowrap rounded px-1 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50">
            {allowRangesOnly ? 'Posición por rangos' : 'Ver tramos'}
        </button>
        {open && createPortal(
            <dialog ref={dialog} aria-label={`Puestos de ${name}`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
                className="m-auto w-[480px] max-w-[calc(100vw-32px)] max-h-[80dvh] overflow-y-auto rounded-xl border-0 p-5 shadow-xl backdrop:bg-black/40">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-gray-900">Puestos del turno</h3>
                    <button type="button" aria-label="Cerrar puestos" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
                </div>
                <p className="mt-1 text-sm text-gray-600">{name}</p>
                {allowRangesOnly && <label className="mt-4 flex items-start gap-2 text-sm font-medium">
                    <input type="checkbox" checked={Boolean(shift.positionRangesOnly)}
                        onChange={event => onModeChange(event.target.checked)} className="mt-1" />
                    Cubrir posición solo en estos rangos
                </label>}
                {allowRangesOnly && <p className="mt-2 text-xs text-gray-600">
                    {shift.positionRangesOnly ? 'Fuera de los rangos no cuenta como cobertura en el heatmap. El turno y las horas trabajadas se mantienen.' : 'El puesto base cubre todo el turno. Activa la opción para limitarlo a los rangos que indiques.'}
                </p>}
                {positions.length > 0 && <form onSubmit={addRange} className="mt-4 space-y-3 rounded-lg bg-blue-50 p-3">
                    <label className="block text-xs font-semibold">Posición
                        <select aria-label="Posición" required value={position} onChange={event => setPosition(event.target.value)} className="mt-1 w-full rounded border bg-white p-2">
                            <option value="">Seleccionar posición…</option>
                            {positions.map(item => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        {[['Desde', from, setFrom], ['Hasta', to, setTo]].map(([label, value, setter]) => <label key={label} className="block text-xs font-semibold">{label}
                            <select aria-label={label} required value={value} onChange={event => setter(event.target.value)} className="mt-1 w-full rounded border bg-white p-2">
                                <option value="">Seleccionar hora…</option>
                                {times.map(minute => <option key={minute} value={minute}>{timeLabel(minute)}</option>)}
                            </select>
                        </label>)}
                    </div>
                    <button type="submit" className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white">Añadir rango</button>
                    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                    <p className="text-xs text-gray-600">Puedes añadir varios rangos. Un rango nuevo reemplaza la posición anterior donde se superponen. El break no cuenta como cobertura.</p>
                </form>}
                <ul className="mt-4 divide-y divide-gray-100">
                    {timeline.map((segment, index) => {
                        const isChange = shift.positionRangesOnly ? Boolean(segment.position) : normalizeSchedulePosition(segment.position) !== normalizeSchedulePosition(shift.position);
                        return <li key={`${segment.start}-${index}`} className="flex items-center gap-3 py-3 text-sm">
                            <span className="shrink-0 tabular-nums text-gray-600">{clockFromMinutes(segment.start)}–{clockFromMinutes(segment.end)}</span>
                            <span className="min-w-0 flex-1 font-medium text-gray-900">{segment.position || 'Sin cobertura de posición'}</span>
                            {isChange && <button type="button" className="shrink-0 rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                aria-label={`Quitar ${segment.position} de ${clockFromMinutes(segment.start)} a ${clockFromMinutes(segment.end)}`}
                                onClick={() => onChange(replacePositionInterval(shift, { start: segment.start, end: segment.end, position: shift.positionRangesOnly ? '' : shift.position }))}>Quitar</button>}
                        </li>;
                    })}
                </ul>
                {breakText && <p className="mt-2 text-sm text-amber-800">{breakText}</p>}
                <p className="mt-3 text-xs text-gray-500">{shift.positionRangesOnly ? 'Quitar un rango elimina su cobertura de posición.' : 'Quitar un cambio devuelve ese tramo al puesto base.'} Guarda el horario para publicar los cambios.</p>
            </dialog>, document.body)}
    </>;
}
