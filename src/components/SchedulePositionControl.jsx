import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clockFromMinutes, getPositionTimeline, normalizeSchedulePosition } from '../services/scheduleExportData';
import { replacePositionInterval } from '../services/heatmapTransfers';
import { scheduleBreakLabel } from '../services/scheduleHours';

export default function SchedulePositionControl({ shift, modality, name, onChange }) {
    const [open, setOpen] = useState(false);
    const dialog = useRef(null);
    const trigger = useRef(null);
    const timeline = getPositionTimeline(shift, modality);
    const breakText = scheduleBreakLabel(shift, modality);
    useEffect(() => {
        if (!open) return;
        dialog.current.showModal();
        return () => trigger.current?.focus();
    }, [open]);
    return <>
        <button ref={trigger} type="button" onClick={() => setOpen(true)}
            aria-label={`Ver tramos de ${name}`}
            className="mt-1 inline-flex whitespace-nowrap rounded px-1 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50">
            Ver tramos
        </button>
        {open && createPortal(
            <dialog ref={dialog} aria-label={`Puestos de ${name}`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
                className="m-auto w-[480px] max-w-[calc(100vw-32px)] max-h-[80dvh] overflow-y-auto rounded-xl border-0 p-5 shadow-xl backdrop:bg-black/40">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-gray-900">Puestos del turno</h3>
                    <button type="button" aria-label="Cerrar puestos" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
                </div>
                <p className="mt-1 text-sm text-gray-600">{name}</p>
                <ul className="mt-4 divide-y divide-gray-100">
                    {timeline.map((segment, index) => {
                        const isChange = normalizeSchedulePosition(segment.position) !== normalizeSchedulePosition(shift.position);
                        return <li key={`${segment.start}-${index}`} className="flex items-center gap-3 py-3 text-sm">
                            <span className="shrink-0 tabular-nums text-gray-600">{clockFromMinutes(segment.start)}–{clockFromMinutes(segment.end)}</span>
                            <span className="min-w-0 flex-1 font-medium text-gray-900">{segment.position || 'Sin asignar'}</span>
                            {isChange && <button type="button" className="shrink-0 rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                aria-label={`Quitar ${segment.position} de ${clockFromMinutes(segment.start)} a ${clockFromMinutes(segment.end)}`}
                                onClick={() => onChange(replacePositionInterval(shift, { start: segment.start, end: segment.end, position: shift.position }))}>Quitar</button>}
                        </li>;
                    })}
                </ul>
                {breakText && <p className="mt-2 text-sm text-amber-800">{breakText}</p>}
                <p className="mt-3 text-xs text-gray-500">Quitar un cambio devuelve ese tramo al puesto base. Guarda el horario para publicar los cambios.</p>
            </dialog>, document.body)}
    </>;
}
