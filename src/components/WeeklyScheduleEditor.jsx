// WeeklyScheduleEditor.jsx – versión con detección de conflictos corregida
import React, { useEffect, useState, useRef } from 'react';
import { getFirestore, writeBatch, doc, getDoc, setDoc, collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ScheduleHeatmapMatrix from './ScheduleHeatmapMatrix';
import { exportSchedulePDF, exportGroupedPositionsPDF } from './PDFExport';
import GeoVictoriaUpload from './GeoVictoriaUpload';
import { exportGeoVictoriaExcel } from "../services/GeoVictoriaExport";
import { FaInfoCircle, FaExclamationTriangle, FaExclamationCircle} from 'react-icons/fa';
import { HOURS } from './ScheduleHeatmapMatrix';
import ModalSelectorDePosiciones from './ModalSelectorDePosiciones'

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const weekdayLabels = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo'
};

const getWeekKey = (s) => {
    if (!s) return '';

    const [Y, M, D] = s.split('-').map(Number);
    const start = new Date(Y, M - 1, D);   // lunes exacto (local)

    if (isNaN(start.getTime())) return '';

    // crear fin de semana sin trucos
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const format = (date) =>
        [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');

    return `${format(start)}_to_${format(end)}`;
};

const getScheduleDocRef = (db, staffId, weekKey) =>
    doc(db, 'schedules', `${staffId}_${weekKey}`);

export default function WeeklyScheduleEditor() {
    const [staff, setStaff] = useState([]);
    const [positions, setPositions] = useState([]);
    const [allSchedules, setAllSchedules] = useState({});
    const [requirements, setRequirements] = useState({});
    const [selectedDay, setSelectedDay] = useState('monday');
    const [weekStartDate, setWeekStartDate] = useState('');
    const [modalityFilter, setModalityFilter] = useState('Todos');
    const [positionFilter, setPositionFilter] = useState('Todas');
    const [turnoMap, setTurnoMap] = useState({});
    const [tooltipOpen, setTooltipOpen] = useState(null);
    const [showTurnoModal, setShowTurnoModal] = useState(false);
    const [turnoPDF, setTurnoPDF] = useState('mañana');
    const [conflictAlerts, setConflictAlerts] = useState({});
    const [scheduleAttempt, setScheduleAttempt] = useState(0);
    const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'success' | 'error'
    const [storeId, setStoreId] = useState('');
    const [loading, setLoading] = useState(true);

    const tooltipRef = useRef(null);
    const db = getFirestore();
    const navigate = useNavigate();
    const { currentUser, userRole } = useAuth();

    const wk = getWeekKey(weekStartDate);
    const schedules = wk ? allSchedules[wk] || {} : {};
    // === OBTENER storeId del usuario ===
    useEffect(() => {
        if (!currentUser) return;
        const fetchStore = async () => {
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            if (snap.exists()) {
                setStoreId(snap.data().storeId || '');
            }
        };
        fetchStore();
    }, [currentUser, db]);
    // === SETEAR SEMANA ACTUAL AUTOMÁTICAMENTE ===
    useEffect(() => {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0=Domingo, 1=Lunes
        const diff = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek); // Calcula lunes
        const monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        setWeekStartDate(monday.toISOString().slice(0, 10));
    }, []);

    // === VALIDACIÓN TEMPRANA ===
    if (!currentUser) return <p className="text-center py-8">Inicia sesión</p>;
    // Posiciones del día seleccionado (para el selector y el filtro)
useEffect(() => {
    setPositions(requirements[selectedDay]?.positions || []);
}, [requirements, selectedDay]);

    // ==================== CARGA TODOS LOS REQUERIMIENTOS (una sola vez) ====================
useEffect(() => {
    if (!storeId) return;

    const loadAllRequirements = async () => {
        const newReq = {};

        for (const day of weekdays) {
            let docRef = doc(db, 'stores', storeId, 'positioning_requirements', day);
            let snap = await getDoc(docRef);

            if (!snap.exists()) {
                docRef = doc(db, 'positioning_requirements', day);
                snap = await getDoc(docRef);
            }

            const data = snap.exists() ? snap.data() : { positions: [], matrix: {} };
            newReq[day] = {
                positions: data.positions || [],
                matrix: data.matrix || {}
            };
        }

        setRequirements(newReq);
    };

    loadAllRequirements();
}, [storeId]);

    const saveSchedules = async () => {
        setSaveStatus('saving');
        try {
            const batch = writeBatch(db);
            for (const staffId in schedules) {
                const schedule = schedules[staffId];
                const ref = doc(db, 'schedules', `${staffId}_${wk}`);
                batch.set(ref, schedule);
            }
            await batch.commit();
            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (err) {
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    const detectScheduleConflict = (staff, day, shift) => {
    // Si no hay turno asignado (sin entrada, salida o posición), NO mostrar conflicto
    if (!shift || !shift.start || !shift.end || !shift.position) {
        return null;
    }
    // 🛑 No validar conflictos en feriados
    const isFeriado = schedules[staff.id]?.[day]?.feriado;
    if (isFeriado) return null;

    const studyBlocks = staff.study_schedule?.[day]?.blocks || [];

    // ✅ Si el día está marcado como libre en estudio, no asignar
    if (staff.study_schedule?.[day]?.free === true) {
        return 'estudia'; // día libre → no asignable
    }

    const requiredSkill = shift.position;
    const hasSkill = staff.skills?.includes(requiredSkill);
    if (!hasSkill) {
        return 'incompatible'; // sin habilidad → no apto
    }

    // Detectar conflictos de horario
    for (const block of studyBlocks) {
        const blockStart = timeToMinutes(block.start);
        const blockEnd = timeToMinutes(block.end);
        const shiftStart = timeToMinutes(shift.start);
        const shiftEnd = timeToMinutes(shift.end);

        if (shiftStart < blockEnd && shiftEnd > blockStart) {
            return 'conflicto';
        }
    }

    return null;
};


    // Función para manejar cambios en los inputs
    const handleChange = (staffId, field, value) => {
        if (!wk) return;

        const current = schedules[staffId]?.[selectedDay] || {};
        const modality = staff.find(p => p.id === staffId)?.modality || '';

        let updates = { [field]: value };

        // 🔒 Si se marca "off", borrar datos relacionados
        if (field === 'off' && value === true) {
            updates = { off: true, start: '', end: '', position: '', feriado: false };
        }

        // 🔒 Si se marca "feriado", setear horarios fijos según modalidad
        if (field === 'feriado' && value === true) {
            const isFull = modality.toLowerCase() === 'full-time';
            updates = {
                feriado: true,
                off: false,
                start: '08:00',
                end: isFull ? '16:45' : '12:00',
                position: ''
            };
        }

        // Si se desmarca feriado → limpiar solo feriado
        if (field === 'feriado' && value === false) {
            updates = { ...current, feriado: false };
        }

        // Si se desmarca off → limpiar solo off
        if (field === 'off' && value === false) {
            updates = { ...current, off: false };
        }

        setAllSchedules(prev => ({
            ...prev,
            [wk]: {
                ...prev[wk],
                [staffId]: {
                    ...prev[wk]?.[staffId],
                    [selectedDay]: {
                        ...prev[wk]?.[staffId]?.[selectedDay],
                        ...updates
                    }
                }
            }
        }));
    };
   

    // Función para calcular horas diarias
    const calculateDailyHours = (start, end) => {
        if (!start || !end) return '--';

        const startMinutes = timeToMinutes(start);
        let endMinutes = timeToMinutes(end);

        // Si termina antes de empezar, asumimos que pasó medianoche
        if (endMinutes <= startMinutes) {
            endMinutes += 24 * 60;
        }

        const diff = endMinutes - startMinutes;
        return formatMinutesToHours(diff);
    };



    // Función para convertir tiempo a minutos
    const timeToMinutes = (time) => {
        if (!time) return 0;
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    // Función para formatear minutos a horas
    const formatMinutesToHours = (minutes) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}`;
    };

    // Función para calcular horas semanales
    const calculateWeeklyHours = (staffId) => {
        if (!wk || !schedules[staffId]) {
            return { total: 0, formatted: '0:00' };
        }

        const modality = staff.find(p => p.id === staffId)?.modality || '';
        const isFullTime = modality.toLowerCase() === 'full-time';

        let totalMinutes = 0;
        weekdays.forEach(day => {
            const daySchedule = schedules[staffId][day];
            if (daySchedule && daySchedule.start && daySchedule.end && !daySchedule.off && !daySchedule.feriado) {
                let startMinutes = timeToMinutes(daySchedule.start);
                let endMinutes = timeToMinutes(daySchedule.end);

                if (endMinutes <= startMinutes) {
                    endMinutes += 24 * 60; // día cruza medianoche
                }

                let dailyMinutes = endMinutes - startMinutes;

                if (isFullTime) {
                    dailyMinutes = Math.max(0, dailyMinutes - 45); // Descontar break
                }

                totalMinutes += dailyMinutes;
            }
        });

        return {
            total: totalMinutes,
            formatted: formatMinutesToHours(totalMinutes)
        };
    };


    // Función para verificar si tiene día libre
    const hasFreeDay = (staffId) => {
        if (!wk || !schedules[staffId]) return false;

        return weekdays.some(day => {
            const daySchedule = schedules[staffId][day];
            return daySchedule && daySchedule.off;
        });
    };

    // Función para formatear mensaje de conflicto
    const formatConflictMessage = (conflicts) => {
        if (conflicts === 'estudia') return 'Solicito el dia Libre';
        if (conflicts === 'incompatible') return 'No tiene las habilidades requeridas';
        if (conflicts === 'conflicto') return 'Conflicto con horario de estudio';
        return 'Conflicto detectado';
    };

    // Función para generar horario ideal (placeholder)
    // Versión corregida de generateIdealSchedule que:
    // - Asigna solo si no tiene turno previo ese día
    // - Full-Time únicamente turnos de 8h45min (35 bloques)
    // - Part-Time con validación de 4h o 6h si tiene más de 1 día libre

    function generateIdealSchedule() {
        if (!wk || !requirements[selectedDay]) {
            return;
        }

        const newSchedules = { ...schedules };
        const dayReqs = requirements[selectedDay];
        const positions = Array.isArray(requirements.positions) ? requirements.positions : [];
        const matrix = dayReqs.matrix;
        // Convertir matrix de objeto a array si es necesario
        const isMatrixObject = !Array.isArray(matrix) && typeof matrix === 'object';
        const normalizedMatrix = isMatrixObject
            ? Object.keys(matrix)
                .sort((a, b) => Number(a) - Number(b))
                .map(k => matrix[k])
            : matrix;
        // Validación de estructura de requerimientos
        if (!Array.isArray(positions) || !Array.isArray(normalizedMatrix) || normalizedMatrix.length !== positions.length) {
            return;
        }

        const availableBlocks = HOURS.map((hour, i) => ({
            hour,
            slots: positions.map((pos, pi) => ({
                position: pos,
                required: matrix[pi]?.[i] || 0,
                assigned: 0,
            })),
        }));

        const timeToMinutes = (time) => {
            if (typeof time !== 'string' || !time.includes(':')) {
                return 0;
            }
            const [h, m] = time.split(':').map(Number);
            return h * 60 + m;
        };

        const getWeeklyMinutes = (personId) => {
            let total = 0;
            const days = schedules[personId] || {};
            for (const d of Object.values(days)) {
                if (!d || !d.start || !d.end || d.off || d.feriado) continue;
                total += timeToMinutes(d.end) - timeToMinutes(d.start);
            }
            return total;
        };

        const shuffledStaff = [...staff]
            .filter(p => p?.id && p?.name)
            .sort(() => Math.random() - 0.5);

        for (const person of shuffledStaff) {
            const day = selectedDay;
            const study = person.study_schedule?.[day] || {};
            const studyBlocks = study?.blocks || [];

            if (study?.free) {
                newSchedules[person.id] = {
                    ...newSchedules[person.id],
                    [day]: { start: '', end: '', off: true, feriado: false, position: '' }
                };
                continue;
            }

            const isFullTime = (person.modality || '').toLowerCase() === 'full-time';
            const weeklyLimit = isFullTime ? 2880 : 1440;
            const currentWeekMin = getWeeklyMinutes(person.id);
            const freeDays = Object.values(person.study_schedule || {}).filter(d => d?.free).length;
            const shiftOptions = isFullTime
                ? [35] // 🔐 Solo 8h45 para full-time
                : freeDays > 1 ? [24, 16] : [16];

            let assigned = false;

            for (const blocks of shiftOptions) {
                for (let i = 0; i <= HOURS.length - blocks; i++) {
                    const start = i;
                    const end = i + blocks;
                    const shiftMin = (end - start) * 15;
                    const startMin = 360 + start * 15;
                    const endMin = 360 + end * 15;

                    if (currentWeekMin + shiftMin > weeklyLimit) continue;

                    const clash = studyBlocks.some(block => {
                        const rawStart = block.start ?? block.startTime;
                        const rawEnd = block.end ?? block.endTime;

                        if (!rawStart || !rawEnd) {
                            return false; // ignorar bloques mal definidos
                        }

                        const s = timeToMinutes(rawStart);
                        const e = timeToMinutes(rawEnd);

                        return !(endMin <= s - 60 || startMin >= e + 60);
                    });

                    if (clash) continue;

                    for (let posIndex = 0; posIndex < positions.length; posIndex++) {
                        const pos = positions[posIndex];
                        if (!person.skills?.includes(pos)) continue;

                        const hasSpace = availableBlocks.slice(start, end).every(
                            b => b.slots[posIndex].assigned < b.slots[posIndex].required
                        );
                        if (!hasSpace) continue;

                        // ✅ Asignar turno
                        newSchedules[person.id] = {
                            ...newSchedules[person.id],
                            [day]: {
                                start: HOURS[start],
                                end: HOURS[end],
                                position: pos,
                                off: false,
                                feriado: false
                            }
                        };

                        for (let k = start; k < end; k++) {
                            availableBlocks[k].slots[posIndex].assigned++;
                        }
                       assigned = true;
                        break;
                    }

                    if (assigned) break;
                }

                if (assigned) break;
            }

            if (!assigned) {
                // 🟥 Escape temprano: si no logró su bloque exacto, se le asigna libre
                newSchedules[person.id] = {
                    ...newSchedules[person.id],
                    [day]: { start: '', end: '', off: true, feriado: false, position: '' }
                };
            }
        }

        setAllSchedules(prev => ({
            ...prev,
            [wk]: newSchedules
        }));
    }
// Reemplaza SOLO la parte que carga study_schedules dentro del useEffect que carga staff
// En el useEffect que carga staff, modifica esta parte:
useEffect(() => {
    if (!storeId) return;
    const loadStaff = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'staff_profiles'), where('storeId', '==', storeId));
            const snap = await getDocs(q);
            const staffList = await Promise.all(
                snap.docs.map(async (docSnap) => {
                    const staffData = { id: docSnap.id, ...docSnap.data() };
                    
                    // 🔥 Cargar study_schedule usando el UID del staff
                    try {
                        // Si el staff_profile tiene un campo 'uid', usarlo para study_schedules
                        const studyScheduleId = staffData.uid || docSnap.id;                      
                        const studyRef = doc(db, 'study_schedules', studyScheduleId);
                        const studySnap = await getDoc(studyRef);
                        
                        if (studySnap.exists()) {
                            const studyData = studySnap.data();
                            
                            // Normalizar estructura
                            staffData.study_schedule = {};
                            const dayMappings = {
                                'monday': 'monday', 'tuesday': 'tuesday', 'wednesday': 'wednesday', 
                                'thursday': 'thursday', 'friday': 'friday', 'saturday': 'saturday', 'sunday': 'sunday',
                                'Monday': 'monday', 'Tuesday': 'tuesday', 'Wednesday': 'wednesday',
                                'Thursday': 'thursday', 'Friday': 'friday', 'Saturday': 'saturday', 'Sunday': 'sunday',
                            };
                            
                            Object.keys(studyData).forEach(fieldName => {
                                const normalizedDay = dayMappings[fieldName];
                                if (normalizedDay && studyData[fieldName]) {
                                    const dayData = studyData[fieldName];
                                    staffData.study_schedule[normalizedDay] = {
                                        free: dayData.free || false,
                                        blocks: Array.isArray(dayData.blocks) ? dayData.blocks : []
                                    };
                                }
                            });
                            
                            // Asegurar que todos los días existan
                            const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                            allDays.forEach(day => {
                                if (!staffData.study_schedule[day]) {
                                    staffData.study_schedule[day] = { free: false, blocks: [] };
                                }
                            });
                            
                        } else {
                            
                            // Estructura vacía
                            staffData.study_schedule = {
                                monday: { free: false, blocks: [] },
                                tuesday: { free: false, blocks: [] },
                                wednesday: { free: false, blocks: [] },
                                thursday: { free: false, blocks: [] },
                                friday: { free: false, blocks: [] },
                                saturday: { free: false, blocks: [] },
                                sunday: { free: false, blocks: [] }
                            };
                        }
                    } catch (err) {
                        staffData.study_schedule = {
                            monday: { free: false, blocks: [] },
                            tuesday: { free: false, blocks: [] },
                            wednesday: { free: false, blocks: [] },
                            thursday: { free: false, blocks: [] },
                            friday: { free: false, blocks: [] },
                            saturday: { free: false, blocks: [] },
                            sunday: { free: false, blocks: [] }
                        };
                    }
                    
                    return staffData;
                })
            );
            
            setStaff(staffList);
            
            const posSet = new Set();
            staffList.forEach(s => s.positionAbilities?.forEach(p => posSet.add(p)));
            setPositions(Array.from(posSet));
        } catch (err) {
        } finally {
            setLoading(false);
        }
    };
    loadStaff();
}, [storeId, db]);


    // Cargar horarios en tiempo real
    useEffect(() => {
        if (!wk || staff.length === 0) return;
        const unsubs = staff.map(s => {
            return onSnapshot(doc(db, 'schedules', `${s.id}_${wk}`), snap => {
                if (snap.exists()) {
                    setAllSchedules(prev => ({
                        ...prev,
                        [wk]: { ...prev[wk], [s.id]: snap.data() }
                    }));
                }
            });
        });
        return () => unsubs.forEach(unsub => unsub());
    }, [wk, staff, db]);



    // Filtrar staff según filtros activos
    const filteredStaff = staff.filter(person => {
        if (modalityFilter !== 'Todos' && person.modality !== modalityFilter) return false;

        if (positionFilter !== 'Todas') {
            const assignedPos = schedules[person.id]?.[selectedDay]?.position?.toLowerCase() || '';
            if (assignedPos !== positionFilter.toLowerCase()) return false;
        }

        return true;
    });


    // Obtener asignados por posición para heatmap
    const getAssignedByPosition = () => {
        const assigned = {};
        filteredStaff.forEach(p => {
            const d = schedules[p.id]?.[selectedDay];
            if (d && d.position && d.start && d.end) {
                if (!assigned[d.position]) assigned[d.position] = [];
                assigned[d.position].push({ start: d.start, end: d.end });
            }
        });
        return assigned;
    };
    const calcularCierres = (personSchedule) => {
    let preCierres = 0;
    let cierres = 0;

    Object.values(personSchedule).forEach(dayData => {
        if (dayData?.off || dayData?.feriado || !dayData?.end) return;

        const end = dayData.end.trim();
        const [hour] = end.split(':').map(Number);

        // Si termina 00:00 o más tarde → cierre completo
        if (hour >= 0 && hour <= 5) {
            cierres++;
        }
        // Si termina entre 22:00 y 23:59 → pre-cierre
        else if (hour >= 22 && hour <= 23) {
            preCierres++;
        }
    });

    return { preCierres, cierres };
};

    const assignedArray = filteredStaff
        .map(p => {
            const d = schedules[p.id]?.[selectedDay];
            return { position: d?.position, start: d?.start, end: d?.end };
        })
        .filter(x => x.position && x.start && x.end);

    const safeRequirements = requirements[selectedDay] || { positions: [], matrix: {} };
    if (loading) return <p className="text-center py-8">Cargando...</p>;
    // Validación de fecha (evita "Fecha inválida")
const isValidDate = (() => {
    if (!weekStartDate) return false;

    const [y, m, d] = weekStartDate.split('-').map(Number);
    const test = new Date(y, m - 1, d);

    // Comprobamos que realmente coincida (evita 32/13/9999 etc.)
    return (
        test.getFullYear() === y &&
        test.getMonth() === m - 1 &&
        test.getDate() === d
    );
})();


    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <nav className="bg-white shadow mb-6 rounded px-4 py-3 flex justify-between items-center">
                <h1 className="text-xl font-bold text-red-600">Panel de Navegación</h1>
                <div className="space-x-4">
                    <Link to="/admin" className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Inicio</Link>
                    <Link to="/horarios" className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">Horarios</Link>
                    <Link to="/posiciones" className="text-sm bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700">Posiciones</Link>
                </div>
            </nav>

            <div className="flex items-center gap-4">
    <label className="font-semibold text-lg">Semana (lunes):</label>
    <div className="flex items-center gap-6 mb-6">
    <div className="flex items-center gap-3">
        <label className="font-bold text-lg">Semana comenzando el:</label>
        <input
        
  type="date"
  value={weekStartDate}
  onChange={(e) => {
    const val = e.target.value;
    if (!val) {
        setWeekStartDate('');
        return;
    }

    // Construimos la fecha en LOCAL, sin UTC ni shifts
    const [year, month, day] = val.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    const dayOfWeek = date.getDay();      // 1 = lunes
    const diff = (dayOfWeek + 6) % 7;     // lunes = 0, domingo = 6

    date.setDate(date.getDate() - diff);

    // Formato seguro yyyy-mm-dd
    const monday = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');

    setWeekStartDate(monday);
}}
  className="border-2 border-gray-400 rounded-lg px-4 py-2 text-lg font-medium"
/>
    </div>

    {/* Texto que muestra la semana completa (bonito y claro) */}
    
</div>


                <select value={selectedDay} onChange={e => setSelectedDay(e.target.value)} className="p-2 border rounded">
                    {weekdays.map(d => <option key={d} value={d}>{weekdayLabels[d]}</option>)}
                </select>
                <select value={modalityFilter} onChange={e => setModalityFilter(e.target.value)} className="p-2 border rounded">
                    <option>Todos</option>
                    <option>Full-Time</option>
                    <option>Part-Time</option>
                </select>
                <select value={positionFilter} onChange={e => setPositionFilter(e.target.value)} className="p-2 border rounded">
                    <option>Todas</option>
                    {positions.map(pos => <option key={pos}>{pos}</option>)}
                </select>
                <button onClick={saveSchedules} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                    {saveStatus === 'saving' ? 'Guardando...' : 'Guardar'}
                </button>
                
                <button 
    onClick={() => exportSchedulePDF(staff, schedules, wk)} 
    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
>
    Exportar PDF
</button>
                <button onClick={() => setShowTurnoModal(true)} className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
                    Exportar PDF por Posiciones
                </button>
                <button
    onClick={() => {
        if (!wk || Object.keys(turnoMap).length === 0) {
            alert('Primero sube el archivo de turnos de GeoVictoria');
            return;
        }
        exportGeoVictoriaExcel(staff, schedules, wk, turnoMap);
    }}
    className="bg-teal-600 text-white px-6 py-3 rounded hover:bg-teal-700"
>
    Exportar Excel GeoVictoria
</button>
              <div className="bg-gray-50 p-4 rounded border">
        <GeoVictoriaUpload onTurnosLoaded={setTurnoMap} />
        {Object.keys(turnoMap).length > 0 ? (
            <p className="text-green-600 text-sm mt-2">✓ Archivo de turnos cargado ({Object.keys(turnoMap).length} turnos detectados)</p>
        ) : (
            <p className="text-gray-500 text-sm mt-2">Sube el archivo de turnos para poder exportar a GeoVictoria</p>
        )}
    </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
                <div className="w-full lg:w-2/3 overflow-auto">
                    <table className="w-full text-sm bg-white border">
                        <thead className="bg-gray-800 text-white">
    <tr>
        <th className="p-3">Nombre</th>
        <th className="p-3">Modalidad</th>
        <th className="p-3">Entrada</th>
        <th className="p-3">Salida</th>
        <th className="p-3">Horas Día</th>
        <th className="p-3">Horas Semana</th>
        <th className="p-3">Posición</th>
        <th className="p-3">Pre-cierres</th>   {/* NUEVO */}
        <th className="p-3">Cierres</th>       {/* NUEVO */}
        <th className="p-3">Libre</th>
        <th className="p-3">Feriado</th>
    </tr>
</thead>
<tbody>
    {filteredStaff.map(p => {
        const d = schedules[p.id]?.[selectedDay] || {};
        const hasConflict = detectScheduleConflict(p, selectedDay, d);
        const horas = calculateWeeklyHours(p.id);
        // Cálculo de si tiene al menos un día libre en la semana
        const tieneDiaLibre = weekdays.some(day =>
            schedules[p.id]?.[day]?.off === true
        );
        // Cálculo de rango correcto de horas según modalidad
        const esFullTime = p.modality?.toLowerCase() === 'full-time';
        const horasMin = esFullTime ? 48 * 60 : 24 * 60;  // 45h FT, 24h PT
        const horasMax = esFullTime ? 48 * 60 : 30 * 60;  // Máximo razonable (evita abusos)
        const horasEnRango = horas.total >= horasMin && horas.total <= horasMax;
        const { preCierres, cierres } = calcularCierres(schedules[p.id] || {});

        return (
            <tr key={p.id} className="border-b">
                <td className="p-3 relative">
                    <div className="flex items-center justify-between">
                        <span className="font-medium">
                            {p.name} {p.lastName}
                        </span>

                        <div className="flex items-center gap-2">
                            {/* Ícono de información (tooltip estudio) */}
                            <FaInfoCircle
                                className="text-blue-600 cursor-pointer hover:text-blue-800 transition"
                                size={16}
                                onMouseEnter={() => setTooltipOpen(p.id)}
                                onMouseLeave={() => setTooltipOpen(null)}
                            />

                            {/* NUEVO: Ícono si NO tiene día libre */}
                            {!tieneDiaLibre && (
                                <FaExclamationCircle
                                    title="No tiene día libre asignado esta semana"
                                    className="text-red-600 ml-2"
                                    size={16}
                                />
                            )}
                        </div>
                    </div>

    {/* Tooltip que aparece debajo */}
    {tooltipOpen === p.id && (
        <div 
            className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-80 bg-white border border-gray-300 rounded-lg shadow-xl p-4"
            style={{ pointerEvents: 'none' }} // permite hover dentro sin que se cierre
        >
            {/* Flechita hacia arriba */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full">
                <div className="w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-white"></div>
            </div>

            <strong className="block mb-2 text-sm font-bold text-gray-800 border-b pb-1">
                📚 Horarios de Estudio
            </strong>

            {weekdays.map(day => {
                const daySchedule = p.study_schedule?.[day];
                const isFree = daySchedule?.free === true;
                const hasBlocks = daySchedule?.blocks && daySchedule.blocks.length > 0;

                return (
                    <div key={day} className="mb-1.5 text-xs">
                        <div className="flex items-start gap-2">
                            <span className="font-semibold text-gray-700 min-w-12">
                                {weekdayLabels[day].slice(0, 3)}:
                            </span>
                            <div className="flex-1">
                                {isFree ? (
                                    <span className="text-green-600 font-bold">
                                        ✅ Día Libre
                                    </span>
                                ) : hasBlocks ? (
                                    <div className="space-y-0.5">
                                        {daySchedule.blocks.map((block, i) => (
                                            <div key={i} className="text-orange-700">
                                                🕐 {block.start} - {block.end}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-black-400 italic">Sin clases</span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* Resumen rápido */}
            <div className="mt-4 pt-3 border-t text-sm font-medium">
                    <div className="flex justify-between text-gray-700">
                        <span className="text-green-600">
                            Días libres: {weekdays.filter(d => p.study_schedule?.[d]?.free).length}
                        </span>
                        <span className="text-orange-600">
                            Con clases: {weekdays.filter(d => p.study_schedule?.[d]?.blocks?.length > 0).length}
                        </span>
                </div>
            </div>
        </div>
    )}

    {/* Mensaje de conflicto debajo del nombre */}
    {hasConflict && (
        <div className="text-xs text-orange-700 bg-orange-100 px-2 py-1 rounded mt-1 flex items-center gap-1">
            <FaExclamationTriangle className="text-orange-600" size={12} />
            {formatConflictMessage(hasConflict)}
        </div>
    )}
</td>
                <td className="p-1 text-center">{p.modality}</td>
                <td className="p-1 text-center">
                    <input
                        type="time"
                        value={d.start || ''}
                        onChange={e => handleChange(p.id, 'start', e.target.value)}
                        disabled={d.feriado || d.off}
                        className={hasConflict ? 'border-orange-500 bg-orange-50' : ''}
                    />
                </td>
                <td className="p-1 text-center">
                    <input
                        type="time"
                        value={d.end || ''}
                        onChange={e => handleChange(p.id, 'end', e.target.value)}
                        disabled={d.feriado || d.off}
                        className={hasConflict ? 'border-orange-500 bg-orange-50' : ''}
                    />
                </td>
                <td className="p-1 text-center">
                    {calculateDailyHours(d.start, d.end)}
                </td>
                {/* HORAS SEMANA - AHORA CON COLOR CORRECTO */}
                <td className={`p-1 text-center font-semibold ${!horasEnRango ? 'text-red-600' : 'text-green-700'
                    }`}>
                    {horas.formatted}
                    {hasConflict && <span className="text-orange-600 ml-1">⚠️</span>}
                </td>
                
                <td className="p-1 text-center">
                    <select
                        value={d.position || ''}
                        onChange={e => handleChange(p.id, 'position', e.target.value)}
                        disabled={d.feriado || d.off}
                    >
                        <option value="">--</option>
                        {positions.map(pos => (
                            <option key={pos} value={pos}>{pos}</option>
                        ))}
                    </select>
                </td>
                <td className="p-1 text-center font-bold text-orange-600">
                    {preCierres}/4
                </td>
                <td className="p-1 text-center font-bold text-red-600">
                    {cierres}/4
                </td>
                <td className="p-1 text-center">
                    <input
                        type="checkbox"
                        checked={d.off || false}
                        onChange={e => handleChange(p.id, 'off', e.target.checked)}
                        disabled={d.feriado}
                    />
                </td>
                <td className="p-1 text-center">
                    <input
                        type="checkbox"
                        checked={d.feriado || false}
                        onChange={e => handleChange(p.id, 'feriado', e.target.checked)}
                    />
                </td>
            </tr>
        );
    })}
</tbody>
                    </table>
                </div>

              
{/* Heatmap */}
<div className="w-full lg:w-5/12 bg-gray-100 z-20">
  <div className="h-screen sticky top-0 flex flex-col">
    <ScheduleHeatmapMatrix
      key={selectedDay}
      assigned={assignedArray}
      requirements={requirements[selectedDay] || { positions: [], matrix: {} }}
    />
  </div>
</div>
            </div>
            

            {/* Modal para selección de turno */}
            {showTurnoModal && (
                
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                    <div className="bg-white rounded shadow-lg p-6 w-80">
                        <h3 className="font-semibold mb-4 text-center">Elegir Turno</h3>

                        <label className="flex items-center gap-2 mb-2">
                            <input
                                type="radio"
                                value="mañana"
                                checked={turnoPDF === 'mañana'}
                                onChange={() => setTurnoPDF('mañana')}
                            />
                            Mañana
                        </label>

                        <label className="flex items-center gap-2 mb-4">
                            <input
                                type="radio"
                                value="tarde"
                                checked={turnoPDF === 'tarde'}
                                onChange={() => setTurnoPDF('tarde')}
                            />
                            Tarde
                        </label>

                        <div className="flex justify-end gap-3">
                            <button
                                className="px-3 py-1 rounded bg-gray-300"
                                onClick={() => setShowTurnoModal(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                className="px-3 py-1 rounded bg-purple-700 text-white"
                                onClick={() => {
                                    exportGroupedPositionsPDF(staff, schedules, selectedDay, turnoPDF);
                                    setShowTurnoModal(false);
                                }}
                            >
                                Descargar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}