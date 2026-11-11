// ScheduleHeatmapMatrix.jsx - Matriz operativa de 07:00 a 26:00
import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, FileText, Download, Settings2 } from 'lucide-react';
import { HEATMAP_LEGEND, downloadHeatmap } from '../services/heatmapExport';
import { HOURS, buildHeatmapRows } from '../services/heatmapModel';
import HeatmapTransferForm from './HeatmapTransferForm';
import { heatmapMinutes } from '../services/heatmapTransfers';
import ProjectionHoursSummary from './ProjectionHoursSummary';
import CoverageInsights from './CoverageInsights';
import { cellOccupants } from '../services/coverageInsights';
import { approvedBukShiftLabel } from '../services/bukSchedule';
import HeatmapOccupantTooltip from './HeatmapOccupantTooltip';
import HeatmapMoveAdjustDialog from './HeatmapMoveAdjustDialog';
export { HOURS } from '../services/heatmapModel';

const EMPTY_ASSIGNED = [];
const EMPTY_REQUIREMENTS = {};

const HEATMAP_CELL_SIZE = 20;
const HEATMAP_POSITION_WIDTH = 120;
const HEATMAP_TABLE_WIDTH = HEATMAP_POSITION_WIDTH + HOURS.length * HEATMAP_CELL_SIZE;
const isMissingCell = cell => Boolean(cell?.color?.includes('yellow'));
const heatmapClock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const gapDuration = minutes => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;

export default function ScheduleHeatmapMatrix({ assigned = EMPTY_ASSIGNED, requirements = EMPTY_REQUIREMENTS, date = '', dayLabel = '', canExport = false, onTransfer, projectionHours, showProjectionSummary = true, onGapSelect, onGapReset, gapResetKey = 0,
    onBreak,positionDefinitions=[],coverageStatus='ready',filtered=false,onSelectPerson,onInfoPerson,onCardTarget,
    cardPlacement,onCardPreview,onCancelCardPlacement,onApplyCardPlacement,onCardOption,movement }) {
    const [moveMode, setMoveMode] = useState(false);
    const [moveAdjustOpen, setMoveAdjustOpen] = useState(false);
    const moveDrag = useRef(null), moveFrame = useRef(null), suppressMoveClick = useRef(false);
    const moveState = moveMode && !cardPlacement ? movement?.state : null;
    const activePreview = cardPlacement || (moveState && { staffId: moveState.staffId, plan: moveState.plan,
        proposedAssignments: moveState.plan?.proposedAssignments });
    const displayAssigned=activePreview?.proposedAssignments || assigned;
    const rows = useMemo(() => buildHeatmapRows(displayAssigned, requirements), [displayAssigned, requirements]);
    const occupants=useMemo(()=>cellOccupants(displayAssigned,rows),[displayAssigned,rows]);
    const [inspectedCell,setInspectedCell]=useState(null);
    const tooltipId = useId();
    const hoverTimeout = useRef(null);
    const inspected = inspectedCell?.date === date && inspectedCell.element.isConnected
        && occupants.get(inspectedCell.key)?.staffId === inspectedCell.staffId ? occupants.get(inspectedCell.key) : null;
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
    const matrixRef = useRef(null);
    const [gapMode, setGapMode] = useState(false);
    const [gapRange, setGapRange] = useState(null);
    const [gapError, setGapError] = useState('');
    const gapRef = useRef(null);
    const gapScope = useRef({ rows, date, onGapSelect, onGapReset, gapMode });
    gapScope.current = { rows, date, onGapSelect, onGapReset, gapMode };
    const canFindGap = typeof onGapSelect === 'function';
    const openPerson=id=>{if(isFullscreen){setIsFullscreen(false);requestAnimationFrame(()=>onSelectPerson?.(id));}else onSelectPerson?.(id);};

    const keepCellInfo = () => clearTimeout(hoverTimeout.current);
    const hideCellInfo = () => { keepCellInfo(); setInspectedCell(null); };
    const leaveCellInfo = () => {
        keepCellInfo();
        hoverTimeout.current = setTimeout(() => setInspectedCell(null), 150);
    };
    const inspectCell = (element, key, hour) => {
        keepCellInfo();
        const person = occupants.get(key);
        setInspectedCell(person && !cardPlacement && !moveMode && !drag.current && !rangeDrag.current
            ? { element, key, hour, date, staffId: person.staffId } : null);
    };
    useEffect(() => {
        hideCellInfo();
    }, [date, isFullscreen, cardPlacement?.token, assigned]);
    useEffect(() => {
        const dismiss = () => { clearTimeout(hoverTimeout.current); setInspectedCell(null); };
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('pointerdown', dismiss, true);
        return () => {
            clearTimeout(hoverTimeout.current);
            window.removeEventListener('scroll', dismiss, true);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('pointerdown', dismiss, true);
        };
    }, []);
    useEffect(() => {
        if (!inspected) return undefined;
        const dismiss = event => {
            if (event.key !== 'Escape' || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== dialogRef.current)) return;
            event.preventDefault(); event.stopPropagation(); hideCellInfo();
        };
        window.addEventListener('keydown', dismiss, true);
        return () => window.removeEventListener('keydown', dismiss, true);
    }, [inspected]);

    const clearGap = (notify = true) => {
        const hadSelection = Boolean(gapRef.current);
        gapRef.current = null;
        setGapRange(null); setGapError('');
        if (notify && hadSelection) gapScope.current.onGapReset?.();
    };

    useEffect(() => { clearGap(false); }, [gapResetKey]);
    useEffect(()=>{if(cardPlacement?.token){setMoveMode(false);movement?.cancel();setMoveAdjustOpen(false);setGapMode(false);clearGap();setTransferSelection(null);setRangePreview(null);}},[cardPlacement?.token]);
    const stopMoveDrag = () => {
        if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
        moveFrame.current = null;
        const current = moveDrag.current; moveDrag.current = null;
        if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    };
    const cancelMove = () => { stopMoveDrag(); movement?.cancel(); setMoveAdjustOpen(false); hideCellInfo(); };
    useEffect(() => () => { if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current); }, []);
    useEffect(() => { cancelMove(); }, [isFullscreen]);
    useEffect(() => {
        if (!moveMode) return undefined;
        const cancel = event => {
            if (event.key !== 'Escape' || [...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== dialogRef.current)) return;
            event.preventDefault(); event.stopPropagation(); cancelMove();
        };
        window.addEventListener('keydown', cancel, true);
        return () => window.removeEventListener('keydown', cancel, true);
    }, [moveMode, movement?.state?.token]);
    const selectMoveCell = cell => {
        if (!cell?.dataset.occupantId || !movement || coverageStatus !== 'ready') return '';
        hideCellInfo(); onCancelCardPlacement?.();
        return movement.select(cell.dataset.occupantId, { anchorMinute: heatmapMinutes(HOURS[Number(cell.dataset.rangeHour)]), sourcePosition: cell.dataset.position });
    };
    const moveTargetAt = (x, y, current) => {
        const bounds = matrixRef.current?.getBoundingClientRect();
        if (!bounds || x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null;
        const cell = document.elementFromPoint(x, y)?.closest('td[data-range-hour]');
        if (!cell || !matrixRef.current.contains(cell) || Number(cell.dataset.rangeHour) >= HOURS.length - 1) return null;
        return { deltaMinutes: current.deltaOrigin + (Number(cell.dataset.rangeHour) - current.anchorIndex) * 15, position: cell.dataset.position };
    };
    const movePointerPreview = () => {
        moveFrame.current = null;
        const current = moveDrag.current, matrix = matrixRef.current;
        if (!current?.moved || !matrix) return;
        const bounds = matrix.getBoundingClientRect(), beforeX = matrix.scrollLeft, beforeY = matrix.scrollTop;
        if (current.x > bounds.right - 24) matrix.scrollLeft += 20;
        else if (current.x < bounds.left + HEATMAP_POSITION_WIDTH + 24) matrix.scrollLeft -= 20;
        if (current.y > bounds.bottom - 24) matrix.scrollTop += 20;
        else if (current.y < bounds.top + 64) matrix.scrollTop -= 20;
        const target = moveTargetAt(current.x, current.y, current);
        if (target && (target.deltaMinutes !== current.lastDelta || target.position !== current.lastPosition)) {
            current.lastDelta = target.deltaMinutes; current.lastPosition = target.position; movement?.preview(target);
        }
        if (matrix.scrollLeft !== beforeX || matrix.scrollTop !== beforeY) moveFrame.current = requestAnimationFrame(movePointerPreview);
    };
    useEffect(() => { if (!canFindGap) setGapMode(false); }, [canFindGap]);
    useEffect(() => {
        const selected = gapRef.current;
        if (!selected) return;
        const row = rows.find(item => `${item.positionKey}-${item.slot}` === selected.rowKey);
        const valid = canFindGap && selected.date === date && row
            && row.cells.slice(selected.from, selected.to + 1).length === selected.to - selected.from + 1
            && row.cells.slice(selected.from, selected.to + 1).every(isMissingCell);
        if (!valid) {
            clearGap();
            setGapError('La cobertura cambió. Selecciona nuevamente el intervalo amarillo.');
        }
    }, [rows, date, canFindGap]);
    useEffect(() => () => {
        if (gapRef.current) {
            gapRef.current = null;
            gapScope.current.onGapReset?.();
        }
    }, []);
    useEffect(() => {
        if (!gapMode) return undefined;
        const cancelFromMatrix = event => {
            if (event.key !== 'Escape' || !gapRef.current || !matrixRef.current?.contains(event.target)) return;
            // Nested native dialogs own Escape. Otherwise cancel this focused
            // selection before a surrounding workspace handles the same key.
            if ([...document.querySelectorAll('dialog[open]')].some(dialog => dialog !== dialogRef.current)) return;
            event.preventDefault(); event.stopPropagation(); clearGap();
        };
        window.addEventListener('keydown', cancelFromMatrix, true);
        return () => window.removeEventListener('keydown', cancelFromMatrix, true);
    }, [gapMode]);

    const selectGapCell = (rowKey, index) => {
        const current = gapScope.current;
        if (!current.gapMode || typeof current.onGapSelect !== 'function') return;
        const row = current.rows.find(item => `${item.positionKey}-${item.slot}` === rowKey);
        if (!row || !isMissingCell(row.cells[index])) {
            setGapError('Selecciona un recuadro amarillo para buscar cobertura.');
            return;
        }
        const previous = gapRef.current;
        if (!previous || previous.complete || previous.date !== current.date) {
            if (previous) current.onGapReset?.();
            const next = { rowKey, position: row.name, positionKey: row.positionKey, slot: row.slot,
                anchor: index, from: index, to: index, date: current.date, complete: false };
            gapRef.current = next;
            setGapRange(next); setGapError('');
            return;
        }
        if (previous.rowKey !== rowKey) {
            setGapError('Elige el último recuadro amarillo del mismo puesto y carril.');
            return;
        }
        const from = Math.min(previous.anchor, index), to = Math.max(previous.anchor, index);
        if (!row.cells.slice(from, to + 1).every(isMissingCell)) {
            setGapError('El intervalo debe tener solo recuadros amarillos contiguos, sin cruzar otro color.');
            return;
        }
        const start = heatmapMinutes(HOURS[from]), end = heatmapMinutes(HOURS[to]) + 15;
        const next = { ...previous, from, to, complete: true, start, end };
        gapRef.current = next;
        setGapRange(next); setGapError('');
        try {
            current.onGapSelect({ position: row.name, positionKey: row.positionKey, rowKey, slot: row.slot,
                start, end, date: current.date, startIndex: from, endIndex: to },
                { exitFullscreen: () => setIsFullscreen(false) });
        } catch (error) {
            console.error('Error al consultar cobertura:', error);
            setGapError('No se pudo consultar la cobertura. Vuelve a seleccionar el intervalo.');
        }
    };

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
        if (gapMode) return;
        const element = event.currentTarget;
        const cell = event.target.closest('[data-range-hour]');
        if (moveMode && movement) {
            suppressMoveClick.current = false;
            if (event.button !== 0 || event.pointerType !== 'mouse' || !cell?.dataset.occupantId || moveState?.applying) return;
            const same = moveState?.staffId === cell.dataset.occupantId;
            const token = same ? moveState.token : selectMoveCell(cell);
            if (!token) return;
            event.preventDefault();
            moveDrag.current = { token, anchorIndex: Number(cell.dataset.rangeHour), deltaOrigin: same ? moveState.deltaMinutes : 0,
                x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, element, pointerId: event.pointerId };
            element.setPointerCapture(event.pointerId); return;
        }
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
    const cardDragCell = event => {
        if (!onCardTarget || !cardPlacement || !Array.from(event.dataTransfer.types||[]).includes('application/x-lc-schedule')) return null;
        const cell=event.target.closest('td[data-range-hour]');
        if (!cell || !event.currentTarget.contains(cell) || Number(cell.dataset.rangeHour)>=HOURS.length-1) return null;
        return {position:cell.dataset.position,start:heatmapMinutes(HOURS[Number(cell.dataset.rangeHour)])};
    };
    const handleCardDragOver = event => {
        const cell=cardDragCell(event);if(!cell)return;
        event.preventDefault();event.dataTransfer.dropEffect='move';
        onCardPreview?.(cell.position,cell.start);
        const bounds=event.currentTarget.getBoundingClientRect();
        if(event.clientX>bounds.right-24)event.currentTarget.scrollLeft+=20;
        else if(event.clientX<bounds.left+HEATMAP_POSITION_WIDTH+24)event.currentTarget.scrollLeft-=20;
        if(event.clientY>bounds.bottom-24)event.currentTarget.scrollTop+=20;
        else if(event.clientY<bounds.top+50)event.currentTarget.scrollTop-=20;
    };
    const handleCardDrop = event => {
        const cell=cardDragCell(event),token=event.dataTransfer.getData('application/x-lc-schedule');
        if(!cell || !token)return;
        event.preventDefault();event.stopPropagation();
        onCardTarget(cell.position,cell.start,token);
    };
    const handlePointerMove = (event) => {
        if (moveDrag.current) {
            const current = moveDrag.current;
            current.x = event.clientX; current.y = event.clientY;
            current.moved ||= Math.hypot(current.x - current.startX, current.y - current.startY) > 4;
            if (moveFrame.current === null) moveFrame.current = requestAnimationFrame(movePointerPreview);
            return;
        }
        if (gapMode) return;
        if (rangeDrag.current) {
            const element = event.currentTarget;
            const bounds = element.getBoundingClientRect();
            if (event.clientX > bounds.right - 24) element.scrollLeft += 20;
            if (event.clientX < bounds.left + 140) element.scrollLeft -= 20;
            const table = element.querySelector('table').getBoundingClientRect();
            const index = Math.max(0, Math.min(HOURS.length - 1, Math.floor((event.clientX - table.left - HEATMAP_POSITION_WIDTH) / HEATMAP_CELL_SIZE)));
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
        if (moveDrag.current) {
            const current = moveDrag.current;
            current.moved ||= Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4;
            const target = current.moved ? moveTargetAt(event.clientX, event.clientY, current) : null;
            suppressMoveClick.current = true; stopMoveDrag();
            if (event.type === 'pointercancel' || current.moved && !target) movement?.cancel();
            else if (current.moved) movement?.apply(target);
            return;
        }
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
            <div data-testid="heatmap-header" className="relative max-h-[45%] flex-none overflow-y-auto bg-gray-800 px-3 py-2 text-white sm:max-h-[60%]">
                <div className="flex min-h-8 items-center justify-between gap-2">
                    <h3 id={isFullscreen ? 'heatmap-dialog-title' : undefined} className={`min-w-0 truncate text-sm font-bold ${cardPlacement || moveState?'invisible':''}`}>
                        Mapa de Cobertura{dayLabel || date ? ` - ${dayLabel} ${date}` : ''}
                    </h3>
                    <div className={`flex shrink-0 items-center gap-2 ${cardPlacement || moveState?'invisible':''}`}>
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
                {(isFullscreen || showProjectionSummary) && <ProjectionHoursSummary summary={projectionHours} dayLabel={dayLabel || 'Día'} />}
                {cardPlacement && <div data-testid="heatmap-card-drag-status" data-phase={cardPlacement.phase} className="absolute inset-x-3 top-2 z-10 flex h-8 items-center gap-2 bg-gray-800 text-xs">
                    <p role={cardPlacement.error?'alert':'status'} title={cardPlacement.error||'Previsualización: suelta para aplicar al borrador; Guardar publica el horario.'} className="min-w-0 flex-1 truncate">{cardPlacement.error || (cardPlacement.busy?'Comprobando disponibilidad y plan semanal…':cardPlacement.plan?`Vista previa · ${cardPlacement.plan.modality} · ${cardPlacement.plan.restDays} descanso(s) · ${cardPlacement.plan.patch.start}–${cardPlacement.plan.patch.end}${cardPlacement.plan.patch.breakStart?` · Break ${cardPlacement.plan.patch.breakStart}`:''}`:'Elige posición e ingreso en el mapa.')}</p>
                    {cardPlacement.options?.length>1 && <label>Jornada<select aria-label="Jornada aprobada del arrastre" value={cardPlacement.optionId||''} onChange={event=>onCardOption?.(event.target.value)} className="ml-1 max-w-full rounded border bg-white p-1 text-slate-900"><option value="">Elegir salida</option>{cardPlacement.options.map(option=><option key={option.id} value={option.id}>{approvedBukShiftLabel(option)}</option>)}</select></label>}
                    {cardPlacement.phase==='review' && cardPlacement.plan?.valid && <button type="button" onClick={onApplyCardPlacement} className="min-h-8 rounded bg-blue-600 px-2">Aplicar al mapa</button>}
                    {cardPlacement.error && <button type="button" onClick={()=>{const id=cardPlacement.staffId;onCancelCardPlacement?.();openPerson(id);}} className="min-h-8 rounded border border-white/40 px-2">Revisar en ficha</button>}
                    <button type="button" onClick={onCancelCardPlacement} className="min-h-8 rounded border border-white/40 px-2">Cancelar arrastre</button>
                </div>}
                {moveState && <div data-testid="heatmap-move-status" className="absolute inset-x-3 top-2 z-10 flex h-8 items-center gap-2 bg-gray-800 text-xs">
                    <p role={moveState.error ? 'alert' : 'status'} className="min-w-0 flex-1 truncate" title={[moveState.error, ...(moveState.plan?.warnings || [])].filter(Boolean).join(' ') || 'Vista previa: arrastra o ajusta el movimiento. Guardar publica el horario.'}>
                        {moveState.error || (moveState.busy ? 'Verificando turno y disponibilidad…' : `${moveState.name} · ${moveState.plan?.patch.start || ''}–${moveState.plan?.patch.end || ''} · ${moveState.position}`)}
                    </p>
                    <button type="button" disabled={moveState.busy || !moveState.plan?.valid || moveState.plan.noChange} onClick={() => movement.apply()} className="min-h-8 rounded bg-blue-600 px-2 disabled:opacity-50">Aplicar movimiento</button>
                    <button type="button" onClick={cancelMove} className="min-h-8 rounded border border-white/40 px-2">Cancelar movimiento</button>
                </div>}
                <div data-testid="heatmap-legend-actions" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                    {HEATMAP_LEGEND.map((item) => (
                        <span key={item.color} className="inline-flex items-center gap-1">
                            <span className={`h-3 w-3 rounded border border-white/30 ${item.color}`} />
                            {item.label}
                        </span>
                    ))}
                {onTransfer || canFindGap || movement ? (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        {onTransfer && <button type="button" aria-pressed={selectMode && !gapMode && !moveMode} onClick={() => { cancelMove(); setMoveMode(false); setGapMode(false); clearGap(); setSelectMode(true); }} className={`rounded px-2 py-1 ${selectMode && !gapMode && !moveMode ? 'bg-blue-600 text-white' : 'bg-white/10'}`}>Seleccionar tramo</button>}
                        <button type="button" aria-pressed={!moveMode && !gapMode && (!onTransfer || !selectMode)} onClick={() => { cancelMove(); setMoveMode(false); setGapMode(false); clearGap(); setSelectMode(false); rangeDrag.current = null; }} className={`rounded px-2 py-1 ${!moveMode && !gapMode && (!onTransfer || !selectMode) ? 'bg-blue-600 text-white' : 'bg-white/10'}`}>Desplazar mapa</button>
                        {canFindGap && <button type="button" aria-pressed={gapMode} onClick={() => {
                            cancelMove(); setMoveMode(false); clearGap(); setGapMode(true); drag.current = null; rangeDrag.current = null;
                            setTransferSelection(null); setRangePreview(null);
                        }} className={`rounded px-2 py-1 ${gapMode ? 'bg-blue-600 text-white' : 'bg-white/10'}`}>Buscar cobertura</button>}
                        {movement && <div className="inline-flex items-center">
                            <button type="button" data-testid="heatmap-move-mode" aria-label="Mover colaborador" aria-pressed={moveMode} disabled={coverageStatus !== 'ready'}
                                onClick={() => { onCancelCardPlacement?.(); cancelMove(); setMoveMode(true); setGapMode(false); clearGap(); setSelectMode(false); setTransferSelection(null); setRangePreview(null); drag.current = null; }} className={`rounded-l px-2 py-1 disabled:opacity-50 ${moveMode ? 'bg-blue-600 text-white' : 'bg-white/10'}`}>Mover</button>
                            <button type="button" aria-label="Ajustar movimiento" aria-haspopup="dialog" disabled={!moveState} onClick={() => setMoveAdjustOpen(true)} className={`rounded-r border-l border-white/20 p-1 disabled:opacity-40 ${moveMode ? 'bg-blue-600 text-white' : 'bg-white/10'}`}><Settings2 size={14} aria-hidden="true" /></button>
                        </div>}
                    </div>
                ) : null}
                    <details className="min-w-0 open:order-last open:basis-full"><summary className="min-h-7 cursor-pointer rounded px-2 py-1 text-gray-300 hover:bg-white/10">Ayuda</summary><div className="space-y-1 py-2 text-xs text-gray-200">
                        <p>Arrastra una tarjeta desde Equipo para previsualizar su jornada. Suelta para aplicarla al borrador y usa Guardar para publicarla.</p>
                        <p>Mover: selecciona una celda ocupada y arrastra el turno. En pantalla táctil, toca el origen y el destino; usa Ajustar movimiento para revisar o aplicar. Las flechas desplazan 15 minutos o cambian de puesto; Escape cancela.</p>
                        <p>{gapMode ? 'Toca el primer y el último recuadro amarillo del mismo carril. El último incluye sus 15 minutos.' : onTransfer && selectMode ? 'Arrastra sobre un exceso para marcar el intervalo.' : 'Arrastra con el mouse o desliza para navegar.'}</p>
                        <p>Las flechas desplazan el mapa. Esc cancela el arrastre o cierra la vista ampliada.</p>
                    </div></details>
                </div>
                {gapMode && gapRange?.date === date && <div role="status" data-testid="heatmap-gap-selection" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-blue-100">
                    <span>{gapRange.complete
                        ? `${gapRange.position} · ${heatmapClock(gapRange.start)}–${heatmapClock(gapRange.end)} · Duración ${gapDuration(gapRange.end - gapRange.start)}`
                        : `Inicio ${HOURS[gapRange.anchor]} · ${gapRange.position}, carril ${gapRange.slot + 1}. Toca el último recuadro amarillo.`}</span>
                    <button type="button" onClick={() => clearGap()} className="min-h-8 rounded border border-white/30 px-2 py-1 text-white hover:bg-white/10">Limpiar selección de cobertura</button>
                </div>}
                {gapMode && gapError && <p role="alert" className="mt-2 text-xs text-red-200">{gapError}</p>}
                {exportError && <p role="alert" className="mt-2 text-sm text-red-200">{exportError}</p>}
                {onTransfer && transferSelection && <HeatmapTransferForm
                    key={`${transferSelection.source}-${transferSelection.start}-${transferSelection.end || ''}`}
                    selection={transferSelection} assigned={assigned} requirements={requirements}
                    onApply={onTransfer} onCancel={() => { setTransferSelection(null); setRangePreview(null); }}
                    onBreak={onBreak}
                />}
                <div data-testid="heatmap-secondary-tools" className="mt-1 flex flex-wrap items-start gap-x-4 gap-y-1">
                {assigned.some(person => person.breakLabel) && (
                    <details className="min-w-0 text-xs text-amber-200 open:basis-full">
                        <summary className="min-h-7 cursor-pointer py-1">Breaks asignados (no suman cobertura)</summary>
                        <ul className="mt-1 space-y-1">
                            {[...new Map(assigned.filter(person => person.breakLabel).map(person => [person.staffId || person.breakLabel, person])).values()].map((person, index) => (
                                <li key={`${person.breakLabel}-${index}`}>{person.breakLabel}</li>
                            ))}
                        </ul>
                    </details>
                )}
                <CoverageInsights assigned={displayAssigned} requirements={requirements} positions={positionDefinitions} status={coverageStatus} filtered={filtered} onSelectPerson={openPerson}/>
                </div>
            </div>
            <div ref={matrixRef} role="region" aria-label="Matriz de cobertura por posición y horario" tabIndex={0}
                onDragOver={handleCardDragOver} onDrop={handleCardDrop}
                onDragLeave={event=>{const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>=bounds.right||event.clientY<bounds.top||event.clientY>=bounds.bottom)onCardPreview?.(null,null);}}
                data-card-placement-active={Boolean(cardPlacement)||undefined}
                onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onLostPointerCapture={() => { drag.current = null; rangeDrag.current = null; if(moveDrag.current){stopMoveDrag();movement?.cancel();} }}
                onKeyDown={event => {
                    if (event.key === 'Escape' && gapMode && gapRef.current) {
                        event.preventDefault(); event.stopPropagation(); clearGap();
                    }
                }}
                data-gap-selection-active={gapMode && Boolean(gapRange)}
                className={`relative isolate flex-1 min-h-0 min-w-0 overflow-auto overscroll-contain ${moveMode ? 'cursor-default' : gapMode || (onTransfer && selectMode) ? 'cursor-crosshair' : 'cursor-grab'} select-none bg-gray-50 focus-visible:outline-blue-500`}
                style={{ WebkitOverflowScrolling: 'touch', touchAction: onTransfer && selectMode && !gapMode ? 'none' : 'auto' }}>
                <table className="table-fixed border-collapse bg-white shadow-inner" style={{ width: HEATMAP_TABLE_WIDTH, minWidth: HEATMAP_TABLE_WIDTH }}>
                    <colgroup>
                        <col style={{ width: HEATMAP_POSITION_WIDTH }} />
                        {HOURS.map((_, i) => (
                            <col key={i} style={{ width: HEATMAP_CELL_SIZE }} />
                        ))}
                    </colgroup>

                    <thead>
                        <tr className="bg-gradient-to-r from-gray-700 to-gray-800 border-b border-gray-600">
                            <th className="sticky top-0 left-0 z-30 bg-gradient-to-r from-gray-700 to-gray-800 border-r border-gray-500 px-2 py-1.5 text-left font-bold text-white text-xs shadow-lg">
                                Posición
                            </th>
                            {HOURS.map((hour) => (
                                <th
                                    key={hour}
                                    scope="col"
                                    className="sticky top-0 z-20 overflow-hidden bg-gradient-to-r from-gray-700 to-gray-800 border border-gray-500 p-0 text-[10px] font-bold text-white text-center shadow-md"
                                    title={hour}
                                >
                                    <div className="relative h-12 w-full">
                                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap leading-none">{hour}</span>
                                    </div>
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
                                            className="sticky left-0 z-10 align-middle bg-white px-2 py-0 font-semibold text-xs leading-none text-gray-800 border-r border-b border-gray-300 shadow-sm"
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
                                    {row.cells.map((cell, j) => {
                                        const rowKey = `${row.positionKey}-${row.slot}`;
                                        const occupant=occupants.get(`${rowKey}:${j}`);
                                        const cardSelected=Boolean(activePreview?.proposedAssignments && occupant?.staffId===activePreview.staffId);
                                        const cardConflict=cardSelected && j<HOURS.length-1 && activePreview.plan?.academicIntervals?.some(range=>range.start<heatmapMinutes(HOURS[j])+15 && range.end>heatmapMinutes(HOURS[j]));
                                        const cardTarget=Boolean(cardPlacement && row.name===cardPlacement.position && heatmapMinutes(HOURS[j])===cardPlacement.start);
                                        const missing = j < HOURS.length-1 && isMissingCell(cell);
                                        const gapSelected = gapMode && gapRange?.date === date && gapRange?.rowKey === rowKey
                                            && j >= gapRange.from && j <= gapRange.to;
                                        return (
                                        <td
                                            key={j}
                                            className={`border border-gray-200 ${cell.color} hover:opacity-80 transition-opacity duration-150 ${moveMode && occupant ? 'cursor-move' : ''}`}
                                            style={{ height: HEATMAP_CELL_SIZE, width: HEATMAP_CELL_SIZE, padding: 0,
                                                boxShadow: cardConflict ? 'inset 0 0 0 2px #dc2626' : cardSelected ? 'inset 0 0 0 2px #2563eb' : cardTarget && cardPlacement.error ? 'inset 0 0 0 2px #dc2626' : gapSelected ? 'inset 0 0 0 2px #2563eb' : rangePreview?.row === `${row.positionKey}-${row.slot}` && j >= rangePreview.from && j <= rangePreview.to ? 'inset 0 3px #1d4ed8, inset 0 -3px #1d4ed8' : undefined,
                                                filter: rangePreview?.row === `${row.positionKey}-${row.slot}` && j >= rangePreview.from && j <= rangePreview.to ? 'brightness(0.8)' : undefined }}
                                            data-range-hour={j} data-range-row={rowKey} data-position={row.name} data-position-key={row.positionKey} data-slot={row.slot} data-excess={cell.isExcess}
                                            data-missing={missing} data-gap-selected={gapSelected || undefined}
                                            data-occupant-id={occupant?.staffId} data-occupant-name={occupant?.staffName} data-exit-marker={occupant?.exit||undefined}
                                            data-card-placement-selected={cardSelected||undefined} data-card-placement-target={cardTarget||undefined}
                                            data-card-placement-conflict={cardConflict||undefined}
                                            data-move-selected={moveState && cardSelected || undefined} data-move-conflict={moveState && cardConflict || undefined}
                                            role={gapMode && missing || moveMode && (occupant || moveState) ? 'button' : undefined}
                                            tabIndex={moveMode ? (occupant || moveState ? 0 : undefined) : gapMode ? (missing ? 0 : undefined) : occupant || onTransfer && cell.isExcess ? 0 : undefined}
                                            aria-pressed={moveMode && occupant ? Boolean(cardSelected) : gapMode && missing ? Boolean(gapSelected) : undefined}
                                            aria-label={moveMode ? (occupant ? `Mover a ${occupant.staffName}, ${row.name}, ${HOURS[j]}` : `Destino ${row.name}, ${HOURS[j]}`) : gapMode && missing ? `Seleccionar faltante de ${row.name}, carril ${row.slot + 1}, a las ${HOURS[j]}` : onTransfer && cell.isExcess && !gapMode ? `Seleccionar tramo de ${row.name} desde ${HOURS[j]}${occupant ? `, ${occupant.staffName}` : ''}` : occupant ? `${occupant.staffName}, ${row.name}, ${HOURS[j]}` : undefined}
                                            aria-describedby={inspected && inspectedCell.key === `${rowKey}:${j}` ? tooltipId : undefined}
                                            onMouseEnter={event=>inspectCell(event.currentTarget,`${rowKey}:${j}`,HOURS[j])}
                                            onMouseLeave={leaveCellInfo}
                                            onFocus={event=>inspectCell(event.currentTarget,`${rowKey}:${j}`,HOURS[j])}
                                            onBlur={hideCellInfo}
                                            onClick={event => {
                                                if(moveMode){
                                                    if(suppressMoveClick.current){suppressMoveClick.current=false;return;}
                                                    if(occupant){if(moveState?.staffId!==occupant.staffId)selectMoveCell(event.currentTarget);}
                                                    else if(moveState)movement.preview({deltaMinutes:heatmapMinutes(HOURS[j])-moveState.anchorMinute,position:row.name});
                                                    return;
                                                }
                                                if(gapMode)selectGapCell(rowKey,j);else if(occupant&&!cell.isExcess)openPerson(occupant.staffId);
                                            }}
                                            onDoubleClick={!moveMode&&occupant?()=>onInfoPerson?.(occupant.staffId):undefined}
                                            onKeyDown={event => {
                                                if(moveMode){
                                                    if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(occupant)selectMoveCell(event.currentTarget);else if(moveState)movement.preview({deltaMinutes:heatmapMinutes(HOURS[j])-moveState.anchorMinute,position:row.name});}
                                                    else if(moveState&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
                                                        event.preventDefault();event.stopPropagation();
                                                        if(event.key==='ArrowLeft'||event.key==='ArrowRight')movement.preview({deltaMinutes:moveState.deltaMinutes+(event.key==='ArrowLeft'?-15:15)});
                                                        else{const positions=[...new Set(rows.map(row=>row.name))],index=positions.indexOf(moveState.position),next=positions[index+(event.key==='ArrowUp'?-1:1)];if(next)movement.preview({position:next});}
                                                    }
                                                    return;
                                                }
                                                if (gapMode) {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault(); event.stopPropagation(); selectGapCell(rowKey, j);
                                                    }
                                                    return;
                                                }
                                                if(occupant && !cell.isExcess && (event.key==='Enter'||event.key===' ')){event.preventDefault();openPerson(occupant.staffId);return;}
                                                if (!onTransfer || !cell.isExcess || j===HOURS.length-1) return;
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    setTransferSelection({ source: row.name, start: heatmapMinutes(HOURS[j]), end: heatmapMinutes(HOURS[j]) + 15 });
                                                    setRangePreview({ row: `${row.positionKey}-${row.slot}`, from: j, to: j });
                                                }
                                            }}
                                            title={occupant ? undefined : `${HOURS[j]}: ${cell.isTrainer ? (cell.isExcess ? 'Entrenador · Exceso' : 'Entrenador') : cell.color.includes('yellow') ? 'Faltante' : cell.color.includes('blue') ? 'Asignado' : cell.isExcess ? 'Exceso' : 'Sin requerimiento'}`}
                                        >{occupant?.exit && <span aria-label="Salida" className="block text-center text-[9px] font-bold leading-none text-white">↗</span>}</td>
                                        );
                                    })}
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
                    onCancel={event => {
                        if (gapRef.current) { event.preventDefault(); clearGap(); }
                        else setIsFullscreen(false);
                    }}
                    onClose={() => setIsFullscreen(false)}
                    className="fixed inset-0 m-0 h-[100dvh] w-screen max-h-none max-w-none border-0 bg-slate-950/90 p-2 sm:p-4 backdrop:bg-black/70">
                    {panel}
                </dialog>,
                document.body
            )}
            {inspected && !cardPlacement && <HeatmapOccupantTooltip id={tooltipId} person={inspected}
                hour={inspectedCell.hour} anchor={inspectedCell.element} container={isFullscreen ? dialogRef.current : document.body}
                onMouseEnter={keepCellInfo} onMouseLeave={leaveCellInfo} />}
            {moveAdjustOpen && moveState && <HeatmapMoveAdjustDialog movement={movement} positions={[...new Set(rows.map(row=>row.name))]} onClose={()=>setMoveAdjustOpen(false)} onCancel={cancelMove} />}
        </>
    );
}
