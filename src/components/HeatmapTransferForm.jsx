import React, { useState } from 'react';
import { clockFromMinutes } from '../services/scheduleExportData';
import { heatmapMinutes, transferCandidates, validateHeatmapTransfer } from '../services/heatmapTransfers';

export default function HeatmapTransferForm({ selection, assigned, requirements, onApply, onCancel }) {
    const [staffId, setStaffId] = useState('');
    const [end, setEnd] = useState(selection.end || selection.start + 15);
    const [position, setPosition] = useState(selection.position || '');
    const [error, setError] = useState('');
    const candidates = transferCandidates(assigned, selection.source, selection.start);
    const selectedId = staffId || candidates[0]?.staffId || '';
    const transfer = { staffId: selectedId, source: selection.source, position, start: selection.start, end };
    const validation = validateHeatmapTransfer(assigned, requirements, transfer);
    const lastMinute = Math.min(1515, Math.max(selection.start + 15, ...assigned.filter(item => item.staffId === selectedId).map(item => {
        const from = heatmapMinutes(item.start), to = heatmapMinutes(item.end);
        return to <= from ? to + 1440 : to;
    })));
    const ends = [];
    for (let minute = selection.start + 15; minute <= lastMinute; minute += 15) ends.push(minute);
    return (
        <form className="mt-3 rounded bg-white p-3 text-sm text-gray-800" aria-label="Mover cobertura"
            onSubmit={event => {
                event.preventDefault();
                if (validation) { setError(validation); return; }
                try { onApply(transfer); onCancel(); } catch (failure) { setError(failure.message); }
            }}>
            <p className="font-semibold">Mover desde {selection.source} · Inicio: {clockFromMinutes(selection.start)}</p>
            <div className="mt-2 flex flex-wrap gap-3">
                <label>Colaborador
                    <select aria-label="Colaborador" className="block max-w-full rounded border p-1" value={selectedId} onChange={event => { setStaffId(event.target.value); setError(''); }}>
                        {!candidates.length && <option value="">Sin colaboradores disponibles</option>}
                        {candidates.map(person => <option key={person.staffId} value={person.staffId}>{person.staffName || person.staffId}</option>)}
                    </select>
                </label>
                <label>Puesto destino
                    <select aria-label="Puesto destino" className="block max-w-full rounded border p-1" value={position} onChange={event => { setPosition(event.target.value); setError(''); }}>
                        <option value="">Seleccionar puesto</option>
                        {requirements.positions.filter(name => name !== selection.source).map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                </label>
                <label>Fin del cambio
                    <select aria-label="Fin del cambio" className="block max-w-full rounded border p-1" value={end} onChange={event => { setEnd(Number(event.target.value)); setError(''); }}>
                        {ends.map(minute => <option key={minute} value={minute}>{clockFromMinutes(minute)}</option>)}
                    </select>
                </label>
            </div>
            <p className="mt-2 text-xs">Puedes agregar más tramos para este colaborador. Fuera de los tramos asignados mantiene su puesto base. Guarda el horario para publicarlos en su dashboard.</p>
            {(error || validation) && <p role="status" className="mt-2 text-amber-800">{error || validation}</p>}
            <div className="mt-2 flex gap-2">
                <button type="submit" disabled={Boolean(validation)} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40">Aplicar tramo</button>
                <button type="button" onClick={onCancel} className="rounded border px-3 py-1">Cancelar</button>
            </div>
        </form>
    );
}
