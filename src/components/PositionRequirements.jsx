// PositionRequirements.jsx – Versión FINAL corregida (funciona con multi-tienda + fallback)
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
} from 'firebase/firestore';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { 
    Calendar, 
    Save, 
    Trash2, 
    Copy, 
    Plus, 
    X, 
    Users, 
    Clock, 
    AlertCircle,
    CheckCircle2,
    TrendingUp,
    ChevronLeft,
    ChevronRight,
    SkipBack,
    SkipForward,
    Home,
    Settings
} from 'lucide-react';

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
    const tableScrollRef = useRef(null);
    const scrollDragging = useRef(false);
    const scrollStartX = useRef(0);
    const scrollLeftStart = useRef(0);

    // === DRAG & DROP GLOBAL (soltar mouse) ===
    useEffect(() => {
        const stopDrag = () => {
            isDragging.current = false;
            scrollDragging.current = false;
        };
        document.addEventListener('mouseup', stopDrag);
        return () => document.removeEventListener('mouseup', stopDrag);
    }, []);

    // === SCROLL FLUIDO CON DRAG ===
    const handleScrollPointerDown = useCallback((e) => {
        if (e.button !== 0 || !tableScrollRef.current) return;
        e.preventDefault();
        scrollDragging.current = true;
        scrollStartX.current = e.clientX;
        scrollLeftStart.current = tableScrollRef.current.scrollLeft;
        tableScrollRef.current.style.cursor = 'grabbing';
        tableScrollRef.current.style.userSelect = 'none';
        tableScrollRef.current.setPointerCapture(e.pointerId);
    }, []);

    const handleScrollPointerMove = useCallback((e) => {
        if (!scrollDragging.current || !tableScrollRef.current) return;
        const walkX = (e.clientX - scrollStartX.current) * 5; // Multiplicador aumentado para scroll mucho más rápido
        tableScrollRef.current.scrollLeft = scrollLeftStart.current - walkX;
    }, []);

    const handleScrollPointerUp = useCallback((e) => {
        if (!tableScrollRef.current) return;
        scrollDragging.current = false;
        tableScrollRef.current.style.cursor = 'grab';
        tableScrollRef.current.style.userSelect = '';
        tableScrollRef.current.releasePointerCapture(e.pointerId);
    }, []);

    useEffect(() => {
        const container = tableScrollRef.current;
        if (!container) return;

        container.addEventListener('pointerdown', handleScrollPointerDown);
        container.addEventListener('pointermove', handleScrollPointerMove);
        container.addEventListener('pointerup', handleScrollPointerUp);
        container.addEventListener('pointercancel', handleScrollPointerUp);

        // Scroll con rueda mucho más rápido
        const handleWheel = (e) => {
            if (e.shiftKey || e.deltaY === 0) {
                e.preventDefault();
                container.scrollLeft += e.deltaY * 4; // Scroll horizontal mucho más rápido
            } else if (e.deltaX !== 0) {
                // Scroll horizontal directo (trackpad)
                e.preventDefault();
                container.scrollLeft += e.deltaX * 3;
            }
        };
        container.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            container.removeEventListener('pointerdown', handleScrollPointerDown);
            container.removeEventListener('pointermove', handleScrollPointerMove);
            container.removeEventListener('pointerup', handleScrollPointerUp);
            container.removeEventListener('pointercancel', handleScrollPointerUp);
            container.removeEventListener('wheel', handleWheel);
        };
    }, [handleScrollPointerDown, handleScrollPointerMove, handleScrollPointerUp]);

    // Navegación rápida
    const scrollToStart = () => {
        if (tableScrollRef.current) {
            tableScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
        }
    };

    const scrollToEnd = () => {
        if (tableScrollRef.current) {
            tableScrollRef.current.scrollTo({ left: tableScrollRef.current.scrollWidth, behavior: 'smooth' });
        }
    };

    const scrollLeft = () => {
        if (tableScrollRef.current) {
            tableScrollRef.current.scrollBy({ left: -800, behavior: 'smooth' });
        }
    };

    const scrollRight = () => {
        if (tableScrollRef.current) {
            tableScrollRef.current.scrollBy({ left: 800, behavior: 'smooth' });
        }
    };


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
    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mb-4"></div>
                    <p className="text-gray-600 font-medium text-lg">Cargando requerimientos...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 select-none">
            {/* Header con navegación */}
            <div className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-40">
                <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                        <div>
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                Requerimientos de Posicionamiento
                            </h1>
                            <p className="text-sm text-gray-600 mt-1">
                                {weekdayLabels[day]} - Configura los requerimientos de personal por posición y hora
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link 
                                to="/admin" 
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium text-sm"
                            >
                                <Home className="w-4 h-4" />
                                Inicio
                            </Link>
                            <Link 
                                to="/horarios" 
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium text-sm"
                            >
                                <Calendar className="w-4 h-4" />
                                Horarios
                            </Link>
                            <Link 
                                to="/posiciones" 
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium text-sm"
                            >
                                <Settings className="w-4 h-4" />
                                Posiciones
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            <div className="w-full mx-auto px-2 sm:px-4 lg:px-6 py-8">

                {/* SELECTOR DE DÍA Y BOTONES */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-3">
                            <Calendar className="w-5 h-5 text-gray-500" />
                            <label className="font-semibold text-gray-700">Día:</label>
                            <select
                                value={day}
                                onChange={e => setDay(e.target.value)}
                                className="border-2 border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium"
                            >
                                {weekdays.map(d => (
                                    <option key={d} value={d}>{weekdayLabels[d]}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex flex-wrap gap-3 ml-auto">
                            <button 
                                onClick={save} 
                                className="flex items-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
                            >
                                <Save className="w-4 h-4" />
                                Guardar
                            </button>
                            <button 
                                onClick={clearAll} 
                                className="flex items-center gap-2 bg-gradient-to-r from-red-500 to-red-600 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
                            >
                                <Trash2 className="w-4 h-4" />
                                Borrar Todo
                            </button>
                            <button
                                onClick={() => setShowDuplicate(!showDuplicate)}
                                className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
                            >
                                <Copy className="w-4 h-4" />
                                Duplicar planificación
                            </button>
                        </div>
                    </div>
                </div>

                {/* DUPLICAR */}
                {showDuplicate && (
                    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-xl p-6 mb-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Copy className="w-5 h-5 text-purple-600" />
                            <p className="font-bold text-lg text-gray-800">Duplicar a:</p>
                        </div>
                        <div className="flex flex-wrap gap-4 mb-4">
                            {weekdays.map(d => (
                                <label 
                                    key={d} 
                                    className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border-2 border-purple-200 cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-all"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedDays.includes(d)}
                                        onChange={() => toggleDupDay(d)}
                                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-500 cursor-pointer"
                                    />
                                    <span className="font-medium text-gray-700">{weekdayLabels[d]}</span>
                                </label>
                            ))}
                        </div>
                        <button
                            onClick={duplicatePlan}
                            className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white px-6 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
                        >
                            <CheckCircle2 className="w-4 h-4" />
                            Confirmar duplicado
                        </button>
                    </div>
                )}

                {/* NUEVA POSICIÓN */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                    <div className="flex gap-3">
                        <input
                            value={newPos}
                            onChange={e => setNewPos(e.target.value)}
                            placeholder="Nueva posición (ej: Caja, Piso, etc.)"
                            className="flex-1 border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            onKeyDown={e => e.key === 'Enter' && addPosition()}
                        />
                        <button 
                            onClick={addPosition} 
                            className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
                        >
                            <Plus className="w-4 h-4" />
                            Añadir Posición
                        </button>
                    </div>
                </div>

                {/* TABLA */}
                <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
                    {/* Controles de navegación rápida */}
                    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-600">Navegación rápida:</span>
                            <button
                                onClick={scrollToStart}
                                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                                title="Ir al inicio"
                            >
                                <SkipBack className="w-4 h-4 text-gray-600" />
                            </button>
                            <button
                                onClick={scrollLeft}
                                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                                title="Izquierda"
                            >
                                <ChevronLeft className="w-4 h-4 text-gray-600" />
                            </button>
                            <button
                                onClick={scrollRight}
                                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                                title="Derecha"
                            >
                                <ChevronRight className="w-4 h-4 text-gray-600" />
                            </button>
                            <button
                                onClick={scrollToEnd}
                                className="p-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                                title="Ir al final"
                            >
                                <SkipForward className="w-4 h-4 text-gray-600" />
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-500 italic">
                            Arrastra para desplazarte • Shift + Rueda para scroll horizontal rápido
                        </p>
                    </div>
                    <div 
                        ref={tableScrollRef}
                        className="overflow-auto border border-gray-200 rounded-lg cursor-grab active:cursor-grabbing"
                        style={{ 
                            scrollBehavior: 'smooth',
                            scrollbarWidth: 'thin',
                            WebkitOverflowScrolling: 'touch'
                        }}
                    >
                        <table className="table-fixed" style={{ minWidth: '100%', width: 'max-content' }}>
                            <colgroup>
                                <col style={{ width: '140px' }} />
                                {hours.map((_, i) => (
                                    <col key={i} style={{ width: '26px' }} />
                                ))}
                                <col style={{ width: '60px' }} />
                            </colgroup>
                            <thead className="sticky top-0 bg-gray-100 z-10">
                                <tr>
                                    <th className="border border-gray-300 px-3 py-1.5 text-gray-800 font-bold text-xs sticky left-0 z-20 bg-gray-100">
                                        Posición
                                    </th>
                                    {hours.map((h, i) => (
                                        <th key={i} className="border border-gray-300 px-1 py-1 text-gray-700 font-semibold text-[10px] whitespace-nowrap bg-gray-50" style={{ width: '26px' }}>
                                            {h.replace(/^0/, '')}
                                        </th>
                                    ))}
                                    <th className="border border-gray-300 px-2 py-1.5 text-gray-800 font-bold text-xs bg-gray-100">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {positions.length === 0 ? (
                                    <tr>
                                        <td colSpan={hours.length + 2} className="text-center py-12 text-gray-500">
                                            <div className="flex flex-col items-center gap-3">
                                                <AlertCircle className="w-12 h-12 text-gray-400" />
                                                <p className="font-semibold text-gray-600">No hay posiciones configuradas</p>
                                                <p className="text-sm text-gray-500">Agrega una posición para comenzar</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    positions.map((pos, r) => (
                                        <tr key={r} className="hover:bg-blue-50/30 transition-colors">
                                            <td className="border border-gray-200 px-3 py-1 bg-white sticky left-0 z-10 shadow-sm">
                                                <input
                                                    value={pos}
                                                    onChange={e => updatePosition(r, e.target.value)}
                                                    className="w-full border-2 border-gray-300 rounded px-2 py-0.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-medium"
                                                />
                                            </td>
                                            {hours.map((_, c) => (
                                                <td
                                                    key={c}
                                                    onMouseDown={e => onCellMouseDown(r, c, e)}
                                                    onMouseEnter={() => onCellMouseEnter(r, c)}
                                                    className={`border border-gray-200 text-center cursor-pointer transition-all ${
                                                        matrix[r]?.[c] > 0 
                                                            ? 'bg-gradient-to-br from-orange-400 to-orange-500 text-white font-bold shadow-sm' 
                                                            : 'hover:bg-blue-100'
                                                    }`}
                                                    style={{ width: '26px', height: '20px', fontSize: '11px' }}
                                                    title={matrix[r]?.[c] > 0 ? `${matrix[r][c]} persona(s) - Click para aumentar, Ctrl+Click para disminuir` : 'Click para agregar, Ctrl+Click para quitar'}
                                                >
                                                    {matrix[r]?.[c] || ''}
                                                </td>
                                            ))}
                                            <td className="border border-gray-200 text-center px-1 py-1">
                                                <button
                                                    onClick={() => deletePosition(r)}
                                                    className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                                                    title="Eliminar posición"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="bg-gray-50 px-4 py-2.5 border-t border-gray-200">
                        <p className="text-[10px] text-gray-600 flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Arrastra el mouse sobre las celdas para asignar personal. Mantén Ctrl/Cmd y arrastra para quitar.</span>
                        </p>
                    </div>
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
                    <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 rounded-xl shadow-lg p-6 border-2 border-blue-200">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-gray-800">
                                    Cobertura real para {weekdayLabels[day]}
                                </h3>
                                {staffCount !== null && (
                                    <p className="text-sm text-gray-600 mt-1">
                                        Tienes <strong className="text-blue-600">{availableStaff}</strong> empleados en plantilla
                                    </p>
                                )}
                            </div>
                        </div>

                        {staffCount === null ? (
                            <p className="text-center text-gray-500">Cargando plantilla...</p>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                                    <div className="bg-white rounded-xl p-6 shadow-md border-2 border-blue-200 hover:shadow-lg transition-shadow">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Users className="w-6 h-6 text-blue-600" />
                                            <span className="text-xs font-semibold text-gray-600 uppercase">Pico simultáneo</span>
                                        </div>
                                        <div className="text-4xl font-bold text-blue-600">{maxConcurrent}</div>
                                        <div className="text-xs text-gray-500 mt-1">personas máximo</div>
                                    </div>

                                    <div className="bg-white rounded-xl p-6 shadow-md border-2 border-purple-200 hover:shadow-lg transition-shadow">
                                        <div className="flex items-center gap-3 mb-2">
                                            <AlertCircle className="w-6 h-6 text-purple-600" />
                                            <span className="text-xs font-semibold text-gray-600 uppercase">Mínimo necesarios</span>
                                        </div>
                                        <div className="text-4xl font-bold text-purple-600">{minPeopleNeeded}</div>
                                        <div className="text-xs text-gray-500 mt-1">personas requeridas</div>
                                    </div>

                                    <div className={`bg-white rounded-xl p-6 shadow-md border-2 ${canCoverWithShifts ? 'border-green-200' : 'border-red-200'} hover:shadow-lg transition-shadow`}>
                                        <div className="flex items-center gap-3 mb-2">
                                            <CheckCircle2 className={`w-6 h-6 ${canCoverWithShifts ? 'text-green-600' : 'text-red-600'}`} />
                                            <span className="text-xs font-semibold text-gray-600 uppercase">Plantilla disponible</span>
                                        </div>
                                        <div className={`text-4xl font-bold ${canCoverWithShifts ? 'text-green-600' : 'text-red-600'}`}>
                                            {availableStaff}
                                        </div>
                                        <div className={`text-xs font-semibold mt-1 ${canCoverWithShifts ? 'text-green-700' : 'text-red-700'}`}>
                                            {canCoverWithShifts ? '✓ Puedes cubrirlo' : '✗ No alcanzas'}
                                        </div>
                                    </div>

                                    <div className="bg-white rounded-xl p-6 shadow-md border-2 border-orange-200 hover:shadow-lg transition-shadow">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Clock className="w-6 h-6 text-orange-600" />
                                            <span className="text-xs font-semibold text-gray-600 uppercase">Cobertura real</span>
                                        </div>
                                        <div className="text-4xl font-bold text-orange-600">
                                            {coveragePercentage}%
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">de capacidad</div>
                                    </div>
                                </div>

                                <div className={`p-6 rounded-xl border-2 ${canCoverWithShifts ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                                    <div className="flex items-start gap-3">
                                        {canCoverWithShifts ? (
                                            <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                                        ) : (
                                            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                                        )}
                                        <div className="flex-1">
                                            <p className={`font-bold mb-3 text-lg ${canCoverWithShifts ? 'text-green-900' : 'text-red-900'}`}>
                                                Conclusión práctica:
                                            </p>
                                            
                                            {canCoverWithShifts ? (
                                                <div className="text-green-800 space-y-2 text-sm">
                                                    <p className="font-semibold">¡Sí puedes cubrir este día con tu plantilla actual!</p>
                                                    <p>Te sobran <strong className="text-green-900">{availableStaff - minPeopleNeeded} empleados</strong> → puedes dar descansos o reforzar limpieza.</p>
                                                    <p>Recomendación: usa <strong>2–3 turnos cruzados</strong> (6–14, 12–20, 14–22).</p>
                                                </div>
                                            ) : (
                                                <div className="text-red-800 space-y-2 text-sm">
                                                    <p className="font-semibold">No alcanzas a cubrir el pico de {maxConcurrent} personas.</p>
                                                    <p>Te faltan <strong className="text-red-900">{minPeopleNeeded - availableStaff} empleados</strong> en el momento más crítico.</p>
                                                    <p>Solución: contratar refuerzo o reducir requerimientos en horario pico.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                            </>
                        )}
                    </div>
                );
            })()}
            </div>
        </div>
    );
}