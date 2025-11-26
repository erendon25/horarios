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
    const lastBlock = Math.floor((endMin)-1 / 15) * 15;  // ← CLAVE: ahora sí detecta relevos perfectos
    
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

    // === ASIGNACIONES DEFINITIVAS ===
    assigned.forEach(p => {
        const norm = normalize(p.position);
        if (!norm || !p.start || !p.end) return;

        const name = p.position.replace(/#\d+$/, '').trim();
        displayNames.set(norm, name);

        let startMin = timeToMin(p.start);
        let endMin = timeToMin(p.end);
        const isOvernight = endMin <= startMin;
        if (isOvernight) endMin += 1440;

        const firstBlock = Math.floor(startMin / 15) * 15;

        // Por defecto: fin exclusivo (no incluye el bloque final)
        let lastBlock = Math.floor((endMin - 1) / 15) * 15;

        // Pero si el turno termina exactamente en cambio de hora (09:00, 14:00, etc.)
        // y NADIE empieza exactamente a esa hora → SÍ incluimos el bloque final
        if (endMin % 15 === 0) {
            const endHourOfDay = endMin % 1440;
            const hasHandover = startingTimes[norm]?.has(endHourOfDay) || false;

            if (!hasHandover) {
                lastBlock = Math.floor(endMin / 15) * 15; // incluimos el bloque final
            }
            // si hasHandover = true → se queda exclusivo → no doble conteo
        }

        assignedMap[norm] = assignedMap[norm] || {};

        let currentBlock = firstBlock;
        while (currentBlock <= lastBlock) {
            const displayMin = isOvernight ? currentBlock : (currentBlock % 1440);
            const hour = ABS_MIN_TO_HOUR[displayMin];
            if (hour) {
                assignedMap[norm][hour] = (assignedMap[norm][hour] || 0) + 1;
            }
            currentBlock += 15;
        }
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
    <div className="h-full flex flex-col bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
        {/* Header idéntico a tu imagen buena */}
        <div className="flex-none bg-white border-b border-gray-300 px-5 py-3">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-6 text-sm font-medium text-gray-700">
                    <span className="flex items-center gap-2">
                        <div className="w-5 h-5 bg-yellow-400 rounded"></div> Faltante
                    </span>
                    <span className="flex items-center gap-2">
                        <div className="w-5 h-5 bg-blue-500 rounded"></div> Asignado
                    </span>
                    <span className="flex items-center gap-2">
                        <div className="w-5 h-5 bg-red-500 rounded"></div> Exceso
                    </span>
                </div>
                <button onClick={() => setIsFullscreen(true)} className="p-2 bg-gray-200 hover:bg-gray-300 rounded transition">
                    <Maximize2 size={18} />
                </button>
            </div>
            <div className="text-center text-xs text-gray-600 mt-2 italic">
                ← Arrastra con el mouse (horizontal y vertical) →
            </div>
        </div>

         {/* Contenedor con scroll real + drag BIDIRECCIONAL PERFECTO */}
        <div
            ref={containerRef}
            className="flex-1 overflow-auto cursor-grab select-none touch-none"
            style={{ scrollBehavior: 'smooth', maxHeight: 'calc(100vh - 200px)' }}
        >
            {/* Tabla con ancho fijo amplio para scroll horizontal garantizado */}
            <table className="table-fixed border-collapse" style={{ minWidth: '3885' }}>
                {/* Ancho mínimo: 220px + (81 × 65px) = ~5485px para garantizar scroll horizontal siempre */}
                <colgroup>
                    <col style={{ width: '140px' }} />
                    {HOURS.map((_, i) => (
                        <col key={i} style={{ width: '32px' }} />   
                    ))}
                </colgroup>

                <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-0">
                        <th className="sticky top-0 left-0 z-10 bg-white border-r-1 border-gray-400 px-2 py-1 text-left font-bold text-gray-800">
                            Posición
                        </th>
                        {HOURS.map((hour, i) => {
                            const display = hour.replace(/^0/, '');
                            return (
                                <th
                                    key={i}
                                    className="sticky top-0 bg-gray-100 border border-gray-300 h-4 px-1 py-3 text-xs font-semibold text-gray-700 text-center"
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
                            <td colSpan={HOURS.length + 1} className="text-center py-32 text-gray-500 text-lg font-medium">
                                No hay requerimientos para este día
                            </td>
                        </tr>
                    ) : (
                        rows.map((row, i) => (
                            <tr
                                key={i}
                                className="border-b border-gray-200 hover:bg-gray-50 transition"
                                style={{ minHeight: '20px' }}
                            >
                                <td
                                    className={`sticky left-0 z-30 bg-white px-6 py-1 font-semibold text-sm border-r-4 border-gray-400 whitespace-nowrap ${
                                        row.isExcess ? 'text-red-600 bg-red-30 font-bold' : 'text-gray-800'
                                    }`}
                                >
                                    {row.name}
                                    {row.isExcess && ' (exceso)'}
                                </td>
                                {row.cells.map((cell, j) => (
                                    <td
                                        key={j}
                                        className={`border border-gray-200 ${cell.color}`}
                                    />
                                ))}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>

        {/* Fullscreen sigue igual – perfecto */}
        {isFullscreen && (
            <div className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center" onClick={() => setIsFullscreen(false)}>
                <div className="bg-white rounded-xl shadow-2xl flex flex-col" style={{ width: '98vw', height: '96vh' }} onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center p-6 bg-gray-100 border-b-2">
                        <h2 className="text-2xl font-bold text-gray-800">Heatmap de Cobertura</h2>
                        <button onClick={() => setIsFullscreen(false)} className="p-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition">
                            <Minimize2 size={28} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-auto p-8">
                        <table className="table-auto border-collapse w-full text-base">
                            <thead className="sticky top-0 bg-white z-20 border-b-4 border-gray-500">
                                <tr>
                                    <th className="sticky left-0 bg-white z-30 px-10 py-6 font-bold border-r-4 border-gray-500">Posición</th>
                                    {HOURS.map(h => (
                                        <th key={h} className="px-8 py-6 font-semibold border border-gray-400">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, i) => (
                                    <tr key={i} className="hover:bg-gray-100">
                                        <td className={`sticky left-0 bg-white z-20 px-10 py-6 font-bold text-lg border-r-4 border-gray-500 ${row.isExcess ? 'text-red-600 bg-red-50' : ''}`}>
                                            {row.name} {row.isExcess && '(exceso)'}
                                        </td>
                                        {row.cells.map((c, j) => (
                                            <td key={j} className={`border border-gray-400 ${c.color} h-20`} />
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        )}
    </div>
);
}