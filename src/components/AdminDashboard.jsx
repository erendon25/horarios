// AdminDashboard.jsx
import React, { useEffect, useState, useMemo } from "react";
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
    Settings,
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
    BarChart3
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
    setDoc
} from "firebase/firestore";
import { db } from "../firebase";
import StudyScheduleEditor from './StudyScheduleEditor';
import ModalSelectorDePosiciones from './ModalSelectorDePosiciones';
import StaffModal from './StaffModal';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';



import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

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

    const skillStats = useMemo(() => {
        const stats = {};
        const activeStaff = staff.filter(s => {
            if (s.cessationDate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const cessation = new Date(s.cessationDate + "T00:00:00");
                return cessation >= today;
            }
            return true;
        });

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

        const filtered = staff.filter(s => isCardExpiringSoon(s.sanitaryCardDate));
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


    const generateUid = () => {
        return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    };
    const handleUnlinkEmail = async (staffId) => {
        try {
            await updateDoc(doc(db, 'staff_profiles', staffId), {
                email: '',
                uid: '' // ❗ Quitamos también el UID
            });
            alert('Correo y UID desvinculados exitosamente.');
            await fetchAllStaffProfiles();
        } catch (err) {
            console.error("Error desvinculando correo:", err);
            alert("No se pudo desvincular el correo.");
        }
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
                // Dividir en grupos de 10 para la cláusula 'in' de Firestore
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

            // 4. Enriquecer perfiles
            const enriched = profiles.map(profile => ({
                ...profile,
                study_schedule: studyMap[profile.uid] || {},
                feriados: (holidayBalances[profile.id] || 0) + (profile.pendingHolidays?.length || 0),
            }));

            setStaff(enriched);

            // Un colaborador se considera activo si NO tiene fecha de cese,
            // o si su fecha de cese es HOY o en el futuro (se resta a partir del día siguiente).
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const isActive = (u) => {
                if (u.isTrainee) {
                    // Trainee: usar trainingEndDate como su fecha de "cese"
                    if (!u.trainingEndDate) return true;
                    const endDate = new Date(u.trainingEndDate + 'T00:00:00');
                    return endDate >= today;
                }
                if (!u.cessationDate) return true;
                const cessation = new Date(u.cessationDate + "T00:00:00");
                return cessation >= today;
            };

            const activePlantilla = enriched.filter(u => !u.isTrainee && isActive(u));
            const activeTrainees = enriched.filter(u => u.isTrainee && isActive(u));

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

    const openScheduleWindow = async (uid, docId) => {
        let finalUid = uid;
        if (!uid) {
            finalUid = generateUid();
            try {
                await setDoc(doc(db, 'staff_profiles', docId), { uid: finalUid }, { merge: true });
                await setDoc(doc(db, 'study_schedules', finalUid), {});
            } catch (err) {
                console.error("Error generando UID para colaborador:", err);
                alert("No se pudo generar el UID para este colaborador.");
                return;
            }
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

            // 2. Ajustar el balance en el perfil
            const impact = holiday.type === 'ganado' ? -1 : 1;
            const newBalance = (selectedStaff.feriados || 0) + impact;
            await updateDoc(doc(db, "staff_profiles", selectedStaff.id), {
                feriados: newBalance
            });

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
                        // Nota: Los documentos en feriados_trabajados permanecen como historial, 
                        // pero el balance del perfil empieza de nuevo.
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
            const existingIds = new Set(snap.docs.map(d => d.id));
            const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            // 2. Migrar solo colaboradores de ESTA tienda
            const staffQuery = query(collection(db, 'staff_profiles'), where('storeId', '==', userData.storeId));
            const staffSnap = await getDocs(staffQuery);
            const migraciones = [];
            staffSnap.docs.forEach(d => {
                const s = d.data();
                if (!s.cessationDate) return;
                const docId = `${d.id}_${s.cessationDate}`;
                if (existingIds.has(docId)) return;
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
                    storeId: userData.storeId, // Forzamos el storeId actual
                    registeredAt: new Date().toISOString(),
                    migratedFromProfile: true
                };
                migraciones.push(
                    setDoc(doc(db, 'ceses', docId), registro)
                        .then(() => lista.push({ id: docId, ...registro }))
                );
            });

            if (migraciones.length > 0) {
                await Promise.all(migraciones);
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
                s.motivoCese || '',
                s.motivoReal || '',
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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cessation = colab.cessationDate ? new Date(colab.cessationDate + 'T00:00:00') : null;
        const isAlreadyCeased = cessation && cessation < today;

        if (isAlreadyCeased) {
            // Reactivar
            const confirm = window.confirm(`¿Deseas reactivar a ${colab.name} ${colab.lastName}?`);
            if (!confirm) return;
            try {
                await updateDoc(doc(db, 'staff_profiles', colab.id), { cessationDate: '' });
                await fetchAllStaffProfiles();
            } catch (err) {
                alert('Error al reactivar el colaborador.');
            }
        } else {
            // Cesar hoy
            const todayStr = today.toISOString().split('T')[0];
            const confirm = window.confirm(`¿Confirmas que ${colab.name} ${colab.lastName} fue cesado hoy (${todayStr.split('-').reverse().join('/')})?\n\nEl colaborador dejará de contarse a partir de mañana.`);
            if (!confirm) return;
            try {
                // 1. Actualizar perfil del colaborador
                await updateDoc(doc(db, 'staff_profiles', colab.id), { cessationDate: todayStr });
                // 2. Guardar en colección independiente 'ceses' (persiste aunque se elimine al colaborador)
                await setDoc(doc(db, 'ceses', `${colab.id}_${todayStr}`), {
                    staffId: colab.id,
                    name: colab.name,
                    lastName: colab.lastName,
                    modality: colab.modality || '',
                    dni: colab.dni || '',
                    gender: colab.gender || colab.sexo || '',
                    position: colab.position || 'TEAM MEMBER',
                    joinDate: colab.joinDate || colab.createdAt?.split?.('T')?.[0] || '',
                    cessationDate: todayStr,
                    storeId: colab.storeId || '',
                    registeredAt: new Date().toISOString()
                });
                await fetchAllStaffProfiles();
            } catch (err) {
                alert('Error al registrar el cese.');
            }
        }
    };

    const handleDelete = async (uid, id) => {
        const confirm = window.confirm("¿Estás seguro de que deseas eliminar este usuario?");
        if (!confirm) return;
        try {
            // Eliminar el perfil de staff (siempre permitido para admins)
            await deleteDoc(doc(db, "staff_profiles", id));

            // Intentar eliminar el documento de users (puede fallar por reglas de Firestore;
            // si falla, el perfil ya fue eliminado y el documento huérfano es inofensivo)
            if (uid) {
                try {
                    await deleteDoc(doc(db, "users", uid));
                } catch (permErr) {
                    console.warn("No se pudo eliminar el documento de users (permisos). El perfil fue eliminado correctamente.", permErr.message);
                }
            }

            setStaff((prev) => prev.filter((u) => u.id !== id));
        } catch (err) {
            console.error("Error al eliminar usuario:", err);
            alert(`Error al eliminar: ${err.message}`);
        }
    };

    const filteredStaff = staff.filter(s => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        // Ocultar trainees cuyo entrenamiento ya terminó
        if (s.isTrainee && s.trainingEndDate) {
            const endDate = new Date(s.trainingEndDate + 'T00:00:00');
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
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                Panel de Administración
                            </h1>
                            {userData?.storeId && (
                                <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                                    <Building2 className="w-4 h-4" />
                                    <span className="font-medium">{storeName}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => navigate("/admin/requirements/lunes")}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Settings className="w-4 h-4" />
                                Requerimientos
                            </button>
                            <button
                                onClick={() => navigate("/admin/generate-schedules")}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Calendar className="w-4 h-4" />
                                Horarios
                            </button>
                            <button
                                onClick={exportCarnetExpiringPDF}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <FaFilePdf className="w-4 h-4" />
                                Carnets PDF
                            </button>
                            <button
                                onClick={() => { setShowCesadosModal(true); loadCesosRegistros(); }}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <Users className="w-4 h-4" />
                                Consultar Ceses
                            </button>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-gray-700 to-gray-800 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <LogOut className="w-4 h-4" />
                                Salir
                            </button>
                        </div>
                    </div>
                </div>

                {/* System Settings Bar */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
                    <div className="bg-white border border-blue-100 rounded-xl shadow-sm p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${lockSettings.restrictionsEnabled ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                {lockSettings.restrictionsEnabled ? <AlertCircle className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-gray-800">Bloqueo de Cambios (Dashboard Colaborador)</h3>
                                <p className="text-xs text-gray-500">
                                    {lockSettings.restrictionsEnabled
                                        ? `Activo hasta el ${new Date(lockSettings.reenableDate + 'T00:00:00').toLocaleDateString('es-ES')}`
                                        : 'Los colaboradores pueden editar sus horarios libremente.'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {lockSettings.restrictionsEnabled ? (
                                <button
                                    onClick={() => handleUpdateLock({ ...lockSettings, restrictionsEnabled: false })}
                                    className="px-4 py-2 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors"
                                >
                                    DESBLOQUEAR AHORA
                                </button>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        className="text-xs border rounded p-2"
                                        value={lockSettings.reenableDate}
                                        onChange={(e) => setLockSettings({ ...lockSettings, reenableDate: e.target.value })}
                                    />
                                    <button
                                        onClick={() => {
                                            if (!lockSettings.reenableDate) return alert("Selecciona una fecha de reactivación");
                                            handleUpdateLock({ ...lockSettings, restrictionsEnabled: true });
                                        }}
                                        className="px-4 py-2 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 transition-colors whitespace-nowrap"
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

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
                    {/* Total Plantilla */}
                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-100 text-[10px] font-medium mb-1 uppercase tracking-wider">Total Plantilla</p>
                                <p className="text-2xl font-bold">{fullTimeCount + partTimeCount}</p>
                            </div>
                            <Users className="w-8 h-8 text-blue-200" />
                        </div>
                    </div>
                    {/* Full-Time */}
                    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-100 text-[10px] font-medium mb-1 uppercase tracking-wider">Full-Time</p>
                                <p className="text-2xl font-bold">{fullTimeCount}</p>
                            </div>
                            <UserCheck className="w-8 h-8 text-green-200" />
                        </div>
                    </div>
                    {/* Part-Time */}
                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-purple-100 text-[10px] font-medium mb-1 uppercase tracking-wider">Part-Time</p>
                                <p className="text-2xl font-bold">{partTimeCount}</p>
                            </div>
                            <Clock className="w-8 h-8 text-purple-200" />
                        </div>
                    </div>
                    {/* Trainees */}
                    <div className="bg-gradient-to-br from-orange-400 to-orange-500 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <p className="text-orange-100 text-[10px] font-medium mb-1 uppercase tracking-wider">🎓 Entrenamiento</p>
                                <p className="text-2xl font-bold">{traineeCount}</p>
                                {traineeCount > 0 && (
                                    <div className="flex gap-2 mt-1 text-[9px] text-orange-100">
                                        <span className="bg-white/20 px-1.5 py-0.5 rounded-full">FT: {traineeFTCount}</span>
                                        <span className="bg-white/20 px-1.5 py-0.5 rounded-full">PT: {traineePTCount}</span>
                                    </div>
                                )}
                            </div>
                            <UserCheck className="w-8 h-8 text-orange-200 flex-shrink-0" />
                        </div>
                    </div>
                    {/* Carnets de Sanidad */}
                    <div
                        onClick={exportCarnetExpiringPDF}
                        className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-all duration-200 cursor-pointer"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-red-100 text-[10px] font-medium mb-1 uppercase tracking-wider">Carnets Críticos</p>
                                <p className="text-2xl font-bold">
                                    {staff.filter(s => {
                                        if (!s.sanitaryCardDate) return false;
                                        const expiry = new Date(s.sanitaryCardDate + 'T00:00:00');
                                        const now = new Date();
                                        now.setHours(0, 0, 0, 0);
                                        return expiry < now;
                                    }).length}
                                </p>
                                <p className="text-[9px] text-red-200 mt-1 uppercase font-bold">Vencidos hoy</p>
                            </div>
                            <AlertCircle className="w-8 h-8 text-red-200" />
                        </div>
                    </div>
                </div>

                {/* Filters and Actions */}
                <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                    <div className="flex flex-col lg:flex-row gap-4 items-center">
                        <div className="flex-1 w-full lg:w-auto">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="text"
                                    placeholder="Buscar colaborador..."
                                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <select
                            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white"
                            value={modalityFilter}
                            onChange={(e) => setModalityFilter(e.target.value)}
                        >
                            <option value="Todos">Todos</option>
                            <option value="Full-Time">Full-Time</option>
                            <option value="Part-Time">Part-Time</option>
                            <option value="Trainee">🎓 Entrenamiento</option>
                        </select>
                        <button
                            onClick={() => setShowTrainingReport(true)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-orange-200 text-orange-600 rounded-lg shadow-sm hover:shadow-md transform hover:scale-105 transition-all duration-200 font-medium whitespace-nowrap"
                        >
                            <Award className="w-5 h-5 text-orange-500" />
                            Ver Avances
                        </button>
                        <button
                            onClick={handleAddStaff}
                            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium whitespace-nowrap"
                        >
                            <Plus className="w-5 h-5" />
                            Agregar Personal
                        </button>
                        <button
                            onClick={fetchAllStaffProfiles}
                            className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg shadow-sm hover:shadow-md transform hover:scale-105 transition-all duration-200 font-medium whitespace-nowrap"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                            Actualizar
                        </button>
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
                                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                                    <tr>
                                        <th className="px-8 py-5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider min-w-[200px]">Nombre</th>
                                        <th className="px-8 py-5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider min-w-[140px]">Modalidad</th>
                                        <th className="px-6 py-5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Rol</th>
                                        <th className="px-6 py-5 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Vinculado</th>
                                        <th className="px-6 py-5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Carnet Sanidad</th>
                                        <th className="px-6 py-5 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Estado</th>
                                        <th className="px-6 py-5 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Acciones</th>
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
                                            <td className="px-8 py-5">
                                                <div className="flex items-center">
                                                    <span className={`px-4 py-2 rounded-full text-sm font-semibold inline-block ${colab.modality === "Full-Time"
                                                        ? "bg-green-100 text-green-800"
                                                        : "bg-purple-100 text-purple-800"
                                                        }`}>
                                                        {colab.modality}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-gray-700">
                                                <span className="text-base">{colab.position || 'colaborador'}</span>
                                            </td>
                                            <td className="px-6 py-5 text-center">
                                                <div className="flex flex-col items-center gap-3">
                                                    {colab.uid ? (
                                                        <FaCheck className="text-green-500 text-xl" />
                                                    ) : (
                                                        <FaTimes className="text-red-500 text-xl" />
                                                    )}
                                                    <button
                                                        onClick={() => openPositionModal(colab)}
                                                        className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline font-medium whitespace-nowrap"
                                                    >
                                                        Asignar posiciones
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
                                            <td className="px-6 py-5 text-center">
                                                <button
                                                    onClick={() => handleCessation(colab)}
                                                    className={
                                                        colab.cessationDate && new Date(colab.cessationDate + 'T00:00:00') < new Date(new Date().setHours(0, 0, 0, 0))
                                                            ? "w-full text-xs font-bold bg-green-100 hover:bg-green-200 text-green-800 px-3 py-2 rounded-lg border border-green-400 transition-colors"
                                                            : "w-full text-xs font-bold bg-orange-100 hover:bg-orange-200 text-orange-800 px-3 py-2 rounded-lg border border-orange-400 transition-colors"
                                                    }
                                                >
                                                    {colab.cessationDate && new Date(colab.cessationDate + 'T00:00:00') < new Date(new Date().setHours(0, 0, 0, 0))
                                                        ? "Reactivar"
                                                        : "Cesar"
                                                    }
                                                </button>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex flex-col gap-2">
                                                    {colab.isTrainee && (
                                                        <button
                                                            onClick={async () => {
                                                                if (!window.confirm(`¿Finalizar el entrenamiento de ${colab.name} ${colab.lastName} y eliminar del sistema?`)) return;
                                                                try {
                                                                    await deleteDoc(doc(db, "staff_profiles", colab.id));
                                                                    if (colab.uid) await deleteDoc(doc(db, "users", colab.uid));
                                                                    setStaff(prev => prev.filter(u => u.id !== colab.id));
                                                                } catch (err) { alert('Error: ' + err.message); }
                                                            }}
                                                            className="text-xs font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-300 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
                                                        >
                                                            ✓ Finalizar entrenamiento
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleUnlinkEmail(colab.id)}
                                                        className="text-xs text-red-600 hover:text-red-800 hover:underline font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                                        disabled={!colab.uid}
                                                    >
                                                        <FaUnlink className="inline" />
                                                        Desvincular
                                                    </button>
                                                    <div className="flex items-center justify-center gap-3">
                                                        <button
                                                            onClick={async () => {
                                                                if (!colab.uid) {
                                                                    const generatedUid = generateUid();
                                                                    try {
                                                                        await setDoc(doc(db, 'staff_profiles', colab.id), { uid: generatedUid }, { merge: true });
                                                                        await setDoc(doc(db, 'study_schedules', generatedUid), {});
                                                                        colab.uid = generatedUid;
                                                                    } catch (err) {
                                                                        console.error("Error generando UID:", err);
                                                                        alert("No se pudo generar el UID automáticamente para este colaborador.");
                                                                        return;
                                                                    }
                                                                }
                                                                setSelectedStaff(colab);
                                                                setShowScheduleEditor(true);
                                                            }}
                                                            className="p-2 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors"
                                                            title="Ver horarios"
                                                        >
                                                            <FaCalendarAlt className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditModal({ ...colab, isNew: false })}
                                                            className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                                                            title="Editar"
                                                        >
                                                            <FaEdit className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(colab.uid, colab.id)}
                                                            className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                                                            title="Eliminar"
                                                        >
                                                            <FaTrash className="w-4 h-4" />
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
                                    uid={selectedStaff.uid}
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
                    const uniqueMonths = [...new Set(
                        cesosRegistros
                            .filter(s => s.cessationDate)
                            .map(s => s.cessationDate.slice(0, 7)) // "2026-02"
                    )].sort((a, b) => b.localeCompare(a)); // más reciente primero

                    return (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

                                {/* Header */}
                                <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-orange-500 to-orange-600 flex-shrink-0">
                                    <div>
                                        <h2 className="text-xl font-bold text-white">Historial de Ceses</h2>
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
                                                {cesosFilterMonth ? 'No hay ceses en el mes seleccionado' : 'No hay ceses registrados'}
                                            </p>
                                        </div>
                                    ) : (
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0">
                                                <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                                                    <th className="px-4 py-3 text-left rounded-l-lg">Colaborador</th>
                                                    <th className="px-4 py-3 text-left">DNI</th>
                                                    <th className="px-4 py-3 text-left">Modalidad</th>
                                                    <th className="px-4 py-3 text-left">Fecha de Cese</th>
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
                                                                <span className="block text-xs text-gray-400 mt-0.5">Generar reporte</span>
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
                                                                        Cese próximo
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
                                        <h2 className="text-xl font-bold text-white">Reporte de Baja</h2>
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
                                        <div><span className="text-gray-500 block text-xs">Fecha Cese</span><span className="font-semibold text-red-600">{fmtFecha(s.cessationDate)}</span></div>
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
                                            <label className="block text-xs text-gray-500 mb-1">Motivo de Cese</label>
                                            <select value={reporteBajaForm.motivoCese} onChange={e => setReporteBajaForm(prev => ({ ...prev, motivoCese: e.target.value }))} className={selectCls}>
                                                {['RENUNCIA VOLUNTARIA', 'ABANDONO DE TRABAJO', 'DESPIDO', 'TÉRMINO DE CONTRATO'].map(o => <option key={o}>{o}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Motivo Real</label>
                                            <select value={reporteBajaForm.motivoReal} onChange={e => setReporteBajaForm(prev => ({ ...prev, motivoReal: e.target.value }))} className={selectCls}>
                                                {['MEJORA ECONÓMICA', 'HORARIO DE ESTUDIO', 'SALUD', 'BAJO DESEMPEÑO', 'DESACUERDO CON BENEFICIOS', 'DISTANCIA DE LA TIENDA', 'FALTA GRAVE', 'HORARIO DE CIERRE EXTENDIDO', 'INASISTENCIAS', 'MAL CLIMA LABORAL'].map(o => <option key={o}>{o}</option>)}
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
                                    {staff.filter(s => !s.cessationDate).map(s => {
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
            </div>
        </div>
    );
}

export default AdminDashboard;




