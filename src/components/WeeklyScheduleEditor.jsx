// WeeklyScheduleEditor.jsx – versión con detección de conflictos corregida
import React, { useEffect, useState, useRef } from 'react';
import { getFirestore, writeBatch, doc, getDoc, setDoc, collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ScheduleHeatmapMatrix from './ScheduleHeatmapMatrix';
import { exportSchedulePDF, exportGroupedPositionsPDF, exportExtraHoursReport } from './PDFExport';
import GeoVictoriaUpload from './GeoVictoriaUpload';
import { exportGeoVictoriaExcel } from "../services/GeoVictoriaExport";
import { FaInfoCircle, FaExclamationTriangle, FaExclamationCircle } from 'react-icons/fa';
import {
    Calendar,
    Save,
    FileText,
    Download,
    Upload,
    Settings,
    Filter,
    Clock,
    Users,
    AlertCircle,
    CheckCircle,
    X,
    Home,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';
import { HOURS } from './ScheduleHeatmapMatrix';
import ModalSelectorDePosiciones from './ModalSelectorDePosiciones';
import { HOLIDAYS_2026 } from '../constants/holidays';

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
    const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
    const [showTurnoModal, setShowTurnoModal] = useState(false);
    const [turnoPDF, setTurnoPDF] = useState('mañana');
    const [conflictAlerts, setConflictAlerts] = useState({});
    const [scheduleAttempt, setScheduleAttempt] = useState(0);
    const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'success' | 'error'
    const [storeId, setStoreId] = useState('');
    const [loading, setLoading] = useState(true);

    const tooltipRef = useRef(null);
    const iconRefs = useRef({});
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
            // 1. Guardar Horarios (Batch principal)
            const batch = writeBatch(db);
            for (const staffId in schedules) {
                const schedule = schedules[staffId];
                const ref = doc(db, 'schedules', `${staffId}_${wk}`);
                batch.set(ref, schedule);
            }
            // 2. Detectar y Guardar Feriados Trabajados
            if (weekStartDate) {
                const [y, m, d] = weekStartDate.split('-').map(Number);
                const start = new Date(y, m - 1, d);

                for (const staffId in schedules) {
                    const personSchedule = schedules[staffId];
                    if (!personSchedule) continue;

                    weekdays.forEach((dayName, idx) => {
                        const shift = personSchedule[dayName];
                        // Si trabaja (no off, no feriado declarado, tiene entrada/salida)
                        if (shift && !shift.off && !shift.feriado && shift.start && shift.end) {
                            const currentDay = new Date(start);
                            currentDay.setDate(start.getDate() + idx);
                            const dateStr = [
                                currentDay.getFullYear(),
                                String(currentDay.getMonth() + 1).padStart(2, '0'),
                                String(currentDay.getDate()).padStart(2, '0')
                            ].join('-');

                            const holiday = HOLIDAYS_2026.find(h => h.date === dateStr);
                            if (holiday) {
                                // Usar setDoc con ID determinista para evitar duplicados
                                const holidayRef = doc(db, 'feriados_trabajados', `${staffId}_${dateStr}`);
                                batch.set(holidayRef, {
                                    uid: staff.find(s => s.id === staffId)?.uid || '', // intentar buscar uid
                                    staffId: staffId,
                                    date: dateStr,
                                    name: holiday.name,
                                    createdAt: new Date().toISOString()
                                });
                            }
                        }
                    });
                }
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

        // Convertir a número si es horas extras
        let finalValue = value;
        if (field === 'extraHours') {
            finalValue = value === '' ? '' : parseFloat(value);
        }

        let updates = { [field]: finalValue };

        // 🔒 Si se marca "off", borrar datos relacionados
        if (field === 'off' && value === true) {
            updates = { off: true, start: '', end: '', position: '', feriado: false, extraHours: '' };
        }

        // 🔒 Si se marca "feriado", setear horarios fijos según modalidad
        if (field === 'feriado' && value === true) {
            const isFull = modality.toLowerCase() === 'full-time';
            updates = {
                feriado: true,
                off: false,
                start: '08:00',
                end: isFull ? '16:45' : '12:00',
                position: '',
                extraHours: ''
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
    const calculateDailyHours = (start, end, extraHours = 0) => {
        if (!start || !end) return '--';

        const startMinutes = timeToMinutes(start);
        let endMinutes = timeToMinutes(end);

        // Si termina antes de empezar, asumimos que pasó medianoche
        if (endMinutes <= startMinutes) {
            endMinutes += 24 * 60;
        }

        let diff = endMinutes - startMinutes;

        // Sumar horas extras
        if (extraHours && !isNaN(extraHours)) {
            diff += Number(extraHours) * 60;
        }

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

                // Filtrar colaboradores cesados: excluir si cessationDate < hoy
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);

                const activeStaff = staffList.filter(s => {
                    if (!s.cessationDate) return true; // sin fecha de cese → activo
                    const cessation = new Date(s.cessationDate + 'T00:00:00');
                    return cessation >= todayMidnight; // cese hoy o futuro → aún activo
                });

                setStaff(activeStaff);

                const posSet = new Set();
                activeStaff.forEach(s => s.positionAbilities?.forEach(p => posSet.add(p)));
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
            if (!d) return {};

            let realEnd = d.end;

            // Si hay horas extra, extender el final visual para el heatmap
            if (d.extraHours && d.end && !isNaN(d.extraHours) && Number(d.extraHours) > 0) {
                const [h, m] = d.end.split(':').map(Number);
                const extraMins = Number(d.extraHours) * 60;
                const baseMins = h * 60 + m;
                const newMins = baseMins + extraMins;

                const finalH = Math.floor(newMins / 60) % 24;
                const finalM = newMins % 60;
                realEnd = `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
            }

            return { position: d?.position, start: d?.start, end: realEnd };
        })
        .filter(x => x.position && x.start && x.end);

    const safeRequirements = requirements[selectedDay] || { positions: [], matrix: {} };
    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mb-4"></div>
                    <p className="text-gray-600 font-medium text-lg">Cargando horarios...</p>
                </div>
            </div>
        );
    }
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            {/* Header Moderno */}
            <div className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-40">
                <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                        <div>
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                Editor de Horarios Semanales
                            </h1>
                            {isValidDate && wk && (
                                <p className="text-sm text-gray-600 mt-1">
                                    Semana: {new Date(weekStartDate).toLocaleDateString('es-ES', {
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric'
                                    })}
                                </p>
                            )}
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

            <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">

                {/* Controles Principales */}
                <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Filtros y Selección */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Calendar className="w-5 h-5 text-gray-500" />
                                <label className="font-semibold text-gray-700">Semana comenzando el:</label>
                                <input
                                    type="date"
                                    value={weekStartDate}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (!val) {
                                            setWeekStartDate('');
                                            return;
                                        }
                                        const [year, month, day] = val.split('-').map(Number);
                                        const date = new Date(year, month - 1, day);
                                        const dayOfWeek = date.getDay();
                                        const diff = (dayOfWeek + 6) % 7;
                                        date.setDate(date.getDate() - diff);
                                        const monday = [
                                            date.getFullYear(),
                                            String(date.getMonth() + 1).padStart(2, '0'),
                                            String(date.getDate()).padStart(2, '0'),
                                        ].join('-');
                                        setWeekStartDate(monday);
                                    }}
                                    className="border-2 border-gray-300 rounded-lg px-4 py-2 text-base font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                />
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-gray-500" />
                                    <select
                                        value={selectedDay}
                                        onChange={e => setSelectedDay(e.target.value)}
                                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium"
                                    >
                                        {weekdays.map(d => <option key={d} value={d}>{weekdayLabels[d]}</option>)}
                                    </select>
                                </div>

                                <select
                                    value={modalityFilter}
                                    onChange={e => setModalityFilter(e.target.value)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium"
                                >
                                    <option>Todos</option>
                                    <option>Full-Time</option>
                                    <option>Part-Time</option>
                                </select>

                                <select
                                    value={positionFilter}
                                    onChange={e => setPositionFilter(e.target.value)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium"
                                >
                                    <option>Todas</option>
                                    {positions.map(pos => <option key={pos}>{pos}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Botones de Acción */}
                        <div className="flex flex-wrap gap-3 items-start">
                            <button
                                onClick={saveSchedules}
                                disabled={saveStatus === 'saving'}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium ${saveStatus === 'saving'
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : saveStatus === 'success'
                                        ? 'bg-green-500 hover:bg-green-600'
                                        : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
                                    } text-white`}
                            >
                                {saveStatus === 'saving' ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        Guardando...
                                    </>
                                ) : saveStatus === 'success' ? (
                                    <>
                                        <CheckCircle className="w-5 h-5" />
                                        Guardado
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-5 h-5" />
                                        Guardar
                                    </>
                                )}
                            </button>

                            <button
                                onClick={() => exportSchedulePDF(staff, schedules, wk)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <FileText className="w-5 h-5" />
                                PDF
                            </button>

                            <button
                                onClick={() => setShowTurnoModal(true)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Download className="w-5 h-5" />
                                PDF Posiciones
                            </button>

                            <button
                                onClick={() => {
                                    if (!wk || Object.keys(turnoMap).length === 0) {
                                        alert('Primero sube el archivo de turnos de GeoVictoria');
                                        return;
                                    }
                                    exportGeoVictoriaExcel(staff, schedules, wk, turnoMap);
                                }}
                                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Download className="w-5 h-5" />
                                Excel GeoVictoria
                            </button>

                            <button
                                onClick={async () => {
                                    const currentSchedule = allSchedules[wk] || {};
                                    await exportExtraHoursReport(staff, currentSchedule, wk);
                                }}
                                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Clock className="w-5 h-5" />
                                Reporte Horas Extras
                            </button>

                            <button
                                onClick={generateIdealSchedule}
                                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Users className="w-5 h-5" />
                                Generar Horario
                            </button>
                        </div>
                    </div>

                    {/* GeoVictoria Upload */}
                    <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2 mb-2">
                            <Upload className="w-4 h-4 text-gray-500" />
                            <span className="font-medium text-gray-700">Cargar Turnos GeoVictoria</span>
                        </div>
                        <GeoVictoriaUpload onTurnosLoaded={setTurnoMap} />
                        {Object.keys(turnoMap).length > 0 ? (
                            <p className="text-green-600 text-sm mt-2 flex items-center gap-1">
                                <CheckCircle className="w-4 h-4" />
                                Archivo cargado ({Object.keys(turnoMap).length} turnos detectados)
                            </p>
                        ) : (
                            <p className="text-gray-500 text-sm mt-2">Sube el archivo de turnos para poder exportar a GeoVictoria</p>
                        )}
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-6">
                    <div className="w-full lg:w-2/3">
                        <div className="bg-white rounded-xl shadow-md">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gradient-to-r from-gray-700 to-gray-800 text-white">
                                        <tr>
                                            <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider sticky left-0 z-10 bg-gradient-to-r from-gray-700 to-gray-800" style={{ minWidth: '280px', maxWidth: '280px' }}>Nombre</th>
                                            <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider sticky left-[280px] z-10 bg-gradient-to-r from-gray-700 to-gray-800" style={{ minWidth: '140px', maxWidth: '140px' }}>Modalidad</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Entrada</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Salida</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider" title="Horas Extras (Se restarán de la salida para GeoVictoria)">HE</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Horas Día</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Horas Semana</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Posición</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Pre-cierres</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Cierres</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Libre</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Feriado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
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
                                            const horasMax = esFullTime ? 48 * 60 : 24 * 60;  // Máximo razonable (evita abusos)
                                            const horasEnRango = horas.total >= horasMin && horas.total <= horasMax;
                                            const { preCierres, cierres } = calcularCierres(schedules[p.id] || {});

                                            return (
                                                <tr key={p.id} className="hover:bg-blue-50 transition-colors duration-150 group">
                                                    <td className="px-6 py-4 relative sticky left-0 z-10 bg-white group-hover:bg-blue-50" style={{ minWidth: '280px', maxWidth: '280px' }}>
                                                        <div className="flex items-start gap-2">
                                                            <div className="flex-1 min-w-0 pr-2">
                                                                <div
                                                                    className="font-medium text-sm text-gray-900 leading-tight"
                                                                    style={{
                                                                        wordBreak: 'break-word',
                                                                        overflowWrap: 'break-word',
                                                                        lineHeight: '1.4'
                                                                    }}
                                                                >
                                                                    {p.name} {p.lastName}
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-1.5 flex-shrink-0 relative">
                                                                {/* Ícono de información (tooltip estudio) */}
                                                                <div className="relative" ref={el => iconRefs.current[p.id] = el}>
                                                                    <FaInfoCircle

                                                                        className="text-blue-600 cursor-pointer hover:text-blue-800 transition flex-shrink-0"
                                                                        size={16}
                                                                        onMouseEnter={(e) => {
                                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                                            const tooltipHeight = 350; // altura aproximada del tooltip
                                                                            const tooltipWidth = 300;
                                                                            const viewportHeight = window.innerHeight;
                                                                            const viewportWidth = window.innerWidth;

                                                                            // Calcular posición vertical: si no hay espacio abajo, mostrar arriba
                                                                            let top = rect.bottom + 8;
                                                                            if (rect.bottom + tooltipHeight + 8 > viewportHeight) {
                                                                                top = rect.top - tooltipHeight - 8;
                                                                            }

                                                                            // Calcular posición horizontal: centrar pero ajustar si está cerca de los bordes
                                                                            let left = rect.left + (rect.width / 2);
                                                                            if (left - (tooltipWidth / 2) < 10) {
                                                                                left = tooltipWidth / 2 + 10;
                                                                            } else if (left + (tooltipWidth / 2) > viewportWidth - 10) {
                                                                                left = viewportWidth - (tooltipWidth / 2) - 10;
                                                                            }

                                                                            setTooltipPosition({ top, left });
                                                                            setTooltipOpen(p.id);
                                                                        }}
                                                                        onMouseLeave={() => {
                                                                            // Pequeño delay para permitir mover el mouse al tooltip
                                                                            setTimeout(() => {
                                                                                if (tooltipRef.current && !tooltipRef.current.matches(':hover')) {
                                                                                    setTooltipOpen(null);
                                                                                }
                                                                            }, 200);
                                                                        }}
                                                                    />
                                                                </div>

                                                                {/* Ícono si NO tiene día libre */}
                                                                {!tieneDiaLibre && (
                                                                    <FaExclamationCircle
                                                                        title="No tiene día libre asignado esta semana"
                                                                        className="text-red-600 flex-shrink-0"
                                                                        size={16}
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Mensaje de conflicto debajo del nombre */}
                                                        {hasConflict && (
                                                            <div className="text-xs text-orange-800 bg-orange-50 border border-orange-200 px-2 py-1 rounded mt-2 flex items-center gap-1.5 shadow-sm">
                                                                <AlertCircle className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />
                                                                <span className="font-medium text-xs">{formatConflictMessage(hasConflict)}</span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-center sticky left-[280px] z-10 bg-white group-hover:bg-blue-50" style={{ minWidth: '140px', maxWidth: '140px' }}>
                                                        <span className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap inline-block ${p.modality === "Full-Time"
                                                            ? "bg-gradient-to-r from-green-500 to-green-600 text-white shadow-sm"
                                                            : "bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-sm"
                                                            }`}>
                                                            {p.modality}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="time"
                                                            value={d.start || ''}
                                                            onChange={e => handleChange(p.id, 'start', e.target.value)}
                                                            disabled={d.feriado || d.off}
                                                            className={`w-full px-2 py-2 border rounded-lg text-center text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${hasConflict ? 'border-orange-500 bg-orange-50' : 'border-gray-300'
                                                                } disabled:bg-gray-100 disabled:cursor-not-allowed`}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="time"
                                                            value={d.end || ''}
                                                            onChange={e => handleChange(p.id, 'end', e.target.value)}
                                                            disabled={d.feriado || d.off}
                                                            className={`w-full px-2 py-2 border rounded-lg text-center text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${hasConflict ? 'border-orange-500 bg-orange-50' : 'border-gray-300'
                                                                } disabled:bg-gray-100 disabled:cursor-not-allowed`}
                                                        />
                                                    </td>
                                                    <td className="px-2 py-4 text-center">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="12"
                                                            step="0.5"
                                                            value={d.extraHours || ''}
                                                            onChange={e => handleChange(p.id, 'extraHours', e.target.value)}
                                                            disabled={d.feriado || d.off}
                                                            placeholder="0"
                                                            className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-center text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-4 text-center font-medium text-gray-700 text-sm">
                                                        {calculateDailyHours(d.start, d.end, d.extraHours)}
                                                    </td>
                                                    <td className={`px-4 py-4 text-center font-semibold text-sm ${!horasEnRango ? 'text-red-600' : 'text-green-700'
                                                        }`}>
                                                        <div className="flex items-center justify-center gap-1">
                                                            <Clock className="w-4 h-4" />
                                                            {horas.formatted}
                                                            {hasConflict && <AlertCircle className="w-4 h-4 text-orange-600" />}
                                                        </div>
                                                    </td>

                                                    <td className="px-4 py-4 text-center">
                                                        <select
                                                            value={d.position || ''}
                                                            onChange={e => handleChange(p.id, 'position', e.target.value)}
                                                            disabled={d.feriado || d.off}
                                                            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                        >
                                                            <option value="">--</option>
                                                            {positions.map(pos => (
                                                                <option key={pos} value={pos}>{pos}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="px-4 py-4 text-center font-bold text-orange-600 text-sm">
                                                        {preCierres}/4
                                                    </td>
                                                    <td className="px-4 py-4 text-center font-bold text-red-600 text-sm">
                                                        {cierres}/4
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={d.off || false}
                                                            onChange={e => handleChange(p.id, 'off', e.target.checked)}
                                                            disabled={d.feriado}
                                                            className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={d.feriado || false}
                                                            onChange={e => handleChange(p.id, 'feriado', e.target.checked)}
                                                            className="w-5 h-5 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-500 cursor-pointer"
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Heatmap */}
                    <div className="w-full lg:w-5/12">
                        <div className="bg-white rounded-xl shadow-md p-3 sticky top-24">
                            <h3 className="text-base font-bold text-gray-800 mb-2 flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                Mapa de Calor - {weekdayLabels[selectedDay]}
                            </h3>
                            <div className="h-[calc(100vh-280px)] overflow-auto">
                                <ScheduleHeatmapMatrix
                                    key={selectedDay}
                                    assigned={assignedArray}
                                    requirements={requirements[selectedDay] || { positions: [], matrix: {} }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tooltip global para horarios de estudio */}
                {tooltipOpen && (
                    <div
                        ref={tooltipRef}
                        className="fixed z-[9999] bg-white border-2 border-blue-200 rounded-lg shadow-xl p-3"
                        style={{
                            pointerEvents: 'auto',
                            width: '300px',
                            maxHeight: '350px',
                            overflowY: 'auto',
                            top: `${tooltipPosition.top}px`,
                            left: `${tooltipPosition.left}px`,
                            transform: 'translateX(-50%)'
                        }}
                        onMouseEnter={() => {
                            // Mantener el tooltip abierto cuando el mouse está sobre él
                        }}
                        onMouseLeave={() => {
                            setTooltipOpen(null);
                        }}
                    >
                        {(() => {
                            const person = filteredStaff.find(p => p.id === tooltipOpen);
                            if (!person) return null;

                            return (
                                <>
                                    <strong className="block mb-2 text-xs font-bold text-gray-800 border-b border-gray-200 pb-1.5 flex items-center gap-1.5">
                                        <Clock className="w-3.5 h-3.5 text-blue-600" />
                                        Horarios de Estudio - {person.name} {person.lastName}
                                    </strong>

                                    <div className="space-y-1 text-xs">
                                        {weekdays.map(day => {
                                            const daySchedule = person.study_schedule?.[day];
                                            const isFree = daySchedule?.free === true;
                                            const hasBlocks = daySchedule?.blocks && daySchedule.blocks.length > 0;

                                            return (
                                                <div key={day} className="flex items-start gap-2 py-0.5">
                                                    <span className="font-semibold text-gray-700 min-w-[55px] text-xs">
                                                        {weekdayLabels[day].slice(0, 3)}:
                                                    </span>
                                                    <div className="flex-1">
                                                        {isFree ? (
                                                            <span className="text-green-700 font-semibold text-xs">
                                                                ✓ Libre
                                                            </span>
                                                        ) : hasBlocks ? (
                                                            <div className="space-y-0.5">
                                                                {daySchedule.blocks.map((block, i) => (
                                                                    <div key={i} className="text-orange-700 font-medium text-xs">
                                                                        {block.start || block.startTime} - {block.end || block.endTime}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-500 italic text-xs">Sin clases</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Resumen compacto */}
                                    <div className="mt-2 pt-1.5 border-t border-gray-200 flex justify-between text-xs font-semibold">
                                        <span className="text-green-700">
                                            Libres: {weekdays.filter(d => person.study_schedule?.[d]?.free).length}
                                        </span>
                                        <span className="text-orange-700">
                                            Clases: {weekdays.filter(d => person.study_schedule?.[d]?.blocks?.length > 0).length}
                                        </span>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                )}

                {/* Modal para selección de turno */}
                {showTurnoModal && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                    <Download className="w-5 h-5" />
                                    Exportar PDF de Posiciones
                                </h3>
                                <button
                                    onClick={() => setShowTurnoModal(false)}
                                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5 text-gray-600" />
                                </button>
                            </div>

                            <div className="space-y-4 mb-6">
                                <label className="flex items-center gap-3 p-4 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-purple-300 hover:bg-purple-50 transition-all">
                                    <input
                                        type="radio"
                                        value="mañana"
                                        checked={turnoPDF === 'mañana'}
                                        onChange={() => setTurnoPDF('mañana')}
                                        className="w-5 h-5 text-purple-600 focus:ring-2 focus:ring-purple-500"
                                    />
                                    <span className="font-medium text-gray-700">Turno Mañana</span>
                                </label>

                                <label className="flex items-center gap-3 p-4 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-purple-300 hover:bg-purple-50 transition-all">
                                    <input
                                        type="radio"
                                        value="tarde"
                                        checked={turnoPDF === 'tarde'}
                                        onChange={() => setTurnoPDF('tarde')}
                                        className="w-5 h-5 text-purple-600 focus:ring-2 focus:ring-purple-500"
                                    />
                                    <span className="font-medium text-gray-700">Turno Tarde</span>
                                </label>
                            </div>

                            <div className="flex justify-end gap-3">
                                <button
                                    className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
                                    onClick={() => setShowTurnoModal(false)}
                                >
                                    Cancelar
                                </button>
                                <button
                                    className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-purple-600 text-white font-medium shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                                    onClick={async () => {
                                        // Calcular fecha exacta
                                        let dateText = '';
                                        if (weekStartDate) {
                                            const dayIndex = weekdays.indexOf(selectedDay);
                                            if (dayIndex !== -1) {
                                                const [y, m, d] = weekStartDate.split('-').map(Number);
                                                const date = new Date(y, m - 1, d);
                                                date.setDate(date.getDate() + dayIndex);
                                                dateText = date.toLocaleDateString('es-ES', {
                                                    weekday: 'long',
                                                    year: 'numeric',
                                                    month: 'long',
                                                    day: 'numeric'
                                                });
                                                // Capitalizar primera letra
                                                dateText = dateText.charAt(0).toUpperCase() + dateText.slice(1);
                                            }
                                        }

                                        // Forzar el uso del estado más reciente
                                        const currentSchedule = allSchedules[wk] || {};
                                        await exportGroupedPositionsPDF(staff, currentSchedule, selectedDay, dateText, turnoPDF, positions);
                                        setShowTurnoModal(false);
                                    }}
                                >
                                    <Download className="w-4 h-4" />
                                    Descargar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}