// ScheduleHeatmapMatrix.jsx - Matriz operativa de 07:00 a 25:00
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, FileText, Download } from 'lucide-react';
import { HEATMAP_LEGEND, downloadHeatmap } from '../services/heatmapExport';
import { HOURS, buildHeatmapRows } from '../services/heatmapModel';
import HeatmapTransferForm from './HeatmapTransferForm';
import { heatmapMinutes } from '../services/heatmapTransfers';
export { HOURS } from '../services/heatmapModel';

const EMPTY_ASSIGNED = [];
const EMPTY_REQUIREMENTS = {};

const HEATMAP_SLOT_WIDTH = 44;
const HEATMAP_TABLE_MIN_WIDTH = 120 + HOURS.length * HEATMAP_SLOT_WIDTH;

export default function ScheduleHeatmapMatrix({ assigned = EMPTY_ASSIGNED, requirements = EMPTY_REQUIREMENTS, date = '', dayLabel = '', canExport = false, onTransfer }) {
    const rows = useMemo(() => buildHeatmapRows(assigned, requirements), [assigned, requirements]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const dialogRef = useRef(null);
    const maximizeRef = useRef(null);
    const drag = useRef(null);
    const [exporting, setExporting] = useState('');
    const [exportError, setExportError] = useState('');
    const [transferSelection, setTransferSelection] = useState(null);
    const [selectMode, setSelectMode] = useState(true);
    const [rangePreview, setRangePreview] = useState(null);
    const rangeDrag = useRef(null);

    useEffect(() => {
        if (!isFullscreen) return;
        const dialog = dialogRef.current;
        const previousOverflow = document.body.style.overflow;
        dialog.showModal();
        document.body.style.overflow = 'hidden';
        return () => {
            dialog.close();
            document.body.style.overflow = previousOverflow;
            maximizeRef.current?.focus();
        };
    }, [isFullscreen]);

    const handlePointerDown = (event) => {
        // Keep native touch scrolling and scrollbar interactions.
        const element = event.currentTarget;
        const cell = event.target.closest('[data-range-hour]');
        if (onTransfer && selectMode && cell && cell.dataset.excess === 'true' && event.button === 0) {
            event.preventDefault();
            const anchor = Number(cell.dataset.rangeHour);
            const range = { source: cell.dataset.position, row: cell.dataset.rangeRow, anchor, from: anchor, to: anchor };
            rangeDrag.current = range;
            setRangePreview(range);
            setTransferSelection(null);
            element.setPointerCapture(event.pointerId);
            return;
        }
        if (onTransfer && selectMode) return;
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.target === element || event.target.closest('button')) return;
        event.preventDefault();
        drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        element.setPointerCapture(event.pointerId);
        element.style.cursor = 'grabbing';
    };
    const handlePointerMove = (event) => {
        if (rangeDrag.current) {
            const element = event.currentTarget;
            const bounds = element.getBoundingClientRect();
            if (event.clientX > bounds.right - 24) element.scrollLeft += 20;
            if (event.clientX < bounds.left + 140) element.scrollLeft -= 20;
            const table = element.querySelector('table').getBoundingClientRect();
            const index = Math.max(0, Math.min(HOURS.length - 1, Math.floor((event.clientX - table.left - 120) / HEATMAP_SLOT_WIDTH)));
            const next = { ...rangeDrag.current, from: Math.min(rangeDrag.current.anchor, index), to: Math.max(rangeDrag.current.anchor, index) };
            if (next.from === rangeDrag.current.from && next.to === rangeDrag.current.to) return;
            rangeDrag.current = next;
            setRangePreview(next);
            return;
        }
        if (!drag.current) return;
        event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
        event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
    };
    const handlePointerUp = (event) => {
        if (rangeDrag.current) {
            const range = rangeDrag.current;
            rangeDrag.current = null;
            if (event.type !== 'pointercancel') setTransferSelection({ source: range.source, start: heatmapMinutes(HOURS[range.from]), end: heatmapMinutes(HOURS[range.to]) + 15 });
            else setRangePreview(null);
        }
        drag.current = null;
        event.currentTarget.style.cursor = '';
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const handleExport = async (format) => {
        if (!canExport || exporting || rows.length === 0) return;
        setExportError('');
        setExporting(format);
        try {
            await downloadHeatmap(format, { rows, hours: HOURS, date, dayLabel });
        } catch (error) {
            console.error('Error exportando la matriz:', error);
            setExportError('No se pudo descargar la matriz. Intenta nuevamente.');
        } finally {
            setExporting('');
        }
    };


    const panel = (
        <div className="h-full min-h-0 min-w-0 flex flex-col isolate bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
            <div className="flex-none bg-gray-800 px-3 py-2 text-white">
                <div className="flex flex-wrap justify-between items-center gap-2">
                    <h3 id={isFullscreen ? 'heatmap-dialog-title' : undefined} className="text-sm font-bold">
                        Mapa de Cobertura{dayLabel || date ? ` - ${dayLabel} ${date}` : ''}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                        {canExport && <>
                            <button type="button" disabled={!!exporting || rows.length === 0}
                                onClick={() => handleExport('pdf')}
                                className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20 disabled:opacity-50">
                                <FileText size={14} /> {exporting === 'pdf' ? 'Generando…' : 'PDF'}
                            </button>
                            <button type="button" disabled={!!exporting || rows.length === 0}
                                onClick={() => handleExport('xlsx')}
                                className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20 disabled:opacity-50">
                                <Download size={14} /> {exporting === 'xlsx' ? 'Generando…' : 'Excel'}
                            </button>
                        </>}
                        <button type="button" ref={isFullscreen ? undefined : maximizeRef}
                            onClick={() => { drag.current = null; setIsFullscreen(!isFullscreen); }}
                            className="rounded bg-white/10 p-1.5 hover:bg-white/20"
                            title={isFullscreen ? 'Minimizar' : 'Maximizar'}
                            aria-label={isFullscreen ? 'Minimizar mapa de cobertura' : 'Maximizar mapa de cobertura'}>
                            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                    </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {HEATMAP_LEGEND.map((item) => (
                        <span key={item.color} className="inline-flex items-center gap-1">
                            <span className={`h-3 w-3 rounded border border-white/30 ${item.color}`} />
                            {item.label}
                        </span>
                    ))}
                </div>
                {onTransfer ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <button type="button" aria-pressed={selectMode} onClick={() => { setSelectMode(true); }} className={`rounded px-2 py-1 ${selectMode ? 'bg-blue-600 text-white' : 'bg-white/10'}`}>Seleccionar tramo</button>
                        <button type="button" aria-pressed={!selectMode} onClick={() => { setSelectMode(false); rangeDrag.current = null; }} className={`rounded px-2 py-1 ${!selectMode ? 'bg-blue-600 text-white' : 'bg-white/10'}`}>Desplazar mapa</button>
                        <span className="text-gray-300">{selectMode ? 'Arrastra sobre una fila roja para marcar el intervalo.' : 'Arrastra o desliza para navegar.'}</span>
                    </div>
                ) : <p className="mt-2 text-[10px] text-gray-300">Arrastra con el mouse o desliza para navegar. En teclado usa las flechas; Esc cierra la vista ampliada.</p>}
                {exportError && <p role="alert" className="mt-2 text-sm text-red-200">{exportError}</p>}
                {onTransfer && transferSelection && <HeatmapTransferForm
                    key={`${transferSelection.source}-${transferSelection.start}-${transferSelection.end || ''}`}
                    selection={transferSelection} assigned={assigned} requirements={requirements}
                    onApply={onTransfer} onCancel={() => { setTransferSelection(null); setRangePreview(null); }}
                />}
                {assigned.some(person => person.breakLabel) && (
                    <details className="mt-2 text-xs text-amber-200">
                        <summary className="cursor-pointer">Breaks asignados (no suman cobertura)</summary>
                        <ul className="mt-1 space-y-1">
                            {[...new Map(assigned.filter(person => person.breakLabel).map(person => [person.staffId || person.breakLabel, person])).values()].map((person, index) => (
                                <li key={`${person.breakLabel}-${index}`}>{person.breakLabel}</li>
                            ))}
                        </ul>
                    </details>
                )}
            </div>
            <div role="region" aria-label="Matriz de cobertura por posición y horario" tabIndex={0}
                onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={() => { drag.current = null; rangeDrag.current = null; }}
                className={`relative isolate flex-1 min-h-0 min-w-0 overflow-auto overscroll-contain ${onTransfer && selectMode ? 'cursor-crosshair' : 'cursor-grab'} select-none bg-gray-50 focus-visible:outline-blue-500`}
                style={{ WebkitOverflowScrolling: 'touch', touchAction: onTransfer && selectMode ? 'none' : 'auto' }}>
                <table className="table-fixed border-collapse bg-white shadow-inner" style={{ minWidth: `${HEATMAP_TABLE_MIN_WIDTH}px` }}>
                    <colgroup>
                        <col style={{ width: '120px' }} />
                        {HOURS.map((_, i) => (
                            <col key={i} style={{ width: `${HEATMAP_SLOT_WIDTH}px` }} />
                        ))}
                    </colgroup>

                    <thead>
                        <tr className="bg-gradient-to-r from-gray-700 to-gray-800 border-b border-gray-600">
                            <th className="sticky top-0 left-0 z-30 bg-gradient-to-r from-gray-700 to-gray-800 border-r border-gray-500 px-2 py-1.5 text-left font-bold text-white text-xs shadow-lg">
                                Posición
                            </th>
                            {HOURS.map(hour => (
                                <th
                                    key={hour}
                                    className="sticky top-0 z-20 overflow-hidden bg-gradient-to-r from-gray-700 to-gray-800 border border-gray-500 px-1 py-1 text-[10px] font-bold text-white text-center shadow-md whitespace-nowrap"
                                    title={hour}
                                >
                                    {hour}
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody className="bg-white">
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={HOURS.length + 1} className="text-center py-12 text-gray-500">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
                                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                            </svg>
                                        </div>
                                        <p className="text-sm font-semibold text-gray-600">No hay proyeccion</p>
                                        <p className="text-xs text-gray-500">Configura la proyeccion horaria</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => (
                                <tr
                                    key={`${row.positionKey}-${row.slot}`}
                                    className="h-5 border-b border-gray-200 hover:bg-blue-50/30 transition-colors duration-150"
                                >
                                    {row.showPositionName && (
                                        <td
                                            rowSpan={row.groupSize}
                                            className="sticky left-0 z-10 align-middle bg-white px-2 py-1 font-semibold text-xs text-gray-800 border-r border-b border-gray-300 shadow-sm"
                                            title={`${row.name}: ${row.groupSize} carril${row.groupSize === 1 ? '' : 'es'}${row.hasExcess ? ', incluye exceso' : ''}`}
                                        >
                                            <div className="flex min-w-0 items-center gap-1">
                                                {row.hasExcess && (
                                                    <span className="h-1.5 w-1.5 flex-none rounded-full bg-red-500" aria-label="Incluye exceso"></span>
                                                )}
                                                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                                                {row.groupSize > 1 && (
                                                    <span className="flex-none rounded bg-gray-100 px-1 text-[9px] font-bold text-gray-500">
                                                        ×{row.groupSize}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                    {row.cells.map((cell, j) => (
                                        <td
                                            key={j}
                                            className={`border border-gray-200 ${cell.color} hover:opacity-80 transition-opacity duration-150`}
                                            style={{ height: '20px', width: `${HEATMAP_SLOT_WIDTH}px`, padding: 0,
                                                boxShadow: rangePreview?.row === `${row.positionKey}-${row.slot}` && j >= rangePreview.from && j <= rangePreview.to ? 'inset 0 3px #1d4ed8, inset 0 -3px #1d4ed8' : undefined,
                                                filter: rangePreview?.row === `${row.positionKey}-${row.slot}` && j >= rangePreview.from && j <= rangePreview.to ? 'brightness(0.8)' : undefined }}
                                            data-range-hour={j} data-range-row={`${row.positionKey}-${row.slot}`} data-position={row.name} data-excess={cell.color.includes('red')}
                                            tabIndex={onTransfer && cell.color.includes('red') ? 0 : undefined}
                                            aria-label={onTransfer && cell.color.includes('red') ? `Seleccionar tramo de ${row.name} desde ${HOURS[j]}` : undefined}
                                            onKeyDown={event => {
                                                if (!onTransfer || !cell.color.includes('red')) return;
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    setTransferSelection({ source: row.name, start: heatmapMinutes(HOURS[j]), end: heatmapMinutes(HOURS[j]) + 15 });
                                                    setRangePreview({ row: `${row.positionKey}-${row.slot}`, from: j, to: j });
                                                }
                                            }}
                                            title={`${HOURS[j]}: ${cell.isTrainer ? 'Entrenador' : cell.color.includes('yellow') ? 'Faltante' : cell.color.includes('blue') ? 'Asignado' : cell.color.includes('red') ? 'Exceso' : 'Sin requerimiento'}`}
                                        />
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <>
            {!isFullscreen && panel}
            {isFullscreen && createPortal(
                <dialog ref={dialogRef} aria-labelledby="heatmap-dialog-title"
                    onCancel={() => setIsFullscreen(false)}
                    onClose={() => setIsFullscreen(false)}
                    className="fixed inset-0 m-0 h-[100dvh] w-screen max-h-none max-w-none border-0 bg-slate-950/90 p-2 sm:p-4 backdrop:bg-black/70">
                    {panel}
                </dialog>,
                document.body
            )}
        </>
    );
}
