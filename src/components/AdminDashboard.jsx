// AdminDashboard.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
    getWorkedHolidaysByUid,
    getNightHoursByUid,
} from "../services/scheduleService";
import { FaCheck, FaTimes, FaCalendarAlt, FaFilePdf, FaEdit, FaTrash, FaUnlink, FaLockOpen } from "react-icons/fa";
import {
    Users,
    Clock,
    Calendar,
    Search,
    Plus,
    RefreshCw,
    LogOut,
    Building2,
    UserCheck,
    AlertCircle,
    X,
    Download,
    Save,
    Award,
    BarChart3,
    Calculator,
    ClipboardCheck,
    CheckCircle2,
    XCircle,
    Pencil,
    Trash2,
    Unlink,
    Bell,
    ClipboardList,
    Upload
} from "lucide-react";
import {
    doc,
    updateDoc,
    deleteDoc,
    addDoc,
    collection,
    getDocs,
    query,
    where,
    getDoc,
    setDoc,
    onSnapshot,
    saveStaffCessation,
    finishStaffTraining,
    importGeoVictoriaStaffProfile
} from "../lib/supabase/firestoreCompat";
import { db } from "../supabase";
import StudyScheduleEditor from './StudyScheduleEditor';
import ModalSelectorDePosiciones from './ModalSelectorDePosiciones';
import StaffModal from './StaffModal';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import VHLConsultation from './VHLConsultation';
import ScheduleRequestsManager from './ScheduleRequestsManager';
import { isStaffActive } from './Training/staffStatus';
import { exportExtraHoursPDF, exportExtraHoursGroupedPDF } from "../services/exportExtraHoursPDF";
import GeoVictoriaUpload from './GeoVictoriaUpload';
import { isCurrentGeoVictoriaEpisode, isImportableGeoVictoriaState } from '../lib/supabase/geoVictoriaCompat';



import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const normalizeDni = (value) => String(value ?? '').trim().replace(/\.0+$/, '').replace(/\D/g, '').trim();
const limaToday = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const parseGeoVictoriaDate = (value) => {
    if (!value) return '';
    if (value instanceof Date && !isNaN(value.getTime())) {
        return value.toISOString().split('T')[0];
    }

    const text = String(value).trim();
    const match = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (!match) return '';

    const day = String(match[1]).padStart(2, '0');
    const month = String(match[2]).padStart(2, '0');
    let year = match[3];
    if (year.length === 2) year = `20${year}`;

    return `${year}-${month}-${day}`;
};

const readGeoVictoriaRows = (workbook) => {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: true });
};

const normalizeHeader = (value) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

const getRowValue = (row, labels) => {
    const targets = labels.map(normalizeHeader);
    const match = Object.keys(row || {}).find((key) => targets.includes(normalizeHeader(key)));
    return match ? row[match] : '';
};

const getRepeatedRowValue = (row, label, index = 0) => {
    const target = normalizeHeader(label);
    const matches = Object.keys(row || {}).filter((key) => {
        const normalized = normalizeHeader(key);
        return normalized === target || normalized.replace(/[._]\d+$/, '') === target;
    });
    const match = matches[index];
    return match ? row[match] : '';
};

const getRowValueWithFallback = (row, labels, fallbackKeys = []) => {
    const direct = getRowValue(row, labels);
    if (direct !== '') return direct;

    for (const key of fallbackKeys) {
        if (row && row[key] !== undefined && row[key] !== '') return row[key];
    }

    return '';
};

const parseActivationDate = (value) => {
    if (!value) return null;

    if (value instanceof Date && !isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }

    if (typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
    }

    const text = String(value).trim();
    const match = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]) - 1;
        const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
        const parsed = new Date(year, month, day);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    const fallback = new Date(text);
    return isNaN(fallback.getTime())
        ? null
        : new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
};

const formatDateInput = (date) => {
    if (!date || isNaN(date.getTime())) return '';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const parseGeoVictoriaTimeValue = (value) => {
    if (value === null || value === undefined || value === '') return '';

    if (value instanceof Date && !isNaN(value.getTime())) {
        return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    }

    if (typeof value === 'number') {
        const totalMinutes = Math.round(((value % 1) + Number.EPSILON) * 24 * 60);
        return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
    }

    const match = String(value).trim().match(/(\d{1,2}):(\d{2})/);
    if (!match) return '';
    return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
};

const parseGeoVictoriaDurationMinutes = (value) => {
    if (value === null || value === undefined || value === '') return 0;

    if (typeof value === 'number') {
        return Math.max(0, Math.round(value * 24 * 60));
    }

    if (value instanceof Date && !isNaN(value.getTime())) {
        return Math.max(0, value.getHours() * 60 + value.getMinutes());
    }

    const text = String(value).trim().toLowerCase().replace(',', '.');
    if (!text || text === '0') return 0;

    const daysMatch = text.match(/(\d+)\s*days?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (daysMatch) {
        return (Number(daysMatch[1]) * 24 * 60) + (Number(daysMatch[2]) * 60) + Number(daysMatch[3]);
    }

    const clockMatch = text.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
    if (clockMatch) {
        return (Number(clockMatch[1]) * 60) + Number(clockMatch[2]);
    }

    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
    const minuteMatch = text.match(/(\d+)\s*m/);
    if (hourMatch || minuteMatch) {
        return Math.round((hourMatch ? Number(hourMatch[1]) * 60 : 0) + (minuteMatch ? Number(minuteMatch[1]) : 0));
    }

    const numeric = Number(text);
    if (!isNaN(numeric)) {
        return Math.max(0, Math.round((numeric <= 1 ? numeric * 24 : numeric) * 60));
    }

    return 0;
};

const parseTurnoRange = (value) => {
    const matches = String(value || '').match(/\d{1,2}:\d{2}/g) || [];
    return {
        scheduledStart: parseGeoVictoriaTimeValue(matches[0] || ''),
        scheduledEnd: parseGeoVictoriaTimeValue(matches[1] || ''),
    };
};

const formatDurationMinutes = (minutes) => {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return `${hours}h ${mins}m`;
};

const minutesToHours = (minutes) => Math.round(((Number(minutes) || 0) / 60) * 100) / 100;

const getExtraRecordMinutes = (record) => {
    if (record?.totalExtraMinutes !== undefined) return Number(record.totalExtraMinutes) || 0;
    if (record?.durationMinutes !== undefined) return Number(record.durationMinutes) || 0;
    return parseGeoVictoriaDurationMinutes(record?.duracion);
};

const geoVictoriaDayNames = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

const getGeoVictoriaDayLabel = (dateString) => {
    if (!dateString) return '';
    const date = new Date(`${dateString}T00:00:00`);
    if (isNaN(date.getTime())) return dateString;
    const day = geoVictoriaDayNames[date.getDay()];
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${day} ${dd}/${mm}`;
};

const getClosedWeekKey = (dateString) => {
    const date = new Date(`${dateString}T00:00:00`);
    if (isNaN(date.getTime())) return '';
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(date);
    monday.setDate(date.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return `${formatDateInput(monday)}_to_${formatDateInput(sunday)}`;
};

const addMinutesToTime = (time, minutes) => {
    const match = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return time || '';
    const base = Number(match[1]) * 60 + Number(match[2]);
    const total = base + Math.round(Number(minutes) || 0);
    const normalized = ((total % 1440) + 1440) % 1440;
    return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

const getShiftWithGeoVictoriaExtras = (detail) => {
    const baseStart = detail?.scheduledStart || detail?.entrada || '';
    const baseEnd = detail?.scheduledEnd || detail?.salida || '';
    const start = detail?.extraMinutesPre > 0 ? addMinutesToTime(baseStart, -detail.extraMinutesPre) : baseStart;
    const end = detail?.extraMinutesPost > 0 ? addMinutesToTime(baseEnd, detail.extraMinutesPost) : baseEnd;
    if (!start && !end) return detail?.turno || '';
    return `${start || '--'} - ${end || '--'}`;
};

const formatHrDate = (date) =>
    date ? date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

const getTenure = (startDate, endDate = new Date()) => {
    if (!startDate || isNaN(startDate.getTime())) return null;

    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    if (start > end) {
        return { months: 0, days: 0, totalDays: 0, label: 'Fecha futura', bucket: 'Sin rango' };
    }

    let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    let days = end.getDate() - start.getDate();

    if (days < 0) {
        months -= 1;
        days += new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    }

    const totalDays = Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
    const monthLabel = `${months} ${months === 1 ? 'mes' : 'meses'}`;
    const dayLabel = `${days} ${days === 1 ? 'dia' : 'dias'}`;
    const bucket = getTenureBucket(totalDays);

    return {
        months,
        days,
        totalDays,
        bucket,
        label: months > 0 ? `${monthLabel} con ${dayLabel}` : dayLabel,
    };
};

const getTenureBucket = (totalDays) => {
    const monthsApprox = totalDays / 30.4375;
    if (monthsApprox < 1) return 'Menos de 1 mes';
    if (monthsApprox < 4) return '1 a 3 meses';
    if (monthsApprox < 7) return '4 a 7 meses';
    if (monthsApprox < 10) return '7 a 10 meses';
    return '10 a mas';
};

const hrTenureBuckets = ['1 a 3 meses', '4 a 7 meses', '7 a 10 meses', '10 a mas'];

const isHrManagementRole = (...values) => {
    const text = normalizeHeader(values.filter(Boolean).join(' '));
    if (!text) return false;

    return [
        'jefe de tienda',
        'jefa de tienda',
        'gerente de tienda',
        'gerente de tiendas',
        'gerente tiendas',
        'store manager',
    ].some((term) => text.includes(term)) || text === 'gerente';
};

function AdminDashboard() {
    const { logout, currentUser, userRole, userData } = useAuth();
    const navigate = useNavigate();
    const [staff, setStaff] = useState([]);
    const [fullTimeCount, setFullTimeCount] = useState(0);
    const [partTimeCount, setPartTimeCount] = useState(0);
    const [traineeCount, setTraineeCount] = useState(0);
    const [traineeFTCount, setTraineeFTCount] = useState(0);
    const [traineePTCount, setTraineePTCount] = useState(0);
    const [editModal, setEditModal] = useState(null);
    const [modalityFilter, setModalityFilter] = useState("Todos");
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [storeName, setStoreName] = useState("");
    const [showScheduleEditor, setShowScheduleEditor] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState(null);
    const [selectedHolidays, setSelectedHolidays] = useState([]);
    const [showHolidayModal, setShowHolidayModal] = useState(false);
    const [positionList, setPositionList] = useState([]);
    const [positionModalOpen, setPositionModalOpen] = useState(false);
    const [positionTarget, setPositionTarget] = useState(null);
    const [tempAbilities, setTempAbilities] = useState([]);
    const [showCesadosModal, setShowCesadosModal] = useState(false);
    const [cesosRegistros, setCesosRegistros] = useState([]);
    const [cesosFilterMonth, setCesosFilterMonth] = useState('');
    const [cesosLoading, setCesosLoading] = useState(false);
    const [showTrainingReport, setShowTrainingReport] = useState(false);
    const [storeRequirements, setStoreRequirements] = useState([]);
    const [reporteBajaColaborador, setReporteBajaColaborador] = useState(null);
    const [reporteBajaForm, setReporteBajaForm] = useState({
        desempenio: 'BUENO',
        motivoCese: 'RENUNCIA VOLUNTARIA',
        motivoReal: 'MEJORA ECONÓMICA',
        comentario: '',
        diasDescansoMedico: '',
        inasistencias: '',
        tardanzas: '',
        horasNocturnas: '',
        horasExtras: '',
        feriados: '',
        descuentos: '',
    });
    const [lockSettings, setLockSettings] = useState({
        restrictionsEnabled: false,
        reenableDate: ''
    });
    const [showVHLModal, setShowVHLModal] = useState(false);
    const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
    const [showRequestsModal, setShowRequestsModal] = useState(false);
    const [showHRPanel, setShowHRPanel] = useState(false);
    const geoVictoriaInputRef = useRef(null);
    const hrAnalysisInputRef = useRef(null);
    const geoVictoriaExtraInputRef = useRef(null);
    const geoVictoriaLateInputRef = useRef(null);
    const [geoVictoriaImporting, setGeoVictoriaImporting] = useState(false);
    const [geoVictoriaImportResult, setGeoVictoriaImportResult] = useState(null);
    const [hrAnalysisLoading, setHrAnalysisLoading] = useState(false);
    const [hrAnalysisError, setHrAnalysisError] = useState('');
    const [hrTimeAnalysis, setHrTimeAnalysis] = useState(null);
    const [geoVictoriaExtraImporting, setGeoVictoriaExtraImporting] = useState(false);
    const [geoVictoriaLateImporting, setGeoVictoriaLateImporting] = useState(false);
    const [geoVictoriaExtraImportResult, setGeoVictoriaExtraImportResult] = useState(null);
    const [geoVictoriaExtraRecords, setGeoVictoriaExtraRecords] = useState([]);
    const [geoVictoriaExtraLoading, setGeoVictoriaExtraLoading] = useState(false);
    const [geoVictoriaExtraDateFrom, setGeoVictoriaExtraDateFrom] = useState('');
    const [geoVictoriaExtraDateTo, setGeoVictoriaExtraDateTo] = useState('');
    const [geoVictoriaExtraStaffFilter, setGeoVictoriaExtraStaffFilter] = useState('');
    const [geoVictoriaTurnoMap, setGeoVictoriaTurnoMap] = useState({});
    const [geoVictoriaTurnoMeta, setGeoVictoriaTurnoMeta] = useState(null);
    const [geoVictoriaTurnoSaving, setGeoVictoriaTurnoSaving] = useState(false);

    const skillStats = useMemo(() => {
        const stats = {};
        const activeStaff = staff.filter(person => isStaffActive(person));

        const totalActive = activeStaff.length || 1;

        activeStaff.forEach(s => {
            const abilities = s.skills || [];
            abilities.forEach(skill => {
                if (skill) {
                    stats[skill] = (stats[skill] || 0) + 1;
                }
            });
        });

        return Object.entries(stats)
            .map(([name, count]) => ({
                name,
                count,
                percentage: Math.round((count / totalActive) * 100)
            }))
            .sort((a, b) => b.percentage - a.percentage);
    }, [staff]);

    const geoVictoriaExtraFilteredRecords = useMemo(() => {
        return geoVictoriaExtraRecords.filter((record) => {
            const recordStart = record.periodStart || record.fecha || '';
            const recordEnd = record.periodEnd || record.fecha || recordStart;
            if (geoVictoriaExtraDateFrom && recordEnd < geoVictoriaExtraDateFrom) return false;
            if (geoVictoriaExtraDateTo && recordStart > geoVictoriaExtraDateTo) return false;
            if (geoVictoriaExtraStaffFilter) {
                const key = record.staffId || record.uid || record.dni;
                if (key !== geoVictoriaExtraStaffFilter) return false;
            }
            return true;
        });
    }, [geoVictoriaExtraRecords, geoVictoriaExtraDateFrom, geoVictoriaExtraDateTo, geoVictoriaExtraStaffFilter]);

    const geoVictoriaExtraTotals = useMemo(() => {
        const collaboratorKeys = new Set();
        return geoVictoriaExtraFilteredRecords.reduce((acc, record) => {
            collaboratorKeys.add(record.staffId || record.uid || record.dni);
            acc.records += 1;
            acc.preMinutes += Number(record.extraMinutesPre) || 0;
            acc.postMinutes += Number(record.extraMinutesPost) || 0;
            acc.totalMinutes += getExtraRecordMinutes(record);
            acc.collaborators = collaboratorKeys.size;
            return acc;
        }, { records: 0, collaborators: 0, preMinutes: 0, postMinutes: 0, totalMinutes: 0 });
    }, [geoVictoriaExtraFilteredRecords]);

    const geoVictoriaExtraCollaborators = useMemo(() => {
        const options = new Map();
        geoVictoriaExtraRecords.forEach((record) => {
            const key = record.staffId || record.uid || record.dni;
            if (!key || options.has(key)) return;
            options.set(key, {
                key,
                label: `${record.name || ''} ${record.lastName || ''}`.trim() || record.dni || 'Sin nombre',
                dni: record.dni || '',
            });
        });
        return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
    }, [geoVictoriaExtraRecords]);

    const fetchScheduleLock = async () => {
        if (!userData?.storeId) return;
        try {
            const docRef = doc(db, "stores", userData.storeId, "config", "schedule_lock");
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                setLockSettings(snap.data());
            }
        } catch (err) {
            console.error("Error al cargar configuración de bloqueo:", err);
        }
    };

    const fetchGeoVictoriaTurnos = async () => {
        if (!userData?.storeId) return;
        try {
            const docRef = doc(db, "stores", userData.storeId, "config", "geovictoria_turnos");
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                setGeoVictoriaTurnoMap(data.turnoMap || {});
                setGeoVictoriaTurnoMeta({
                    fileName: data.fileName || '',
                    count: data.count || Object.keys(data.turnoMap || {}).length,
                    updatedAt: data.updatedAt || '',
                });
            } else {
                setGeoVictoriaTurnoMap({});
                setGeoVictoriaTurnoMeta(null);
            }
        } catch (err) {
            console.error("Error al cargar turnos GeoVictoria:", err);
        }
    };

    const handleGeoVictoriaTurnosLoaded = async (turnoMap, file) => {
        if (!userData?.storeId) {
            alert('No se pudo identificar la tienda.');
            return;
        }

        setGeoVictoriaTurnoSaving(true);
        try {
            const payload = {
                turnoMap,
                count: Object.keys(turnoMap).length,
                fileName: file?.name || '',
                updatedAt: new Date().toISOString(),
                storeId: userData.storeId,
            };

            await setDoc(doc(db, "stores", userData.storeId, "config", "geovictoria_turnos"), payload);
            setGeoVictoriaTurnoMap(turnoMap);
            setGeoVictoriaTurnoMeta({
                fileName: payload.fileName,
                count: payload.count,
                updatedAt: payload.updatedAt,
            });
        } catch (err) {
            console.error("Error guardando turnos GeoVictoria:", err);
            alert('No se pudo guardar el archivo de turnos GeoVictoria.');
        } finally {
            setGeoVictoriaTurnoSaving(false);
        }
    };

    const handleUpdateLock = async (newSettings) => {
        if (!userData?.storeId) return;
        try {
            const docRef = doc(db, "stores", userData.storeId, "config", "schedule_lock");
            await setDoc(docRef, newSettings);
            setLockSettings(newSettings);
            alert("Configuración de bloqueo actualizada.");
        } catch (err) {
            console.error("Error al guardar bloqueo:", err);
            alert("Error al guardar configuración.");
        }
    };

    const fetchStoreRequirements = async () => {
        if (!userData?.storeId) return;
        try {
            const q = query(collection(db, "stores", userData.storeId, "positioning_requirements"));
            const snap = await getDocs(q);

            const positionSet = new Set();
            snap.docs.forEach(d => {
                const data = d.data();
                if (data.positions && Array.isArray(data.positions)) {
                    data.positions.forEach(pos => positionSet.add(pos));
                }
            });

            setStoreRequirements(Array.from(positionSet).sort());
        } catch (e) {
            console.error("Error al obtener requerimientos:", e);
        }
    };

    const isCardExpiringSoon = (dateString) => {
        if (!dateString) return false;
        const now = new Date();
        const expiry = new Date(dateString);
        const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);
        return diffDays <= 15;
    };

    const isActiveInSystem = (person) => {
        return isStaffActive(person);
    };

    const openPositionModal = (colab) => {
        setPositionTarget(colab);
        setTempAbilities(colab.positionAbilities || []);
        setPositionModalOpen(true);
    };

    const savePositionAbilities = async () => {
        if (!positionTarget?.id) return;
        try {
            await updateDoc(doc(db, "staff_profiles", positionTarget.id), {
                positionAbilities: tempAbilities,
            });
            setPositionModalOpen(false);
            setPositionTarget(null);
            await fetchAllStaffProfiles();
        } catch (error) {
            console.error("Error actualizando habilidades:", error);
        }
    };

    const fetchAllPositions = async () => {
        const snapshot = await getDocs(collection(db, "positioning_requirements"));
        const positions = new Set();
        snapshot.forEach(doc => {
            const posList = doc.data().positions || [];
            posList.forEach(pos => positions.add(pos));
        });
        setPositionList(Array.from(positions));
    };


    const exportCarnetExpiringPDF = () => {
        const doc = new jsPDF();
        doc.text("Colaboradores con carnet de sanidad próximo a vencer", 14, 14);

        const filtered = staff.filter(s => isActiveInSystem(s) && isCardExpiringSoon(s.sanitaryCardDate));
        if (filtered.length === 0) {
            doc.text("No hay colaboradores con carnet próximo a vencer.", 14, 30);
        } else {
            const rows = filtered.map(s => [
                s.name + " " + s.lastName,
                (() => {
                    const [y, m, d] = s.sanitaryCardDate.split("-");
                    return `${d}/${m}/${y}`;
                })()
            ]);

            autoTable(doc, {
                head: [["Nombre", "Fecha de Vencimiento"]],
                body: rows,
                startY: 20
            });
        }

        doc.save("carnets_por_vencer.pdf");
    };


    const handleUnlinkEmail = async (staffId) => {
        void staffId;
        alert('El vínculo de cuenta se conserva para proteger el historial. Registra un cese y usa el flujo de reingreso verificado si el colaborador vuelve.');
    };
    const fetchStoreName = async () => {
        if (!userData?.storeId) return;
        try {
            const docRef = doc(db, "stores", userData.storeId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setStoreName(docSnap.data().name || "Tienda sin nombre");
            } else {
                setStoreName("Tienda no encontrada");
            }
        } catch (err) {
            console.error("Error al obtener nombre de tienda:", err);
            setStoreName("Error al cargar tienda");
        }
    };
    const handleViewHolidays = async (colab) => {
        let feriados = [];
        try {
            // Buscar en la colección de feriados filtrando por staffId Y storeId (obligatorio por reglas)
            const q = query(
                collection(db, 'feriados_trabajados'),
                where('staffId', '==', colab.id),
                where('storeId', '==', userData.storeId)
            );
            const snap = await getDocs(q);
            feriados = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Agregar feriados pendientes del perfil si los hay
            const pending = colab.pendingHolidays || [];
            const mappedPending = pending.map(p => {
                if (typeof p === 'string') {
                    return { date: p, type: 'ganado', isPending: true, name: 'Feriado Pendiente' };
                }
                return { ...p, type: 'ganado', isPending: true, name: p.name || 'Feriado Pendiente' };
            });

            feriados = [...feriados, ...mappedPending].sort((a, b) => {
                const dateA = new Date(a.date || 0);
                const dateB = new Date(b.date || 0);
                return dateB - dateA;
            });

            setSelectedHolidays(feriados);
            setSelectedStaff(colab);
            setShowHolidayModal(true);
        } catch (error) {
            console.error("Error obteniendo feriados:", error);
        }
    };

    const fetchAllStaffProfiles = async () => {
        fetchAllPositions();
        setLoading(true);
        setError(null);

        try {
            if (!userData?.storeId) {
                setError("No se encontró el ID de la tienda.");
                setLoading(false);
                return;
            }

            // 1. Cargar todos los perfiles de la tienda
            const profilesQuery = query(collection(db, 'staff_profiles'), where('storeId', '==', userData.storeId));
            const profilesSnap = await getDocs(profilesQuery);
            const profiles = profilesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 2. Cargar study_schedules solo para los perfiles encontrados (evita listado masivo)
            const studyMap = {};
            const uids = profiles.map(p => p.uid).filter(uid => !!uid);

            if (uids.length > 0) {
                // Dividir en grupos de 10 para mantener consultas pequeñas.
                for (let i = 0; i < uids.length; i += 10) {
                    const chunk = uids.slice(i, i + 10);
                    const q = query(collection(db, 'study_schedules'), where('__name__', 'in', chunk));
                    const snap = await getDocs(q);
                    snap.forEach(doc => {
                        studyMap[doc.id] = doc.data();
                    });
                }
            }

            // 3. Cargar balance de feriados de la tienda
            const holidaysQuery = query(collection(db, 'feriados_trabajados'), where('storeId', '==', userData.storeId));
            const hSnap = await getDocs(holidaysQuery);
            const holidayBalances = {};
            hSnap.forEach(hDoc => {
                const hData = hDoc.data();
                if (!holidayBalances[hData.staffId]) holidayBalances[hData.staffId] = 0;
                holidayBalances[hData.staffId] += (hData.type === 'compensado' ? -1 : 1);
            });

            // 4. Enriquecer perfiles y procesar cambios de modalidad programados que ya se cumplieron
            const todayStr = new Date().toISOString().split('T')[0];
            const updatesExec = [];

            const enriched = profiles.map(profile => {
                let currentProfile = { ...profile };

                // Si hoy es igual o mayor a la fecha de cambio programada
                if (profile.modalityChangeDate && profile.modalityChangeDate <= todayStr && profile.nextModality) {
                    const newModality = profile.nextModality;
                    const changeDate = profile.modalityChangeDate;

                    // Ejecutar el cambio de forma permanente en el objeto local
                    currentProfile.modality = newModality;
                    currentProfile.joinDate = changeDate; // El inicio de labores es la fecha del cambio
                    currentProfile.modalityChangeDate = '';
                    currentProfile.nextModality = '';
                    currentProfile.feriados = 0;
                    currentProfile.pendingHolidays = [];

                    // Programar actualización en Supabase.
                    updatesExec.push(updateDoc(doc(db, 'staff_profiles', profile.id), {
                        modality: newModality,
                        joinDate: changeDate,
                        modalityChangeDate: '',
                        nextModality: '',
                        feriados: 0,
                        pendingHolidays: []
                    }));
                }

                return {
                    ...currentProfile,
                    study_schedule: studyMap[profile.uid] || {},
                    feriados: (currentProfile.feriados || 0) + (currentProfile.pendingHolidays?.length || 0),
                };
            });

            if (updatesExec.length > 0) {
                await Promise.all(updatesExec);
                console.log(`Se ejecutaron ${updatesExec.length} cambios de modalidad programados.`);
            }

            setStaff(enriched);

            // Un colaborador se considera activo si NO tiene fecha de cese,
            // o si su fecha de cese es HOY o en el futuro (se resta a partir del día siguiente).
            const activePlantilla = enriched.filter(u => !u.isTrainee && isStaffActive(u));
            const activeTrainees = enriched.filter(u => u.isTrainee && isStaffActive(u));

            setFullTimeCount(activePlantilla.filter(u => u.modality === "Full-Time").length);
            setPartTimeCount(activePlantilla.filter(u => u.modality === "Part-Time").length);
            setTraineeCount(activeTrainees.length);
            setTraineeFTCount(activeTrainees.filter(u => u.modality === "Full-Time").length);
            setTraineePTCount(activeTrainees.filter(u => u.modality === "Part-Time").length);

        } catch (error) {
            console.error("Error:", error);
            setError(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        if (userData?.storeId) {
            console.log("userData cambiado, actualizando perfiles");
            fetchStoreName();
            fetchAllStaffProfiles();
            fetchScheduleLock();
            fetchStoreRequirements();
            fetchGeoVictoriaTurnos();

            // Notify listener for pending requests
            const q = query(
                collection(db, 'schedule_requests'),
                where('storeId', '==', userData.storeId),
                where('status', '==', 'pending')
            );
            const unsub = onSnapshot(q, (snap) => {
                setPendingRequestsCount(snap.size);
            });
            return () => unsub();
        }
    }, [userData]);




    const handleLogout = async () => {
        try {
            console.log("Intentando cerrar sesión...");
            await logout();
            console.log("Logout exitoso");
            navigate("/login");
        } catch (error) {
            console.error("Error al cerrar sesión:", error);
            alert("Error al cerrar sesión: " + error.message);
        }
    };


    const handleAddStaff = () => {
        setEditModal({
            name: '',
            lastName: '',
            modality: 'Full-Time',
            isNew: true,
            position: 'COLABORADOR',
            storeId: userData?.storeId || '',
            sanitaryCardDate: '', // <-- Nuevo campo
        });
    };

    const handleGeoVictoriaImport = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!userData?.storeId) {
            alert("No se pudo identificar la tienda para importar usuarios.");
            event.target.value = '';
            return;
        }

        setGeoVictoriaImporting(true);
        setGeoVictoriaImportResult(null);

        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
            const rows = readGeoVictoriaRows(workbook);

            const existingByDni = new Map();
            const today = limaToday();
            staff.forEach((person) => {
                const dni = normalizeDni(person.dni);
                if (dni && isCurrentGeoVictoriaEpisode(person, today)) existingByDni.set(dni, person);
            });

            const seenInFile = new Set();
            const created = [];
            let existingCount = 0;
            let skippedCount = 0;

            for (const row of rows) {
                if (!isImportableGeoVictoriaState(row.Estado)) {
                    skippedCount++;
                    continue;
                }

                const dni = normalizeDni(row.Identificador);
                if (!dni || seenInFile.has(dni)) {
                    skippedCount++;
                    continue;
                }
                seenInFile.add(dni);

                if (existingByDni.has(dni)) {
                    existingCount++;
                    continue;
                }

                const name = String(row.Nombre || '').trim();
                const lastName = String(row.Apellidos || '').trim();
                if (!name || !lastName) {
                    skippedCount++;
                    continue;
                }

                const payload = {
                    name,
                    lastName,
                    dni,
                    email: String(row.Email || '').trim(),
                    modality: '',
                    position: 'COLABORADOR',
                    storeId: userData.storeId,
                    storeName: storeName || '',
                    joinDate: parseGeoVictoriaDate(row['Fecha inicio contrato']),
                    sanitaryCardDate: '',
                    sanitaryCardUnlock: false,
                    isTrainee: false,
                    importedFrom: 'geovictoria',
                    importedAt: new Date().toISOString(),
                    sourceFile: file.name,
                    needsCompletion: true,
                    status: 'pending',
                };

                const imported = await importGeoVictoriaStaffProfile(payload, file.name);
                const newStaff = { id: imported.id, ...payload };
                if (imported.created) created.push(newStaff);
                else existingCount++;
                existingByDni.set(dni, newStaff);
            }

            setGeoVictoriaImportResult({
                created,
                existingCount,
                skippedCount,
                fileName: file.name,
            });

            if (created.length > 0) {
                alert(`Se agregaron ${created.length} ingresos nuevos desde Geovictoria. Revisa la notificación para completar modalidad y carnet.`);
            } else {
                alert(`No se encontraron ingresos nuevos. ${existingCount} usuarios ya existían por DNI.`);
            }

            await fetchAllStaffProfiles();
        } catch (err) {
            console.error("Error importando usuarios de Geovictoria:", err);
            alert(`No se pudo procesar el Excel de Geovictoria: ${err.message}`);
        } finally {
            setGeoVictoriaImporting(false);
            event.target.value = '';
        }
    };

    const isStaffActiveForHr = (person) => {
        return isStaffActive(person);
    };

    const getGeoVictoriaExtraPeriodLabel = (record) => {
        if (record?.periodStart && record?.periodEnd) {
            return `${record.periodStart} a ${record.periodEnd}`;
        }
        return record?.fecha || '';
    };

    const getGeoVictoriaExtraStaffProfile = (record) => {
        const recordDni = normalizeDni(record?.dni);
        return staff.find((person) =>
            person.id === record?.staffId
            || person.uid === record?.uid
            || (recordDni && normalizeDni(person.dni) === recordDni)
        ) || {};
    };

    const buildGeoVictoriaExtraPdfData = (record) => {
        const profile = getGeoVictoriaExtraStaffProfile(record);
        const totalMinutes = getExtraRecordMinutes(record);
        const periodLabel = getGeoVictoriaExtraPeriodLabel(record);
        const activityParts = [];
        if ((Number(record.extraMinutesPre) || 0) > 0) {
            activityParts.push(`Entrada: ${formatDurationMinutes(record.extraMinutesPre)}`);
        }
        if ((Number(record.extraMinutesPost) || 0) > 0) {
            activityParts.push(`Salida: ${formatDurationMinutes(record.extraMinutesPost)}`);
        }

        return {
            name: record.name || profile.name || '',
            lastName: record.lastName || profile.lastName || '',
            dni: record.dni || profile.dni || '',
            cargo: record.cargo || record.position || profile.cargo || profile.position || '',
            modality: record.modality || profile.modality || '',
            storeName: record.storeName || profile.storeName || storeName || '',
            periodLabel,
            fileName: `Horas_Extras_${normalizeDni(record.dni) || record.staffId || 'colaborador'}_${(record.periodStart || record.fecha || '').replaceAll('-', '')}.pdf`,
            registros: [{
                fecha: periodLabel,
                fechaLabel: periodLabel,
                inicio: record.entrada || record.inicio || '',
                fin: record.salida || record.fin || '',
                duracion: formatDurationMinutes(totalMinutes),
                totalExtraMinutes: totalMinutes,
                durationMinutes: totalMinutes,
                actividad: record.actividad || `Tiempo extra GeoVictoria (${activityParts.join(' | ')})`,
            }],
        };
    };

    const handleExportGeoVictoriaExtraPDF = async (record) => {
        await exportExtraHoursPDF(buildGeoVictoriaExtraPdfData(record));
    };

    const handleExportGeoVictoriaExtraFilteredPDF = async () => {
        if (geoVictoriaExtraFilteredRecords.length === 0) {
            alert('No hay registros para descargar con los filtros seleccionados.');
            return;
        }

        const datePart = new Date().toLocaleDateString('es-PE').replace(/\//g, '.');
        const detailDates = geoVictoriaExtraFilteredRecords
            .flatMap((record) => (record.dailyDetails || []).map((detail) => detail.fecha).filter(Boolean));
        const periodStart = (geoVictoriaExtraDateFrom || detailDates.sort()[0]) || geoVictoriaExtraFilteredRecords
            .map((record) => record.periodStart || record.fecha)
            .filter(Boolean)
            .sort()[0] || geoVictoriaExtraDateFrom || '';
        const periodEnd = (geoVictoriaExtraDateTo || detailDates.sort().slice(-1)[0]) || geoVictoriaExtraFilteredRecords
            .map((record) => record.periodEnd || record.fecha)
            .filter(Boolean)
            .sort()
            .slice(-1)[0] || geoVictoriaExtraDateTo || '';
        const periodLabel = periodStart && periodEnd ? `${periodStart}_to_${periodEnd}` : 'GeoVictoria';

        const groupedRows = geoVictoriaExtraFilteredRecords.flatMap((record) => {
            const profile = getGeoVictoriaExtraStaffProfile(record);
            const baseName = `${record.name || profile.name || ''} ${record.lastName || profile.lastName || ''}`.trim();
            const modality = record.modality || profile.modality || '';
            const details = Array.isArray(record.dailyDetails) ? record.dailyDetails : [];

            return details
                .filter((detail) => {
                    const fecha = detail.fecha || record.fecha || '';
                    if (geoVictoriaExtraDateFrom && fecha < geoVictoriaExtraDateFrom) return false;
                    if (geoVictoriaExtraDateTo && fecha > geoVictoriaExtraDateTo) return false;
                    return (Number(detail.totalExtraMinutes) || 0) > 0;
                })
                .map((detail) => ({
                    name: baseName,
                    modality,
                    day: detail.day || getGeoVictoriaDayLabel(detail.fecha),
                    shift: getShiftWithGeoVictoriaExtras(detail),
                    extraMinutes: Number(detail.totalExtraMinutes) || 0,
                    weekKey: periodLabel,
                    sortKey: `${detail.fecha || record.fecha || ''}_${baseName}`,
                }));
        }).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

        if (groupedRows.length === 0) {
            alert('No hay detalle diario de horas extra para el rango seleccionado. Vuelve a subir el Excel de GeoVictoria para guardar el detalle por dia.');
            return;
        }

        await exportExtraHoursGroupedPDF(groupedRows, {
            weekKey: periodLabel,
            fileName: `Reporte_Extras_${periodLabel}_GeoVictoria_${datePart}.pdf`,
        });
    };

    const handleGeoVictoriaLateUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setGeoVictoriaLateImporting(true);
        try {
            const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
            const rows = readGeoVictoriaRows(workbook);
            const reportRows = rows.filter((row) => {
                const justifiedBy = String(getRowValue(row, ['Justificado por']) || '').trim();
                return !justifiedBy;
            }).map((row) => {
                const dni = normalizeDni(getRowValue(row, ['DNI', 'Identificador']));
                const profile = staff.find((person) => normalizeDni(person.dni) === dni) || {};
                const rawDate = getRowValue(row, ['Fecha']);
                const parsedDate = parseActivationDate(rawDate);
                const date = parsedDate ? formatDateInput(parsedDate) : parseGeoVictoriaDate(rawDate);
                const scheduledStart = parseGeoVictoriaTimeValue(getRowValue(row, ['Hora Inicio Turno']));
                const arrival = parseGeoVictoriaTimeValue(getRowValue(row, ['Hora Llegada']));
                const lateMinutes = parseGeoVictoriaDurationMinutes(getRowValue(row, ['Minutos de Atraso']));

                return {
                    name: `${getRowValue(row, ['Nombre'])} ${getRowValue(row, ['Apellidos'])}`.trim(),
                    modality: profile.modality || (String(getRowValue(row, ['Grupo Usuario', 'Grupo marcacion'])).toUpperCase().includes('ENTRENADOR') ? 'Full-Time' : 'Part-Time'),
                    day: getGeoVictoriaDayLabel(date),
                    shift: `${scheduledStart || '--'} - ${arrival || '--'}`,
                    extraMinutes: lateMinutes,
                    sortKey: `${date}_${getRowValue(row, ['Apellidos'])}_${getRowValue(row, ['Nombre'])}`,
                    date,
                };
            }).filter((row) => row.name && row.date && row.extraMinutes > 0);

            if (reportRows.length === 0) {
                alert('El archivo no contiene minutos de atraso válidos.');
                return;
            }

            reportRows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
            const dates = reportRows.map((row) => row.date).sort();
            const periodLabel = `${dates[0]}_to_${dates[dates.length - 1]}`;
            reportRows.forEach((row) => { row.weekKey = periodLabel; });
            const datePart = new Date().toLocaleDateString('es-PE').replace(/\//g, '.');

            await exportExtraHoursGroupedPDF(reportRows, {
                weekKey: periodLabel,
                fileName: `Reporte_Tardanzas_${periodLabel}_GeoVictoria_${datePart}.pdf`,
                reportTitle: 'REPORTE DE TARDANZAS',
                periodCaption: 'Periodo',
                shiftHeader: 'Turno - Llegada',
                durationHeader: 'Ingreso tarde',
                collaboratorTotalHeader: 'Sumatoria tardanzas',
                generalTotalLabel: 'TOTAL GENERAL TARDANZAS',
                summaryOnly: true,
            });
        } catch (err) {
            console.error('Error importando tardanzas GeoVictoria:', err);
            alert(`No se pudo procesar el reporte de tardanzas: ${err.message}`);
        } finally {
            setGeoVictoriaLateImporting(false);
            event.target.value = '';
        }
    };

    const loadGeoVictoriaExtraHours = async () => {
        if (!userData?.storeId) return;
        setGeoVictoriaExtraLoading(true);
        try {
            const snap = await getDocs(collection(db, 'extra_hours'));
            const storeStaffIds = new Set(staff.map((person) => person.id));
            const storeUids = new Set(staff.map((person) => person.uid).filter(Boolean));
            const records = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .filter((record) => {
                    const isGeoVictoriaExtra = record.source === 'geovictoria_extra_hours'
                        || record.importedFrom === 'geovictoria_tiempo_extra';
                    if (!isGeoVictoriaExtra) return false;
                    if (record.isPeriodTotal !== true) return false;
                    if (record.storeId) return record.storeId === userData.storeId;
                    return storeStaffIds.has(record.staffId) || storeUids.has(record.uid);
                })
                .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
            setGeoVictoriaExtraRecords(records);
        } catch (err) {
            console.error('Error cargando horas extra GeoVictoria:', err);
            alert(`No se pudo cargar el historial de horas extra: ${err.message}`);
        } finally {
            setGeoVictoriaExtraLoading(false);
        }
    };

    useEffect(() => {
        if (showHRPanel && userData?.storeId) {
            loadGeoVictoriaExtraHours();
        }
    }, [showHRPanel, userData?.storeId, staff.length]);

    const handleGeoVictoriaExtraHoursUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!userData?.storeId) {
            alert('No se pudo identificar la tienda para importar horas extra.');
            event.target.value = '';
            return;
        }

        setGeoVictoriaExtraImporting(true);
        setGeoVictoriaExtraImportResult(null);

        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
            const rows = readGeoVictoriaRows(workbook);

            const staffByDni = new Map();
            staff.forEach((person) => {
                const dni = normalizeDni(person.dni);
                if (!dni) return;
                const current = staffByDni.get(dni);
                if (!current || isStaffActiveForHr(person)) {
                    staffByDni.set(dni, person);
                }
            });

            const grouped = new Map();
            let matchedRows = 0;
            let skippedNoDni = 0;
            let unmatchedRows = 0;
            let invalidDateRows = 0;
            let noExtraRows = 0;
            let lastExtraContext = null;
            const unmatchedDnis = new Set();

            rows.forEach((row, rowIndex) => {
                const rawDni = normalizeDni(getRowValueWithFallback(row, ['Identificador', 'DNI', 'Documento'], ['_3']));
                if (rawDni) {
                    const person = staffByDni.get(rawDni);
                    if (!person) {
                        if (!unmatchedDnis.has(rawDni)) {
                            unmatchedRows += 1;
                            unmatchedDnis.add(rawDni);
                        }
                        lastExtraContext = null;
                        return;
                    }

                    const rowDate = parseActivationDate(getRowValueWithFallback(row, ['Fecha'], ['', '_0']));
                    const rowFecha = formatDateInput(rowDate);
                    if (!rowFecha) {
                        invalidDateRows += 1;
                        lastExtraContext = null;
                        return;
                    }

                    const turno = String(getRowValueWithFallback(row, ['Turno'], ['_5']) || '').trim();
                    const { scheduledStart, scheduledEnd } = parseTurnoRange(turno);
                    const entrada = parseGeoVictoriaTimeValue(getRowValueWithFallback(row, ['Entrada'], ['_6']));
                    const salida = parseGeoVictoriaTimeValue(getRowValueWithFallback(row, ['Salio', 'Salió'], ['_10']));
                    const detailExtraMinutesPre = parseGeoVictoriaDurationMinutes(getRepeatedRowValue(row, 'TE', 0) || getRowValueWithFallback(row, ['TE Entrada'], ['_7']));
                    const detailExtraMinutesPost = parseGeoVictoriaDurationMinutes(getRepeatedRowValue(row, 'TE', 1) || getRowValueWithFallback(row, ['TE Salida'], ['_11']));
                    const dailyDetail = detailExtraMinutesPre + detailExtraMinutesPost > 0
                        ? {
                            rowIndex: rowIndex + 2,
                            fecha: rowFecha,
                            day: getGeoVictoriaDayLabel(rowFecha),
                            turno,
                            entrada,
                            salida,
                            scheduledStart,
                            scheduledEnd,
                            extraMinutesPre: detailExtraMinutesPre,
                            extraMinutesPost: detailExtraMinutesPost,
                            totalExtraMinutes: detailExtraMinutesPre + detailExtraMinutesPost,
                        }
                        : null;

                    if (!lastExtraContext || lastExtraContext.dni !== rawDni) {
                        lastExtraContext = {
                            dni: rawDni,
                            person,
                            date: rowDate,
                            fecha: rowFecha,
                            periodStart: rowFecha,
                            periodEnd: rowFecha,
                            turno,
                            entrada,
                            salida,
                            scheduledStart,
                            scheduledEnd,
                            detailRows: 1,
                            dailyDetails: dailyDetail ? [dailyDetail] : [],
                        };
                    } else {
                        lastExtraContext.date = rowDate;
                        lastExtraContext.fecha = rowFecha;
                        lastExtraContext.periodStart = rowFecha < lastExtraContext.periodStart ? rowFecha : lastExtraContext.periodStart;
                        lastExtraContext.periodEnd = rowFecha > lastExtraContext.periodEnd ? rowFecha : lastExtraContext.periodEnd;
                        lastExtraContext.turno = turno || lastExtraContext.turno;
                        lastExtraContext.entrada = entrada || lastExtraContext.entrada;
                        lastExtraContext.salida = salida || lastExtraContext.salida;
                        lastExtraContext.scheduledStart = scheduledStart || lastExtraContext.scheduledStart;
                        lastExtraContext.scheduledEnd = scheduledEnd || lastExtraContext.scheduledEnd;
                        lastExtraContext.detailRows += 1;
                        if (dailyDetail) lastExtraContext.dailyDetails.push(dailyDetail);
                    }
                    return;
                }

                const dni = rawDni || lastExtraContext?.dni || '';
                if (!dni) {
                    skippedNoDni += 1;
                    return;
                }

                const person = rawDni
                    ? staffByDni.get(dni)
                    : (lastExtraContext?.person || staffByDni.get(dni));
                if (!person) {
                    unmatchedRows += 1;
                    return;
                }

                const rawDate = parseActivationDate(getRowValueWithFallback(row, ['Fecha'], ['', '_0']));
                const date = rawDate || lastExtraContext?.date;
                const fecha = formatDateInput(date);
                if (!fecha) {
                    invalidDateRows += 1;
                    return;
                }
                const turno = String(getRowValueWithFallback(row, ['Turno'], ['_5']) || lastExtraContext?.turno || '').trim();
                const { scheduledStart, scheduledEnd } = parseTurnoRange(turno);
                const entrada = parseGeoVictoriaTimeValue(getRowValueWithFallback(row, ['Entrada'], ['_6'])) || lastExtraContext?.entrada || '';

                const salida = parseGeoVictoriaTimeValue(getRowValueWithFallback(row, ['Salio', 'Salió'], ['_10'])) || lastExtraContext?.salida || '';
                const teEntrada = getRepeatedRowValue(row, 'TE', 0) || getRowValueWithFallback(row, ['TE Entrada'], ['_7']);
                const teSalida = getRepeatedRowValue(row, 'TE', 1) || getRowValueWithFallback(row, ['TE Salida'], ['_11']);
                const extraMinutesPre = parseGeoVictoriaDurationMinutes(teEntrada);
                const extraMinutesPost = parseGeoVictoriaDurationMinutes(teSalida);
                const totalExtraMinutes = extraMinutesPre + extraMinutesPost;
                if (totalExtraMinutes <= 0) {
                    lastExtraContext = null;
                    noExtraRows += 1;
                    return;
                }

                matchedRows += 1;
                const periodStart = lastExtraContext?.periodStart || fecha;
                const periodEnd = lastExtraContext?.periodEnd || fecha;
                const key = `${person.id}_${periodStart}_${periodEnd}`;
                const existing = grouped.get(key) || {
                    person,
                    dni,
                    fecha: periodEnd,
                    periodStart,
                    periodEnd,
                    isPeriodTotal: true,
                    turno,
                    entrada,
                    salida,
                    scheduledStart,
                    scheduledEnd,
                    extraMinutesPre: 0,
                    extraMinutesPost: 0,
                    totalExtraMinutes: 0,
                    segments: [],
                    dailyDetails: [],
                };

                existing.extraMinutesPre += extraMinutesPre;
                existing.extraMinutesPost += extraMinutesPost;
                existing.totalExtraMinutes += totalExtraMinutes;
                existing.turno = existing.turno || turno;
                existing.entrada = existing.entrada || entrada;
                existing.salida = salida || existing.salida;
                existing.scheduledStart = existing.scheduledStart || scheduledStart;
                existing.scheduledEnd = existing.scheduledEnd || scheduledEnd;
                existing.dailyDetails = lastExtraContext?.dailyDetails || [];
                existing.segments.push({
                    rowIndex: rowIndex + 2,
                    type: 'subtotal',
                    periodStart,
                    periodEnd,
                    detailRows: lastExtraContext?.detailRows || 0,
                    turno,
                    entrada,
                    salida,
                    scheduledStart,
                    scheduledEnd,
                    extraMinutesPre,
                    extraMinutesPost,
                    totalExtraMinutes,
                });
                grouped.set(key, existing);
                lastExtraContext = null;
            });

            let created = 0;
            let updated = 0;
            const totalByStaff = new Map();

            for (const item of grouped.values()) {
                const person = item.person;
                const ref = doc(db, 'extra_hours', `gvextra_${person.id}_${item.periodStart || item.fecha}_${item.periodEnd || item.fecha}`);
                const existed = await getDoc(ref);
                const totalExtraMinutes = item.totalExtraMinutes;
                const extraMinutesPre = item.extraMinutesPre;
                const extraMinutesPost = item.extraMinutesPost;
                const inicio = extraMinutesPre > 0
                    ? (item.entrada || item.scheduledStart || '')
                    : (item.scheduledEnd || item.salida || '');
                const fin = extraMinutesPost > 0
                    ? (item.salida || item.scheduledEnd || '')
                    : (item.scheduledStart || item.entrada || '');
                const activityParts = [];
                if (extraMinutesPre > 0) activityParts.push(`Entrada: ${formatDurationMinutes(extraMinutesPre)}`);
                if (extraMinutesPost > 0) activityParts.push(`Salida: ${formatDurationMinutes(extraMinutesPost)}`);

                const payload = {
                    // user_id (extra_hours.user_id) referencia auth.users; el personal
                    // emparejado por DNI puede no tener cuenta vinculada, en cuyo caso
                    // person.uid es null. Nunca usar person.id (id de staff_profiles)
                    // como fallback: violaria la FK extra_hours_user_id_fkey.
                    uid: person.uid || null,
                    staffId: person.id,
                    dni: item.dni,
                    name: person.name || '',
                    lastName: person.lastName || '',
                    cargo: person.cargo || person.position || '',
                    position: person.position || '',
                    modality: person.modality || '',
                    storeId: userData.storeId,
                    storeName: storeName || person.storeName || '',
                    fecha: item.fecha,
                    periodStart: item.periodStart || item.fecha,
                    periodEnd: item.periodEnd || item.fecha,
                    isPeriodTotal: true,
                    inicio,
                    fin,
                    entrada: item.entrada || '',
                    salida: item.salida || '',
                    turno: item.turno || '',
                    scheduledStart: item.scheduledStart || '',
                    scheduledEnd: item.scheduledEnd || '',
                    extraMinutesPre,
                    extraMinutesPost,
                    totalExtraMinutes,
                    durationMinutes: totalExtraMinutes,
                    extraHoursPre: minutesToHours(extraMinutesPre),
                    extraHoursPost: minutesToHours(extraMinutesPost),
                    totalExtraHours: minutesToHours(totalExtraMinutes),
                    duracion: formatDurationMinutes(totalExtraMinutes),
                    actividad: `Tiempo extra GeoVictoria (${activityParts.join(' | ')})`,
                    source: 'geovictoria_extra_hours',
                    importedFrom: 'geovictoria_tiempo_extra',
                    sourceFile: file.name,
                    importedAt: new Date().toISOString(),
                    segments: item.segments,
                    dailyDetails: item.dailyDetails || [],
                };

                await setDoc(ref, payload, { merge: true });
                if (existed.exists()) updated += 1;
                else created += 1;

                const staffKey = person.id;
                const current = totalByStaff.get(staffKey) || {
                    staffId: staffKey,
                    name: `${person.name || ''} ${person.lastName || ''}`.trim(),
                    dni: item.dni,
                    totalMinutes: 0,
                    preMinutes: 0,
                    postMinutes: 0,
                };
                current.totalMinutes += totalExtraMinutes;
                current.preMinutes += extraMinutesPre;
                current.postMinutes += extraMinutesPost;
                totalByStaff.set(staffKey, current);
            }

            const importedTotalMinutes = Array.from(grouped.values())
                .reduce((acc, item) => acc + item.totalExtraMinutes, 0);

            setGeoVictoriaExtraImportResult({
                fileName: file.name,
                created,
                updated,
                matchedRows,
                uploadedRecords: grouped.size,
                skippedNoDni,
                unmatchedRows,
                invalidDateRows,
                noExtraRows,
                totalMinutes: importedTotalMinutes,
                totalByStaff: Array.from(totalByStaff.values())
                    .sort((a, b) => b.totalMinutes - a.totalMinutes),
            });

            await loadGeoVictoriaExtraHours();
            alert(`Horas extra importadas: ${grouped.size} registro(s), total ${formatDurationMinutes(importedTotalMinutes)}.`);
        } catch (err) {
            console.error('Error importando tiempo extra GeoVictoria:', err);
            alert(`No se pudo procesar el Excel de tiempo extra: ${err.message}`);
        } finally {
            setGeoVictoriaExtraImporting(false);
            event.target.value = '';
        }
    };

    const handleHrTimeAnalysisUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setHrAnalysisLoading(true);
        setHrAnalysisError('');

        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
            const rows = readGeoVictoriaRows(workbook);
            const today = new Date();

            const excelByDni = new Map();
            let skippedRows = 0;
            let excludedManagementExcel = 0;

            rows.forEach((row) => {
                if (!isImportableGeoVictoriaState(getRowValue(row, ['Estado']))) {
                    skippedRows += 1;
                    return;
                }

                if (isHrManagementRole(
                    getRowValue(row, ['Cargo']),
                    getRowValue(row, ['Grupo']),
                    getRowValue(row, ['Perfil'])
                )) {
                    excludedManagementExcel += 1;
                    return;
                }

                const dni = normalizeDni(getRowValue(row, ['Identificador', 'DNI', 'Documento']));
                if (!dni || excelByDni.has(dni)) {
                    skippedRows += 1;
                    return;
                }

                const activationDate = parseActivationDate(getRowValue(row, [
                    'Fecha ultimo estado de activacion',
                    'Fecha último estado de activación',
                ]));

                excelByDni.set(dni, {
                    dni,
                    name: String(getRowValue(row, ['Nombre']) || '').trim(),
                    lastName: String(getRowValue(row, ['Apellidos']) || '').trim(),
                    activationDate,
                    rawActivationDate: getRowValue(row, [
                        'Fecha ultimo estado de activacion',
                        'Fecha último estado de activación',
                    ]),
                });
            });

            const activeStaffForHr = staff.filter(isStaffActiveForHr);
            const excludedManagementStaff = activeStaffForHr.filter((person) =>
                isHrManagementRole(
                    person.position,
                    person.cargo,
                    person.jobTitle,
                    person.role,
                    person.profile
                )
            );
            const activeProgramStaff = activeStaffForHr.filter((person) =>
                !isHrManagementRole(
                    person.position,
                    person.cargo,
                    person.jobTitle,
                    person.role,
                    person.profile
                )
            );
            const programByDni = new Map();
            activeProgramStaff.forEach((person) => {
                const dni = normalizeDni(person.dni);
                if (dni) programByDni.set(dni, person);
            });

            const matched = [];
            const missingInExcel = [];
            const missingDni = [];

            activeProgramStaff.forEach((person) => {
                const dni = normalizeDni(person.dni);
                if (!dni) {
                    missingDni.push(person);
                    return;
                }

                const excelPerson = excelByDni.get(dni);
                if (!excelPerson) {
                    missingInExcel.push(person);
                    return;
                }

                const tenure = getTenure(excelPerson.activationDate, today);
                matched.push({
                    id: person.id,
                    dni,
                    name: `${person.name || ''} ${person.lastName || ''}`.trim(),
                    modality: person.modality || '-',
                    programJoinDate: person.joinDate || '',
                    activationDate: excelPerson.activationDate,
                    rawActivationDate: excelPerson.rawActivationDate,
                    tenure,
                    bucket: tenure?.bucket || 'Sin fecha valida',
                });
            });

            const missingInProgram = Array.from(excelByDni.values())
                .filter((row) => !programByDni.has(row.dni))
                .map((row) => ({
                    ...row,
                    fullName: `${row.name || ''} ${row.lastName || ''}`.trim(),
                }));

            const validMatched = matched.filter((row) => row.activationDate && row.tenure);
            const bucketSummary = hrTenureBuckets.map((label) => {
                const count = validMatched.filter((row) => row.bucket === label).length;
                return {
                    label,
                    count,
                    percentage: validMatched.length ? Math.round((count / validMatched.length) * 1000) / 10 : 0,
                };
            });

            const lessThanOneMonth = validMatched.filter((row) => row.bucket === 'Menos de 1 mes').length;
            const invalidActivation = matched.filter((row) => !row.activationDate || !row.tenure).length;

            setHrTimeAnalysis({
                fileName: file.name,
                generatedAt: new Date().toISOString(),
                totalExcel: excelByDni.size,
                totalProgram: activeProgramStaff.length,
                matched,
                validMatchedCount: validMatched.length,
                missingInExcel,
                missingInProgram,
                missingDni,
                skippedRows,
                excludedManagementExcel,
                excludedManagementStaff: excludedManagementStaff.length,
                invalidActivation,
                lessThanOneMonth,
                bucketSummary,
            });
        } catch (err) {
            console.error("Error analizando permanencia RRHH:", err);
            setHrAnalysisError(`No se pudo analizar el Excel: ${err.message}`);
        } finally {
            setHrAnalysisLoading(false);
            event.target.value = '';
        }
    };

    const openScheduleWindow = async (uid, docId) => {
        // El horario de estudios se resuelve por id de staff_profiles o user_id,
        // así que usamos el uid real si existe o el id del perfil como identificador.
        const finalUid = uid || docId;
        if (!finalUid) {
            alert("No se pudo identificar al colaborador para abrir su horario.");
            return;
        }

        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        window.open(
            `/admin/study-schedule/${finalUid}`,
            "EditarHorario",
            `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
        );
    };

    const handleDeleteHoliday = async (holiday) => {
        if (!window.confirm("¿Seguro que deseas eliminar este registro de feriado? Esto afectará el balance actual del colaborador.")) return;

        try {
            // 1. Eliminar el registro físico
            if (holiday.isPending) {
                // Es un registro en staff_profiles.pendingHolidays
                const ref = doc(db, "staff_profiles", selectedStaff.id);
                const updatedPending = (selectedStaff.pendingHolidays || []).filter(p => {
                    const date = typeof p === 'string' ? p : p.date;
                    return date !== holiday.date;
                });
                await updateDoc(ref, { pendingHolidays: updatedPending });
            } else {
                // Es un documento en feriados_trabajados
                await deleteDoc(doc(db, 'feriados_trabajados', holiday.id));
            }

            // 2. El balance se deriva de worked_holidays; no se persiste un
            // segundo contador que pueda quedar desincronizado.
            const impact = holiday.type === 'ganado' ? -1 : 1;
            const newBalance = (selectedStaff.feriados || 0) + impact;

            // 3. Actualizar estados locales
            setSelectedHolidays(prev => prev.filter(h => {
                if (holiday.isPending) return h.date !== holiday.date;
                return h.id !== holiday.id;
            }));

            const updatedStaff = { ...selectedStaff, feriados: newBalance };
            setSelectedStaff(updatedStaff);

            // Actualizar la lista principal de staff
            setStaff(prev => prev.map(s => s.id === selectedStaff.id ? { ...s, feriados: newBalance } : s));

        } catch (error) {
            console.error("Error al eliminar feriado:", error);
            alert("No se pudo eliminar el registro: " + error.message);
        }
    };

    const handleEditSave = async () => {
        try {
            if (!editModal.name || !editModal.lastName) {
                alert("Nombre y apellido son obligatorios.");
                return;
            }

            const payload = {
                name: editModal.name,
                lastName: editModal.lastName,
                modality: editModal.modality,
                dni: editModal.dni || "",
                position: editModal.position || "COLABORADOR",
                email: editModal.email || "",
                storeId: userData?.storeId || "",
                storeName: storeName || "",
                study_schedule: editModal.study_schedule || {},
                sanitaryCardDate: editModal.sanitaryCardDate || "",
                sanitaryCardUnlock: editModal.sanitaryCardUnlock || false,
            };

            if (editModal.isNew) {
                await addDoc(collection(db, "staff_profiles"), payload);
            } else {
                // Verificar si hubo cambio de modalidad
                const original = staff.find(s => s.id === editModal.id);
                if (original && original.modality !== editModal.modality) {
                    if (window.confirm(`Has cambiado la modalidad de ${original.modality} a ${editModal.modality}. El balance de feriados se reseteará a 0 ya que se considera liquidado/pagado. ¿Continuar?`)) {
                        payload.feriados = 0;
                        payload.pendingHolidays = [];

                        // Nuevo inicio de labores para la nueva modalidad
                        const todayStr = new Date().toISOString().split('T')[0];
                        payload.joinDate = todayStr;

                        // Registrar como cese por cambio de modalidad (inmediato)
                        const docId = `${editModal.id}_mod_immediate_${todayStr}`;
                        setDoc(doc(db, 'ceses', docId), {
                            staffId: editModal.id,
                            name: editModal.name,
                            lastName: editModal.lastName,
                            modality: original.modality, // La modalidad anterior
                            dni: editModal.dni || '',
                            gender: editModal.gender || editModal.sexo || '',
                            position: editModal.position || 'TEAM MEMBER',
                            joinDate: original.joinDate || original.createdAt?.split?.('T')?.[0] || '',
                            cessationDate: (() => {
                                const d = new Date(todayStr + 'T00:00:00');
                                d.setDate(d.getDate() - 1);
                                const y = d.getFullYear();
                                const m = String(d.getMonth() + 1).padStart(2, '0');
                                const day = String(d.getDate()).padStart(2, '0');
                                return `${y}-${m}-${day}`;
                            })(),
                            storeId: userData.storeId,
                            registeredAt: new Date().toISOString(),
                            isModalityChange: true,
                            nextModality: editModal.modality,
                            motivoCese: 'CAMBIO DE MODALIDAD',
                            motivoReal: 'MEJORA CONTRACTUAL',
                            migratedFromProfile: true
                        }).catch(e => console.error("Error registrando cese inmediato:", e));
                    } else {
                        return; // Cancelar guardado si no acepta el reset
                    }
                }
                await updateDoc(doc(db, "staff_profiles", editModal.id), payload);
            }

            setEditModal(null);
            await fetchAllStaffProfiles();
        } catch (err) {
            console.error("Error al guardar usuario:", err);
            alert(`Error al guardar: ${err.message}`);
        }
    };

    const loadCesosRegistros = async () => {
        if (!userData?.storeId) return;
        setCesosLoading(true);
        try {
            // 1. Leer solo los ceses de ESTA tienda
            const qCeses = query(collection(db, 'ceses'), where('storeId', '==', userData.storeId));
            const snap = await getDocs(qCeses);
            const cessationKey = (record) => [
                record.staffId || '',
                record.cessationDate || '',
                record.isModalityChange ? `modality:${record.nextModality || ''}` : 'cessation'
            ].join('|');
            const existingIds = new Set(
                snap.docs.filter(snapshot => !snapshot.data().isCancelled).map(snapshot => snapshot.id)
            );
            const existingKeys = new Set(
                snap.docs
                    .map(snapshot => snapshot.data())
                    .filter(record => !record.isCancelled)
                    .map(cessationKey)
            );
            let lista = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(registro => !registro.isCancelled);

            // 2. Migrar solo colaboradores de ESTA tienda
            const staffQuery = query(collection(db, 'staff_profiles'), where('storeId', '==', userData.storeId));
            const staffSnap = await getDocs(staffQuery);
            const migraciones = [];
            const staffActual = new Map(staffSnap.docs.map(snapshot => [snapshot.id, snapshot.data()]));
            const cesesObsoletos = snap.docs.filter(snapshot => {
                const registro = snapshot.data();
                if (registro.isCancelled) return true;
                if (registro.isModalityChange) return false;

                const perfil = staffActual.get(registro.staffId);
                if (!perfil) return false; // Mantener el historial de perfiles ya eliminados.

                return !perfil.cessationDate || perfil.cessationDate !== registro.cessationDate;
            });

            if (cesesObsoletos.length > 0) {
                const idsObsoletos = new Set(cesesObsoletos.map(snapshot => snapshot.id));
                lista = lista.filter(registro => !idsObsoletos.has(registro.id));
                cesesObsoletos.forEach(snapshot => {
                    existingIds.delete(snapshot.id);
                    existingKeys.delete(cessationKey(snapshot.data()));
                });

                // Corregir la vista aunque una política antigua impida limpiar el registro.
                await Promise.allSettled(cesesObsoletos.map(snapshot =>
                    deleteDoc(snapshot.ref).catch(error => {
                        console.warn(`No se pudo depurar el cese obsoleto ${snapshot.id}:`, error);
                    })
                ));
            }

            staffSnap.docs.forEach(d => {
                const s = d.data();

                // --- CASO 1: CESE NORMAL ---
                if (s.cessationDate) {
                    const docId = `${d.id}_${s.cessationDate}`;
                    const key = cessationKey({ staffId: d.id, cessationDate: s.cessationDate });
                    if (!existingIds.has(docId) && !existingKeys.has(key)) {
                        const registro = {
                            staffId: d.id,
                            name: s.name || '',
                            lastName: s.lastName || '',
                            modality: s.modality || '',
                            dni: s.dni || '',
                            gender: s.gender || s.sexo || '',
                            position: s.position || 'TEAM MEMBER',
                            joinDate: s.joinDate || s.createdAt?.split?.('T')?.[0] || '',
                            cessationDate: s.cessationDate,
                            storeId: userData.storeId,
                            motivoCese: 'RENUNCIA VOLUNTARIA',
                            motivoReal: 'MEJORA ECONÓMICA',
                            registeredAt: new Date().toISOString(),
                            migratedFromProfile: true
                        };
                        migraciones.push(
                            setDoc(doc(db, 'ceses', docId), registro)
                                .then(() => {
                                    existingIds.add(docId);
                                    existingKeys.add(key);
                                    lista.push({ id: docId, ...registro });
                                })
                        );
                    }
                }

                // --- CASO 2: CAMBIO DE MODALIDAD ---
                if (s.modalityChangeDate && s.nextModality) {
                    const docId = `${d.id}_mod_${s.modalityChangeDate}`;
                    const modalityEndDate = (() => {
                        const date = new Date(s.modalityChangeDate + 'T00:00:00');
                        date.setDate(date.getDate() - 1);
                        const y = date.getFullYear();
                        const m = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        return `${y}-${m}-${day}`;
                    })();
                    const key = cessationKey({
                        staffId: d.id,
                        cessationDate: modalityEndDate,
                        isModalityChange: true,
                        nextModality: s.nextModality
                    });
                    if (!existingIds.has(docId) && !existingKeys.has(key)) {
                        const registro = {
                            staffId: d.id,
                            name: s.name || '',
                            lastName: s.lastName || '',
                            modality: s.modality || '', // La modalidad QUE DEJA
                            dni: s.dni || '',
                            gender: s.gender || s.sexo || '',
                            position: s.position || 'TEAM MEMBER',
                            joinDate: s.joinDate || s.createdAt?.split?.('T')?.[0] || '',
                            cessationDate: modalityEndDate, // Un día antes del cambio
                            storeId: userData.storeId,
                            registeredAt: new Date().toISOString(),
                            isModalityChange: true,
                            nextModality: s.nextModality,
                            motivoCese: 'CAMBIO DE MODALIDAD',
                            motivoReal: 'MEJORA CONTRACTUAL',
                            migratedFromProfile: true
                        };
                        migraciones.push(
                            setDoc(doc(db, 'ceses', docId), registro)
                                .then(() => {
                                    existingIds.add(docId);
                                    existingKeys.add(key);
                                    lista.push({ id: docId, ...registro });
                                })
                        );
                    }
                }
            });

            if (migraciones.length > 0) {
                const results = await Promise.allSettled(migraciones);
                results.forEach(result => {
                    if (result.status === 'rejected') {
                        console.warn('No se pudo sincronizar un registro de cese:', result.reason);
                    }
                });
            }

            lista.sort((a, b) => new Date(b.cessationDate) - new Date(a.cessationDate));
            setCesosRegistros(lista);
        } catch (err) {
            console.error('Error cargando ceses:', err);
        } finally {
            setCesosLoading(false);
        }
    };

    const abrirReporteBaja = (registro) => {
        setReporteBajaColaborador(registro);
        setReporteBajaForm({
            desempenio: registro.desempenio || 'BUENO',
            motivoCese: registro.motivoCese || 'RENUNCIA VOLUNTARIA',
            motivoReal: registro.motivoReal || 'MEJORA ECONÓMICA',
            comentario: registro.comentario || '',
            diasDescansoMedico: registro.diasDescansoMedico || '',
            inasistencias: registro.inasistencias || '',
            tardanzas: registro.tardanzas || '',
            horasNocturnas: registro.horasNocturnas || '',
            horasExtras: registro.horasExtras || '',
            feriados: registro.feriados || '',
            descuentos: registro.descuentos || '',
        });
    };

    const exportarReporteBajaExcel = async () => {
        if (!reporteBajaColaborador) return;
        const s = reporteBajaColaborador;
        const f = reporteBajaForm;

        // Mes del cese para el título
        const fechaCeseObj = s.cessationDate ? new Date(s.cessationDate + 'T00:00:00') : new Date();
        const mesLabel = fechaCeseObj.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const mesCapitalized = mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Reporte de Baja');

        const headers = [
            'TIENDA', 'PUESTO', 'MOD', 'DNI',
            'NOMBRE DE COLABORADOR', 'SEXO',
            'FECHA DE INGRESO', 'FECHA DE CESE',
            'DIAS DESCANSO MEDICO', 'INASISTENCIA',
            'TARDANZAS (MINUTOS, HORAS)',
            'HORAS NOCTURNAS', 'HORAS EXTRAS', 'FERIADOS', 'DESCUENTOS',
            'DESEMPEÑO', 'MOTIVO DE CESE', 'MOTIVO REAL',
            'COMENTARIO TIENDA - DESCRIBIR CON MAYOR DETALLE EL MOTIVO POR EL QUE SE RETIRA EL COLABORADOR DE LA EMPRESA'
        ];

        worksheet.addRow(headers);

        const fmtFecha = (str) => {
            if (!str) return '';
            const d = new Date(str + 'T00:00:00');
            return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        };

        const rowData = [
            storeName || s.storeId || '',
            s.position || 'TEAM MEMBER',
            s.modality === 'Full-Time' ? 'FT' : s.modality === 'Part-Time' ? 'PT' : (s.modality || ''),
            s.dni || '',
            `${s.name || ''} ${s.lastName || ''}`.trim(),
            s.gender || s.sexo || '',
            fmtFecha(s.joinDate || s.createdAt?.split?.('T')?.[0] || ''),
            fmtFecha(s.cessationDate),
            f.diasDescansoMedico || '0',
            f.inasistencias || '0',
            f.tardanzas || '0',
            f.horasNocturnas || '0',
            f.horasExtras || '0',
            f.feriados || '0',
            f.descuentos || '0',
            f.desempenio,
            f.motivoCese,
            f.motivoReal,
            f.comentario,
        ];

        worksheet.addRow(rowData);

        // Estilos
        const headerRow = worksheet.getRow(1);
        headerRow.height = 45;
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F4E78' } // Dark Blue
            };
            cell.font = {
                bold: true,
                color: { argb: 'FFFFFFFF' }, // White
                size: 10
            };
            cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        worksheet.getRow(2).eachCell((cell) => {
            cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        worksheet.columns = [
            { width: 15 }, { width: 15 }, { width: 8 }, { width: 12 },
            { width: 30 }, { width: 10 },
            { width: 15 }, { width: 15 },
            { width: 12 }, { width: 12 },
            { width: 15 },
            { width: 15 }, { width: 15 }, { width: 10 }, { width: 12 },
            { width: 15 }, { width: 22 }, { width: 25 },
            { width: 60 }
        ];

        const buffer = await workbook.xlsx.writeBuffer();

        // --- GUARDAR EN FIRESTORE ---
        try {
            await updateDoc(doc(db, 'ceses', s.id), {
                ...f,
                lastUpdated: new Date().toISOString()
            });
            // Recargar la lista local para que el reporte mensual tenga la data actualizada
            await loadCesosRegistros();
        } catch (err) {
            console.error("Error guardando datos del cese:", err);
        }

        saveAs(new Blob([buffer]), `Reporte_Baja_${s.name}_${s.lastName}_${mesCapitalized}.xlsx`);
    };

    const exportarReporteBajasMensualExcel = async () => {
        if (!cesosFilterMonth) return;

        const filtered = cesosRegistros.filter(s =>
            s.cessationDate && s.cessationDate.startsWith(cesosFilterMonth)
        );

        if (filtered.length === 0) {
            alert("No hay registros para exportar en este mes.");
            return;
        }

        const mesLabel = new Date(cesosFilterMonth + '-02').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const mesCapitalized = mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Bajas del Mes');

        const headers = [
            'TIENDA', 'PUESTO', 'MOD', 'DNI',
            'NOMBRE DE COLABORADOR', 'SEXO',
            'FECHA DE INGRESO', 'FECHA DE CESE',
            'DIAS DESCANSO MEDICO', 'INASISTENCIA',
            'TARDANZAS (MINUTOS, HORAS)',
            'HORAS NOCTURNAS', 'HORAS EXTRAS', 'FERIADOS', 'DESCUENTOS',
            'DESEMPEÑO', 'MOTIVO DE CESE', 'MOTIVO REAL',
            'COMENTARIO TIENDA'
        ];

        worksheet.addRow(headers);

        const fmtFecha = (str) => {
            if (!str) return '';
            const d = new Date(str + 'T00:00:00');
            return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        };

        filtered.forEach(s => {
            worksheet.addRow([
                storeName || s.storeId || '',
                s.position || 'TEAM MEMBER',
                s.modality === 'Full-Time' ? 'FT' : s.modality === 'Part-Time' ? 'PT' : (s.modality || ''),
                s.dni || '',
                `${s.name || ''} ${s.lastName || ''}`.trim(),
                s.gender || s.sexo || '',
                fmtFecha(s.joinDate || s.createdAt?.split?.('T')?.[0] || ''),
                fmtFecha(s.cessationDate),
                s.diasDescansoMedico || '0',
                s.inasistencias || '0',
                s.tardanzas || '0',
                s.horasNocturnas || '0',
                s.horasExtras || '0',
                s.feriados || '0',
                s.descuentos || '0',
                s.desempenio || '',
                s.motivoCese || 'RENUNCIA VOLUNTARIA',
                s.motivoReal || 'MEJORA ECONÓMICA',
                s.comentario || ''
            ]);
        });

        const headerRow = worksheet.getRow(1);
        headerRow.height = 40;
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F4E78' }
            };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' }, left: { style: 'thin' },
                bottom: { style: 'thin' }, right: { style: 'thin' }
            };
        });

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin' }, left: { style: 'thin' },
                        bottom: { style: 'thin' }, right: { style: 'thin' }
                    };
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                });
            }
        });

        worksheet.columns = [
            { width: 15 }, { width: 15 }, { width: 8 }, { width: 12 },
            { width: 30 }, { width: 10 },
            { width: 15 }, { width: 15 },
            { width: 12 }, { width: 12 },
            { width: 15 }, { width: 15 }, { width: 15 }, { width: 10 }, { width: 12 },
            { width: 15 }, { width: 22 }, { width: 25 }, { width: 40 }
        ];

        const buffer = await workbook.xlsx.writeBuffer();
        saveAs(new Blob([buffer]), `Reporte_Bajas_Mensual_${mesCapitalized}.xlsx`);
    };

    const handleSaveReporteBaja = async () => {
        if (!reporteBajaColaborador) return;
        const s = reporteBajaColaborador;
        const f = reporteBajaForm;
        try {
            await updateDoc(doc(db, 'ceses', s.id), {
                ...f,
                lastUpdated: new Date().toISOString()
            });
            await loadCesosRegistros();
            alert("Reporte guardado exitosamente en el sistema.");
        } catch (err) {
            console.error("Error guardando datos del cese:", err);
            alert("Error al guardar: " + err.message);
        }
    };

    const handleCessation = async (colab) => {
        if (colab.isTrainee) {
            const endDate = limaToday();
            if (!window.confirm(`¿Finalizar el entrenamiento de ${colab.name} ${colab.lastName} hoy?`)) return;
            try {
                await finishStaffTraining(colab.id, endDate);
                await fetchAllStaffProfiles();
            } catch (err) {
                alert('Error al finalizar el entrenamiento: ' + err.message);
            }
            return;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cessation = colab.cessationDate ? new Date(colab.cessationDate + 'T00:00:00') : null;
        const isAlreadyCeased = cessation && cessation < today;

        if (isAlreadyCeased) {
            alert(`El cese de ${colab.name} ${colab.lastName} se conserva como historial. Para un reingreso, crea una nueva ficha con el mismo correo y DNI; la cuenta se enlazará mediante el flujo verificado.`);
        } else {
            // Cesar hoy
            const todayStr = limaToday();
            const confirm = window.confirm(`¿Confirmas que ${colab.name} ${colab.lastName} fue cesado hoy (${todayStr.split('-').reverse().join('/')})?\n\nEl colaborador dejará de contarse a partir de mañana.`);
            if (!confirm) return;
            try {
                await saveStaffCessation(colab.id, { cessationDate: todayStr });
                await fetchAllStaffProfiles();
            } catch (err) {
                alert('Error al registrar el cese.');
            }
        }
    };

    const handleDelete = async (_uid, colab) => {
        if (colab.isTrainee) {
            if (!window.confirm("Los datos del entrenamiento deben conservarse. ¿Deseas finalizar el entrenamiento hoy?")) return;
            try {
                await finishStaffTraining(colab.id, limaToday());
                await fetchAllStaffProfiles();
            } catch (err) {
                alert(`Error al finalizar el entrenamiento: ${err.message}`);
            }
            return;
        }
        const confirm = window.confirm("Los datos laborales deben conservarse. ¿Deseas registrar el cese de este colaborador hoy en lugar de eliminar su historial?");
        if (!confirm) return;
        try {
            await saveStaffCessation(colab.id, { cessationDate: limaToday() });
            await fetchAllStaffProfiles();
        } catch (err) {
            console.error("Error al registrar el cese:", err);
            alert(`Error al registrar el cese: ${err.message}`);
        }
    };

    const filteredStaff = staff.filter(s => {
        if (!isStaffActive(s)) return false;

        const today = new Date(); today.setHours(0, 0, 0, 0);
        // Ocultar personal (trainees o regulares) cuyo plazo ha terminado
        const endDateStr = s.isTrainee ? s.trainingEndDate : (s.cessationDate || s.terminationDate);
        if (endDateStr) {
            const endDate = new Date(endDateStr + 'T00:00:00');
            if (endDate < today) return false;
        }
        const matchesModality = modalityFilter === "Todos"
            || (modalityFilter === "Trainee" ? s.isTrainee : s.modality === modalityFilter && !s.isTrainee);
        const fullName = (s.name + " " + s.lastName).toLowerCase();
        const matchesSearch = fullName.includes(searchTerm.toLowerCase());
        return matchesModality && matchesSearch;
    });

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            {/* Header */}
            <div className="bg-white shadow-md border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <h1 className="text-3xl font-black text-gray-900 tracking-tight">
                                Panel <span className="text-indigo-600">Admin</span>
                            </h1>
                            {userData?.storeId && (
                                <div className="flex items-center gap-2 mt-2">
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100/50 shadow-sm">
                                        <Building2 className="w-3.5 h-3.5" />
                                        <span className="text-[11px] font-black uppercase tracking-wider">{storeName}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            {/* Grupo: Operaciones */}
                            <div className="flex items-center bg-gray-50 p-1 rounded-2xl border border-gray-100">
                                <button
                                    onClick={() => navigate("/admin/proyeccion")}
                                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-white hover:text-orange-600 hover:shadow-sm rounded-xl transition-all text-xs font-bold"
                                >
                                    <Calculator className="w-4 h-4" />
                                    <span>PROYECCIÓN</span>
                                </button>
                                <button
                                    onClick={() => navigate("/admin/ventas")}
                                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-white hover:text-emerald-600 hover:shadow-sm rounded-xl transition-all text-xs font-bold"
                                >
                                    <BarChart3 className="w-4 h-4" />
                                    <span>VENTAS</span>
                                </button>
                                <button
                                    onClick={() => navigate("/admin/analisis-ventas")}
                                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-white hover:text-blue-600 hover:shadow-sm rounded-xl transition-all text-xs font-bold"
                                >
                                    <BarChart3 className="w-4 h-4" />
                                    <span>ANÁLISIS VENTAS</span>
                                </button>
                                <button
                                    onClick={() => navigate("/admin/generate-schedules")}
                                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm rounded-xl transition-all text-xs font-bold"
                                >
                                    <Calendar className="w-4 h-4" />
                                    <span>HORARIOS</span>
                                </button>
                            </div>

                            {/* Grupo: Herramientas */}
                            <div className="flex items-center bg-gray-50 p-1 rounded-2xl border border-gray-100">
                                <button
                                    onClick={() => setShowHRPanel(true)}
                                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-white hover:text-emerald-600 hover:shadow-sm rounded-xl transition-all text-xs font-bold"
                                >
                                    <Users className="w-4 h-4" />
                                    <span>RRHH</span>
                                </button>
                                <button
                                    onClick={() => setShowVHLModal(true)}
                                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm rounded-xl transition-all text-xs font-bold"
                                >
                                    <Calculator className="w-4 h-4" />
                                    <span>VHL/THL</span>
                                </button>
                            </div>

                            {/* Grupo: Administración */}
                            <div className="flex items-center bg-gray-50 p-1 rounded-2xl border border-gray-100">
                                <input
                                    ref={geoVictoriaInputRef}
                                    type="file"
                                    accept=".xlsx,.xls"
                                    className="hidden"
                                    onChange={handleGeoVictoriaImport}
                                />
                                <input
                                    ref={hrAnalysisInputRef}
                                    type="file"
                                    accept=".xlsx,.xls"
                                    className="hidden"
                                    onChange={handleHrTimeAnalysisUpload}
                                />
                                <input
                                    ref={geoVictoriaExtraInputRef}
                                    type="file"
                                    accept=".xlsx,.xls"
                                    className="hidden"
                                    onChange={handleGeoVictoriaExtraHoursUpload}
                                />
                                <input
                                    ref={geoVictoriaLateInputRef}
                                    type="file"
                                    accept=".xlsx,.xls"
                                    className="hidden"
                                    onChange={handleGeoVictoriaLateUpload}
                                />
                                <button
                                    onClick={() => setShowRequestsModal(true)}
                                    className="relative flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-white hover:text-red-600 hover:shadow-sm rounded-xl transition-all text-xs font-bold"
                                >
                                    <Bell className="w-4 h-4" />
                                    <span>SOLICITUDES</span>
                                    {pendingRequestsCount > 0 && (
                                        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] font-black w-4 h-4 flex items-center justify-center rounded-full border border-white">
                                            {pendingRequestsCount}
                                        </span>
                                    )}
                                </button>
                            </div>

                            {/* Acciones Finales */}
                            <div className="flex items-center gap-3 ml-auto">
                                {currentUser?.email === 'erickrendon18@gmail.com' && (
                                    <button
                                        onClick={() => navigate("/superadmin")}
                                        className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-xl transition-all text-xs font-black uppercase tracking-widest border border-purple-100 shadow-sm shadow-purple-50"
                                    >
                                        <Award className="w-4 h-4" />
                                        Superadmin
                                    </button>
                                )}
                                <button
                                    onClick={handleLogout}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl shadow-lg shadow-gray-200 hover:bg-black transition-all text-xs font-black uppercase tracking-widest"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Salir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* System Settings Bar - Refinado */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
                    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 flex flex-col md:flex-row items-center justify-between gap-6 transition-all hover:shadow-md">
                        <div className="flex items-center gap-4">
                            <div className={`p-4 rounded-xl transition-colors ${lockSettings.restrictionsEnabled ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                {lockSettings.restrictionsEnabled ? <AlertCircle className="w-6 h-6" /> : <UserCheck className="w-6 h-6" />}
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-gray-900">Configuración de Seguridad</h3>
                                <p className="text-sm text-gray-500 font-medium">
                                    {lockSettings.restrictionsEnabled
                                        ? `Bloqueo activo hasta el ${new Date(lockSettings.reenableDate + 'T00:00:00').toLocaleDateString('es-ES')}`
                                        : 'Los colaboradores pueden editar sus horarios libremente.'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 w-full md:w-auto">
                            {lockSettings.restrictionsEnabled ? (
                                <button
                                    onClick={() => handleUpdateLock({ ...lockSettings, restrictionsEnabled: false })}
                                    className="w-full md:w-auto px-6 py-2.5 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all"
                                >
                                    DESBLOQUEAR AHORA
                                </button>
                            ) : (
                                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 w-full">
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <input
                                            type="date"
                                            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-red-500/10 focus:border-red-500 outline-none transition-all"
                                            value={lockSettings.reenableDate}
                                            onChange={(e) => setLockSettings({ ...lockSettings, reenableDate: e.target.value })}
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (!lockSettings.reenableDate) return alert("Selecciona una fecha de reactivación");
                                            handleUpdateLock({ ...lockSettings, restrictionsEnabled: true });
                                        }}
                                        className="px-6 py-2.5 bg-red-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-red-700 shadow-lg shadow-red-100 transition-all whitespace-nowrap"
                                    >
                                        BLOQUEAR CAMBIOS
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Error Message */}
                {error && (
                    <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg shadow-md flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-red-700 font-medium">{error}</p>
                    </div>
                )}

                {showHRPanel && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
                        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
                            <div className="px-6 py-5 bg-gradient-to-r from-emerald-700 to-slate-900 text-white flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-200">Recursos Humanos</p>
                                    <h2 className="text-2xl font-black mt-1">Panel RRHH</h2>
                                    <p className="text-sm text-emerald-50 mt-1">
                                        Gestiona ingresos, ceses, validaciones y permanencia del personal.
                                    </p>
                                </div>
                                <button
                                    onClick={() => setShowHRPanel(false)}
                                    className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                                    title="Cerrar RRHH"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="overflow-y-auto p-6 bg-slate-50 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <button
                                        onClick={() => geoVictoriaInputRef.current?.click()}
                                        disabled={geoVictoriaImporting}
                                        className="bg-white border border-emerald-100 rounded-2xl p-5 text-left hover:border-emerald-300 hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl">
                                                <Upload className="w-6 h-6" />
                                            </div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                                                Excel
                                            </span>
                                        </div>
                                        <h3 className="font-black text-slate-900 mt-4">
                                            {geoVictoriaImporting ? 'Importando GeoVictoria...' : 'GeoVictoria'}
                                        </h3>
                                        <p className="text-sm text-slate-500 mt-1">
                                            Importa usuarios activos nuevos y completa luego su modalidad y carnet.
                                        </p>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setShowHRPanel(false);
                                            setShowCesadosModal(true);
                                            loadCesosRegistros();
                                        }}
                                        className="bg-white border border-orange-100 rounded-2xl p-5 text-left hover:border-orange-300 hover:shadow-md transition-all"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="p-3 bg-orange-50 text-orange-700 rounded-xl">
                                                <Users className="w-6 h-6" />
                                            </div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-orange-600 bg-orange-50 px-2 py-1 rounded-full">
                                                Historial
                                            </span>
                                        </div>
                                        <h3 className="font-black text-slate-900 mt-4">Ceses / Cambios</h3>
                                        <p className="text-sm text-slate-500 mt-1">
                                            Consulta bajas, cambios de modalidad y genera reportes mensuales.
                                        </p>
                                    </button>

                                    <button
                                        onClick={() => navigate("/entrenamiento")}
                                        className="bg-white border border-blue-100 rounded-2xl p-5 text-left hover:border-blue-300 hover:shadow-md transition-all"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="p-3 bg-blue-50 text-blue-700 rounded-xl">
                                                <ClipboardCheck className="w-6 h-6" />
                                            </div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                                                Evaluacion
                                            </span>
                                        </div>
                                        <h3 className="font-black text-slate-900 mt-4">Validador</h3>
                                        <p className="text-sm text-slate-500 mt-1">
                                            Abre el modulo de entrenamiento y validacion de colaboradores.
                                        </p>
                                    </button>
                                </div>

                                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                                    <div className="px-5 py-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                        <div>
                                            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                                                <Download className="w-5 h-5 text-teal-600" />
                                                Turnos GeoVictoria
                                            </h3>
                                            <p className="text-sm text-slate-500 mt-1">
                                                Sube una sola vez el Excel maestro de turnos. Se guardara para futuras exportaciones.
                                            </p>
                                            {geoVictoriaTurnoMeta && (
                                                <p className="text-xs text-teal-700 font-bold mt-2">
                                                    {geoVictoriaTurnoMeta.count} turnos guardados
                                                    {geoVictoriaTurnoMeta.fileName ? ` | ${geoVictoriaTurnoMeta.fileName}` : ''}
                                                </p>
                                            )}
                                        </div>
                                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                                            <GeoVictoriaUpload
                                                onTurnosLoaded={handleGeoVictoriaTurnosLoaded}
                                                initialCount={Object.keys(geoVictoriaTurnoMap).length}
                                                label={geoVictoriaTurnoSaving ? 'Guardando turnos...' : 'Actualizar Excel de turnos'}
                                                compact
                                            />
                                        </div>
                                    </div>

                                    {geoVictoriaTurnoSaving && (
                                        <div className="px-5 py-3 bg-teal-50 text-teal-700 text-sm font-bold border-b border-teal-100">
                                            Guardando configuracion GeoVictoria...
                                        </div>
                                    )}
                                </div>

                                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                                    <div className="px-5 py-4 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                                        <div>
                                            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                                                <Clock className="w-5 h-5 text-red-600" />
                                                Tiempo extra GeoVictoria
                                            </h3>
                                            <p className="text-sm text-slate-500 mt-1">
                                                Sube el Excel de tiempo extra y cruza las marcaciones por DNI contra usuarios del sistema.
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => geoVictoriaExtraInputRef.current?.click()}
                                                disabled={geoVictoriaExtraImporting}
                                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <Upload className="w-4 h-4" />
                                                {geoVictoriaExtraImporting ? 'Importando...' : 'Subir Tiempo Extra'}
                                            </button>
                                            <button
                                                onClick={() => geoVictoriaLateInputRef.current?.click()}
                                                disabled={geoVictoriaLateImporting}
                                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <Clock className="w-4 h-4" />
                                                {geoVictoriaLateImporting ? 'Procesando tardanzas...' : 'Tardanzas'}
                                            </button>
                                            <button
                                                onClick={loadGeoVictoriaExtraHours}
                                                disabled={geoVictoriaExtraLoading}
                                                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <RefreshCw className={`w-4 h-4 ${geoVictoriaExtraLoading ? 'animate-spin' : ''}`} />
                                                Actualizar
                                            </button>
                                            <button
                                                onClick={handleExportGeoVictoriaExtraFilteredPDF}
                                                disabled={geoVictoriaExtraLoading || geoVictoriaExtraFilteredRecords.length === 0}
                                                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-700 text-sm font-bold hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-red-100"
                                            >
                                                <FaFilePdf className="w-4 h-4" />
                                                PDF filtrado
                                            </button>
                                        </div>
                                    </div>

                                    <div className="p-5 space-y-5">
                                        {geoVictoriaExtraImportResult && (
                                            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                                                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-black text-red-900 uppercase tracking-wide">Ultima importacion</p>
                                                        <p className="text-sm text-red-800 mt-1">
                                                            {geoVictoriaExtraImportResult.uploadedRecords} registro(s) subido(s), total {formatDurationMinutes(geoVictoriaExtraImportResult.totalMinutes)}.
                                                        </p>
                                                        <p className="text-xs text-red-700 mt-1">
                                                            Archivo: {geoVictoriaExtraImportResult.fileName} | Nuevos: {geoVictoriaExtraImportResult.created} | Actualizados: {geoVictoriaExtraImportResult.updated}
                                                        </p>
                                                        <p className="text-xs text-red-600 mt-1">
                                                            Sin DNI: {geoVictoriaExtraImportResult.skippedNoDni} | Sin usuario: {geoVictoriaExtraImportResult.unmatchedRows} | Sin fecha: {geoVictoriaExtraImportResult.invalidDateRows} | Sin TE: {geoVictoriaExtraImportResult.noExtraRows}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => setGeoVictoriaExtraImportResult(null)}
                                                        className="self-start p-1.5 rounded-lg text-red-500 hover:text-red-800 hover:bg-white transition-colors"
                                                        title="Cerrar resumen"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>

                                                {geoVictoriaExtraImportResult.totalByStaff.length > 0 && (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {geoVictoriaExtraImportResult.totalByStaff.slice(0, 8).map((row) => (
                                                            <span key={row.staffId} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-red-100 text-xs font-bold text-red-800">
                                                                {row.name}
                                                                <span className="font-black">{formatDurationMinutes(row.totalMinutes)}</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Registros</p>
                                                <p className="text-2xl font-black text-slate-900">{geoVictoriaExtraTotals.records}</p>
                                            </div>
                                            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Colaboradores</p>
                                                <p className="text-2xl font-black text-blue-900">{geoVictoriaExtraTotals.collaborators}</p>
                                            </div>
                                            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">TE Entrada</p>
                                                <p className="text-2xl font-black text-emerald-900">{formatDurationMinutes(geoVictoriaExtraTotals.preMinutes)}</p>
                                            </div>
                                            <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">TE Salida</p>
                                                <p className="text-2xl font-black text-orange-900">{formatDurationMinutes(geoVictoriaExtraTotals.postMinutes)}</p>
                                            </div>
                                            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Total HE</p>
                                                <p className="text-2xl font-black text-red-900">{formatDurationMinutes(geoVictoriaExtraTotals.totalMinutes)}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="text-xs font-black uppercase tracking-widest text-slate-500">Desde</label>
                                                <input
                                                    type="date"
                                                    value={geoVictoriaExtraDateFrom}
                                                    onChange={(e) => setGeoVictoriaExtraDateFrom(e.target.value)}
                                                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-black uppercase tracking-widest text-slate-500">Hasta</label>
                                                <input
                                                    type="date"
                                                    value={geoVictoriaExtraDateTo}
                                                    onChange={(e) => setGeoVictoriaExtraDateTo(e.target.value)}
                                                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                                                />
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className="text-xs font-black uppercase tracking-widest text-slate-500">Colaborador</label>
                                                <select
                                                    value={geoVictoriaExtraStaffFilter}
                                                    onChange={(e) => setGeoVictoriaExtraStaffFilter(e.target.value)}
                                                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
                                                >
                                                    <option value="">Todos</option>
                                                    {geoVictoriaExtraCollaborators.map((person) => (
                                                        <option key={person.key} value={person.key}>
                                                            {person.label}{person.dni ? ` - ${person.dni}` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                                            <table className="w-full text-sm">
                                                <thead className="bg-slate-100 text-slate-600 text-[11px] uppercase tracking-wider">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left">Periodo</th>
                                                        <th className="px-4 py-3 text-left">Colaborador</th>
                                                        <th className="px-4 py-3 text-left">DNI</th>
                                                        <th className="px-4 py-3 text-left">Turno</th>
                                                        <th className="px-4 py-3 text-left">Entrada</th>
                                                        <th className="px-4 py-3 text-left">TE Entrada</th>
                                                        <th className="px-4 py-3 text-left">Salio</th>
                                                        <th className="px-4 py-3 text-left">TE Salida</th>
                                                        <th className="px-4 py-3 text-left">Total</th>
                                                        <th className="px-4 py-3 text-left">PDF</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 bg-white">
                                                    {geoVictoriaExtraLoading ? (
                                                        <tr>
                                                            <td colSpan={10} className="px-4 py-8 text-center text-slate-500 font-semibold">Cargando registros...</td>
                                                        </tr>
                                                    ) : geoVictoriaExtraFilteredRecords.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={10} className="px-4 py-8 text-center text-slate-500 font-semibold">No hay horas extra para los filtros seleccionados.</td>
                                                        </tr>
                                                    ) : (
                                                        geoVictoriaExtraFilteredRecords.map((record) => (
                                                            <tr key={record.id} className="hover:bg-slate-50">
                                                                <td className="px-4 py-3 font-semibold text-slate-800">
                                                                    {record.periodStart && record.periodEnd
                                                                        ? `${record.periodStart} a ${record.periodEnd}`
                                                                        : (record.fecha || '-')}
                                                                </td>
                                                                <td className="px-4 py-3 text-slate-800">{`${record.name || ''} ${record.lastName || ''}`.trim() || '-'}</td>
                                                                <td className="px-4 py-3 font-mono text-xs text-slate-500">{record.dni || '-'}</td>
                                                                <td className="px-4 py-3 text-slate-600">{record.turno || '-'}</td>
                                                                <td className="px-4 py-3 text-slate-600">{record.entrada || record.inicio || '-'}</td>
                                                                <td className="px-4 py-3 font-bold text-emerald-700">{formatDurationMinutes(record.extraMinutesPre)}</td>
                                                                <td className="px-4 py-3 text-slate-600">{record.salida || record.fin || '-'}</td>
                                                                <td className="px-4 py-3 font-bold text-orange-700">{formatDurationMinutes(record.extraMinutesPost)}</td>
                                                                <td className="px-4 py-3">
                                                                    <span className="inline-flex px-2 py-1 rounded-full bg-red-50 text-red-700 text-xs font-black">
                                                                        {formatDurationMinutes(getExtraRecordMinutes(record))}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <button
                                                                        onClick={() => handleExportGeoVictoriaExtraPDF(record)}
                                                                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-black hover:bg-red-700 transition-colors"
                                                                        title="Descargar PDF"
                                                                    >
                                                                        <FaFilePdf className="w-3.5 h-3.5" />
                                                                        PDF
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                                    <div className="px-5 py-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                        <div>
                                            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                                                <BarChart3 className="w-5 h-5 text-emerald-700" />
                                                Analisis de tiempo
                                            </h3>
                                            <p className="text-sm text-slate-500 mt-1">
                                                Sube Usuarios Activos y compara por DNI contra la plantilla del sistema.
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => hrAnalysisInputRef.current?.click()}
                                            disabled={hrAnalysisLoading}
                                            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <Upload className="w-4 h-4" />
                                            {hrAnalysisLoading ? 'Analizando...' : 'Subir Usuarios Activos'}
                                        </button>
                                    </div>

                                    <div className="p-5">
                                        {hrAnalysisError && (
                                            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm font-semibold flex items-center gap-2">
                                                <AlertCircle className="w-4 h-4" />
                                                {hrAnalysisError}
                                            </div>
                                        )}

                                        {!hrTimeAnalysis ? (
                                            <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center bg-slate-50">
                                                <Clock className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                                                <p className="font-bold text-slate-700">Sin analisis cargado</p>
                                                <p className="text-sm text-slate-500 mt-1">
                                                    El archivo debe contener Identificador y Fecha ultimo estado de activacion.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="space-y-5">
                                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Emparejados</p>
                                                        <p className="text-2xl font-black text-emerald-900">{hrTimeAnalysis.matched.length}</p>
                                                    </div>
                                                    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Sistema activo</p>
                                                        <p className="text-2xl font-black text-blue-900">{hrTimeAnalysis.totalProgram}</p>
                                                    </div>
                                                    <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Solo sistema</p>
                                                        <p className="text-2xl font-black text-orange-900">{hrTimeAnalysis.missingInExcel.length + hrTimeAnalysis.missingDni.length}</p>
                                                    </div>
                                                    <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-purple-700">Solo Excel</p>
                                                        <p className="text-2xl font-black text-purple-900">{hrTimeAnalysis.missingInProgram.length}</p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                                                    {hrTimeAnalysis.bucketSummary.map((bucket) => (
                                                        <div key={bucket.label} className="rounded-xl border border-slate-200 bg-white p-4">
                                                            <div className="flex justify-between items-center gap-3">
                                                                <p className="text-xs font-black uppercase text-slate-600">{bucket.label}</p>
                                                                <p className="text-lg font-black text-slate-900">{bucket.percentage}%</p>
                                                            </div>
                                                            <div className="w-full h-2 rounded-full bg-slate-100 mt-3 overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-emerald-600"
                                                                    style={{ width: `${bucket.percentage}%` }}
                                                                />
                                                            </div>
                                                            <p className="text-xs text-slate-500 mt-2">{bucket.count} colaborador(es)</p>
                                                        </div>
                                                    ))}
                                                </div>

                                                {(hrTimeAnalysis.lessThanOneMonth > 0 || hrTimeAnalysis.invalidActivation > 0) && (
                                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-semibold">
                                                        {hrTimeAnalysis.lessThanOneMonth > 0 && `${hrTimeAnalysis.lessThanOneMonth} colaborador(es) tienen menos de 1 mes. `}
                                                        {hrTimeAnalysis.invalidActivation > 0 && `${hrTimeAnalysis.invalidActivation} emparejado(s) no tienen fecha de activacion valida.`}
                                                    </div>
                                                )}

                                                {(hrTimeAnalysis.excludedManagementExcel > 0 || hrTimeAnalysis.excludedManagementStaff > 0) && (
                                                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 font-semibold">
                                                        Excluidos del analisis por jefatura/gerencia: {hrTimeAnalysis.excludedManagementStaff} en sistema y {hrTimeAnalysis.excludedManagementExcel} en Excel.
                                                    </div>
                                                )}

                                                <div className="overflow-x-auto rounded-xl border border-slate-200">
                                                    <table className="w-full text-sm">
                                                        <thead className="bg-slate-100 text-slate-600 text-[11px] uppercase tracking-wider">
                                                            <tr>
                                                                <th className="px-4 py-3 text-left">Colaborador</th>
                                                                <th className="px-4 py-3 text-left">DNI</th>
                                                                <th className="px-4 py-3 text-left">F. Activacion</th>
                                                                <th className="px-4 py-3 text-left">Tiempo</th>
                                                                <th className="px-4 py-3 text-left">Rango</th>
                                                                <th className="px-4 py-3 text-left">Modalidad</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100 bg-white">
                                                            {hrTimeAnalysis.matched.map((row) => (
                                                                <tr key={row.id} className="hover:bg-slate-50">
                                                                    <td className="px-4 py-3 font-semibold text-slate-800">{row.name || '-'}</td>
                                                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.dni}</td>
                                                                    <td className="px-4 py-3 text-slate-700">{formatHrDate(row.activationDate)}</td>
                                                                    <td className="px-4 py-3 text-slate-700">{row.tenure?.label || 'Sin fecha valida'}</td>
                                                                    <td className="px-4 py-3">
                                                                        <span className="inline-flex px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase">
                                                                            {row.bucket}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-slate-600">{row.modality}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                    <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
                                                        <p className="text-xs font-black uppercase tracking-widest text-orange-700 mb-2">En sistema y no en Excel</p>
                                                        <div className="space-y-1 text-sm text-orange-900 max-h-32 overflow-y-auto">
                                                            {[...hrTimeAnalysis.missingInExcel, ...hrTimeAnalysis.missingDni].length === 0 ? (
                                                                <p className="text-orange-700">Sin diferencias.</p>
                                                            ) : (
                                                                [...hrTimeAnalysis.missingInExcel, ...hrTimeAnalysis.missingDni].map((person) => (
                                                                    <p key={person.id}>{person.name} {person.lastName} <span className="font-mono text-xs">({person.dni || 'sin DNI'})</span></p>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-xl border border-purple-100 bg-purple-50 p-4">
                                                        <p className="text-xs font-black uppercase tracking-widest text-purple-700 mb-2">En Excel y no en sistema</p>
                                                        <div className="space-y-1 text-sm text-purple-900 max-h-32 overflow-y-auto">
                                                            {hrTimeAnalysis.missingInProgram.length === 0 ? (
                                                                <p className="text-purple-700">Sin diferencias.</p>
                                                            ) : (
                                                                hrTimeAnalysis.missingInProgram.map((person) => (
                                                                    <p key={person.dni}>{person.fullName || 'Sin nombre'} <span className="font-mono text-xs">({person.dni})</span></p>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <p className="text-xs text-slate-400">
                                                    Archivo: {hrTimeAnalysis.fileName} | Fecha base: {formatHrDate(new Date())} | Filas omitidas: {hrTimeAnalysis.skippedRows}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {geoVictoriaImportResult && (
                    <div className={`mb-6 p-4 border rounded-2xl shadow-sm flex flex-col gap-3 ${geoVictoriaImportResult.created.length > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-xl ${geoVictoriaImportResult.created.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {geoVictoriaImportResult.created.length > 0 ? <UserCheck className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                                </div>
                                <div>
                                    <p className={`font-black text-sm uppercase tracking-wide ${geoVictoriaImportResult.created.length > 0 ? 'text-emerald-900' : 'text-blue-900'}`}>
                                        Importación Geovictoria
                                    </p>
                                    <p className="text-sm text-gray-700">
                                        {geoVictoriaImportResult.created.length > 0
                                            ? `${geoVictoriaImportResult.created.length} ingreso(s) nuevo(s) detectado(s). Haz click en un nombre para completar modalidad y carnet.`
                                            : `No hubo ingresos nuevos. ${geoVictoriaImportResult.existingCount} usuario(s) ya existían por DNI.`}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Archivo: {geoVictoriaImportResult.fileName} · Omitidos: {geoVictoriaImportResult.skippedCount}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setGeoVictoriaImportResult(null)}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-white rounded-lg transition-colors"
                                title="Cerrar notificación"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {geoVictoriaImportResult.created.length > 0 && (
                            <div className="flex flex-wrap gap-2 pl-12">
                                {geoVictoriaImportResult.created.map((person) => (
                                    <button
                                        key={person.id}
                                        onClick={() => setEditModal({ ...person, isNew: false })}
                                        className="px-3 py-1.5 bg-white border border-emerald-200 text-emerald-800 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-colors"
                                        title="Completar datos del colaborador"
                                    >
                                        {person.name} {person.lastName}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Stats Cards - Rediseño Minimalista */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
                    {/* Total Plantilla */}
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
                        <div className="p-3 bg-indigo-50 rounded-xl">
                            <Users className="w-6 h-6 text-indigo-600" />
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Total Plantilla</p>
                            <p className="text-2xl font-black text-gray-900">{fullTimeCount + partTimeCount}</p>
                        </div>
                    </div>

                    {/* Full-Time */}
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
                        <div className="p-3 bg-emerald-50 rounded-xl">
                            <UserCheck className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Full-Time</p>
                            <p className="text-2xl font-black text-gray-900">{fullTimeCount}</p>
                        </div>
                    </div>

                    {/* Part-Time */}
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
                        <div className="p-3 bg-purple-50 rounded-xl">
                            <Clock className="w-6 h-6 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Part-Time</p>
                            <p className="text-2xl font-black text-gray-900">{partTimeCount}</p>
                        </div>
                    </div>

                    {/* Trainees */}
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md">
                        <div className="p-3 bg-orange-50 rounded-xl">
                            <Award className="w-6 h-6 text-orange-600" />
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Entrenamiento</p>
                            <div className="flex items-baseline gap-2">
                                <p className="text-2xl font-black text-gray-900">{traineeCount}</p>
                                {traineeCount > 0 && (
                                    <span className="text-[10px] font-bold text-orange-600">
                                        (FT:{traineeFTCount} PT:{traineePTCount})
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Carnets de Sanidad */}
                    <div
                        onClick={exportCarnetExpiringPDF}
                        className="bg-white border border-red-100 rounded-2xl shadow-sm p-6 flex items-center gap-4 transition-all hover:shadow-md hover:border-red-200 cursor-pointer group"
                    >
                        <div className="p-3 bg-red-50 rounded-xl group-hover:bg-red-100 transition-colors">
                            <AlertCircle className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">Carnets Críticos</p>
                            <div className="flex items-baseline gap-2">
                                <p className="text-2xl font-black text-red-600">
                                    {staff.filter(s => {
                                        if (!isActiveInSystem(s)) return false;
                                        if (!s.sanitaryCardDate) return false;
                                        const expiry = new Date(s.sanitaryCardDate + 'T00:00:00');
                                        const now = new Date();
                                        now.setHours(0, 0, 0, 0);
                                        return expiry < now;
                                    }).length}
                                </p>
                                <span className="text-[10px] font-bold text-red-400 uppercase">Vencidos</span>
                            </div>
                        </div>
                    </div>
                </div>


                {/* Filters and Actions - Refinado */}
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 mb-8">
                    <div className="flex flex-col lg:flex-row gap-4 items-center">
                        <div className="flex-1 w-full lg:w-auto relative">
                            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre o DNI..."
                                className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm outline-none"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        
                        <div className="flex items-center gap-3 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0">
                            <select
                                className="px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm outline-none font-medium text-gray-700 min-w-[140px]"
                                value={modalityFilter}
                                onChange={(e) => setModalityFilter(e.target.value)}
                            >
                                <option value="Todos">Todas las modalidades</option>
                                <option value="Full-Time">Full-Time</option>
                                <option value="Part-Time">Part-Time</option>
                                <option value="Trainee">🎓 Entrenamiento</option>
                            </select>

                            <button
                                onClick={() => setShowTrainingReport(true)}
                                className="flex items-center gap-2 px-6 py-3 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-orange-200 hover:text-orange-600 transition-all text-sm font-bold whitespace-nowrap"
                            >
                                <Award className="w-4 h-4" />
                                Avances
                            </button>

                            <button
                                onClick={fetchAllStaffProfiles}
                                className="flex items-center justify-center p-3 border border-gray-200 text-gray-500 rounded-xl hover:bg-gray-50 transition-all"
                                title="Actualizar lista"
                            >
                                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            </button>

                            <button
                                onClick={handleAddStaff}
                                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-indigo-300 transition-all text-sm font-bold whitespace-nowrap ml-2"
                            >
                                <Plus className="w-4 h-4" />
                                Agregar Personal
                            </button>
                        </div>
                    </div>
                </div>

                {/* Staff Table */}
                {loading ? (
                    <div className="bg-white rounded-xl shadow-md p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                        <p className="text-gray-600 font-medium">Cargando personal...</p>
                    </div>
                ) : filteredStaff.length > 0 ? (
                    <div className="bg-white rounded-xl shadow-md overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50/50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-8 py-4 text-left text-[11px] font-bold text-gray-500 uppercase tracking-widest">Nombre y Detalle</th>
                                        <th className="px-8 py-4 text-left text-[11px] font-bold text-gray-500 uppercase tracking-widest">Modalidad</th>
                                        <th className="px-6 py-4 text-left text-[11px] font-bold text-gray-500 uppercase tracking-widest">Rol</th>
                                        <th className="px-6 py-4 text-center text-[11px] font-bold text-gray-500 uppercase tracking-widest">App</th>
                                        <th className="px-6 py-4 text-left text-[11px] font-bold text-gray-500 uppercase tracking-widest">Carnet Sanidad</th>
                                        <th className="px-6 py-4 text-center text-[11px] font-bold text-gray-500 uppercase tracking-widest">Estado</th>
                                        <th className="px-6 py-4 text-center text-[11px] font-bold text-gray-500 uppercase tracking-widest">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {filteredStaff.map((colab, idx) => (
                                        <tr
                                            key={idx}
                                            className="hover:bg-blue-50 transition-colors duration-150 group"
                                        >
                                            <td className="px-8 py-5 relative">
                                                <div className="flex flex-col gap-1">
                                                    <span
                                                        onClick={() => handleViewHolidays(colab)}
                                                        className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer hover:underline transition-colors text-base leading-relaxed"
                                                    >
                                                        {`${colab.name} ${colab.lastName}`}
                                                    </span>
                                                    {colab.isTrainee && (
                                                        <span className="text-xs font-bold text-orange-700 bg-orange-100 border border-orange-300 px-2 py-0.5 rounded-full w-fit flex items-center gap-1">
                                                            🎓 TRAINEE
                                                        </span>
                                                    )}
                                                    {colab.position === 'ENTRENADOR' && (
                                                        <span className="text-xs font-bold text-blue-700 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded-full w-fit flex items-center gap-1">
                                                            ⭐ ENTRENADOR / TRAINER
                                                        </span>
                                                    )}
                                                    {colab.cessationDate && (() => {
                                                        const today = new Date(); today.setHours(0, 0, 0, 0);
                                                        const cessation = new Date(colab.cessationDate + 'T00:00:00');
                                                        if (cessation < today) {
                                                            return (
                                                                <span className="text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full w-fit">
                                                                    CESADO el {cessation.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                                </span>
                                                            );
                                                        } else {
                                                            return (
                                                                <span className="text-xs font-semibold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full w-fit">
                                                                    Cese: {cessation.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                                </span>
                                                            );
                                                        }
                                                    })()}
                                                    {colab.modalityChangeDate && colab.nextModality && (() => {
                                                        const todayStr = new Date().toISOString().split('T')[0];
                                                        if (colab.modalityChangeDate > todayStr) {
                                                            return (
                                                                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full w-fit flex items-center gap-1 mt-1">
                                                                    ⚡ CAMBIA A {colab.nextModality} EL {new Date(colab.modalityChangeDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                                                                </span>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                                <div className="hidden group-hover:block absolute top-full left-0 mt-2 bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 z-20 w-72">
                                                    <div className="space-y-1.5">
                                                        <p><strong>ID:</strong> {colab.id}</p>
                                                        <p><strong>Correo:</strong> {colab.email || "No vinculado"}</p>
                                                        <p><strong>Feriados:</strong> {colab.feriados}</p>
                                                        <p><strong>DNI:</strong> {colab.dni || "No registrado"}</p>
                                                        <p><strong>StoreId:</strong> {colab.storeId || "No asignado"}</p>
                                                        {colab.uid && <p><strong>UID:</strong> {colab.uid}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-8 py-4">
                                                <div className="flex items-center">
                                                    <span className={`px-3 py-1 rounded-lg text-xs font-bold border ${colab.modality === "Full-Time"
                                                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                                        : "bg-purple-50 text-purple-700 border-purple-100"
                                                        }`}>
                                                        {colab.modality?.toUpperCase()}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-gray-700">
                                                <span className="text-base">{colab.position || 'colaborador'}</span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex flex-col items-center gap-1.5">
                                                    {colab.uid ? (
                                                        <CheckCircle2 className="text-emerald-500 w-5 h-5" />
                                                    ) : (
                                                        <XCircle className="text-gray-300 w-5 h-5" />
                                                    )}
                                                    <button
                                                        onClick={() => openPositionModal(colab)}
                                                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold uppercase tracking-tighter"
                                                    >
                                                        Posiciones
                                                    </button>
                                                </div>
                                            </td>
                                            {/* Carnet Sanidad */}
                                            <td className="px-6 py-5">
                                                <div className="flex flex-col gap-1">
                                                    {colab.sanitaryCardDate ? (
                                                        <>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-xs font-bold px-2 py-1 rounded-full ${(() => {
                                                                    const expiry = new Date(colab.sanitaryCardDate + 'T00:00:00');
                                                                    const now = new Date(); now.setHours(0, 0, 0, 0);
                                                                    if (expiry < now) return "bg-red-100 text-red-700 border border-red-200";
                                                                    const diff = (expiry - now) / (1000 * 60 * 60 * 24);
                                                                    if (diff <= 15) return "bg-orange-100 text-orange-700 border border-orange-200";
                                                                    return "bg-green-100 text-green-700 border border-green-200";
                                                                })()
                                                                    }`}>
                                                                    {new Date(colab.sanitaryCardDate + 'T00:00:00').toLocaleDateString('es-ES')}
                                                                </span>
                                                                {colab.sanitaryCardUnlock && (
                                                                    <FaLockOpen className="text-green-500 text-xs" title="Acceso desbloqueado manualmente" />
                                                                )}
                                                            </div>
                                                            {(() => {
                                                                const expiry = new Date(colab.sanitaryCardDate + 'T00:00:00');
                                                                const now = new Date(); now.setHours(0, 0, 0, 0);
                                                                if (expiry < now) {
                                                                    return <span className="text-[10px] font-bold text-red-600 uppercase">Vencido</span>;
                                                                }
                                                                const diff = (expiry - now) / (1000 * 60 * 60 * 24);
                                                                if (diff <= 15) {
                                                                    return <span className="text-[10px] font-bold text-orange-600 uppercase">Vence pronto</span>;
                                                                }
                                                                return null;
                                                            })()}
                                                        </>
                                                    ) : (
                                                        <span className="text-xs text-gray-400 italic">No registrado</span>
                                                    )}
                                                </div>
                                            </td>
                                            {/* Columna Estado / Cesar */}
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => handleCessation(colab)}
                                                    className={`w-full text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border transition-all ${
                                                        colab.cessationDate && new Date(colab.cessationDate + 'T00:00:00') < new Date(new Date().setHours(0, 0, 0, 0))
                                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                                            : "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                                                    }`}
                                                >
                                                    {colab.cessationDate && new Date(colab.cessationDate + 'T00:00:00') < new Date(new Date().setHours(0, 0, 0, 0))
                                                        ? "Reingreso: nueva ficha"
                                                        : "Cesar"
                                                    }
                                                </button>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-2">
                                                    {colab.isTrainee && (
                                                        <button
                                                            onClick={async () => {
                                                                if (!window.confirm(`¿Finalizar el entrenamiento de ${colab.name} ${colab.lastName} y conservar su historial como cese?`)) return;
                                                                try {
                                                                    await finishStaffTraining(colab.id, limaToday());
                                                                    await fetchAllStaffProfiles();
                                                                } catch (err) { alert('Error: ' + err.message); }
                                                            }}
                                                            className="text-[9px] font-black uppercase tracking-tighter text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-2 py-1.5 rounded-lg transition-all"
                                                        >
                                                            Fin Entrenamiento
                                                        </button>
                                                    )}
                                                    
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => {
                                                                setSelectedStaff(colab);
                                                                setShowScheduleEditor(true);
                                                            }}
                                                            className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                                                            title="Ver horarios"
                                                        >
                                                            <Calendar className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditModal({ ...colab, isNew: false })}
                                                            className="p-2 text-amber-600 hover:bg-amber-50 rounded-xl transition-all"
                                                            title="Editar"
                                                        >
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(colab.uid, colab)}
                                                            className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleUnlinkEmail(colab.id)}
                                                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all disabled:opacity-30"
                                                            disabled={!colab.uid}
                                                            title="Vínculo protegido; usa el flujo de cese y reingreso"
                                                        >
                                                            <Unlink className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-md p-12 text-center">
                        <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600 font-medium text-lg">No se encontraron registros de personal para esta tienda</p>
                    </div>
                )}

                {/* MODALES */}
                {editModal && (
                    <StaffModal
                        staff={editModal.isNew ? null : editModal}
                        userData={userData}
                        onClose={() => setEditModal(null)}
                        onSaved={async () => {
                            setEditModal(null);
                            await fetchAllStaffProfiles();
                        }}
                    />
                )}

                {showScheduleEditor && selectedStaff && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-2xl">
                                <h3 className="text-xl font-bold text-gray-800">Editor de Horarios</h3>
                                <button
                                    onClick={() => {
                                        setShowScheduleEditor(false);
                                        setSelectedStaff(null);
                                    }}
                                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5 text-gray-600" />
                                </button>
                            </div>
                            <div className="p-6">
                                <StudyScheduleEditor
                                    uid={selectedStaff.uid || selectedStaff.id}
                                    onClose={() => {
                                        setShowScheduleEditor(false);
                                        setSelectedStaff(null);
                                    }}
                                    onSaved={fetchAllStaffProfiles}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {positionModalOpen && (
                    <ModalSelectorDePosiciones
                        docId={positionTarget?.id}
                        onClose={() => setPositionModalOpen(false)}
                    />
                )}

                {showHolidayModal && selectedStaff && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
                            {/* Header */}
                            <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 flex justify-between items-center text-white">
                                <h3 className="text-xl font-bold">Historial de Feriados: {selectedStaff.name}</h3>
                                <button onClick={() => setShowHolidayModal(false)} className="text-2xl hover:text-gray-200">&times;</button>
                            </div>
                            {/* Body */}
                            <div className="p-6 overflow-y-auto flex-1">
                                <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl flex justify-between items-center">
                                    <div>
                                        <p className="text-blue-600 text-sm font-medium">Balance Actual</p>
                                        <p className="text-3xl font-bold text-blue-900">{selectedStaff.feriados} días</p>
                                    </div>
                                    <Calendar className="w-12 h-12 text-blue-200" />
                                </div>
                                <div className="space-y-3">
                                    <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Movimientos</h4>
                                    {selectedHolidays.length === 0 ? (
                                        <p className="text-center py-8 text-gray-400">No hay movimientos registrados</p>
                                    ) : (
                                        <div className="bg-white border rounded-xl overflow-hidden">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-gray-50 text-gray-500 font-medium border-b">
                                                    <tr>
                                                        <th className="px-4 py-3">Fecha</th>
                                                        <th className="px-4 py-3">Concepto</th>
                                                        <th className="px-4 py-3 text-right">Efecto</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {selectedHolidays.map((h, i) => (
                                                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                                                            <td className="px-4 py-3 font-medium text-gray-900">
                                                                {h.date ? new Date(h.date + 'T00:00:00').toLocaleDateString('es-ES') : '—'}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-600">
                                                                {h.name}
                                                                {h.isPending && <span className="ml-2 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] font-bold rounded uppercase">Migrado</span>}
                                                            </td>
                                                            <td className={`px-4 py-3 text-right font-bold ${h.type === 'compensado' ? 'text-red-500' : 'text-green-500'}`}>
                                                                {h.type === 'compensado' ? '-1 día' : '+1 día'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* Footer */}
                            <div className="p-4 border-t bg-gray-50 flex justify-end">
                                <button
                                    onClick={() => setShowHolidayModal(false)}
                                    className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal Consultar Ceses */}
                {showCesadosModal && (() => {
                    const today = new Date(); today.setHours(0, 0, 0, 0);

                    // Filtrar por mes/año si se seleccionó un mes
                    const filtered = cesosRegistros.filter(s => {
                        if (!cesosFilterMonth) return true; // sin filtro → todos
                        return s.cessationDate && s.cessationDate.startsWith(cesosFilterMonth);
                    });

                    // Obtener meses únicos para el selector
                    const isRealCese = (registro) => registro.cessationDate && !registro.isModalityChange;
                    const getMonthLabel = (monthKey) => {
                        if (!monthKey) return 'Todos los meses';
                        const [yyyy, mm] = monthKey.split('-');
                        const label = new Date(Number(yyyy), Number(mm) - 1, 1)
                            .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
                        return label.charAt(0).toUpperCase() + label.slice(1);
                    };
                    const getMonthEnd = (monthKey) => {
                        const [yyyy, mm] = monthKey.split('-').map(Number);
                        return new Date(yyyy, mm, 0);
                    };
                    const getActiveCountForMonth = (monthKey) => {
                        if (!monthKey) return staff.filter(isStaffActiveForHr).filter(s => !s.isTrainee).length;
                        const monthEnd = getMonthEnd(monthKey);

                        return staff.filter((person) => {
                            if (person.isTrainee) return false;

                            const joinSource = person.joinDate || person.createdAt?.split?.('T')?.[0] || '';
                            if (joinSource) {
                                const joinDate = new Date(`${joinSource}T00:00:00`);
                                if (!isNaN(joinDate.getTime()) && joinDate > monthEnd) return false;
                            }

                            const endSource = person.cessationDate || person.terminationDate || '';
                            if (endSource) {
                                const endDate = new Date(`${endSource}T00:00:00`);
                                if (!isNaN(endDate.getTime()) && endDate <= monthEnd) return false;
                            }

                            return true;
                        }).length;
                    };
                    const getRotation = (cesesCount, activeCount) => {
                        const denominator = cesesCount + activeCount;
                        return denominator > 0 ? (cesesCount / denominator) * 100 : 0;
                    };

                    const realCesesFiltered = filtered.filter(isRealCese);
                    const realCesesFullTime = realCesesFiltered.filter(s => s.modality === 'Full-Time').length;
                    const realCesesPartTime = realCesesFiltered.filter(s => s.modality === 'Part-Time').length;
                    const activeForSelectedMonth = cesosFilterMonth ? getActiveCountForMonth(cesosFilterMonth) : getActiveCountForMonth('');
                    const selectedRotation = cesosFilterMonth
                        ? getRotation(realCesesFiltered.length, activeForSelectedMonth)
                        : null;

                    const uniqueMonths = [...new Set(
                        cesosRegistros
                            .filter(s => s.cessationDate)
                            .map(s => s.cessationDate.slice(0, 7)) // "2026-02"
                    )].sort((a, b) => b.localeCompare(a)); // más reciente primero

                    const monthlyRotation = uniqueMonths.map(monthKey => {
                        const monthCeses = cesosRegistros.filter(s =>
                            isRealCese(s) && s.cessationDate.startsWith(monthKey)
                        );
                        const activeCount = getActiveCountForMonth(monthKey);
                        const fullTime = monthCeses.filter(s => s.modality === 'Full-Time').length;
                        const partTime = monthCeses.filter(s => s.modality === 'Part-Time').length;
                        return {
                            monthKey,
                            monthLabel: getMonthLabel(monthKey),
                            ceses: monthCeses.length,
                            fullTime,
                            partTime,
                            activeCount,
                            rotation: getRotation(monthCeses.length, activeCount),
                        };
                    });

                    return (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

                                {/* Header */}
                                <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-orange-500 to-orange-600 flex-shrink-0">
                                    <div>
                                        <h2 className="text-xl font-bold text-white">Historial de Ceses / Cambios</h2>
                                        <p className="text-orange-100 text-sm mt-0.5">
                                            {filtered.length} registro{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
                                            {cesosFilterMonth && ` en ${new Date(cesosFilterMonth + '-02').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowCesadosModal(false)}
                                        className="text-white hover:text-orange-200 transition-colors text-2xl font-bold leading-none"
                                    >
                                        &times;
                                    </button>
                                </div>

                                {/* Filtro de mes */}
                                <div className="px-6 py-3 bg-orange-50 border-b border-orange-100 flex-shrink-0 flex items-center gap-3 flex-wrap">
                                    <label className="text-sm font-semibold text-orange-800">Filtrar por mes:</label>
                                    <select
                                        value={cesosFilterMonth}
                                        onChange={e => setCesosFilterMonth(e.target.value)}
                                        className="text-sm border border-orange-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400"
                                    >
                                        <option value="">Todos los meses</option>
                                        {uniqueMonths.map(m => {
                                            const [yyyy, mm] = m.split('-');
                                            const label = new Date(Number(yyyy), Number(mm) - 1, 1)
                                                .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
                                            return <option key={m} value={m}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>;
                                        })}
                                    </select>
                                    {cesosFilterMonth && (
                                        <>
                                            <button
                                                onClick={() => setCesosFilterMonth('')}
                                                className="text-xs text-orange-600 hover:text-orange-800 underline mr-2"
                                            >
                                                Limpiar filtro
                                            </button>
                                            <button
                                                onClick={exportarReporteBajasMensualExcel}
                                                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg shadow hover:bg-green-700 hover:scale-105 transform transition-all"
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                                Descargar Reporte Mensual
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={loadCesosRegistros}
                                        className="ml-auto text-xs text-orange-700 hover:text-orange-900 flex items-center gap-1 font-medium"
                                        title="Actualizar lista"
                                    >
                                        ↻ Actualizar
                                    </button>
                                </div>

                                <div className="px-6 py-4 bg-white border-b border-gray-100 flex-shrink-0">
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Ceses reales</p>
                                            <p className="text-2xl font-black text-red-900">{realCesesFiltered.length}</p>
                                            <p className="text-[11px] text-red-600 font-semibold mt-0.5">{getMonthLabel(cesosFilterMonth)}</p>
                                        </div>
                                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Full-Time</p>
                                            <p className="text-2xl font-black text-emerald-900">{realCesesFullTime}</p>
                                            <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">Solo ceses</p>
                                        </div>
                                        <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-purple-700">Part-Time</p>
                                            <p className="text-2xl font-black text-purple-900">{realCesesPartTime}</p>
                                            <p className="text-[11px] text-purple-600 font-semibold mt-0.5">Solo ceses</p>
                                        </div>
                                        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Rotacion</p>
                                            <p className="text-2xl font-black text-orange-900">
                                                {selectedRotation === null ? '-' : `${selectedRotation.toFixed(1)}%`}
                                            </p>
                                            <p className="text-[11px] text-orange-600 font-semibold mt-0.5">
                                                {cesosFilterMonth ? `${realCesesFiltered.length} / (${realCesesFiltered.length} + ${activeForSelectedMonth})` : 'Selecciona un mes'}
                                            </p>
                                        </div>
                                    </div>

                                    {monthlyRotation.length > 0 && (
                                        <div className="mt-4 rounded-xl border border-gray-200 overflow-hidden">
                                            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                                                <p className="text-xs font-black uppercase tracking-widest text-gray-600">Rotacion por mes</p>
                                                <p className="text-[11px] text-gray-400 font-semibold">Formula: ceses / (ceses + activos)</p>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-white text-gray-500 uppercase tracking-wider">
                                                        <tr>
                                                            <th className="px-4 py-2 text-left">Mes</th>
                                                            <th className="px-4 py-2 text-center">Ceses</th>
                                                            <th className="px-4 py-2 text-center">FT</th>
                                                            <th className="px-4 py-2 text-center">PT</th>
                                                            <th className="px-4 py-2 text-center">Activos</th>
                                                            <th className="px-4 py-2 text-center">Rotacion</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100">
                                                        {monthlyRotation.map((row) => (
                                                            <tr key={row.monthKey} className={cesosFilterMonth === row.monthKey ? 'bg-orange-50' : 'bg-white'}>
                                                                <td className="px-4 py-2 font-bold text-gray-800">{row.monthLabel}</td>
                                                                <td className="px-4 py-2 text-center font-bold text-red-700">{row.ceses}</td>
                                                                <td className="px-4 py-2 text-center text-emerald-700 font-semibold">{row.fullTime}</td>
                                                                <td className="px-4 py-2 text-center text-purple-700 font-semibold">{row.partTime}</td>
                                                                <td className="px-4 py-2 text-center text-gray-700 font-semibold">{row.activeCount}</td>
                                                                <td className="px-4 py-2 text-center">
                                                                    <span className="inline-flex px-2 py-1 rounded-full bg-orange-100 text-orange-800 font-black">
                                                                        {row.rotation.toFixed(1)}%
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Body */}
                                <div className="overflow-y-auto flex-1 p-4">
                                    {cesosLoading ? (
                                        <div className="text-center py-12 text-gray-400">
                                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mb-3"></div>
                                            <p className="text-sm">Cargando registros...</p>
                                        </div>
                                    ) : filtered.length === 0 ? (
                                        <div className="text-center py-12 text-gray-400">
                                            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                                            <p className="font-medium">
                                                {cesosFilterMonth ? 'No hay registros en el mes seleccionado' : 'No hay registros de cese o cambio'}
                                            </p>
                                        </div>
                                    ) : (
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0">
                                                <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                                                    <th className="px-4 py-3 text-left rounded-l-lg">Colaborador</th>
                                                    <th className="px-4 py-3 text-left">DNI</th>
                                                    <th className="px-4 py-3 text-left">Modalidad</th>
                                                    <th className="px-4 py-3 text-left">F. Cese / Cambio</th>
                                                    <th className="px-4 py-3 text-center rounded-r-lg">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {filtered.map((s, i) => {
                                                    const cessation = new Date(s.cessationDate + 'T00:00:00');
                                                    const isCeased = cessation < today;
                                                    return (
                                                        <tr key={i} className={`transition-colors hover:brightness-95 ${isCeased ? 'bg-red-50' : 'bg-orange-50'}`}>
                                                            <td className="px-4 py-3 font-medium">
                                                                <button
                                                                    onClick={() => abrirReporteBaja(s)}
                                                                    className="text-blue-700 hover:text-blue-900 hover:underline font-semibold text-left"
                                                                    title="Click para generar Reporte de Baja"
                                                                >
                                                                    {s.name} {s.lastName}
                                                                </button>
                                                                {s.isModalityChange ? (
                                                                    <span className="block text-[10px] font-bold text-blue-600 uppercase mt-0.5 italic">
                                                                        ⚡ Cambio de Modalidad
                                                                    </span>
                                                                ) : (
                                                                    <span className="block text-xs text-gray-400 mt-0.5">Generar reporte</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                                                                {s.dni || '—'}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-600">{s.modality || '—'}</td>
                                                            <td className="px-4 py-3 font-semibold text-gray-700">
                                                                {cessation.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                {isCeased ? (
                                                                    <span className="inline-block bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full border border-red-300">
                                                                        CESADO
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-block bg-orange-100 text-orange-700 text-xs font-bold px-3 py-1 rounded-full border border-orange-300">
                                                                        {s.isModalityChange ? "Cambio próximo" : "Cese próximo"}
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center flex-shrink-0">
                                    <span className="text-xs text-gray-400">
                                        Los registros se conservan aunque el colaborador sea eliminado del sistema.
                                    </span>
                                    <button
                                        onClick={() => setShowCesadosModal(false)}
                                        className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* ===== MODAL HISTORIAL DE FERIADOS ===== */}
                {showHolidayModal && selectedStaff && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-700 flex-shrink-0">
                                <div>
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                        <Calendar className="w-5 h-5" />
                                        Balance de Feriados
                                    </h2>
                                    <p className="text-blue-100 text-sm mt-0.5">{selectedStaff.name} {selectedStaff.lastName}</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowHolidayModal(false);
                                        setSelectedHolidays([]);
                                    }}
                                    className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            {/* Resumen del Balance */}
                            <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                                <span className="text-blue-800 font-medium">Balance Actual:</span>
                                <div className="flex items-center gap-2">
                                    <span className={`text-2xl font-bold ${selectedStaff.feriados > 0 ? 'text-green-600' : selectedStaff.feriados < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                        {selectedStaff.feriados > 0 ? `+${selectedStaff.feriados}` : selectedStaff.feriados}
                                    </span>
                                    <span className="text-sm text-blue-600 font-medium">días disponibles</span>
                                </div>
                            </div>

                            {/* Tabla de Movimientos */}
                            <div className="overflow-y-auto flex-1 p-6">
                                {selectedHolidays.length === 0 ? (
                                    <div className="text-center py-12">
                                        <Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                                        <p className="text-gray-500">No hay movimientos registrados para este colaborador.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Historial de Movimientos</p>
                                        <div className="border border-gray-100 rounded-xl overflow-hidden">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left">Fecha</th>
                                                        <th className="px-4 py-3 text-left">Concepto</th>
                                                        <th className="px-4 py-3 text-center">Tipo</th>
                                                        <th className="px-4 py-3 text-center">Impacto</th>
                                                        <th className="px-4 py-3 text-center">Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {selectedHolidays.map((h, i) => {
                                                        const isGanado = h.type === 'ganado';
                                                        return (
                                                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                                                                <td className="px-4 py-3 font-medium text-gray-700">
                                                                    {(() => {
                                                                        if (!h.date) return 'Sin fecha';
                                                                        const d = new Date(h.date + 'T00:00:00');
                                                                        return isNaN(d.getTime()) ? 'Fecha inválida' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                                                    })()}
                                                                </td>
                                                                <td className="px-4 py-3 text-gray-600">
                                                                    {h.name || 'Feriado de Ley'}
                                                                    {h.isPending && <span className="ml-2 bg-yellow-100 text-yellow-700 text-[10px] px-1.5 py-0.5 rounded font-bold">PENDIENTE</span>}
                                                                </td>
                                                                <td className="px-4 py-3 text-center">
                                                                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${isGanado ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                        {isGanado ? 'Trabajado' : 'Compensado'}
                                                                    </span>
                                                                </td>
                                                                <td className={`px-4 py-3 text-center font-bold ${isGanado ? 'text-green-600' : 'text-red-600'}`}>
                                                                    {isGanado ? '+1' : '-1'}
                                                                </td>
                                                                <td className="px-4 py-3 text-center">
                                                                    <button
                                                                        onClick={() => handleDeleteHoliday(h)}
                                                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                                        title="Eliminar este registro"
                                                                    >
                                                                        <FaTrash className="w-4 h-4" />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
                                <button
                                    onClick={() => {
                                        setShowHolidayModal(false);
                                        setSelectedHolidays([]);
                                    }}
                                    className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-all"
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* ===== MODAL REPORTE DE BAJAS ===== */}
                {reporteBajaColaborador && (() => {
                    const s = reporteBajaColaborador;
                    const fmtFecha = (str) => {
                        if (!str) return '—';
                        return new Date(str + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    };
                    const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400";
                    const selectCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400";
                    return (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden">

                                {/* Header */}
                                <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-yellow-500 to-orange-500 flex-shrink-0">
                                    <div>
                                        <h2 className="text-xl font-bold text-white">
                                            {s.isModalityChange ? "Reporte de Cambio de Modalidad" : "Reporte de Baja"}
                                        </h2>
                                        <p className="text-yellow-100 text-sm mt-0.5">{s.name} {s.lastName} · {fmtFecha(s.cessationDate)}</p>
                                    </div>
                                    <button onClick={() => setReporteBajaColaborador(null)} className="text-white hover:text-yellow-200 text-2xl font-bold">&times;</button>
                                </div>

                                {/* Datos automáticos */}
                                <div className="px-6 pt-4 pb-2 bg-yellow-50 border-b border-yellow-100 flex-shrink-0">
                                    <p className="text-xs font-bold text-yellow-800 uppercase tracking-wider mb-2">Datos del colaborador (automáticos)</p>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                        <div><span className="text-gray-500 block text-xs">Tienda</span><span className="font-semibold">{storeName || s.storeId || '—'}</span></div>
                                        <div><span className="text-gray-500 block text-xs">Puesto</span><span className="font-semibold">{s.position || 'TEAM MEMBER'}</span></div>
                                        <div><span className="text-gray-500 block text-xs">Modalidad</span><span className="font-semibold">{s.modality === 'Full-Time' ? 'FT' : s.modality === 'Part-Time' ? 'PT' : (s.modality || '—')}</span></div>
                                        <div><span className="text-gray-500 block text-xs">DNI</span><span className="font-semibold font-mono">{s.dni || '—'}</span></div>
                                        <div><span className="text-gray-500 block text-xs">Nombre</span><span className="font-semibold">{s.name} {s.lastName}</span></div>
                                        <div><span className="text-gray-500 block text-xs">Sexo</span><span className="font-semibold">{s.gender || s.sexo || '—'}</span></div>
                                        <div><span className="text-gray-500 block text-xs">Fecha Ingreso</span><span className="font-semibold">{fmtFecha(s.joinDate || s.createdAt?.split?.('T')?.[0])}</span></div>
                                        <div><span className="text-gray-500 block text-xs">{s.isModalityChange ? 'Fecha Cambio' : 'Fecha Cese'}</span><span className={`font-semibold ${s.isModalityChange ? 'text-blue-600' : 'text-red-600'}`}>{fmtFecha(s.cessationDate)}</span></div>
                                    </div>
                                </div>

                                {/* Formulario */}
                                <div className="overflow-y-auto flex-1 px-6 py-4">
                                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Datos opcionales / campos vacíos</p>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                                        {[
                                            ['diasDescansoMedico', 'Días Desc. Médico'],
                                            ['inasistencias', 'Inasistencias'],
                                            ['tardanzas', 'Tardanzas (min)'],
                                            ['horasNocturnas', 'Horas Nocturnas'],
                                            ['horasExtras', 'Horas Extras'],
                                            ['feriados', 'Feriados'],
                                            ['descuentos', 'Descuentos'],
                                        ].map(([field, label]) => (
                                            <div key={field}>
                                                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={reporteBajaForm[field]}
                                                    onChange={e => setReporteBajaForm(prev => ({ ...prev, [field]: e.target.value }))}
                                                    className={inputCls}
                                                    placeholder="0"
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Desempeño</label>
                                            <select value={reporteBajaForm.desempenio} onChange={e => setReporteBajaForm(prev => ({ ...prev, desempenio: e.target.value }))} className={selectCls}>
                                                {['BUENO', 'REGULAR', 'MALO', 'EXCELENTE'].map(o => <option key={o}>{o}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">{s.isModalityChange ? 'Motivo del Cambio' : 'Motivo de Cese'}</label>
                                            <select value={reporteBajaForm.motivoCese} onChange={e => setReporteBajaForm(prev => ({ ...prev, motivoCese: e.target.value }))} className={selectCls}>
                                                {['RENUNCIA VOLUNTARIA', 'ABANDONO DE TRABAJO', 'DESPIDO', 'TÉRMINO DE CONTRATO', 'CAMBIO DE MODALIDAD'].map(o => <option key={o}>{o}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Motivo Real</label>
                                            <select value={reporteBajaForm.motivoReal} onChange={e => setReporteBajaForm(prev => ({ ...prev, motivoReal: e.target.value }))} className={selectCls}>
                                                {['MEJORA ECONÓMICA', 'HORARIO DE ESTUDIO', 'SALUD', 'BAJO DESEMPEÑO', 'DESACUERDO CON BENEFICIOS', 'DISTANCIA DE LA TIENDA', 'FALTA GRAVE', 'HORARIO DE CIERRE EXTENDIDO', 'INASISTENCIAS', 'MAL CLIMA LABORAL', 'MEJORA CONTRACTUAL'].map(o => <option key={o}>{o}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Comentario Tienda – Describir con mayor detalle el motivo por el que se retira el colaborador</label>
                                        <textarea
                                            rows={3}
                                            value={reporteBajaForm.comentario}
                                            onChange={e => setReporteBajaForm(prev => ({ ...prev, comentario: e.target.value }))}
                                            className={`${inputCls} resize-none`}
                                            placeholder="Escriba aquí el comentario..."
                                        />
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center flex-shrink-0">
                                    <button
                                        onClick={() => setReporteBajaColaborador(null)}
                                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors text-sm"
                                    >
                                        Cancelar
                                    </button>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleSaveReporteBaja}
                                            className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 font-bold rounded-lg transition-colors text-sm flex items-center gap-2"
                                        >
                                            <Save className="w-4 h-4" />
                                            Guardar Cambios
                                        </button>
                                        <button
                                            onClick={exportarReporteBajaExcel}
                                            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-green-600 to-green-700 text-white font-bold rounded-lg shadow hover:shadow-lg transition-all text-sm"
                                        >
                                            ⬇ Descargar Excel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {showTrainingReport && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn">
                            <div className="px-6 py-4 bg-gradient-to-r from-orange-600 to-orange-700 flex justify-between items-center text-white">
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <Award className="w-6 h-6" />
                                    Reporte de Avances y Entrenamiento
                                </h3>
                                <button onClick={() => setShowTrainingReport(false)} className="text-white hover:bg-white/10 p-2 rounded-lg">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="p-6 overflow-y-auto flex-1 bg-gray-50">
                                {/* Gráfico Analítico de Habilidades */}
                                <div className="bg-white rounded-xl shadow-sm p-6 mb-10 border border-gray-200">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="p-2 bg-indigo-100 rounded-lg">
                                            <BarChart3 className="w-6 h-6 text-indigo-600" />
                                        </div>
                                        <div>
                                            <h4 className="text-lg font-bold text-gray-800 uppercase tracking-tight">Análisis de Capacitación Global</h4>
                                            <p className="text-xs text-gray-500 uppercase font-semibold">Tasa de dominio por posición (%)</p>
                                        </div>
                                    </div>

                                    {skillStats.length > 0 ? (
                                        <div className="h-[280px] w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart
                                                    data={skillStats}
                                                    layout="vertical"
                                                    margin={{ top: 0, right: 80, left: 170, bottom: 0 }}
                                                >
                                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                                    <XAxis type="number" domain={[0, 100]} hide />
                                                    <YAxis
                                                        dataKey="name"
                                                        type="category"
                                                        axisLine={false}
                                                        tickLine={false}
                                                        width={160}
                                                        interval={0}
                                                        style={{
                                                            fontSize: '10px',
                                                            fontWeight: '700',
                                                            fill: '#334155',
                                                            textTransform: 'uppercase',
                                                            letterSpacing: '0.025em'
                                                        }}
                                                    />
                                                    <Tooltip
                                                        cursor={{ fill: '#f1f5f9', radius: 4 }}
                                                        content={({ active, payload }) => {
                                                            if (active && payload && payload.length) {
                                                                const data = payload[0].payload;
                                                                return (
                                                                    <div className="bg-white border-none shadow-xl rounded-xl p-3 text-xs flex flex-col gap-1 border border-gray-100">
                                                                        <p className="font-bold text-gray-800 uppercase mb-1 border-b pb-1">{data.name}</p>
                                                                        <div className="flex justify-between items-center gap-4">
                                                                            <span className="text-gray-500 font-medium">Cobertura:</span>
                                                                            <span className="text-indigo-600 font-bold">{data.percentage}%</span>
                                                                        </div>
                                                                        <div className="flex justify-between items-center gap-4">
                                                                            <span className="text-gray-500 font-medium">Personal capaz:</span>
                                                                            <span className="text-gray-800 font-bold">{data.count} pers.</span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        }}
                                                    />
                                                    <Bar
                                                        dataKey="percentage"
                                                        radius={[0, 6, 6, 0]}
                                                        barSize={24}
                                                        label={{
                                                            position: 'right',
                                                            formatter: (val) => `${val}%`,
                                                            style: { fontSize: '11px', fontWeight: '800', fill: '#1e293b', marginLeft: '10px' }
                                                        }}
                                                    >
                                                        {skillStats.map((entry, index) => (
                                                            <Cell
                                                                key={`cell-${index}`}
                                                                fill={['#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#dc2626', '#059669', '#0891b2'][index % 7]}
                                                                fillOpacity={0.9}
                                                                className="hover:fill-opacity-100 transition-all duration-300"
                                                            />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="h-[150px] flex items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                            <p className="text-sm font-medium">No hay datos suficientes para el análisis</p>
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {staff.filter(s => isStaffActive(s)).map(s => {
                                        // Filtramos para contar solo las habilidades que existen en los requerimientos actuales de la tienda
                                        const mastered = s.skills?.filter(skill => storeRequirements.includes(skill)).length || 0;
                                        const total = storeRequirements.length || 1;
                                        const percent = Math.round((mastered / total) * 100);

                                        return (
                                            <div key={s.id} className="border border-gray-100 rounded-xl p-4 bg-gray-50 flex flex-col gap-3">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <p className="font-bold text-gray-800">{s.name} {s.lastName}</p>
                                                        <p className="text-[10px] text-gray-500 uppercase tracking-widest">{s.position || 'Colaborador'}</p>
                                                    </div>
                                                    {s.isTrainee && (
                                                        <span className="text-[9px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">TRAINEE</span>
                                                    )}
                                                </div>

                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-[10px] font-bold text-gray-600 uppercase">
                                                        <span>Progreso</span>
                                                        <span>{percent}%</span>
                                                    </div>
                                                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden shadow-inner">
                                                        <div
                                                            className={`h-full transition-all duration-1000 ${percent === 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                                                            style={{ width: `${percent}%` }}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap gap-1 mt-auto">
                                                    {s.skills?.map(skill => (
                                                        <span key={skill} className="text-[9px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-100">
                                                            {skill}
                                                        </span>
                                                    ))}
                                                    {(!s.skills || s.skills.length === 0) && (
                                                        <span className="text-[9px] text-gray-400 italic">Sin habilidades registradas</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="p-4 border-t bg-gray-50 flex justify-end">
                                <button
                                    onClick={() => setShowTrainingReport(false)}
                                    className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
                                >
                                    Cerrar Reporte
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showVHLModal && (
                    <VHLConsultation
                        storeId={userData?.storeId}
                        onClose={() => setShowVHLModal(false)}
                    />
                )}
            </div>
            {/* Modal de Solicitudes */}
            {showRequestsModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowRequestsModal(false)}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-300" onClick={e => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-8 py-6 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white flex items-center gap-3">
                                <ClipboardList className="w-6 h-6 text-orange-400" />
                                Gestión de Solicitudes de Horario
                            </h3>
                            <button
                                onClick={() => setShowRequestsModal(false)}
                                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                            >
                                <X className="w-6 h-6 text-white" />
                            </button>
                        </div>
                        <div className="p-8">
                            <ScheduleRequestsManager storeId={userData?.storeId} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default AdminDashboard;




