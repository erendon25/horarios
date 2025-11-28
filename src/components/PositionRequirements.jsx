// PositionRequirements.jsx – Versión FINAL corregida (funciona con multi-tienda + fallback)
import React, { useEffect, useState, useRef } from 'react';
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, getDocs, query, where } from 'firebase/firestore';

export const hours = Array.from({ length: 81 }, (_, i) => {
    const totalMinutes = 360 + i * 15; // 06:00 = 360 minutos
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const weekdayLabels = {
    monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles',
    thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo'
};

const dayMap = {
    lunes: 'monday', martes: 'tuesday', miercoles: 'wednesday',
    jueves: 'thursday', viernes: 'friday', sabado: 'saturday', domingo: 'sunday'
};

const compressMatrix = (matrix) => Object.fromEntries(
    matrix.map((r, i) => [i, Object.fromEntries(r.map((v, j) => [j, v]))])
);

const expandMatrix = (data, rows, cols) =>
    Array.from({ length: rows }, (_, i) =>
        Array.from({ length: cols }, (_, j) => data?.[i]?.[j] || 0)
    )
 

export default function PositionRequirements() {
    const db = getFirestore();
    const { day: urlDay } = useParams();
    const { currentUser } = useAuth();

    const [day, setDay] = useState('monday');
    const [positions, setPositions] = useState([]);
    const [matrix, setMatrix] = useState([]);
    const [newPos, setNewPos] = useState('');
    const [showDuplicate, setShowDuplicate] = useState(false);
    const [selectedDays, setSelectedDays] = useState([]);
    const [storeId, setStoreId] = useState('');
    const [loading, setLoading] = useState(true);

    const isDragging = useRef(false);
    const dragMode = useRef('add');// ←←← AÑADE ESTO AQUÍ ↓↓↓
    const [staffCount, setStaffCount] = useState(null); // null = cargando, número = real
    const [stats, setStats] = useState({
        totalPersonHours: 0,
        maxConcurrent: 0,
        fullTimeNeeded: 0
    });

    // === DRAG & DROP GLOBAL (soltar mouse) ===
    useEffect(() => {
        const stopDrag = () => {
            isDragging.current = false;
        };
        document.addEventListener('mouseup', stopDrag);
        return () => document.removeEventListener('mouseup', stopDrag);
    }, []);


    // ==================== CARGA STORE ID ====================
    useEffect(() => {
        const fetchStore = async () => {
            if (!currentUser) return;
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            if (snap.exists()) setStoreId(snap.data().storeId || '');
        };
        fetchStore();
    }, [currentUser, db]);

    // ==================== DIA DESDE URL ====================
    useEffect(() => {
        if (urlDay) {
            const mapped = dayMap[urlDay.toLowerCase()] || 'monday';
            setDay(mapped);
        }
    }, [urlDay]);

    // ==================== CARGA REQUERIMIENTOS ====================
    useEffect(() => {
        if (!storeId || !day) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                // 1. Subcolección de la tienda
                let docRef = doc(db, 'stores', storeId, 'positioning_requirements', day);
                let snap = await getDoc(docRef);

                // 2. Fallback a colección raíz (datos antiguos)
                if (!snap.exists()) {
                    docRef = doc(db, 'positioning_requirements', day);
                    snap = await getDoc(docRef);
                }

                if (snap.exists()) {
                    const { positions: p, matrix: m } = snap.data();
                    setPositions(p || []);
                    setMatrix(expandMatrix(m, p?.length || 0, hours.length));
                } else {
                    setPositions([]);
                    setMatrix([]);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [day, storeId]);

    // ==================== FUNCIONES DE EDICIÓN ====================
    const mutateCell = (row, col, type) => {
        setMatrix(prev => prev.map((r, i) =>
            i === row ? r.map((v, j) => j === col ? (type === 'add' ? v + 1 : Math.max(0, v - 1)) : v) : r
        ));
    };

    const onCellMouseDown = (row, col, e) => {
        if (e.buttons !== 1) return;
        isDragging.current = true;
        dragMode.current = e.ctrlKey || e.metaKey ? 'subtract' : 'add';
        updateCell(row, col, dragMode.current);
    };

    const onCellMouseEnter = (row, col) => {
        if (isDragging.current) {
            updateCell(row, col, dragMode.current);
        }
    };
    const updateCell = (row, col, mode) => {
        setMatrix(prev => {
            const newMatrix = [...prev];
            newMatrix[row] = [...(newMatrix[row] || Array(hours.length).fill(0))];
            const current = newMatrix[row][col] || 0;
            newMatrix[row][col] = mode === 'add' ? current + 1 : Math.max(0, current - 1);
            return newMatrix;
        });
    };

    const onMouseUp = () => { isDragging.current = false; };

    useEffect(() => {
        window.addEventListener('mouseup', onMouseUp);
        return () => window.removeEventListener('mouseup', onMouseUp);
    }, []);

    const addPosition = () => {
        if (!newPos.trim()) return;
        setPositions(prev => [...prev, newPos.trim()]);
        setMatrix(prev => [...prev, Array(hours.length).fill(0)]);
        setNewPos('');
    };

    const deletePosition = (row) => {
        setPositions(prev => prev.filter((_, i) => i !== row));
        setMatrix(prev => prev.filter((_, i) => i !== row));
    };

    const updatePosition = (row, value) => {
        setPositions(prev => prev.map((p, i) => i === row ? value : p));
    };

    const clearAll = () => {
        if (window.confirm('¿Borrar toda la planificación del día?')) {
            setMatrix(positions.map(() => Array(hours.length).fill(0)));
        }
    };

    // ==================== GUARDADO ====================
    const save = async () => {
        if (positions.length === 0) return alert('Agrega al menos una posición');

        const compressed = compressMatrix(matrix);

        try {
            const docRef = doc(db, 'stores', storeId, 'positioning_requirements', day);
            await setDoc(docRef, {
                positions,
                matrix: compressed
            }, { merge: true });

            alert('Guardado correctamente');
        } catch (e) {
            console.error(e);
            alert('Error al guardar');
        }
    };

    // ==================== DUPLICAR ====================
    const toggleDupDay = (d) => {
        setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
    };

    const duplicatePlan = async () => {
        if (selectedDays.length === 0) return;

        const compressed = compressMatrix(matrix);

        const promises = selectedDays.map(d => {
            const ref = doc(db, 'stores', storeId, 'positioning_requirements', d);
            return setDoc(ref, { positions, matrix: compressed }, { merge: true });
        });

        await Promise.all(promises);
        alert('Duplicado correctamente');
        setShowDuplicate(false);
        setSelectedDays([]);
    };

        // ==================== CARGA CONTEO DE EMPLEADOS REALES ====================
    useEffect(() => {
        if (!storeId) {
            setStaffCount(0);
            return;
        }

        const fetchStaffCount = async () => {
            try {
                const staffRef = collection(db, 'staff_profiles');
                const q = query(
    staffRef,
    where('storeId', '==', storeId)
);
                const snap = await getDocs(q);
                setStaffCount(snap.size);
            } catch (err) {
                console.error('Error cargando plantilla:', err);
                setStaffCount(0);
            }
        };

        fetchStaffCount();
    }, [storeId]);

    // ==================== CÁLCULO EN TIEMPO REAL DE ESTADÍSTICAS ====================
    useEffect(() => {
        if (!matrix || matrix.length === 0) {
            setStats({ totalPersonHours: 0, maxConcurrent: 0, fullTimeNeeded: 0 });
            return;
        }

        const totalPersonHours = matrix.reduce((dayTotal, row) =>
            dayTotal + row.reduce((sum, cell) => sum + (cell || 0), 0), 0);

        const maxConcurrent = Math.max(
            ...Array.from({ length: hours.length }, (_, col) =>
                matrix.reduce((sum, row) => sum + (row[col] || 0), 0)
            ), 0
        );

        setStats({
            totalPersonHours,
            maxConcurrent,
            fullTimeNeeded: Math.ceil(totalPersonHours / 8)
        });
    }, [matrix]);
    if (loading) return <div className="p-8 text-center">Cargando requerimientos...</div>;

    return (
        <div className="p-6 select-none">
            {/* SELECTOR DE DÍA Y BOTONES */}
            <div className="flex items-center gap-4 mb-6 flex-wrap">
                <div className="flex items-center gap-2">
                    <label className="font-semibold">Día:</label>
                    <select
                        value={day}
                        onChange={e => setDay(e.target.value)}
                        className="border rounded px-3 py-1"
                    >
                        {weekdays.map(d => (
                            <option key={d} value={d}>{weekdayLabels[d]}</option>
                        ))}
                    </select>
                </div>

                <button onClick={save} className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700">
                    Guardar
                </button>
                <button onClick={clearAll} className="bg-red-600 text-white px-5 py-2 rounded hover:bg-red-700">
                    Borrar Todo
                </button>
                <button
                    onClick={() => setShowDuplicate(!showDuplicate)}
                    className="bg-purple-600 text-white px-5 py-2 rounded hover:bg-purple-700"
                >
                    Duplicar planificación
                </button>
            </div>

            {/* DUPLICAR */}
            {showDuplicate && (
                <div className="border border-purple-300 bg-purple-50 p-4 rounded mb-6">
                    <p className="font-semibold mb-2">Duplicar a:</p>
                    <div className="flex flex-wrap gap-4">
                        {weekdays.map(d => (
                            <label key={d} className="flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={selectedDays.includes(d)}
                                    onChange={() => toggleDupDay(d)}
                                />
                                {weekdayLabels[d]}
                            </label>
                        ))}
                    </div>
                    <button
                        onClick={duplicatePlan}
                        className="mt-4 bg-purple-700 text-white px-6 py-2 rounded"
                    >
                        Confirmar duplicado
                    </button>
                </div>
            )}

            {/* NUEVA POSICIÓN */}
            <div className="flex gap-3 mb-6">
                <input
                    value={newPos}
                    onChange={e => setNewPos(e.target.value)}
                    placeholder="Nueva posición"
                    className="border rounded px-3 py-1 w-64"
                    onKeyDown={e => e.key === 'Enter' && addPosition()}
                />
                <button onClick={addPosition} className="bg-green-600 text-white px-5 py-2 rounded">
                    Añadir Posición
                </button>
            </div>

            {/* TABLA */}
            <div className="overflow-auto border rounded-lg shadow">
                <table className="table-auto w-[1400px] text-xs">
                    <thead className="sticky top-0 bg-gray-100 z-10">
                        <tr>
                            <th className="border px-3 py-2">Posición</th>
                            {hours.map((h, i) => (
                                <th key={i} className="border px-1 py-1 whitespace-nowrap">{h}</th>
                            ))}
                            <th className="border px-3">❌</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.map((pos, r) => (
                            <tr key={r}>
                                <td className="border px-3 bg-white sticky left-0 z-10">
                                    <input
                                        value={pos}
                                        onChange={e => updatePosition(r, e.target.value)}
                                        className="w-full border-b border-gray-300 px-1"
                                    />
                                </td>
                                {hours.map((_, c) => (
                                    <td
                                        key={c}
                                        onMouseDown={e => onCellMouseDown(r, c, e)}
                                        onMouseEnter={() => onCellMouseEnter(r, c)}
                                        className={`border text-center w-5 h-8 cursor-pointer ${
                                            matrix[r]?.[c] > 0 ? 'bg-orange-500 text-white font-bold' : 'hover:bg-gray-100'
                                        }`}
                                        title={matrix[r]?.[c] > 0 ? `${matrix[r][c]} persona(s)` : ''}
                                    >
                                        {matrix[r]?.[c] || ''}
                                    </td>
                                ))}
                                <td
                                    className="border text-center text-red-600 cursor-pointer text-lg"
                                    onClick={() => deletePosition(r)}
                                >
                                    🗑️
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
                                               {/* ====== CONTADOR REALISTA: ¿Puedes cubrirlo con tu plantilla actual? ====== */}
            {positions.length > 0 && (() => {
                // Cálculo de demanda
                const totalPersonHours = matrix.reduce((dayTotal, row) =>
                    dayTotal + row.reduce((sum, cell) => sum + (cell || 0), 0), 0);

                const maxConcurrent = Math.max(
                    ...Array.from({ length: hours.length }, (_, col) =>
                        matrix.reduce((sum, row) => sum + (row[col] || 0), 0)
                    ), 0
                );

                // Tu plantilla real
                const availableStaff = staffCount || 0;

                // ¿Cuántas personas MÍNIMAS necesitas trabajando ese día?
                const minPeopleNeeded = maxConcurrent; // Nunca puedes bajar del pico

                // ¿Puedes cubrirlo con turnos cruzados (mañana + tarde + noche)?
                const canCoverWithShifts = availableStaff >= minPeopleNeeded;

                // Estimación inteligente: cuántos empleados necesitas "activos" ese día
                const estimatedActiveThatDay = Math.max(minPeopleNeeded, Math.ceil(totalPersonHours / 10)); // 10h promedio por persona con descansos

                const coveragePercentage = availableStaff > 0 
                    ? Math.min(100, Math.round((availableStaff / Math.max(minPeopleNeeded, 10)) * 100)) 
                    : 0;

                return (
                    <div className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <h3 className="text-2xl font-bold text-gray-800 mb-4">
                            Cobertura real para {weekdayLabels[day]}
                            {staffCount !== null && (
                                <span className="text-lg font-normal text-gray-600 block mt-1">
                                    Tienes {availableStaff} empleados en plantilla
                                </span>
                            )}
                        </h3>

                        {staffCount === null ? (
                            <p className="text-center text-gray-500">Cargando plantilla...</p>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-center mb-6">
                                    <div className="bg-white rounded-lg p-5 shadow-sm">
                                        <div className="text-4xl font-bold text-blue-600">{maxConcurrent}</div>
                                        <div className="text-sm text-gray-600 mt-2">Pico simultáneo</div>
                                    </div>

                                    <div className="bg-white rounded-lg p-5 shadow-sm">
                                        <div className="text-4xl font-bold text-purple-600">{minPeopleNeeded}</div>
                                        <div className="text-sm text-gray-600 mt-2">Mínimo necesarios</div>
                                    </div>

                                    <div className="bg-white rounded-lg p-5 shadow-sm">
                                        <div className={`text-4xl font-bold ${canCoverWithShifts ? 'text-green-600' : 'text-red-600'}`}>
                                            {availableStaff}
                                        </div>
                                        <div className="text-sm text-gray-600 mt-2">
                                            {canCoverWithShifts ? 'Puedes cubrirlo' : 'No alcanzas'}
                                        </div>
                                    </div>

                                    <div className="bg-white rounded-lg p-5 shadow-sm">
                                        <div className="text-4xl font-bold text-orange-600">
                                            {coveragePercentage}%
                                        </div>
                                        <div className="text-sm text-gray-600 mt-2">Cobertura real</div>
                                    </div>
                                </div>

                                <div className="bg-amber-50 p-5 rounded-lg border border-amber-300">
                                    <p className="font-bold text-amber-900 mb-3 text-lg">Conclusión práctica:</p>
                                    
                                    {canCoverWithShifts ? (
                                        <div className="text-green-700 space-y-2">
                                            <p>¡Sí puedes cubrir este día con tu plantilla actual!</p>
                                            <p>Te sobran <strong>{availableStaff - minPeopleNeeded} empleados</strong> → puedes dar descansos o reforzar limpieza.</p>
                                            <p>Recomendación: usa <strong>2–3 turnos cruzados</strong> (6–14, 12–20, 14–22).</p>
                                        </div>
                                    ) : (
                                        <div className="text-red-700 space-y-2">
                                            <p>No alcanzas a cubrir el pico de {maxConcurrent} personas.</p>
                                            <p>Te faltan <strong>{minPeopleNeeded - availableStaff} empleados</strong> en el momento más crítico.</p>
                                            <p>Solución: contratar refuerzo o reducir requerimientos en horario pico.</p>
                                        </div>
                                    )}
                                </div>

                            </>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}