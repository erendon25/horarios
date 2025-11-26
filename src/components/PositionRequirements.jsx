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
    const dragMode = useRef('add');
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
        </div>
    );
}