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
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
    Calendar, 
    Download,
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

export const hours = Array.from({ length: 21 }, (_, i) => {
    const totalMinutes = 480 + i * 60; // 08:00 = 480 minutos. Como en excel arranca a las 08:00.
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
    const [isSaving, setIsSaving] = useState(false);

    const isDragging = useRef(false);
    const dragMode = useRef('add');
    const [staffCount, setStaffCount] = useState({ total: 0, ft: 0, pt: 0 }); 
    const [stats, setStats] = useState({
        totalPersonHours: 0,
        maxConcurrent: 0,
        fullTimeNeeded: 0
    });
    
    // ======== VENTAS ========
    const [salesConfig, setSalesConfig] = useState({ vta: 0, txs: 0, hourlyParts: {} });
    const [weekStartDate, setWeekStartDate] = useState(() => {
        const d = new Date();
        const startDiff = d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1); 
        const monday = new Date(d.setDate(startDiff));
        return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    });
    // ========================

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

    // ==================== CARGA CONFIGURACIÓN DE VENTAS ====================
    useEffect(() => {
        if (!storeId || !weekStartDate || !day) return;

        const fetchSales = async () => {
            const shiftDays = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
            const [baseY, baseM, baseD] = weekStartDate.split('-');
            const targetDate = new Date(baseY, parseInt(baseM) - 1, parseInt(baseD));
            
            // Sumamos los días que hayan pasado desde el lunes
            targetDate.setDate(targetDate.getDate() + (shiftDays[day] || 0));

            const currentMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
            const numericDay = targetDate.getDate().toString();

            try {
                const docRef = doc(db, 'stores', storeId, 'sales_config', currentMonth);
                const snap = await getDoc(docRef);

                if (snap.exists()) {
                    const data = snap.data();
                    const monthData = data.monthlyData || {};
                    const hourlyParts = data.hourlyParticipation || {};
                    const dailyHourlyParts = data.dailyHourlyParts || {};
                    
                    const dayData = monthData[numericDay] || {};
                    
                    const yr = targetDate.getFullYear();
                    const mo = String(targetDate.getMonth() + 1).padStart(2, '0');
                    const da = String(targetDate.getDate()).padStart(2, '0');
                    const targetDateStr = `${yr}-${mo}-${da}`;

                    const specificHourlyParts = dailyHourlyParts[targetDateStr] || hourlyParts;

                    setSalesConfig({
                        vta: Number(dayData.vta || 0),
                        txs: Number(dayData.txs || 0),
                        hourlyParts: specificHourlyParts
                    });
                } else {
                    setSalesConfig({ vta: 0, txs: 0, hourlyParts: {} });
                }
            } catch (e) {
                console.error("Error loading sales", e);
            }
        };

        fetchSales();
    }, [storeId, weekStartDate, day]);


    // ==================== FUNCIONES DE EDICIÓN ====================
    const lastHoveredCell = useRef({ row: -1, col: -1 });

    const mutateCell = (row, col, type) => {
        setMatrix(prev => prev.map((r, i) =>
            i === row ? r.map((v, j) => j === col ? (type === 'add' ? v + 1 : Math.max(0, v - 1)) : v) : r
        ));
    };

    const onCellMouseDown = (row, col, e) => {
        if (e.buttons !== 1) return;
        isDragging.current = true;
        dragMode.current = e.ctrlKey || e.metaKey ? 'subtract' : 'add';
        lastHoveredCell.current = { row, col };
        updateCell(row, col, dragMode.current);
    };

    const onCellMouseEnter = (row, col) => {
        if (!isDragging.current) return;
        if (lastHoveredCell.current.row === row && lastHoveredCell.current.col === col) return;
        
        lastHoveredCell.current = { row, col };
        updateCell(row, col, dragMode.current);
    };

    const updateCell = (row, col, mode) => {
        setMatrix(prev => {
            const newMatrix = [...prev];
            newMatrix[row] = [...(newMatrix[row] || Array(hours.length).fill(0))];
            const current = newMatrix[row][col] || 0;
            // Para pintar sumas 1. Para borrar bajas a 0 directamente si está pintado, o restas 1 (si quieres borrado parcial)
            // Aquí lo dejaremos sumando o restando 1 siempre
            newMatrix[row][col] = mode === 'add' ? current + 1 : Math.max(0, current - 1);
            return newMatrix;
        });
    };

    const onMouseUp = () => { 
        isDragging.current = false; 
        lastHoveredCell.current = { row: -1, col: -1 };
    };

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

    // ==================== EXPORTAR A PDF (Estilo Excel) ====================
    const exportToPDF = () => {
        if (positions.length === 0) return alert('No hay posiciones para exportar');

        // Formato personalizado para asegurar el ancho total de 81 columnas sin interrupción.
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'pt',
            format: [1450, 800] 
        });

        doc.setFontSize(22);
        doc.text(`PLANIFICACIÓN DIARIA - ${weekdayLabels[day].toUpperCase()}`, 30, 35);

        // Header: Una sola fila con "POSICIÓN / HORA" y los nombres de las horas en :00
        const headRow = [
            { content: 'POSICIÓN / HORA', styles: { halign: 'center' } }
        ];
        hours.forEach((h, i) => {
            headRow.push({
                content: h.replace(/^0/, ''),
                styles: { halign: 'center', cellPadding: 1, fontSize: 8 }
            });
        });
        headRow.push({ content: 'TOTAL', styles: { halign: 'center' } });

        // Body: Índices, nombres, matriz y sumas por fila
        const bodyData = positions.map((pos, r) => {
            const rowSum = matrix[r].reduce((a, b) => a + (b || 0), 0);
            return [
                `${r + 1} ${pos.toUpperCase()}`,
                ...hours.map((_, c) => matrix[r]?.[c] || ''),
                rowSum > 0 ? rowSum : ''
            ];
        });

        // Foot: Subtotales por cada columna de los 15 mins (Total Personal)
        const colSums = hours.map((_, c) => matrix.reduce((sum, row) => sum + (row[c] || 0), 0));
        const totalAll = colSums.reduce((a, b) => a + b, 0);

        const footRow = [
            'TOTAL',
            ...colSums.map(s => s > 0 ? s : ''),
            totalAll
        ];

        // Anchos y estilos específicos de cada columna para que sea una matriz cuadrada
        const colStyles = {
            0: { halign: 'right', cellWidth: 150, fillColor: [255, 255, 255], fontStyle: 'bold' }
        };
        for(let i = 1; i <= hours.length; i++) {
            colStyles[i] = { halign: 'center', cellWidth: 14 };
        }
        colStyles[hours.length + 1] = { halign: 'center', cellWidth: 40, fontStyle: 'bold' };

        autoTable(doc, {
            head: [headRow],
            body: bodyData,
            foot: [footRow],
            startY: 50,
            theme: 'grid',
            styles: {
                fontSize: 8,
                cellPadding: 2,
                lineColor: [180, 180, 180],
                lineWidth: 0.5
            },
            columnStyles: colStyles,
            headStyles: {
                fillColor: [0, 0, 0], // Fondo de encabezado negro
                textColor: [255, 255, 255],
            },
            footStyles: {
                fillColor: [255, 255, 180], // Color amarillo suave estilo total summary excel
                textColor: [0, 0, 0],
                fontStyle: 'bold',
                halign: 'center'
            },
            didParseCell: function(data) {
                // Modificar celdas internas para aplicar los bloques rojos
                if (data.section === 'body') {
                    if (data.column.index > 0 && data.column.index <= hours.length) {
                        const val = data.cell.raw;
                        if (val > 0) {
                            data.cell.styles.fillColor = [204, 0, 0]; // Bloque rojo vibrante
                            data.cell.styles.textColor = [255, 255, 255]; // Texto en blanco brillante
                        } else {
                            data.cell.styles.textColor = [255, 255, 255]; // Ocultar el texto 0 en celdas vacías
                        }
                    } else if (data.column.index === 0) {
                        data.cell.styles.textColor = [0, 0, 0];
                    }
                }
            },
            margin: { top: 20, left: 20, right: 20 }
        });

        doc.save(`Requerimientos_${weekdayLabels[day]}_ExcelFormato.pdf`);
    };

    // ==================== GUARDADO ====================
    const save = async () => {
        if (positions.length === 0) return alert('Agrega al menos una posición');

        const compressed = compressMatrix(matrix);
        setIsSaving(true);

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
        } finally {
            setIsSaving(false);
        }
    };

    // ==================== DUPLICAR ====================
    const toggleDupDay = (d) => {
        setSelectedDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
    };

    const duplicatePlan = async () => {
        if (selectedDays.length === 0) return;

        const compressed = compressMatrix(matrix);
        setIsSaving(true);

        try {
            const promises = selectedDays.map(d => {
                const ref = doc(db, 'stores', storeId, 'positioning_requirements', d);
                return setDoc(ref, { positions, matrix: compressed }, { merge: true });
            });

            await Promise.all(promises);
            alert('Duplicado correctamente');
            setShowDuplicate(false);
            setSelectedDays([]);
        } catch (e) {
            console.error(e);
            alert('Error al duplicar');
        } finally {
            setIsSaving(false);
        }
    };

        // ==================== CARGA CONTEO DE EMPLEADOS REALES ====================
    useEffect(() => {
        if (!storeId) {
            setStaffCount({ total: 0, ft: 0, pt: 0 });
            return;
        }

        const fetchStaffCount = async () => {
            try {
                const staffRef = collection(db, 'staff_profiles');
                let snap = await getDocs(query(staffRef, where('storeId', '==', storeId)));
                
                // Fallback para DBs antiguas sin storeId asignado a los perfiles
                if (snap.empty) {
                    snap = await getDocs(staffRef);
                }

                let ft = 0; let pt = 0;
                snap.forEach(doc => {
                    const data = doc.data();
                    // Ignora a los trainees o a los que tienen cessation date
                    if (data.isTrainee) return;
                    if (data.cessationDate && new Date(data.cessationDate) <= new Date()) return;

                    const mod = String(data.modality || '').toLowerCase();
                    if (mod.includes('full')) ft++;
                    else if (mod.includes('part')) pt++;
                });

                setStaffCount({ total: ft + pt, ft, pt });
            } catch (err) {
                console.error('Error cargando plantilla:', err);
                setStaffCount({ total: 0, ft: 0, pt: 0 });
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 select-none relative">
            {/* Pantalla de carga superpuesta al guardar */}
            {isSaving && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex flex-col items-center justify-center backdrop-blur-sm transition-all opacity-100">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-4 transform transition-all scale-100">
                         <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
                         <div className="text-center">
                             <p className="text-gray-800 font-extrabold text-xl">Guardando cambios...</p>
                             <p className="text-gray-500 text-sm mt-1">Por favor, espera un momento</p>
                         </div>
                    </div>
                </div>
            )}

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
                        <div className="flex flex-wrap items-center gap-3">
                            <Calendar className="w-5 h-5 text-gray-500" />
                            <label className="font-semibold text-gray-700">Día de la semana:</label>
                            <select
                                value={day}
                                onChange={e => setDay(e.target.value)}
                                className="border-2 border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium shadow-sm"
                            >
                                {weekdays.map(d => (
                                    <option key={d} value={d}>{weekdayLabels[d]}</option>
                                ))}
                            </select>

                            <div className="hidden sm:block w-px h-8 bg-gray-300 mx-2"></div>
                            
                            <label className="font-semibold text-gray-700">El Lunes de esta semana fue el día:</label>
                            <input
                                type="date"
                                value={weekStartDate}
                                onChange={e => setWeekStartDate(e.target.value)}
                                className="border-2 border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium shadow-sm text-blue-800"
                            />
                            
                            <div className="ml-2 px-3 py-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold rounded-full">
                                {(() => {
                                    if (!weekStartDate) return '';
                                    const shiftDays = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
                                    const [baseY, baseM, baseD] = weekStartDate.split('-');
                                    const targetDate = new Date(baseY, parseInt(baseM) - 1, parseInt(baseD));
                                    targetDate.setDate(targetDate.getDate() + (shiftDays[day] || 0));
                                    return `Ventas del: ${targetDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
                                })()}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3 ml-auto">
                            <button
                                onClick={exportToPDF}
                                className="flex items-center gap-2 bg-gradient-to-r from-teal-500 to-teal-600 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200"
                            >
                                <Download className="w-4 h-4" />
                                Descargar PDF
                            </button>
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
                        {/* MÉTRICAS SUPERIORES (Estilo Excel) */}
                        <div className="min-w-max border-b-[3px] border-black bg-white sticky top-0 z-30 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
                            {/* Fila TOTAL HH */}
                            <div className="flex">
                                <div className="w-[140px] px-3 py-1 text-right text-xs font-bold text-gray-800 border-r border-gray-300">TOTAL HH</div>
                                {hours.map((_, col) => {
                                    const sumHr = matrix.reduce((acc, row) => acc + (row[col] || 0), 0);
                                    return <div key={col} className="w-[60px] text-center text-xs font-bold text-gray-800 border-r border-gray-200 py-1">{sumHr}</div>;
                                })}
                                <div className="w-[60px] text-center text-xs font-black py-1">
                                    {matrix.reduce((tAcc, row) => tAcc + row.reduce((cAcc, c) => cAcc + (c||0), 0), 0)}
                                </div>
                            </div>
                            {/* Fila VTA */}
                            <div className="flex">
                                <div className="w-[140px] px-3 py-1 text-right text-xs font-bold text-gray-800 border-r border-gray-300">VTA</div>
                                {hours.map((h, col) => {
                                    const prc = Number(salesConfig.hourlyParts[h] || 0) / 100;
                                    const vtaHr = Math.round(salesConfig.vta * prc);
                                    return <div key={col} className="w-[60px] text-center text-[11px] text-gray-700 border-r border-gray-200 py-1">S/{vtaHr}</div>;
                                })}
                                <div className="w-[60px] text-center text-xs font-bold py-1 bg-blue-50/50">S/ {Math.round(salesConfig.vta)}</div>
                            </div>
                            {/* Fila TXS */}
                            <div className="flex">
                                <div className="w-[140px] px-3 py-1 text-right text-xs font-bold text-gray-800 border-r border-gray-300">TXS</div>
                                {hours.map((h, col) => {
                                    const prc = Number(salesConfig.hourlyParts[h] || 0) / 100;
                                    const txsHr = Math.round(salesConfig.txs * prc);
                                    return <div key={col} className="w-[60px] text-center text-xs text-gray-700 border-r border-gray-200 py-1">{txsHr}</div>;
                                })}
                                <div className="w-[60px] text-center text-xs font-bold py-1 bg-gray-50">{Math.round(salesConfig.txs)}</div>
                            </div>
                            {/* Fila VHL */}
                            <div className="flex">
                                <div className="w-[140px] px-3 py-1 text-right text-xs font-bold text-gray-800 border-r border-gray-300">VHL</div>
                                {hours.map((h, col) => {
                                    const prc = Number(salesConfig.hourlyParts[h] || 0) / 100;
                                    const vtaHr = salesConfig.vta * prc;
                                    const sumHr = matrix.reduce((acc, row) => acc + (row[col] || 0), 0);
                                    const vhl = sumHr > 0 ? (vtaHr / sumHr).toFixed(1) : "0.0";
                                    return <div key={col} className="w-[60px] text-center text-xs text-gray-700 border-r border-gray-200 py-1">{vhl}</div>;
                                })}
                                <div className="w-[60px]"></div>
                            </div>
                            {/* Fila THL */}
                            <div className="flex border-b border-gray-300">
                                <div className="w-[140px] px-3 py-1 text-right text-xs font-bold text-gray-800 border-r border-gray-300">THL</div>
                                {hours.map((h, col) => {
                                    const prc = Number(salesConfig.hourlyParts[h] || 0) / 100;
                                    const txsHr = salesConfig.txs * prc;
                                    const sumHr = matrix.reduce((acc, row) => acc + (row[col] || 0), 0);
                                    const thl = sumHr > 0 ? (txsHr / sumHr).toFixed(1) : "0.0";
                                    return <div key={col} className="w-[60px] text-center text-xs text-gray-700 border-r border-gray-200 py-1">{thl}</div>;
                                })}
                                <div className="w-[60px]"></div>
                            </div>
                        </div>

                        <table className="table-fixed mt-0" style={{ minWidth: '100%', width: 'max-content' }}>
                            <colgroup>
                                <col style={{ width: '140px' }} />
                                {hours.map((_, i) => (
                                    <col key={i} style={{ width: '60px' }} />
                                ))}
                                <col style={{ width: '60px' }} />
                            </colgroup>
                            <thead className="bg-[#000000]">
                                <tr>
                                    <th className="border-r border-gray-600 px-3 py-2 text-white font-bold text-xs sticky left-0 z-20 bg-black">
                                        Posición
                                    </th>
                                    {hours.map((h, i) => (
                                        <th key={i} className="border-r border-gray-600 px-1 py-2 text-yellow-500 font-bold text-xs text-center">
                                            {h.replace(/^0/, '')}
                                        </th>
                                    ))}
                                    <th className="border-l border-gray-600 px-2 py-2 text-white font-bold text-xs">Acción</th>
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
                                                    className={`border border-gray-300 border-dotted text-center text-sm font-bold cursor-pointer transition-all ${
                                                        matrix[r]?.[c] > 0 
                                                            ? 'bg-[#cc0000] text-white shadow-none'
                                                            : 'text-transparent hover:bg-blue-100 hover:text-blue-300'
                                                    }`}
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
                // Cálculo de
                const totalPersonHours = matrix.reduce((dayTotal, row) =>
                    dayTotal + row.reduce((sum, cell) => sum + (cell || 0), 0), 0);

                const dailyVTA = Math.round(salesConfig.vta || 0);
                const dailyTXS = Math.round(salesConfig.txs || 0);
                
                // === LÓGICA DE FT / PT ===
                let suggestedFT = 0;
                let suggestedPT = 0;
                const { ft, pt, total } = staffCount || { total: 0, ft: 0, pt: 0 };
                const isFallback = (ft === 0 && pt === 0);
                
                if (isFallback) {
                    // Si no hay datos, asumimos una relación genérica 50% FT y 50% PT (en horas)
                    const neededFtHrs = totalPersonHours / 2;
                    const neededPtHrs = totalPersonHours / 2;
                    suggestedFT = Math.round(neededFtHrs / 8);
                    suggestedPT = Math.round(neededPtHrs / 4);
                } else {
                    const maxFtHrs = ft * 8;
                    const maxPtHrs = pt * 4;
                    const totalCapacity = maxFtHrs + maxPtHrs;
                    const ftRatio = totalCapacity > 0 ? (maxFtHrs / totalCapacity) : 0.5;

                    // 1. Distribución proporcional pura e ideal
                    const neededFtHrs = totalPersonHours * ftRatio;
                    
                    suggestedFT = Math.round(neededFtHrs / 8);
                    
                    // Asegurarnos de que asigne el resto de horas al PT
                    const hoursCoveredByFt = suggestedFT * 8;
                    const remainingForPt = totalPersonHours - hoursCoveredByFt;
                    
                    suggestedPT = Math.max(0, Math.ceil(remainingForPt / 4));
                }
                
                const faltanteFT = suggestedFT > ft ? suggestedFT - ft : 0;
                const faltantePT = suggestedPT > pt ? suggestedPT - pt : 0;
                const isUnderstaffed = (faltanteFT > 0 || faltantePT > 0);
                
                const dailyVHL = totalPersonHours > 0 ? (dailyVTA / totalPersonHours).toFixed(1) : "0.0";
                const dailyTHL = totalPersonHours > 0 ? (dailyTXS / totalPersonHours).toFixed(1) : "0.0";

                return (
                    <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 rounded-xl shadow-lg p-6 border-2 border-blue-200">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-gray-800">
                                    Productividad Estimada del Día
                                </h3>
                                <p className="text-sm text-gray-600 mt-1">
                                    Resumen de VHL y THL basado en tu Venta (S/{dailyVTA}) y Transacciones ({dailyTXS}) totales.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
                            <div className="bg-white rounded-xl p-6 shadow-md border-2 border-indigo-100 hover:shadow-lg transition-shadow">
                                <div className="flex items-center gap-3 mb-2">
                                    <Clock className="w-6 h-6 text-indigo-600" />
                                    <span className="text-xs font-semibold text-gray-600 uppercase">Total Horas Hombre</span>
                                </div>
                                <div className="text-4xl font-bold text-indigo-600">{totalPersonHours}</div>
                                <div className="text-xs text-gray-500 mt-1">horas asignadas en el día</div>
                            </div>

                            <div className="bg-white rounded-xl p-6 shadow-md border-2 border-green-100 hover:shadow-lg transition-shadow">
                                <div className="flex items-center gap-3 mb-2">
                                    <TrendingUp className="w-6 h-6 text-green-600" />
                                    <span className="text-xs font-semibold text-gray-600 uppercase">Venta Esperada</span>
                                </div>
                                <div className="text-4xl font-bold text-green-600">S/{dailyVTA}</div>
                                <div className="text-xs text-gray-500 mt-1">monto total proyectado</div>
                            </div>

                            <div className="bg-white rounded-xl p-6 shadow-md border-2 border-blue-200 hover:shadow-lg transition-shadow">
                                <div className="flex items-center gap-3 mb-2">
                                    <Users className="w-6 h-6 text-blue-600" />
                                    <span className="text-xs font-semibold text-gray-600 uppercase">VHL General</span>
                                </div>
                                <div className="text-4xl font-bold text-blue-600">S/{dailyVHL}</div>
                                <div className="text-xs text-gray-500 mt-1">rentabilidad por cada hora laboral</div>
                            </div>

                            <div className="bg-white rounded-xl p-6 shadow-md border-2 border-purple-200 hover:shadow-lg transition-shadow">
                                <div className="flex items-center gap-3 mb-2">
                                    <AlertCircle className="w-6 h-6 text-purple-600" />
                                    <span className="text-xs font-semibold text-gray-600 uppercase">THL General</span>
                                </div>
                                <div className="text-4xl font-bold text-purple-600">{dailyTHL}</div>
                                <div className="text-xs text-gray-500 mt-1">transacciones por hora laboral</div>
                            </div>
                        </div>

                        {/* Nueva fila para sugerencia de Turnos Optimizada */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div className="bg-white rounded-xl p-6 shadow-md border-2 border-orange-200 hover:shadow-lg transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <Users className="w-6 h-6 text-orange-500" />
                                        <span className="text-sm font-bold text-gray-700 uppercase tracking-wide">Mix Sugerido</span>
                                    </div>
                                    <div className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-bold rounded-full">
                                        Planilla: {ft} FT / {pt} PT
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-8">
                                    <div className="flex flex-col">
                                        <div className="flex items-end gap-1">
                                            <span className="text-4xl font-black text-orange-600">{suggestedFT}</span>
                                            <span className="text-lg font-bold text-gray-400 mb-1">FT</span>
                                        </div>
                                        <span className="text-xs font-medium text-gray-500 uppercase mt-1">Full-Time (8h)</span>
                                    </div>

                                    <div className="h-12 w-0.5 bg-gray-200"></div>

                                    <div className="flex flex-col">
                                        <div className="flex items-end gap-1">
                                            <span className="text-4xl font-black text-amber-500">{suggestedPT}</span>
                                            <span className="text-lg font-bold text-gray-400 mb-1">PT</span>
                                        </div>
                                        <span className="text-xs font-medium text-gray-500 uppercase mt-1">Part-Time (4h)</span>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 mt-4 leading-relaxed border-t border-gray-100 pt-3">
                                    {isFallback 
                                        ? `⚠️ No tienes personal FT/PT activo en tu planilla actual. Este es un cálculo genérico 50/50 para cubrir las ${totalPersonHours}h requeridas.`
                                        : `El sistema balanceó tus necesidades (${totalPersonHours}h requeridas). Maximizó el uso de tus ${ft} FT, y calculó el resto en turnos PT de 4h.`
                                    }
                                </p>
                                
                                {isUnderstaffed && !isFallback && (
                                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-xs font-bold text-red-700">¡Alerta de Faltante de Personal!</p>
                                            <p className="text-xs text-red-600 mt-1">
                                                Tu cuadro genera {totalPersonHours} Horas, superando tu capacidad máxima ideal (incluso sin descansos). <br/>
                                                <strong>
                                                    Te faltan: 
                                                    {faltanteFT > 0 ? ` ${faltanteFT} Full-Time` : ''} 
                                                    {faltanteFT > 0 && faltantePT > 0 ? ' y ' : ''}
                                                    {faltantePT > 0 ? ` ${faltantePT} Part-Time` : ''}.
                                                </strong>
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
            </div>
        </div>
    );
}