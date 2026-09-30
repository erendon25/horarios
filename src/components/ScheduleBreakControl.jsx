import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Coffee, X } from 'lucide-react';
import { getScheduleBreak, getScheduleBreakOptions } from '../services/scheduleHours';

export default function ScheduleBreakControl({ shift, modality, name, onChange }) {
    const [open, setOpen] = useState(false);
    const [start, setStart] = useState('');
    const dialog = useRef(null);
    const trigger = useRef(null);
    const rest = getScheduleBreak(shift, modality);
    const options = getScheduleBreakOptions(shift, modality);
    const preview = getScheduleBreak({ ...shift, breakStart: start }, modality);
    useEffect(() => {
        if (!open) return;
        dialog.current.showModal();
        return () => trigger.current?.focus();
    }, [open]);
    return <>
        <button type="button" ref={trigger}
            aria-label={`Asignar break de ${name}`} title={rest ? `Break: ${rest.start}-${rest.end}` : 'Asignar break de 45 minutos'}
            onClick={() => { setStart(rest?.start || ''); setOpen(true); }}
            className={`inline-flex items-center justify-center gap-1 rounded px-1 py-0.5 text-[11px] whitespace-nowrap hover:bg-amber-100 ${rest ? 'text-gray-600' : 'text-amber-700'}`}>
            <Coffee size={12} aria-hidden="true" />{rest ? rest.start : 'Break'}
        </button>
        {open && createPortal(
            <dialog ref={dialog} aria-label={`Break de ${name}`} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
                className="m-auto w-[360px] max-w-[calc(100vw-32px)] rounded-xl border-0 p-0 shadow-xl backdrop:bg-black/40">
                <form className="p-5" onSubmit={event => { event.preventDefault(); onChange(start); setOpen(false); }}>
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-gray-900">Break · 45 minutos</h3>
                        <button type="button" aria-label="Cerrar break" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{name}</p>
                    <label className="mt-4 block text-sm font-medium text-gray-700">Inicio del break
                        <select aria-label="Inicio del break" autoFocus value={start} onChange={event => setStart(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 p-2">
                            <option value="">Pendiente de asignar</option>
                            {options.map(time => <option key={time} value={time}>{time}</option>)}
                        </select>
                    </label>
                    <p className="mt-3 text-sm text-gray-600">{preview ? `Descanso: ${preview.start}–${preview.end}` : 'Selecciona una hora dentro del turno.'}</p>
                    <div className="mt-5 flex justify-end gap-2">
                        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button>
                        <button type="submit" disabled={Boolean(start && !preview)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40">Aplicar break</button>
                    </div>
                </form>
            </dialog>, document.body)}
    </>;
}
