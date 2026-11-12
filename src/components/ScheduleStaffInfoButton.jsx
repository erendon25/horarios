import React, { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import ScheduleTooltip from './ScheduleTooltip';

export default function ScheduleStaffInfoButton({ item, onInfo }) {
    const button = useRef(null), timer = useRef(null), id = useId();
    const returningFromDialog = useRef(false);
    const [preview, setPreview] = useState(false);
    const keep = () => clearTimeout(timer.current);
    const hide = () => { keep(); setPreview(false); };
    const leave = () => { keep(); timer.current = setTimeout(() => setPreview(false), 150); };
    const show = () => { keep(); setPreview(true); };
    useEffect(() => {
        if (!preview) return undefined;
        const dismiss = event => {
            // Let users scroll a long preview without dismissing it.
            if (event?.target?.closest?.('[role="tooltip"]')) return;
            clearTimeout(timer.current); setPreview(false);
        };
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('resize', dismiss);
        return () => {
            clearTimeout(timer.current);
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('resize', dismiss);
        };
    }, [preview]);
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => {
        if (!preview) return undefined;
        const dismiss = event => {
            if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
            event.preventDefault(); event.stopPropagation(); hide();
        };
        window.addEventListener('keydown', dismiss, true);
        return () => window.removeEventListener('keydown', dismiss, true);
    }, [preview]);
    return <>
        <button ref={button} type="button" draggable={false} aria-label={`Información de ${item.name}`}
            aria-haspopup="dialog" aria-describedby={preview ? id : undefined}
            onMouseEnter={show} onMouseLeave={leave} onFocus={() => {
                if (returningFromDialog.current) { returningFromDialog.current = false; return; }
                show();
            }} onBlur={hide}
            onDragStart={event => { event.preventDefault(); event.stopPropagation(); hide(); }}
            onClick={() => { hide(); returningFromDialog.current = true; onInfo(item.id); }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-blue-700 hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
            <Info className="h-4 w-4" aria-hidden="true" />
        </button>
        {preview && <ScheduleTooltip id={id} testId="staff-info-preview" anchor={button.current} preferSide
            className="w-[520px] rounded-lg border-2 border-blue-200 bg-white p-3 text-xs text-slate-800"
            onMouseEnter={keep} onMouseLeave={leave}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="font-bold text-slate-900">{item.name}</p>
                    <p className="text-slate-600">{item.modality} · {item.role}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {item.birthday && <span className="rounded-full bg-pink-50 px-2 py-0.5 font-semibold text-pink-700">🎂 Cumpleaños</span>}
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">Semana: {item.weeklyHours} h</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">Ayer: {item.previousShift}</span>
                </div>
            </div>
            {item.studyStatus !== 'ready' && <p role="status" className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">Estudios pendientes de verificar.</p>}
            {item.weekRows?.some(row => row.freePreference) && <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">El día libre solicitado es una preferencia. No bloquea automáticamente un turno.</p>}
            <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full min-w-[460px] border-collapse text-left text-[11px]">
                    <thead className="bg-slate-50 text-slate-600">
                        <tr>{['Día', 'Estudios', 'Turno asignado', 'Solicitud aprobada'].map(label => <th key={label} scope="col" className="border-b border-slate-200 px-2 py-1.5 font-semibold">{label}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {item.weekRows?.map(row => <tr key={row.day} className={row.requests.length ? 'bg-green-50/50' : undefined}>
                            <th scope="row" className="whitespace-nowrap px-2 py-1.5 align-top font-semibold text-slate-800">
                                {row.label}
                                {row.date && <span className="block font-normal text-slate-500">{row.date.slice(8, 10)}/{row.date.slice(5, 7)}</span>}
                            </th>
                            <td className="px-2 py-1.5 align-top">
                                {row.freePreference && <p className="font-semibold text-amber-800">Preferencia de día libre</p>}
                                {row.studyBlocks.length
                                    ? row.studyBlocks.map(block => <p key={block} className="font-medium tabular-nums text-orange-800">{block}</p>)
                                    : <p className="italic text-slate-500">{item.studyStatus === 'ready' ? 'Sin clases' : 'Sin verificar'}</p>}
                            </td>
                            <td className="px-2 py-1.5 align-top">
                                <p className={`tabular-nums ${row.shift === 'Sin asignar' ? 'italic text-slate-500' : 'font-medium text-slate-900'}`}>{row.shift}</p>
                                {row.breakLabel && <p className="text-slate-500">{row.breakLabel}</p>}
                            </td>
                            <td className="px-2 py-1.5 align-top">
                                {row.requests.length
                                    ? row.requests.map(request => <p key={request.id} className={request.mismatch ? 'text-red-700' : 'font-semibold text-green-800'}>{request.label}{request.mismatch && <span className="block font-normal">No coincide con el turno.</span>}</p>)
                                    : <span className="text-slate-400">—</span>}
                            </td>
                        </tr>)}
                    </tbody>
                </table>
            </div>
            <p className="mt-2 text-slate-500">Haz clic para abrir la ficha.</p>
        </ScheduleTooltip>}
    </>;
}
