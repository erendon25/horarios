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
    ChevronRight,
    Search,
    ClipboardList
} from 'lucide-react';
import { HOURS } from './ScheduleHeatmapMatrix';
import ModalSelectorDePosiciones from './ModalSelectorDePosiciones';
import { HOLIDAYS_2026, isHoliday } from '../constants/holidays';

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

const getEffectiveModality = (person, dateStr) => {
    if (!person || !person.modalityChangeDate || !person.nextModality || !dateStr) {
        return person?.modality || '';
    }
    // Comparación lexicográfica de fechas ISO (YYYY-MM-DD)
    if (dateStr >= person.modalityChangeDate) {
        return person.nextModality;
    }
    return person.modality;
};

export default function WeeklyScheduleEditor() {
    const [staff, setStaff] = useState([]);
    const [positions, setPositions] = useState([]);
    const [allSchedules, setAllSchedules] = useState({});
    const [requirements, setRequirements] = useState({});
    const [selectedDay, setSelectedDay] = useState('monday');
    const [weekStartDate, setWeekStartDate] = useState('');
    const [modalityFilter, setModalityFilter] = useState('Todos');
    const [positionFilter, setPositionFilter] = useState('Todas');
    const [excludeTraineesFilter, setExcludeTraineesFilter] = useState(false);
    const [turnoMap, setTurnoMap] = useState({});
    const [prevWeekSchedules, setPrevWeekSchedules] = useState({});
    const [tooltipOpen, setTooltipOpen] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
    const [showTurnoModal, setShowTurnoModal] = useState(false);
    const [turnoPDF, setTurnoPDF] = useState('mañana');
    const [conflictAlerts, setConflictAlerts] = useState({});
    const [scheduleAttempt, setScheduleAttempt] = useState(0);
    const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'success' | 'error'
    const [storeId, setStoreId] = useState('');
    const [approvedRequests, setApprovedRequests] = useState([]);
    const [showApprovedRequestsModal, setShowApprovedRequestsModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [dirtyStaff, setDirtyStaff] = useState(new Set());
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [aptitudeFilter, setAptitudeFilter] = useState('Todos'); // 'Todos', 'Certificados', 'En Proceso', 'No Capacitados'
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportOptions, setExportOptions] = useState({
        excludeTrainees: false,
        showPositions: false
    });

    const wk = getWeekKey(weekStartDate);
    const schedules = wk ? allSchedules[wk] || {} : {};

    // === PERSISTENCIA LOCAL STORAGE (Evitar pérdidas y llamadas innecesarias) ===
    useEffect(() => {
        if (!wk) return;
        const saved = localStorage.getItem(`draft_schedule_${wk}`);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setAllSchedules(prev => ({ ...prev, [wk]: parsed }));
            } catch (e) {
                console.error("Error cargando borrador local");
            }
        }
    }, [wk]);

    useEffect(() => {
        if (!wk || Object.keys(schedules).length === 0) return;
        // Guardar borrador localmente cada vez que cambie algo
        const timer = setTimeout(() => {
            localStorage.setItem(`draft_schedule_${wk}`, JSON.stringify(schedules));
        }, 1000);
        return () => clearTimeout(timer);
    }, [schedules, wk]);

    const tooltipRef = useRef(null);
    const iconRefs = useRef({});
    const db = getFirestore();
    const navigate = useNavigate();
    const { currentUser, userRole } = useAuth();
    const getSelectedDateStr = () => {
        if (!weekStartDate || !selectedDay) return null;
        const [y, m, d] = weekStartDate.split('-').map(Number);
        const dayIndex = weekdays.indexOf(selectedDay);
        const date = new Date(y, m - 1, d + dayIndex);
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    };

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

        // CORRECCIÓN: Usar hora local, no UTC
        const y = monday.getFullYear();
        const m = String(monday.getMonth() + 1).padStart(2, '0');
        const d = String(monday.getDate()).padStart(2, '0');
        setWeekStartDate(`${y}-${m}-${d}`);
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

    // === CARGA SOLICITUDES APROBADAS ===
    useEffect(() => {
        if (!storeId || !wk) return;

        const db = getFirestore();
        const startStr = wk.split('_to_')[0];
        const endStr = wk.split('_to_')[1];

        const q = query(
            collection(db, 'schedule_requests'),
            where('storeId', '==', storeId),
            where('status', '==', 'approved'),
            where('date', '>=', startStr),
            where('date', '<=', endStr)
        );

        const unsub = onSnapshot(q, (snap) => {
            const reqs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setApprovedRequests(reqs);
        });

        return () => unsub();
    }, [storeId, wk]);

    const saveSchedules = async () => {
        if (dirtyStaff.size === 0) {
            alert("No hay cambios pendientes para guardar.");
            return;
        }

        setSaveStatus('saving');
        try {
            const batch = writeBatch(db);
            const dirtyArray = Array.from(dirtyStaff);

            // 1. Guardar SOLO Horarios modificados
            for (const staffId of dirtyArray) {
                const schedule = schedules[staffId];
                if (!schedule) continue;

                const ref = doc(db, 'schedules', `${staffId}_${wk}`);
                // Añadimos campos de indexación para búsqueda masiva eficiente (Cost-Reduction)
                batch.set(ref, {
                    ...schedule,
                    weekKey: wk,
                    storeId: storeId
                });
            }

            // 2. Procesar Feriados SOLO para filas modificadas
            if (weekStartDate) {
                const [y, m, d] = weekStartDate.split('-').map(Number);
                const start = new Date(y, m - 1, d);

                for (const staffId of dirtyArray) {
                    const personSchedule = schedules[staffId];
                    const person = staff.find(s => s.id === staffId);
                    if (!personSchedule || !person) continue;

                    weekdays.forEach((dayName, idx) => {
                        const shift = personSchedule[dayName];
                        const currentDay = new Date(start);
                        currentDay.setDate(start.getDate() + idx);
                        const dateStr = [
                            currentDay.getFullYear(),
                            String(currentDay.getMonth() + 1).padStart(2, '0'),
                            String(currentDay.getDate()).padStart(2, '0')
                        ].join('-');

                        const holidayRef = doc(db, 'feriados_trabajados', `${staffId}_${dateStr}`);
                        const calendarHoliday = HOLIDAYS_2026.find(h => h.date === dateStr);

                        if (shift?.feriado) {
                            if (!calendarHoliday) {
                                batch.set(holidayRef, {
                                    uid: person.uid || '',
                                    staffId: staffId,
                                    storeId: storeId,
                                    date: dateStr,
                                    name: 'Compensación de Feriado',
                                    type: 'compensado',
                                    createdAt: new Date().toISOString()
                                });
                            } else {
                                batch.delete(holidayRef);
                            }
                        }
                        else if (shift && !shift.off && shift.start && shift.end) {
                            if (calendarHoliday) {
                                batch.set(holidayRef, {
                                    uid: person.uid || '',
                                    staffId: staffId,
                                    storeId: storeId,
                                    date: dateStr,
                                    name: calendarHoliday.name,
                                    type: 'ganado',
                                    createdAt: new Date().toISOString()
                                });
                            } else {
                                batch.delete(holidayRef);
                            }
                        }
                        else {
                            batch.delete(holidayRef);
                        }
                    });
                }
            }

            await batch.commit();

            // Limpieza post-guardado exitoso
            setDirtyStaff(new Set());
            setHasUnsavedChanges(false);
            localStorage.removeItem(`draft_schedule_${wk}`); // Limpiar borrador local al sincronizar

            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (err) {
            console.error("Error al guardar:", err);
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
        const shiftStart = timeToMinutes(shift.start);
        let shiftEndRaw = timeToMinutes(shift.end);
        
        // Manejar cruce de medianoche
        const isOvernight = shiftEndRaw <= shiftStart;
        const shiftEnd = isOvernight ? shiftEndRaw + (24 * 60) : shiftEndRaw;

        for (const block of studyBlocks) {
            const blockStart = timeToMinutes(block.start);
            const blockEnd = timeToMinutes(block.end);

            // Caso 1: Traslape en el día actual
            const overlapCurrent = shiftStart < blockEnd && Math.min(shiftEnd, 1440) > blockStart;
            
            // Caso 2: Traslape después de medianoche (si el turno es overnight)
            let overlapNext = false;
            if (isOvernight) {
                // Aquí deberíamos idealmente revisar el horario de estudio del DÍA SIGUIENTE,
                // pero por simplicidad y según el requerimiento, validamos contra el bloque si choca con la parte post-medianoche
                // (Nota: la mayoría de los estudios son diurnos, el riesgo mayor es el inicio del turno)
                overlapNext = (shiftEnd > 1440) && (shiftEnd - 1440 > blockStart);
            }

            if (overlapCurrent || overlapNext) {
                return 'conflicto';
            }
        }

        return null;
    };


    // Función para manejar cambios en los inputs
    const handleChange = (staffId, field, value) => {
        if (!wk) return;

        const current = schedules[staffId]?.[selectedDay] || {};
        const person = staff.find(p => p.id === staffId);
        const dateStr = getSelectedDateStr();

        // Convertir a número si es horas extras
        let finalValue = value;
        if (field === 'extraHours' || field === 'extraHoursPre' || field === 'extraHoursPost') {
            finalValue = value === '' ? '' : parseFloat(String(value).replace(',', '.'));
        }

        let updates = { [field]: finalValue };

        // 🔒 Si se marca "off", borrar datos relacionados
        if (field === 'off' && value === true) {
            updates = { off: true, start: '', end: '', position: '', feriado: false, extraHours: '', extraHoursPre: '', extraHoursPost: '' };
        }

        // 🔒 Si se marca "feriado", setear horarios fijos según modalidad
        if (field === 'feriado' && value === true) {
            const holiday = isHoliday(dateStr);

            if (holiday) {
                alert(`Nota legal activa:\n\nEl ${dateStr} es "${holiday.name}".\n\nPor ley, no se puede usar un feriado oficial para pagar otro feriado. El sistema marcará automáticamente este día como "Día Libre (Descanso Legal)" para preservar el balance del colaborador.`);
                updates = {
                    off: true,
                    feriado: false,
                    start: '',
                    end: '',
                    position: '',
                    extraHours: '',
                    extraHoursPre: '',
                    extraHoursPost: ''
                };
            } else {
                const effModality = getEffectiveModality(person, dateStr);
                const isFull = (effModality || '').toLowerCase() === 'full-time';
                updates = {
                    feriado: true,
                    off: false,
                    start: '08:00',
                    end: isFull ? '16:45' : '12:00',
                    position: '',
                    extraHours: '',
                    extraHoursPre: '',
                    extraHoursPost: ''
                };
            }
        }

        // Si se desmarca feriado → limpiar solo feriado
        if (field === 'feriado' && value === false) {
            updates = { ...current, feriado: false };
        }

        // Si se desmarca off → limpiar solo off
        if (field === 'off' && value === false) {
            updates = { ...current, off: false };
        }

        setDirtyStaff(prev => new Set(prev).add(staffId));
        setHasUnsavedChanges(true);

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


    // Función para calcular horas diarias (turno + horas extras)
    const calculateDailyHours = (start, end, extraHoursPre = 0, extraHoursPost = 0) => {
        if (!start || !end) return '--';

        const startMinutes = timeToMinutes(start);
        let endMinutes = timeToMinutes(end);

        if (endMinutes <= startMinutes) {
            endMinutes += 24 * 60;
        }

        let diff = endMinutes - startMinutes;

        // Sumar horas extras al total diario
        const pre = parseFloat(String(extraHoursPre || 0).replace(',', '.')) || 0;
        if (pre > 0) diff += pre * 60;

        const post = parseFloat(String(extraHoursPost || 0).replace(',', '.')) || 0;
        if (post > 0) diff += post * 60;

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

    const getDateStrForDay = (day) => {
        if (!weekStartDate || !day) return null;
        const [y, m, d] = weekStartDate.split('-').map(Number);
        const dayIndex = weekdays.indexOf(day);
        const date = new Date(y, m - 1, d + dayIndex);
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    };

    // Función para calcular horas semanales
    const calculateWeeklyHours = (staffId) => {
        // Asegurarnos de tener los datos necesarios
        if (!wk || !schedules || !schedules[staffId]) {
            return { total: 0, formatted: '0:00' };
        }

        const person = staff.find(p => p.id === staffId);
        if (!person) return { total: 0, formatted: '0:00' };

        let totalMinutes = 0;

        weekdays.forEach(day => {
            const daySchedule = schedules[staffId][day];

            // Si no hay horario o es día libre, saltar
            if (!daySchedule || daySchedule.off) return;
            if (!daySchedule.start || !daySchedule.end) return;

            const dateStr = getDateStrForDay(day);
            const effModality = getEffectiveModality(person, dateStr);
            const isFullTime = (effModality || '').toLowerCase() === 'full-time';

            // 1. Calcular Horas Base (Turno)
            const startMinutes = timeToMinutes(daySchedule.start);
            let endMinutes = timeToMinutes(daySchedule.end);

            if (endMinutes <= startMinutes) {
                endMinutes += 24 * 60; // Cruce de medianoche
            }

            let baseMinutes = endMinutes - startMinutes;

            // Descuento Break (Solo Full Time)
            if (isFullTime) {
                baseMinutes = Math.max(0, baseMinutes - 45);
            }

            totalMinutes += baseMinutes;
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

        const shuffledStaff = [...activeStaff]
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

            const currentDayDateStr = getDateStrForDay(day);
            const effModality = getEffectiveModality(person, currentDayDateStr);
            const isFullTime = (effModality || '').toLowerCase() === 'full-time';

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


    // Cargar horarios por ID de documento directo (100% confiable, sin índice).
    // La consulta optimizada se usa solo para complementar los resultados.
    useEffect(() => {
        if (!wk || !storeId || staff.length === 0) return;

        const loadAllSchedules = async () => {
            console.log('[Horarios] Iniciando carga → wk:', wk, '| storeId:', storeId, '| staff:', staff.length);

            const merged = {};

            let allStaffIds = [];

            // --- Paso 1: Fetch por ID directo (funciona siempre, sin índice) ---
            try {
                const allStaffSnap = await getDocs(
                    query(collection(db, 'staff_profiles'), where('storeId', '==', storeId))
                );
                allStaffIds = allStaffSnap.docs.map(d => d.id);
                console.log('[Horarios] Staff IDs en tienda:', allStaffIds.length);
                await Promise.all(allStaffIds.map(async (sId) => {
                    const dSnap = await getDoc(doc(db, 'schedules', `${sId}_${wk}`));
                    if (dSnap.exists()) merged[sId] = dSnap.data();
                }));
                console.log('[Horarios] Por ID directo:', Object.keys(merged).length, 'horarios cargados');
            } catch (err) {
                console.error('[Horarios] Error en carga por ID:', err);
            }

            // --- Paso 2: Complementar con consulta optimizada (si tiene índice) ---
            try {
                const q = query(
                    collection(db, 'schedules'),
                    where('weekKey', '==', wk),
                    where('storeId', '==', storeId)
                );
                const snap = await getDocs(q);
                console.log('[Horarios] Consulta optimizada:', snap.size, 'docs adicionales');
                snap.docs.forEach(docSnap => {
                    const sId = docSnap.id.split('_')[0];
                    if (!merged[sId]) merged[sId] = docSnap.data();
                });
            } catch (err) {
                console.warn('[Horarios] Consulta optimizada omitida (sin índice):', err.message);
            }

            console.log('[Horarios] Total final:', Object.keys(merged).length, 'horarios');
            setAllSchedules(prev => ({ ...prev, [wk]: merged }));

            // --- Paso 3: Cargar semana anterior si es necesario ---
            const [y, m, d] = weekStartDate.split('-').map(Number);
            const monday = new Date(y, m - 1, d);
            const prevMonday = new Date(monday);
            prevMonday.setDate(monday.getDate() - 7);
            const prevWk = getWeekKey(`${prevMonday.getFullYear()}-${String(prevMonday.getMonth() + 1).padStart(2, '0')}-${String(prevMonday.getDate()).padStart(2, '0')}`);

            if (prevWk) {
                const prevMerged = {};
                try {
                    await Promise.all(allStaffIds.map(async (sId) => {
                        const dSnap = await getDoc(doc(db, 'schedules', `${sId}_${prevWk}`));
                        if (dSnap.exists()) prevMerged[sId] = dSnap.data();
                    }));
                    setPrevWeekSchedules(prevMerged);
                } catch (err) {
                    console.error('[Horarios] Error cargando semana anterior:', err);
                }
            }
        };

        loadAllSchedules();
    }, [wk, staff, storeId, db, weekStartDate]);



    // Filtrar staff según filtros activos
    // Filtrar staff según filtros activos
    // 1. Filtrar primero por Cese (Active Staff)
    // Esto asegura que activeStaff solo contenga empleados activos para esta semana
    const activeStaff = staff.filter(person => {
        // Logic de Ceses: Si la fecha de cese es ANTERIOR al inicio de la semana, ocultar.
        if (person.terminationDate && weekStartDate) {
            try {
                const [y, m, d] = weekStartDate.split('-').map(Number);
                const weekStart = new Date(y, m - 1, d);

                // Parse termination date manually
                const [tY, tM, tD] = person.terminationDate.split('-').map(Number);
                const termDate = new Date(tY, tM - 1, tD);

                if (isNaN(termDate.getTime())) return true;
                if (termDate < weekStart) return false;
            } catch (e) {
                return true;
            }
        }
        return true;
    });

    // 2. Filtrar activeStaff según inputs de la UI (Modalidad, Posición)
    // Usamos activeStaff como base para que los cesados no aparezcan en la tabla ni en los filtros
    const filteredStaff = activeStaff.filter(person => {
        const dateStr = getSelectedDateStr();
        const effModality = getEffectiveModality(person, dateStr);

        if (modalityFilter !== 'Todos' && effModality !== modalityFilter) return false;

        if (positionFilter !== 'Todas') {
            const posKey = positionFilter.toUpperCase();
            const assignedPos = (schedules[person.id]?.[selectedDay]?.position || '').toUpperCase();

            // Si el filtro de aptitud es 'Todos', mantenemos el comportamiento original: filtrar por ASIGNACIÓN
            // PERO si el filtro de aptitud está activo, queremos ver quién TIENE la habilidad para esa posición
            if (aptitudeFilter === 'Todos') {
                if (assignedPos !== posKey) return false;
            } else {
                const isCertified = person.skills?.some(s => s.toUpperCase() === posKey);
                const score = person.trainingScores?.[posKey] || 0;
                const inTraining = score > 0 && score < 90;

                if (aptitudeFilter === 'Certificados' && !isCertified) return false;
                if (aptitudeFilter === 'En Proceso' && !inTraining) return false;
                if (aptitudeFilter === 'No Capacitados' && (isCertified || inTraining)) return false;

                // Si llegamos aquí, la persona cumple con el nivel de aptitud requerido para la posición seleccionada
            }
        }

        if (searchTerm) {
            const fullName = `${person.name} ${person.lastName}`.toLowerCase();
            if (!fullName.includes(searchTerm.toLowerCase())) return false;
        }

        if (excludeTraineesFilter && person.isTrainee) return false;

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
            // Si no hay datos, o faltan start/end esenciales, retornar vacío se filtrará luego
            if (!d || !d.start || !d.end) return {};

            let realStart = d.start;
            let realEnd = d.end;

            // 1. Extender inicio si hay HE Antes
            //    Si entra a las 9:00 y tiene 1h HE pre, en el heatmap debe verse desde las 8:00
            if (d.extraHoursPre && !isNaN(d.extraHoursPre) && Number(d.extraHoursPre) > 0) {
                const [h, m] = realStart.split(':').map(Number);
                const extraMins = Number(d.extraHoursPre) * 60;
                const baseMins = h * 60 + m;
                let newMins = baseMins - extraMins;

                // Evitar tiempos negativos si se pasa del día anterior (00:00 como tope visual simple)
                if (newMins < 0) newMins = 0;

                const finalH = Math.floor(newMins / 60);
                const finalM = newMins % 60;
                realStart = `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
            }

            // 2. Extender final si hay HE Después
            const hePost = d.extraHoursPost || d.extraHours;
            if (hePost && !isNaN(hePost) && Number(hePost) > 0) {
                const [h, m] = realEnd.split(':').map(Number);
                const extraMins = Number(hePost) * 60;
                const baseMins = h * 60 + m; // Hora de salida normal

                // Casos de turno nocturno: si termina a las 02:00, son 26 horas desde el día anterior para calculo lineal
                // Pero aquí asumimos simple extensión. Si start > end, ya cruzó medianoche.
                // Para el heatmap visual simple, solo extendemos la hora final.

                const newMins = baseMins + extraMins;
                const finalH = Math.floor(newMins / 60) % 24;
                const finalM = newMins % 60;
                realEnd = `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
            }

            return {
                position: d?.position,
                start: realStart,
                end: realEnd,
                isTrainer: p.position === 'ENTRENADOR'
            };
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
                                    <option value="Todos">Modalidad</option>
                                    <option value="Full-Time">Full-Time</option>
                                    <option value="Part-Time">Part-Time</option>
                                </select>

                                <select
                                    value={positionFilter}
                                    onChange={e => setPositionFilter(e.target.value)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium"
                                >
                                    <option value="Todas">Posiciones</option>
                                    {positions.map(pos => <option key={pos} value={pos}>{pos}</option>)}
                                </select>

                                {positionFilter !== 'Todas' && (
                                    <select
                                        value={aptitudeFilter}
                                        onChange={e => setAptitudeFilter(e.target.value)}
                                        className="px-4 py-2 border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all bg-emerald-50 text-emerald-800 font-bold text-xs"
                                    >
                                        <option value="Todos">Filtrar por Aptitud...</option>
                                        <option value="Certificados">Solo Certificados (Expertos)</option>
                                        <option value="En Proceso">En Formación (Aprendices)</option>
                                        <option value="No Capacitados">Sin Capacitación (Nuevos)</option>
                                    </select>
                                )}

                                <button
                                    onClick={() => setExcludeTraineesFilter(!excludeTraineesFilter)}
                                    className={`px-4 py-2 border rounded-lg font-medium transition-all flex items-center gap-2 ${excludeTraineesFilter
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                        }`}
                                >
                                    {excludeTraineesFilter ? 'Solo Tienda' : 'Ver Todos'}
                                </button>

                                <div className="relative flex-1 min-w-[200px]">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Search className="h-4 w-4 text-gray-400" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Buscar colaborador..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white font-medium"
                                    />
                                    {searchTerm && (
                                        <button
                                            onClick={() => setSearchTerm('')}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center"
                                        >
                                            <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                                        </button>
                                    )}
                                </div>
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
                                        : hasUnsavedChanges
                                            ? 'bg-orange-500 hover:bg-orange-600 animate-pulse'
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
                                        <span>Guardar</span>
                                        {hasUnsavedChanges && (
                                            <span className="bg-white text-orange-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">
                                                {dirtyStaff.size}
                                            </span>
                                        )}
                                    </>
                                )}
                            </button>

                            <button
                                onClick={() => setShowExportModal(true)}
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
                                    exportGeoVictoriaExcel(activeStaff, schedules, wk, turnoMap);
                                }}
                                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Download className="w-5 h-5" />
                                Excel GeoVictoria
                            </button>

                            <button
                                onClick={async () => {
                                    const currentSchedule = allSchedules[wk] || {};
                                    await exportExtraHoursReport(activeStaff, currentSchedule, wk);
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

                            <button
                                onClick={() => setShowApprovedRequestsModal(true)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <ClipboardList className="w-5 h-5" />
                                Solicitudes ({approvedRequests.length})
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
                                            <th className="px-4 md:px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider md:sticky md:left-0 z-10 bg-gradient-to-r from-gray-700 to-gray-800 min-w-[150px] max-w-[150px] md:min-w-[280px] md:max-w-[280px]">Nombre</th>
                                            <th className="px-4 md:px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider md:sticky md:left-[280px] z-10 bg-gradient-to-r from-gray-700 to-gray-800 min-w-[100px] max-w-[100px] md:min-w-[140px] md:max-w-[140px]">Modalidad</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Entrada</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Salida</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider" title="Horas Extras Antes">HE Ant</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider" title="Horas Extras Después">HE Desp</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Horas Día</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Horas Semana</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Posición</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Pre-cierres</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Cierres</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">Libre</th>
                                            <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-wider">
                                                Feriado
                                                {(() => {
                                                    const dateStr = getSelectedDateStr();
                                                    const holiday = isHoliday(dateStr);
                                                    return holiday ? <span className="block text-[10px] text-yellow-300 mt-1">({holiday.name})</span> : null;
                                                })()}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {filteredStaff.map(p => {
                                            const currentDateStr = getSelectedDateStr();
                                            const effModality = getEffectiveModality(p, currentDateStr);

                                            const d = schedules[p.id]?.[selectedDay] || {};
                                            const hasConflict = detectScheduleConflict(p, selectedDay, d);
                                            const horas = calculateWeeklyHours(p.id);
                                            // Cálculo de si tiene al menos un día libre en la semana
                                            const tieneDiaLibre = weekdays.some(day =>
                                                schedules[p.id]?.[day]?.off === true
                                            );
                                            // Cálculo de rango correcto de horas según modalidad
                                            const esFullTime = effModality?.toLowerCase() === 'full-time';
                                            const horasMin = esFullTime ? 48 * 60 : 24 * 60;  // 45h FT, 24h PT
                                            const horasMax = esFullTime ? 48 * 60 : 24 * 60;  // Máximo razonable (evita abusos)
                                            const horasEnRango = horas.total >= horasMin && horas.total <= horasMax;
                                            const { preCierres, cierres } = calcularCierres(schedules[p.id] || {});

                                            // Lógica de Cese Diario
                                            let isCeased = false;
                                            if (p.terminationDate && weekStartDate) {
                                                const [y, m, d] = weekStartDate.split('-').map(Number);
                                                const dayIndex = weekdays.indexOf(selectedDay);
                                                const currentDate = new Date(y, m - 1, d + dayIndex);
                                                // Ajustar a medianoche para comparar fechas
                                                currentDate.setHours(0, 0, 0, 0);
                                                const termDate = new Date(p.terminationDate + 'T00:00:00');
                                                termDate.setHours(0, 0, 0, 0);

                                                if (currentDate > termDate) {
                                                    isCeased = true;
                                                }

                                            }

                                            // Lógica de Cumpleaños
                                            let isBirthday = false;
                                            if (p.birthDate && weekStartDate) {
                                                const [y, m, d] = weekStartDate.split('-').map(Number);
                                                const dayIndex = weekdays.indexOf(selectedDay);
                                                const currentDate = new Date(y, m - 1, d + dayIndex);

                                                // Ajustar por zona horaria si es necesario o simplemente comparar día/mes
                                                // p.birthDate viene como YYYY-MM-DD string
                                                const [bY, bM, bD] = p.birthDate.split('-').map(Number);

                                                if (currentDate.getDate() === bD && (currentDate.getMonth() + 1) === bM) {
                                                    isBirthday = true;
                                                }
                                            }

                                            return (
                                                <tr key={p.id} className={`hover:bg-blue-50 transition-colors duration-150 group ${isCeased ? 'bg-red-50' : ''}`}>
                                                    <td className="px-4 md:px-6 py-4 relative md:sticky md:left-0 z-10 bg-white group-hover:bg-blue-50 min-w-[150px] max-w-[150px] md:min-w-[280px] md:max-w-[280px]">
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
                                                                    {isBirthday && (
                                                                        <span title="¡Cumpleaños!" className="ml-2 text-xl animate-bounce inline-block" role="img" aria-label="birthday">
                                                                            🎂
                                                                        </span>
                                                                    )}
                                                                    {p.isTrainee && (
                                                                        <span title="En entrenamiento" className="ml-1.5 text-sm" role="img" aria-label="trainee">
                                                                            🎓
                                                                        </span>
                                                                    )}
                                                                    {p.position === 'ENTRENADOR' && (
                                                                        <span title="Entrenador / Trainer" className="ml-1.5 px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded border border-orange-200 inline-block align-middle" style={{ lineHeight: '1' }}>
                                                                            TRAINER
                                                                        </span>
                                                                    )}

                                                                    {positionFilter !== 'Todas' && (() => {
                                                                        const posKey = positionFilter.toUpperCase();
                                                                        const isCertified = p.skills?.some(s => s.toUpperCase() === posKey);
                                                                        const score = p.trainingScores?.[posKey];

                                                                        if (isCertified) {
                                                                            return (
                                                                                <span title={`Certificado en ${positionFilter}`} className="ml-1.5 px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded border border-green-200 inline-block align-middle" style={{ lineHeight: '1' }}>
                                                                                    CERTIFICADO
                                                                                </span>
                                                                            );
                                                                        } else if (score && score > 0) {
                                                                            return (
                                                                                <span title={`En entrenamiento para ${positionFilter}: ${score}%`} className="ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded border border-amber-200 inline-block align-middle" style={{ lineHeight: '1' }}>
                                                                                    {score}%
                                                                                </span>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    })()}
                                                                </div>

                                                                {/* Fila de Info Compacta: Turno Anterior */}
                                                                {(() => {
                                                                    const dayIdx = weekdays.indexOf(selectedDay);
                                                                    let yesterdayShift = null;
                                                                    let yesterdayLabel = '';

                                                                    if (dayIdx === 0) {
                                                                        yesterdayShift = prevWeekSchedules[p.id]?.sunday;
                                                                        yesterdayLabel = 'Dom (Sem Ant)';
                                                                    } else {
                                                                        const yesterdayDay = weekdays[dayIdx - 1];
                                                                        yesterdayShift = schedules[p.id]?.[yesterdayDay];
                                                                        yesterdayLabel = weekdayLabels[yesterdayDay].slice(0, 3);
                                                                    }

                                                                    if (!yesterdayShift) return null;

                                                                    const shiftText = yesterdayShift.off ? 'Libre' : yesterdayShift.feriado ? 'Feriado' : `${yesterdayShift.start}-${yesterdayShift.end}`;

                                                                    return (
                                                                        <div className="flex items-center gap-1 mt-1">
                                                                            <span className="text-[9px] font-bold text-gray-400 uppercase">{yesterdayLabel}:</span>
                                                                            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${yesterdayShift.off ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-600'}`}>
                                                                                {shiftText}
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })()}
                                                                {isCeased && (
                                                                    <span className="text-xs text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded mt-1 inline-block">CESADO</span>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-1.5 flex-shrink-0 relative">
                                                                <div className="relative" ref={el => iconRefs.current[p.id] = el}>
                                                                    <FaInfoCircle
                                                                        className="text-blue-600 cursor-pointer hover:text-blue-800 transition flex-shrink-0"
                                                                        size={16}
                                                                        onMouseEnter={(e) => {
                                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                                            const tooltipHeight = 350;
                                                                            const tooltipWidth = 300;
                                                                            const viewportHeight = window.innerHeight;
                                                                            const viewportWidth = window.innerWidth;

                                                                            let top = rect.bottom + 8;
                                                                            if (rect.bottom + tooltipHeight + 8 > viewportHeight) {
                                                                                top = rect.top - tooltipHeight - 8;
                                                                            }

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
                                                                            setTimeout(() => {
                                                                                if (tooltipRef.current && !tooltipRef.current.matches(':hover')) {
                                                                                    setTooltipOpen(null);
                                                                                }
                                                                            }, 200);
                                                                        }}
                                                                    />
                                                                </div>

                                                                {!tieneDiaLibre && !isCeased && (
                                                                    <FaExclamationCircle
                                                                        title="No tiene día libre asignado esta semana"
                                                                        className="text-red-600 flex-shrink-0"
                                                                        size={16}
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* CONTENEDOR DE ALERTAS CONSOLIDADO */}
                                                        {(() => {
                                                            if (isCeased) return null;

                                                            const alerts = [];

                                                            // 1. Conflicto de Habilidades / Estudio (Original)
                                                            if (hasConflict) {
                                                                alerts.push({
                                                                    type: 'warning',
                                                                    text: formatConflictMessage(hasConflict),
                                                                    icon: <AlertCircle className="w-3 h-3" />
                                                                });
                                                            }

                                                            // 2. Conflicto de Descanso (Cierre -> Apertura)
                                                            const dayIdx = weekdays.indexOf(selectedDay);
                                                            let yesterdayShift = null;
                                                            if (dayIdx === 0) {
                                                                yesterdayShift = prevWeekSchedules[p.id]?.sunday;
                                                            } else {
                                                                yesterdayShift = schedules[p.id]?.[weekdays[dayIdx - 1]];
                                                            }

                                                            if (yesterdayShift && !yesterdayShift.off && !yesterdayShift.feriado && !d.off && !d.feriado && yesterdayShift.end && d.start) {
                                                                const prevEndMin = timeToMinutes(yesterdayShift.end);
                                                                const currStartMin = timeToMinutes(d.start);
                                                                let restMins = 0;
                                                                if (prevEndMin > timeToMinutes("12:00") && currStartMin < timeToMinutes("15:00")) {
                                                                    const actualPrevEnd = prevEndMin > 1440 ? prevEndMin - 1440 : prevEndMin;
                                                                    if (prevEndMin < 1440) {
                                                                        restMins = (1440 - prevEndMin) + currStartMin;
                                                                    } else {
                                                                        restMins = currStartMin - actualPrevEnd;
                                                                    }

                                                                    if (restMins < 660) {
                                                                        alerts.push({
                                                                            type: 'danger',
                                                                            text: 'Descanso Bajo (Cierre/Apertura)',
                                                                            icon: <Clock className="w-3 h-3" />,
                                                                            animate: true
                                                                        });
                                                                    }
                                                                }
                                                            }

                                                            if (alerts.length === 0) return null;

                                                            return (
                                                                <div className="mt-2 space-y-1">
                                                                    {alerts.map((alert, idx) => (
                                                                        <div
                                                                            key={idx}
                                                                            className={`text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-opacity-30 ${alert.type === 'danger'
                                                                                ? 'bg-red-50 text-red-700 border-red-200'
                                                                                : 'bg-orange-50 text-orange-800 border-orange-200'
                                                                                } ${alert.animate ? 'animate-pulse' : ''}`}
                                                                        >
                                                                            {alert.icon}
                                                                            <span className="font-bold">{alert.text}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="px-4 md:px-6 py-4 text-center md:sticky md:left-[280px] z-10 bg-white group-hover:bg-blue-50 min-w-[100px] max-w-[100px] md:min-w-[140px] md:max-w-[140px]">
                                                        {(() => {
                                                            const dateStr = getSelectedDateStr();
                                                            const effModality = getEffectiveModality(p, dateStr);
                                                            const isChangeDay = p.modalityChangeDate === dateStr;
                                                            return (
                                                                <div className="flex flex-col items-center">
                                                                    <span className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap inline-block ${effModality === "Full-Time"
                                                                        ? "bg-green-100 text-green-800 border border-green-200"
                                                                        : "bg-purple-100 text-purple-800 border border-purple-200"
                                                                        }`}>
                                                                        {effModality}
                                                                    </span>
                                                                    {isChangeDay && (
                                                                        <span className="text-[9px] font-bold text-blue-600 animate-pulse mt-1">
                                                                            🔄 CAMBIO HOY
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {isCeased ? <span className="text-gray-400 text-xs italic">--</span> : (
                                                            <input
                                                                type="time"
                                                                value={d.start || ''}
                                                                onChange={e => handleChange(p.id, 'start', e.target.value)}
                                                                disabled={d.feriado || d.off}
                                                                className={`w-full px-2 py-2 border-2 rounded-lg text-center text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${hasConflict 
                                                                    ? 'border-red-500 bg-red-100 text-red-900 animate-pulse ring-2 ring-red-200' 
                                                                    : 'border-gray-300'
                                                                    } disabled:bg-gray-100 disabled:cursor-not-allowed`}
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        {isCeased ? <span className="text-gray-400 text-xs italic">--</span> : (
                                                            <input
                                                                type="time"
                                                                value={d.end || ''}
                                                                onChange={e => handleChange(p.id, 'end', e.target.value)}
                                                                disabled={d.feriado || d.off}
                                                                className={`w-full px-2 py-2 border-2 rounded-lg text-center text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${hasConflict 
                                                                    ? 'border-red-500 bg-red-100 text-red-900 animate-pulse ring-2 ring-red-200' 
                                                                    : 'border-gray-300'
                                                                    } disabled:bg-gray-100 disabled:cursor-not-allowed`}
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-4 text-center">
                                                        {isCeased ? <span className="text-gray-400 text-xs italic">--</span> : (
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="12"
                                                                step="0.5"
                                                                value={d.extraHoursPre ?? ''}
                                                                onChange={e => handleChange(p.id, 'extraHoursPre', e.target.value)}
                                                                disabled={d.feriado || d.off}
                                                                placeholder="0"
                                                                className="w-16 px-2 py-2 border border-blue-200 bg-blue-50 rounded-lg text-center text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-4 text-center">
                                                        {isCeased ? <span className="text-gray-400 text-xs italic">--</span> : (
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="12"
                                                                step="0.5"
                                                                value={d.extraHoursPost ?? d.extraHours ?? ''}
                                                                onChange={e => handleChange(p.id, 'extraHoursPost', e.target.value)}
                                                                disabled={d.feriado || d.off}
                                                                placeholder="0"
                                                                className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-center text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                            />
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-center font-medium text-gray-700 text-sm">
                                                        {isCeased ? '--' : calculateDailyHours(d.start, d.end, d.extraHoursPre, (d.extraHoursPost ?? d.extraHours))}
                                                    </td>
                                                    <td className={`px-4 py-4 text-center font-semibold text-sm ${!horasEnRango && !isCeased ? 'text-red-600' : 'text-green-700'
                                                        }`}>
                                                        {isCeased ? '--' : (
                                                            <div className="flex items-center justify-center gap-1">
                                                                <Clock className="w-4 h-4" />
                                                                {horas.formatted}
                                                                {hasConflict && <AlertCircle className="w-4 h-4 text-orange-600" />}
                                                            </div>
                                                        )}
                                                    </td>

                                                    <td className="px-4 py-4 text-center">
                                                        {isCeased ? <span className="text-xs font-bold text-red-500 bg-red-100 px-2 py-1 rounded">CESADO</span> : (
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
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-4 text-center font-bold text-orange-600 text-sm">
                                                        {isCeased ? '--' : `${preCierres}/4`}
                                                    </td>
                                                    <td className="px-4 py-4 text-center font-bold text-red-600 text-sm">
                                                        {isCeased ? '--' : `${cierres}/4`}
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={d.off || false}
                                                            onChange={e => handleChange(p.id, 'off', e.target.checked)}
                                                            disabled={d.feriado || isCeased}
                                                            className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={d.feriado || false}
                                                            onChange={e => handleChange(p.id, 'feriado', e.target.checked)}
                                                            disabled={isCeased}
                                                            className="w-5 h-5 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-500 cursor-pointer disabled:opacity-50"
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

                                    {/* Solicitudes Aprobadas */}
                                    {(() => {
                                        const personRequests = approvedRequests.filter(r => r.staffId === person.id);
                                        if (personRequests.length === 0) return null;

                                        return (
                                            <div className="mt-3 pt-2 border-t border-gray-200">
                                                <strong className="block mb-1.5 text-[10px] font-bold text-orange-600 uppercase tracking-wider flex items-center gap-1">
                                                    <ClipboardList className="w-3 h-3" />
                                                    Solicitudes Aprobadas
                                                </strong>
                                                <div className="space-y-1.5">
                                                    {personRequests.map(req => (
                                                        <div key={req.id} className="bg-orange-50 border border-orange-100 rounded p-1.5 text-[10px]">
                                                            <div className="flex justify-between items-center mb-0.5">
                                                                <span className="font-bold text-orange-800">{weekdayLabels[req.date ? weekdays[new Date(req.date + 'T00:00:00').getDay() === 0 ? 6 : new Date(req.date + 'T00:00:00').getDay() - 1] : '']} {req.date?.split('-').reverse().slice(0, 2).join('/')}</span>
                                                                <span className="bg-orange-200 text-orange-900 px-1 rounded font-extrabold uppercase text-[8px]">{req.shiftType}</span>
                                                            </div>
                                                            {req.shiftType === 'rango' && (
                                                                <p className="text-orange-900 font-bold mb-0.5">{req.startTime} - {req.endTime}</p>
                                                            )}
                                                            <p className="text-gray-600 italic">"{req.reason}"</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}

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
                                        await exportGroupedPositionsPDF(activeStaff, currentSchedule, selectedDay, dateText, turnoPDF, positions);
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

                {showExportModal && (
                    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in duration-300">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-3 bg-blue-100 rounded-xl">
                                    <FileText className="w-6 h-6 text-blue-600" />
                                </div>
                                <h3 className="text-2xl font-bold text-gray-800">Opciones de Impresión</h3>
                            </div>

                            <p className="text-gray-600 mb-6 font-medium">
                                Selecciona las opciones para la exportación del horario semanal.
                            </p>

                            <div className="space-y-5 mb-8">
                                <label className={`flex items-start gap-4 p-5 border-2 rounded-2xl cursor-pointer transition-all ${exportOptions.excludeTrainees ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200 bg-gray-50'}`}>
                                    <input
                                        type="checkbox"
                                        className="w-6 h-6 mt-1 text-blue-600 rounded-lg border-gray-300 focus:ring-blue-500 cursor-pointer"
                                        checked={exportOptions.excludeTrainees}
                                        onChange={e => setExportOptions({ ...exportOptions, excludeTrainees: e.target.checked })}
                                    />
                                    <div className="select-none">
                                        <p className="font-extrabold text-gray-900 text-lg">Solo Personal de Tienda</p>
                                        <p className="text-sm text-gray-600 leading-relaxed font-medium">Excluye automáticamente a colaboradores en entrenamiento (Trainees).</p>
                                    </div>
                                </label>

                                <label className={`flex items-start gap-4 p-5 border-2 rounded-2xl cursor-pointer transition-all ${exportOptions.showPositions ? 'border-purple-500 bg-purple-50' : 'border-gray-100 hover:border-gray-200 bg-gray-50'}`}>
                                    <input
                                        type="checkbox"
                                        className="w-6 h-6 mt-1 text-purple-600 rounded-lg border-gray-300 focus:ring-purple-500 cursor-pointer"
                                        checked={exportOptions.showPositions}
                                        onChange={e => setExportOptions({ ...exportOptions, showPositions: e.target.checked })}
                                    />
                                    <div className="select-none">
                                        <p className="font-extrabold text-gray-900 text-lg">Incluir Posiciones</p>
                                        <p className="text-sm text-gray-600 leading-relaxed font-medium">Muestra el cargo/posición asignado debajo de cada turno.</p>
                                    </div>
                                </label>
                            </div>

                            <div className="flex gap-4">
                                <button
                                    onClick={() => setShowExportModal(false)}
                                    className="flex-1 px-4 py-3.5 border border-gray-300 rounded-xl text-gray-700 font-bold hover:bg-gray-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={() => {
                                        exportSchedulePDF(activeStaff, schedules, wk, exportOptions.excludeTrainees, exportOptions.showPositions);
                                        setShowExportModal(false);
                                    }}
                                    className="flex-1 px-4 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98] transition-all"
                                >
                                    Generar PDF
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Modal de Solicitudes Aprobadas */}
                {showApprovedRequestsModal && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fadeIn">
                            <div className="bg-gradient-to-r from-orange-500 to-orange-600 p-4 flex justify-between items-center text-white">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <ClipboardList className="w-5 h-5" />
                                    Solicitudes para esta Semana
                                </h3>
                                <button onClick={() => setShowApprovedRequestsModal(false)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="p-6 max-h-[70vh] overflow-y-auto">
                                {approvedRequests.length === 0 ? (
                                    <div className="text-center py-10 text-gray-400">
                                        <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
                                        <p>No hay solicitudes aprobadas para esta semana.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {approvedRequests.map(req => {
                                            const person = staff.find(s => s.id === req.staffId);
                                            return (
                                                <div key={req.id} className="border-2 border-gray-50 rounded-2xl p-4 hover:border-orange-100 transition-all flex items-start gap-4">
                                                    <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center shrink-0">
                                                        <Users className="w-5 h-5 text-orange-600" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <p className="font-bold text-gray-800">{person ? `${person.name} ${person.lastName}` : 'Cargando...'}</p>
                                                                <p className="text-xs text-gray-500 capitalize">{weekdayLabels[req.date ? weekdays[new Date(req.date + 'T00:00:00').getDay() === 0 ? 6 : new Date(req.date + 'T00:00:00').getDay() - 1] : 'monday']} {req.date?.split('-').reverse().join('/')}</p>
                                                            </div>
                                                            <span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full uppercase">APROBADA</span>
                                                        </div>
                                                        <p className="text-xs text-blue-600 font-bold mt-1 uppercase">
                                                            {req.shiftType === 'apertura' && 'Apertura'}
                                                            {req.shiftType === 'medio' && 'Medio'}
                                                            {req.shiftType === 'cierre' && 'Cierre'}
                                                            {req.shiftType === 'rango' && `Rango Especial (${req.startTime} - ${req.endTime})`}
                                                        </p>
                                                        <div className="mt-2 bg-gray-50 p-3 rounded-xl">
                                                            <p className="text-xs text-gray-600 italic leading-relaxed font-medium">"{req.reason}"</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="p-4 bg-gray-50 border-t flex justify-end">
                                <button
                                    onClick={() => setShowApprovedRequestsModal(false)}
                                    className="px-6 py-2 bg-white border border-gray-300 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-100 transition-all shadow-sm"
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}