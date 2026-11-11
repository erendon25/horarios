import React from 'react';
import ScheduleTooltip from './ScheduleTooltip';

export default function HeatmapOccupantTooltip({ id, person, hour, anchor, container, onMouseEnter, onMouseLeave }) {
    return <ScheduleTooltip id={id} testId="coverage-occupant-info" anchor={anchor} container={container}
            onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
            <p className="font-semibold">{person.staffName || 'Nombre no disponible'}</p>
            <p className="text-slate-200">{person.position} · {hour}</p>
            <p className="text-slate-300">Tramo: {person.start}–{person.end}{person.exit ? ' · Salida (sin duración)' : ''}</p>
        </ScheduleTooltip>;
}
