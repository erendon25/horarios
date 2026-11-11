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
            onMouseEnter={keep} onMouseLeave={leave}>
            <p className="font-semibold">{item.name}</p>
            <p>{item.modality} · {item.role}</p>
            <p>Semana: {item.weeklyHours} h · Ayer: {item.previousShift}</p>
            {item.birthday && <p>🎂 Cumpleaños</p>}
            <div className="mt-2 space-y-1 border-t border-slate-600 pt-2">{item.contextLabel?.split('\n').map((line, index) => <p key={index}>{line}</p>)}</div>
            <p className="mt-2 text-slate-300">Haz clic para abrir la ficha.</p>
        </ScheduleTooltip>}
    </>;
}
