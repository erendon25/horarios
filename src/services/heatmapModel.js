// Shared by the on-screen matrix and all daily Excel worksheets.
const HEATMAP_START_MINUTES = 7 * 60;
const HEATMAP_END_MINUTES = 25 * 60;
const HEATMAP_INTERVAL_MINUTES = 15;
const PROJECTION_START_MINUTES = 8 * 60;

export const HOURS = Array.from(
    { length: ((HEATMAP_END_MINUTES - HEATMAP_START_MINUTES) / HEATMAP_INTERVAL_MINUTES) + 1 },
    (_, i) => {
        const totalMinutes = HEATMAP_START_MINUTES + i * HEATMAP_INTERVAL_MINUTES;
        const totalHours = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;

        // Para horas >= 24, mostramos 24, 25, 26, etc.
        if (totalHours >= 24) {
            return `${String(totalHours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        return `${String(totalHours % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
);


export function buildHeatmapRows(assigned = [], requirements = {}) {
    const need = {};
    const assignedMap = {};
    const trainerMap = {}; // norm -> hour -> array of isTrainer flags
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

    // === PROYECCION ===
    const positions = Array.isArray(requirements.positions) ? requirements.positions : [];
    const compressed = requirements.matrix || {};

    // Cada llave en compressed es un índice (0...20) basado en la proyección desde las 08:00.
    // El mapa empieza a las 07:00, por eso anteponemos cuatro intervalos de 15 minutos.
    const projectionOffsetSlots = Math.max(
        0,
        (PROJECTION_START_MINUTES - HEATMAP_START_MINUTES) / HEATMAP_INTERVAL_MINUTES
    );
    const expanded = Object.keys(compressed)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => {
            const sourceRow = Array.isArray(compressed[k])
                ? compressed[k]
                : Object.keys(compressed[k] || {})
                    .sort((a, b) => Number(a) - Number(b))
                    .map(col => compressed[k][col]);
            const fullRow = [];

            // Alineación de 07:00 a 08:00
            for (let i = 0; i < projectionOffsetSlots; i++) fullRow.push(0);

            for(let i=0; i<21; i++) {
               const qty = sourceRow[i] || 0;
               fullRow.push(qty, qty, qty, qty);
            }
            return fullRow.slice(0, HOURS.length);
        });

    positions.forEach((pos, i) => {
        const norm = normalize(pos);
        const name = pos.replace(/#\d+$/, '').trim();
        displayNames.set(norm, name);
        need[norm] = need[norm] || {};

        const row = expanded[i] || Array(HOURS.length).fill(0);
        row.forEach((qty, j) => {
            if (qty > 0) {
                need[norm][HOURS[j]] = qty;
            }
        });
    });

    // === DETECCIÓN DE SOLAPAMIENTO ===
    const overlapDetection = {};
    const positionOverlapDetection = {};
    const turnoChanges = {};

    // Pre-computar todos los minutos de inicio por posición para detectar relevos exactos
    const startMinsByPos = {}; // norm → Set de minutos de inicio
    assigned.forEach(p => {
        const norm = normalize(p.position);
        if (!norm || !p.start) return;
        startMinsByPos[norm] = startMinsByPos[norm] || new Set();
        startMinsByPos[norm].add(timeToMin(p.start) % 1440);
    });

    assigned.forEach(p => {
        const norm = normalize(p.position);
        if (!norm || !p.start || !p.end) return;

        let startMin = timeToMin(p.start);
        let endMin = timeToMin(p.end);
        const isOvernight = endMin <= startMin;

        if (isOvernight) {
            endMin += 1440;
        }

        // Detección GENERAL de solapamiento
        const firstBlock = Math.floor(startMin / 15) * 15;
        // Último bloque inclusivo: si termina exactamente en múltiplo de 15, ese bloque lo incluimos
        // excepto si hay un relevo exacto (otro turno empieza justo donde éste termina)
        const endBlock = (endMin % 15 === 0) ? endMin : Math.floor(endMin / 15) * 15;

        let currentBlock = firstBlock;
        while (currentBlock <= endBlock) {
            const displayMin = isOvernight ? currentBlock : (currentBlock % 1440);
            const hour = ABS_MIN_TO_HOUR[displayMin];

            if (hour) {
                overlapDetection[hour] = (overlapDetection[hour] || 0) + 1;
            }
            currentBlock += 15;
        }

        // Detección ESPECÍFICA por posición
        positionOverlapDetection[norm] = positionOverlapDetection[norm] || {};
        currentBlock = firstBlock;
        while (currentBlock <= endBlock) {
            const displayMin = isOvernight ? currentBlock : (currentBlock % 1440);
            const hour = ABS_MIN_TO_HOUR[displayMin];

            if (hour) {
                positionOverlapDetection[norm][hour] = (positionOverlapDetection[norm][hour] || 0) + 1;
            }
            currentBlock += 15;
        }

        if (endMin % 15 === 0) {
            const changeHour = ABS_MIN_TO_HOUR[isOvernight ? endMin : (endMin % 1440)];
            if (changeHour) {
                turnoChanges[changeHour] = true;
            }
        }
    });

    // === PRIMERA PASADA: detectar horarios de INICIO por posición ===
    const startingTimes = {};
    assigned.forEach(p => {
        const norm = normalize(p.position);
        if (!norm || !p.start) return;
        let startMin = timeToMin(p.start);
        startingTimes[norm] = startingTimes[norm] || new Set();
        startingTimes[norm].add(startMin % 1440);
    });

    // === ASIGNACIONES DEFINITIVAS CON LÓGICA PRECISA ===
    assigned.forEach(p => {
        const norm = normalize(p.position);
        if (!norm || !p.start || !p.end) return;

        assignedMap[norm] = assignedMap[norm] || {};

        let startMin = timeToMin(p.start);
        let endMin = timeToMin(p.end);

        // Manejo de cruce de medianoche
        if (endMin <= startMin) endMin += 1440;

        // Iterar sobre cada bloque visual disponible en HOURS
        HOURS.forEach(hourStr => {
            let currentBlockMin;
            if (hourStr.includes(':')) {
                const [h, m] = hourStr.split(':').map(Number);
                currentBlockMin = h * 60 + m;
            } else {
                return;
            }

            // Un bloque "08:00" representa el intervalo [08:00, 08:15)
            // Un turno 08:00-12:00 CUBRE el bloque 08:00 (empieza en esa hora),
            // el bloque 11:45 (está dentro) y también INCLUYE el bloque 12:00
            // (marcando que "está presente en ese punto").
            //
            // Para evitar doble conteo en relevos exactos (A: 08-12, B: 12-16):
            // el bloque 12:00 SOLO se cuenta para el turno que INICIA (B), no para el que termina (A).
            // Esto se logra usando `<= endMin` para pintar, pero marcando el bloque de fin
            // solo si NO hay otro turno en esa posición que empieza exactamente ahí.

            const coversBlock = currentBlockMin >= startMin && currentBlockMin <= endMin;

            if (coversBlock) {
                // Si es exactamente el bloque de fin (currentBlockMin === endMin)
                // Y hay un relevo exacto (otro turno en esta posición empieza en ese mismo minuto),
                // NO lo contamos para evitar doble conteo.
                const isExactEnd = currentBlockMin === endMin;
                const hasRelayAtEnd = isExactEnd && (startMinsByPos[norm]?.has(endMin % 1440));

                // Excluir el bloque de fin solo si hay relevo, de lo contrario incluirlo
                if (!hasRelayAtEnd) {
                    assignedMap[norm][hourStr] = (assignedMap[norm][hourStr] || 0) + 1;

                    // Rastrear si este slot específico es un trainer
                    trainerMap[norm] = trainerMap[norm] || {};
                    trainerMap[norm][hourStr] = trainerMap[norm][hourStr] || [];
                    trainerMap[norm][hourStr].push(p.isTrainer || false);
                }
            }
        });
    });

    // === CONSTRUIR FILAS ===
    const finalRows = [];

    Object.keys(need)
        .sort((a, b) => (displayNames.get(a) || a).localeCompare(displayNames.get(b) || b))
        .forEach(norm => {
            const name = displayNames.get(norm) || norm;
            const required = need[norm] || {};
            const assignedHere = assignedMap[norm] || {};
            const positionRows = [];

            // Encontrar el máximo requerimiento para esta posición
            const maxRequired = Math.max(...Object.values(required), 1);



            // Crear una fila por cada carril requerido. La posición se rotula
            // una sola vez para el grupo mediante rowSpan al renderizar.
            for (let slot = 0; slot < maxRequired; slot++) {
                const cells = HOURS.map(hour => {
                    const req = required[hour] || 0;
                    const ass = assignedHere[hour] || 0;
                    const isTrainer = trainerMap[norm]?.[hour]?.[slot] || false;

                    // Para este slot específico
                    const slotIsRequired = req > slot;
                    const slotIsAssigned = ass > slot;

                    if (slotIsRequired && slotIsAssigned) {
                        return { color: isTrainer ? 'bg-orange-500' : 'bg-blue-500', isTrainer, text: '' };
                    } else if (slotIsRequired && !slotIsAssigned) {
                        return { color: 'bg-yellow-300', text: '' };
                    } else if (!slotIsRequired && slotIsAssigned) {
                        return { color: isTrainer ? 'bg-orange-500' : 'bg-red-500', isTrainer, text: '' };
                    } else {
                        return { color: 'bg-white', text: '' };
                    }
                });

                positionRows.push({
                    name,
                    positionKey: norm,
                    slot,
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
                        const isTrainer = trainerMap[norm]?.[hour]?.[extraSlot] || false;
                        const hasAssignment = ass > extraSlot;

                        return hasAssignment ?
                            { color: isTrainer ? 'bg-orange-500' : 'bg-red-500', isTrainer, text: '' } :
                            { color: 'bg-white', text: '' };
                    });

                    positionRows.push({
                        name,
                        positionKey: norm,
                        slot: extraSlot,
                        cells,
                        isExcess: true
                    });
                }
            }

            const groupSize = positionRows.length;
            const hasExcess = positionRows.some(row => row.isExcess);
            positionRows.forEach((row, index) => {
                finalRows.push({
                    ...row,
                    showPositionName: index === 0,
                    groupSize,
                    hasExcess
                });
            });
        });

    return finalRows;
}
