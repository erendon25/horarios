// ScheduleHeatmapMatrix.jsx - VERSIÓN CORREGIDA (incluye el último bloque de 25:45)
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
// === AGREGA ESTO ARRIBA DEL COMPONENTE (justo después de los imports) ===
const weekdayLabels = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo'
};

export const HOURS = Array.from({ length: 81 }, (_, i) => {
    const totalMinutes = 360 + i * 15; // 06:00 = 360 minutos
    const totalHours = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;

    // Para horas >= 24, mostramos 24, 25, 26, etc.
    if (totalHours >= 24) {
        return `${String(totalHours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return `${String(totalHours % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

export default function ScheduleHeatmapMatrix({ assigned = [], requirements = {} }) {
    const [rows, setRows] = useState([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef(null);


    // ==== DRAG DRAG BIDIRECCIONAL CON POINTER EVENTS (funciona perfecto aunque el mouse salga del área) ====
    const dragging = useRef(false);
    const startX = useRef(0);
    const startY = useRef(0);
    const scrollLeftStart = useRef(0);
    const scrollTopStart = useRef(0);

    const handlePointerDown = useCallback((e) => {
        // Solo botón izquierdo (mouse) o touch/pen
        if (e.button !== 0) return;

        e.preventDefault(); // evita selección de texto y drags nativos

        dragging.current = true;
        startX.current = e.clientX;
        startY.current = e.clientY;
        scrollLeftStart.current = containerRef.current.scrollLeft;
        scrollTopStart.current = containerRef.current.scrollTop;

        containerRef.current.style.cursor = 'grabbing';
        containerRef.current.style.userSelect = 'none';

        containerRef.current.setPointerCapture(e.pointerId);

        // Añadimos los listeners solo mientras arrastramos
        containerRef.current.addEventListener('pointermove', handlePointerMove);
        containerRef.current.addEventListener('pointerup', handlePointerUp);
        containerRef.current.addEventListener('pointercancel', handlePointerUp);
    }, []);

    const handlePointerMove = useCallback((e) => {
        if (!dragging.current) return;

        const walkX = (e.clientX - startX.current) * 2.5; // 2.5 = velocidad perfecta (cambia a 2 o 3 si quieres)
        const walkY = (e.clientY - startY.current) * 2.5;

        containerRef.current.scrollLeft = scrollLeftStart.current - walkX;
        containerRef.current.scrollTop = scrollTopStart.current - walkY;
    }, []);

    const handlePointerUp = useCallback((e) => {
        if (!dragging.current) return;

        dragging.current = false;
        containerRef.current.style.cursor = 'grab';
        containerRef.current.style.userSelect = '';

        containerRef.current.releasePointerCapture(e.pointerId);

        containerRef.current.removeEventListener('pointermove', handlePointerMove);
        containerRef.current.removeEventListener('pointerup', handlePointerUp);
        containerRef.current.removeEventListener('pointercancel', handlePointerUp);
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        el.addEventListener('pointerdown', handlePointerDown);

        return () => {
            el.removeEventListener('pointerdown', handlePointerDown);
            // limpieza extra por si acaso
            el.removeEventListener('pointermove', handlePointerMove);
            el.removeEventListener('pointerup', handlePointerUp);
            el.removeEventListener('pointercancel', handlePointerUp);
        };
    }, [handlePointerDown, handlePointerMove, handlePointerUp]);
    useEffect(() => {
        const need = {};
        const assignedMap = {};
        const displayNames = new Map();

        const normalize = (pos) => pos?.trim().replace(/#\d+$/g, '').replace(/\s+/g, ' ').toLowerCase() || '';

        const timeToMin = (t) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };

        // === MAPA EXTENDIDO: minutos absolutos (0-1679) → hora visible en HOURS ===
        const ABS_MIN_TO_HOUR = {};
        HOURS.forEach(h => {
            let totalMinutes;
            if (h.includes(':')) {
                const [hours, minutes] = h.split(':').map(Number);
                totalMinutes = hours * 60 + minutes;
            } else {
                totalMinutes = 0;
            }
            ABS_MIN_TO_HOUR[totalMinutes] = h;
        });

        // === REQUERIMIENTOS ===
        const positions = Array.isArray(requirements.positions) ? requirements.positions : [];
        const compressed = requirements.matrix || {};
        const expanded = Object.keys(compressed)
            .sort((a, b) => Number(a) - Number(b))
            .map(k => Object.values(compressed[k]));

        positions.forEach((pos, i) => {
            const norm = normalize(pos);
            const name = pos.replace(/#\d+$/, '').trim();
            displayNames.set(norm, name);

            const row = expanded[i] || Array(HOURS.length).fill(0);
            row.forEach((qty, j) => {
                if (qty > 0) {
                    need[norm] = need[norm] || {};
                    need[norm][HOURS[j]] = qty;
                }
            });
        });

        // === DETECCIÓN DE SOLAPAMIENTO MEJORADA ===
        const overlapDetection = {};
        const positionOverlapDetection = {}; // Nueva: detección por posición
        const turnoChanges = {}; // NUEVO: Detectar cambios de turno

        assigned.forEach(p => {
            const norm = normalize(p.position);
            if (!norm || !p.start || !p.end) return;

            let startMin = timeToMin(p.start);
            let endMin = timeToMin(p.end);
            const isOvernight = endMin <= startMin;

            if (isOvernight) {
                endMin += 1440;
            }

            // Detección GENERAL de solapamiento (para todos)
            const firstBlock = Math.floor(startMin / 15) * 15;
            const lastBlock = Math.floor((endMin) - 1 / 15) * 15;  // ← CLAVE: ahora sí detecta relevos perfectos

            let currentBlock = firstBlock;
            while (currentBlock <= lastBlock) {
                const displayMin = isOvernight ? currentBlock : (currentBlock % 1440);
                const hour = ABS_MIN_TO_HOUR[displayMin];

                if (hour) {
                    overlapDetection[hour] = (overlapDetection[hour] || 0) + 1;
                }
                currentBlock += 15;
            }

            // Detección ESPECÍFICA por posición (para múltiples personas)
            positionOverlapDetection[norm] = positionOverlapDetection[norm] || {};
            currentBlock = firstBlock;
            while (currentBlock <= lastBlock) {
                const displayMin = isOvernight ? currentBlock : (currentBlock % 1440);
                const hour = ABS_MIN_TO_HOUR[displayMin];

                if (hour) {
                    positionOverlapDetection[norm][hour] = (positionOverlapDetection[norm][hour] || 0) + 1;
                }
                currentBlock += 15;
            }
            if (endMin % 15 === 0) { // Termina exactamente en cambio de hora
                const changeHour = ABS_MIN_TO_HOUR[isOvernight ? endMin : (endMin % 1440)];
                if (changeHour) {
                    turnoChanges[changeHour] = true;
                }
            }
        });
        // === PRIMERA PASADA: detectar qué horarios de INICIO existen por posición (para saber si hay relevo exacto) ===
        const startingTimes = {}; // norm → { 'caja': Set(480, 540, ...) } minutos absolutos de inicio
        assigned.forEach(p => {
            const norm = normalize(p.position);
            if (!norm || !p.start) return;
            let startMin = timeToMin(p.start);
            // Para overnight, guardamos el inicio real (puede ser >1440 o < start si cruza medianoche, pero simplificamos)
            startingTimes[norm] = startingTimes[norm] || new Set();
            startingTimes[norm].add(startMin % 1440); // guardamos solo la hora del día
        });

        // === ASIGNACIONES DEFINITIVAS CON LÓGICA PRECISA ===
        assigned.forEach(p => {
            const norm = normalize(p.position);
            if (!norm || !p.start || !p.end) return;

            assignedMap[norm] = assignedMap[norm] || {};

            let startMin = timeToMin(p.start);
            let endMin = timeToMin(p.end);

            // Manejo de cruce de medianoche (simple)
            if (endMin <= startMin) endMin += 1440;

            // Iterar sobre cada bloque visual disponible en HOURS y ver si está cubierto
            HOURS.forEach(hourStr => {
                let currentBlockMin;
                if (hourStr.includes(':')) {
                    const [h, m] = hourStr.split(':').map(Number);
                    currentBlockMin = h * 60 + m;
                } else {
                    return;
                }

                // Un bloque (ej 08:00) representa el intervalo [08:00, 08:15)
                // Está cubierto si el intervalo del turno [start, end) intercepta o cubre este bloque.
                // Simplificación: si start <= block < end, está cubierto.

                // Ajustar currentBlockMin para overnight visual si es necesario (ej 25:00)
                // Pero HOURS ya viene formateado 06:00 ... 26:00

                if (currentBlockMin >= startMin && currentBlockMin < endMin) {
                    assignedMap[norm][hourStr] = (assignedMap[norm][hourStr] || 0) + 1;
                }
            });
        });

        // === CONSTRUIR FILAS - CON DUPLICACIÓN DE POSICIONES (SIN NÚMEROS) ===
        const finalRows = [];

        Object.keys(need)
            .sort((a, b) => (displayNames.get(a) || a).localeCompare(displayNames.get(b) || b))
            .forEach(norm => {
                const name = displayNames.get(norm) || norm;
                const required = need[norm] || {};
                const assignedHere = assignedMap[norm] || {};

                // Encontrar el máximo requerimiento para esta posición
                const maxRequired = Math.max(...Object.values(required), 1);



                // Crear una fila por cada "slot" requerido (TODAS con el mismo nombre)
                for (let slot = 0; slot < maxRequired; slot++) {
                    const cells = HOURS.map(hour => {
                        const req = required[hour] || 0;
                        const ass = assignedHere[hour] || 0;

                        // Para este slot específico
                        const slotIsRequired = req > slot;
                        const slotIsAssigned = ass > slot;

                        if (slotIsRequired && slotIsAssigned) {
                            return { color: 'bg-blue-500', text: '' };
                        } else if (slotIsRequired && !slotIsAssigned) {
                            return { color: 'bg-yellow-300', text: '' };
                        } else if (!slotIsRequired && slotIsAssigned) {
                            return { color: 'bg-red-500', text: '' };
                        } else {
                            return { color: 'bg-white', text: '' };
                        }
                    });

                    finalRows.push({
                        name: name, // MISMO NOMBRE PARA TODAS LAS FILAS
                        cells,
                        isExcess: false
                    });
                }

                // Agregar filas de exceso si hay más asignaciones que requerimientos
                const maxAssigned = Math.max(...Object.values(assignedHere), 0);
                if (maxAssigned > maxRequired) {
                    for (let extraSlot = maxRequired; extraSlot < maxAssigned; extraSlot++) {
                        const cells = HOURS.map(hour => {
                            const ass = assignedHere[hour] || 0;
                            const hasAssignment = ass > extraSlot;

                            return hasAssignment ?
                                { color: 'bg-red-500', text: '' } :
                                { color: 'bg-white', text: '' };
                        });

                        finalRows.push({
                            name: name, // MISMO NOMBRE TAMBIÉN PARA EXCESOS
                            cells,
                            isExcess: true
                        });
                    }
                }
            });

        setRows(finalRows);
    }, [assigned, requirements]);

    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
            {/* Header compacto */}
            <div className="flex-none bg-gradient-to-r from-gray-800 to-gray-900 border-b border-gray-700 px-3 py-2">
                <div className="flex justify-between items-center mb-1.5">
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></div>
                        Mapa de Cobertura
                    </h3>
                    <button
                        onClick={() => setIsFullscreen(true)}
                        className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded transition-all duration-200 hover:scale-105"
                        title="Maximizar"
                    >
                        <Maximize2 size={14} />
                    </button>
                </div>
                <div className="flex items-center gap-3 text-xs font-medium text-gray-200">
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/20 rounded border border-yellow-400/30">
                        <div className="w-3 h-3 bg-yellow-400 rounded"></div>
                        <span className="text-yellow-200">Faltante</span>
                    </span>
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 rounded border border-blue-400/30">
                        <div className="w-3 h-3 bg-blue-500 rounded"></div>
                        <span className="text-blue-200">Asignado</span>
                    </span>
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 rounded border border-red-400/30">
                        <div className="w-3 h-3 bg-red-500 rounded"></div>
                        <span className="text-red-200">Exceso</span>
                    </span>
                </div>
                <div className="text-center text-[10px] text-gray-400 mt-1.5 italic">
                    ← Arrastra para navegar →
                </div>
            </div>

            {/* Contenedor con scroll real + drag BIDIRECCIONAL PERFECTO */}
            <div
                ref={containerRef}
                className="flex-1 overflow-auto cursor-grab select-none touch-none bg-gray-50"
                style={{ scrollBehavior: 'smooth' }}
            >
                {/* Tabla compacta */}
                <table className="table-fixed border-collapse bg-white shadow-inner" style={{ minWidth: '2592px' }}>
                    <colgroup>
                        <col style={{ width: '120px' }} />
                        {HOURS.map((_, i) => (
                            <col key={i} style={{ width: '24px' }} />
                        ))}
                    </colgroup>

                    <thead>
                        <tr className="bg-gradient-to-r from-gray-700 to-gray-800 border-b border-gray-600">
                            <th className="sticky top-0 left-0 z-20 bg-gradient-to-r from-gray-700 to-gray-800 border-r border-gray-500 px-2 py-1.5 text-left font-bold text-white text-xs shadow-lg">
                                Posición
                            </th>
                            {HOURS.map((hour, i) => {
                                const display = hour.replace(/^0/, '');
                                return (
                                    <th
                                        key={i}
                                        className="sticky top-0 bg-gradient-to-r from-gray-700 to-gray-800 border border-gray-500 px-0.5 py-1 text-[10px] font-bold text-white text-center shadow-md"
                                        title={hour}
                                    >
                                        {display}
                                    </th>
                                );
                            })}
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
                                        <p className="text-sm font-semibold text-gray-600">No hay requerimientos</p>
                                        <p className="text-xs text-gray-500">Configura los requerimientos de posicionamiento</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            rows.map((row, i) => (
                                <tr
                                    key={i}
                                    className="border-b border-gray-200 hover:bg-blue-50/30 transition-colors duration-150"
                                    style={{ minHeight: '20px' }}
                                >
                                    <td
                                        className={`sticky left-0 z-30 bg-white px-2 py-1 font-semibold text-xs border-r border-gray-300 whitespace-nowrap shadow-sm ${row.isExcess
                                                ? 'text-red-600 bg-red-50 font-bold border-red-200'
                                                : 'text-gray-800 hover:bg-blue-50'
                                            }`}
                                    >
                                        <div className="flex items-center gap-1">
                                            {row.isExcess && (
                                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                                            )}
                                            <span className="truncate max-w-[90px]">{row.name}</span>
                                            {row.isExcess && (
                                                <span className="text-[10px] font-normal text-red-500">(exc)</span>
                                            )}
                                        </div>
                                    </td>
                                    {row.cells.map((cell, j) => (
                                        <td
                                            key={j}
                                            className={`border border-gray-200 ${cell.color} hover:opacity-80 transition-opacity duration-150`}
                                            style={{ height: '20px', width: '24px' }}
                                            title={`${HOURS[j]}: ${cell.color.includes('yellow') ? 'Faltante' : cell.color.includes('blue') ? 'Asignado' : cell.color.includes('red') ? 'Exceso' : 'Sin requerimiento'}`}
                                        />
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal maximizado mejorado */}
            {isFullscreen && (
                <div
                    className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    onClick={() => setIsFullscreen(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl flex flex-col max-w-[96vw] max-h-[92vh] w-full border-2 border-gray-300"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header compacto */}
                        <div className="flex-none bg-gradient-to-r from-gray-800 to-gray-900 border-b border-gray-700 px-4 py-2.5">
                            <div className="flex justify-between items-center mb-2">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                                    Heatmap de Cobertura - Vista Completa
                                </h2>
                                <button
                                    onClick={() => setIsFullscreen(false)}
                                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded transition-all duration-200 hover:scale-105"
                                    title="Minimizar"
                                >
                                    <Minimize2 size={16} />
                                </button>
                            </div>
                            <div className="flex items-center gap-4 text-xs font-medium">
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/20 rounded border border-yellow-400/30">
                                    <div className="w-3 h-3 bg-yellow-400 rounded"></div>
                                    <span className="text-yellow-200">Faltante</span>
                                </span>
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/20 rounded border border-blue-400/30">
                                    <div className="w-3 h-3 bg-blue-500 rounded"></div>
                                    <span className="text-blue-200">Asignado</span>
                                </span>
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-red-500/20 rounded border border-red-400/30">
                                    <div className="w-3 h-3 bg-red-500 rounded"></div>
                                    <span className="text-red-200">Exceso</span>
                                </span>
                            </div>
                            <div className="text-center text-[10px] text-gray-400 mt-1.5 italic">
                                ← Arrastra para navegar →
                            </div>
                        </div>
                        {/* Contenedor con scroll compacto */}
                        <div className="flex-1 overflow-auto p-2 bg-gray-50">
                            <table className="table-fixed border-collapse bg-white shadow-inner rounded overflow-hidden" style={{ minWidth: '2592px' }}>
                                <colgroup>
                                    <col style={{ width: '120px' }} />
                                    {HOURS.map((_, i) => (
                                        <col key={i} style={{ width: '24px' }} />
                                    ))}
                                </colgroup>
                                <thead>
                                    <tr className="bg-gradient-to-r from-gray-700 to-gray-800 border-b border-gray-600">
                                        <th className="sticky top-0 left-0 z-20 bg-gradient-to-r from-gray-700 to-gray-800 border-r border-gray-500 px-2 py-1.5 text-left font-bold text-white text-xs shadow-lg">
                                            Posición
                                        </th>
                                        {HOURS.map((hour, i) => {
                                            const display = hour.replace(/^0/, '');
                                            return (
                                                <th
                                                    key={i}
                                                    className="sticky top-0 bg-gradient-to-r from-gray-700 to-gray-800 border border-gray-500 px-0.5 py-1 text-[10px] font-bold text-white text-center shadow-md"
                                                    title={hour}
                                                >
                                                    {display}
                                                </th>
                                            );
                                        })}
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
                                                    <p className="text-sm font-semibold text-gray-600">No hay requerimientos</p>
                                                    <p className="text-xs text-gray-500">Configura los requerimientos de posicionamiento</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        rows.map((row, i) => (
                                            <tr
                                                key={i}
                                                className="border-b border-gray-200 hover:bg-blue-50/30 transition-colors duration-150"
                                                style={{ minHeight: '20px' }}
                                            >
                                                <td
                                                    className={`sticky left-0 z-30 bg-white px-2 py-1 font-semibold text-xs border-r border-gray-300 whitespace-nowrap shadow-sm ${row.isExcess
                                                            ? 'text-red-600 bg-red-50 font-bold border-red-200'
                                                            : 'text-gray-800 hover:bg-blue-50'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-1">
                                                        {row.isExcess && (
                                                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                                                        )}
                                                        <span className="truncate max-w-[90px]">{row.name}</span>
                                                        {row.isExcess && (
                                                            <span className="text-[10px] font-normal text-red-500">(exc)</span>
                                                        )}
                                                    </div>
                                                </td>
                                                {row.cells.map((cell, j) => (
                                                    <td
                                                        key={j}
                                                        className={`border border-gray-200 ${cell.color} hover:opacity-80 transition-opacity duration-150`}
                                                        style={{ height: '20px', width: '24px' }}
                                                        title={`${HOURS[j]}: ${cell.color.includes('yellow') ? 'Faltante' : cell.color.includes('blue') ? 'Asignado' : cell.color.includes('red') ? 'Exceso' : 'Sin requerimiento'}`}
                                                    />
                                                ))}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}