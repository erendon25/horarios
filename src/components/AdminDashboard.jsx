// AdminDashboard.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
    getWorkedHolidaysByUid,
    getNightHoursByUid,
} from "../services/scheduleService";
import { FaCheck, FaTimes, FaCalendarAlt, FaFilePdf, FaEdit, FaTrash, FaUnlink } from "react-icons/fa";
import {
    Users,
    Clock,
    Settings,
    FileText,
    Calendar,
    Search,
    Plus,
    RefreshCw,
    LogOut,
    Building2,
    UserCheck,
    AlertCircle,
    X
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



import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

function AdminDashboard() {
    const { logout, currentUser, userRole, userData } = useAuth();
    const navigate = useNavigate();
    const [staff, setStaff] = useState([]);
    const [fullTimeCount, setFullTimeCount] = useState(0);
    const [partTimeCount, setPartTimeCount] = useState(0);
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
            if (colab.uid) {
                feriados = await getWorkedHolidaysByUid(colab.uid);

                const staffDoc = await getDoc(doc(db, 'staff_profiles', colab.id));
                if (staffDoc.exists()) {
                    const profileData = staffDoc.data();
                    const pending = profileData.pendingHolidays || [];
                    feriados = [...feriados, ...pending];
                }
            }
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

            // 2. Cargar todos los study_schedules de una vez
            const studySnap = await getDocs(collection(db, 'study_schedules'));
            const studyMap = {};
            studySnap.forEach(doc => {
                studyMap[doc.id] = doc.data();
            });

            // 3. Enriquecer perfiles (sin más getDoc)
            const enriched = profiles.map(profile => ({
                ...profile,
                study_schedule: studyMap[profile.uid] || {},
                feriados: profile.pendingHolidays?.length || 0,
                horasNocturnas: 0, // Si no tienes colección, calcular en backend
            }));

            // 4. Si necesitas feriados trabajados y nocturnidad → hazlo en Cloud Function
            // O carga solo si uid existe y en batch

            setStaff(enriched);

            // Un colaborador se considera activo si NO tiene fecha de cese,
            // o si su fecha de cese es HOY o en el futuro (se resta a partir del día siguiente).
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const isActive = (u) => {
                if (!u.cessationDate) return true;
                // Comparamos: el colaborador sigue activo si su cese es HOY o futuro
                const cessation = new Date(u.cessationDate + "T00:00:00");
                return cessation >= today;
            };

            setFullTimeCount(enriched.filter(u => u.modality === "Full-Time" && isActive(u)).length);
            setPartTimeCount(enriched.filter(u => u.modality === "Part-Time" && isActive(u)).length);

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
            fetchAllStaffProfiles(); // Usamos la función alternativa
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
            position: 'colaborador',
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
                position: editModal.position || "colaborador",
                email: editModal.email || "",
                storeId: userData?.storeId || "",
                storeName: storeName || "",
                study_schedule: editModal.study_schedule || {},
                sanitaryCardDate: editModal.sanitaryCardDate || "",
            };

            if (editModal.isNew) {
                await addDoc(collection(db, "staff_profiles"), payload);
            } else {
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
        setCesosLoading(true);
        try {
            // 1. Leer la colección independiente de ceses
            const snap = await getDocs(collection(db, 'ceses'));
            const existingIds = new Set(snap.docs.map(d => d.id));
            const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            // 2. Migrar automáticamente colaboradores con cessationDate
            //    que aún no estén registrados en la colección 'ceses'
            const staffSnap = await getDocs(collection(db, 'staff_profiles'));
            const migraciones = [];
            staffSnap.docs.forEach(d => {
                const s = d.data();
                if (!s.cessationDate) return; // sin fecha de cese → ignorar
                const docId = `${d.id}_${s.cessationDate}`;
                if (existingIds.has(docId)) return; // ya existe → no duplicar
                const registro = {
                    staffId: d.id,
                    name: s.name || '',
                    lastName: s.lastName || '',
                    modality: s.modality || '',
                    dni: s.dni || '',
                    cessationDate: s.cessationDate,
                    storeId: s.storeId || '',
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
    };

    const exportarReporteBajaExcel = () => {
        if (!reporteBajaColaborador) return;
        const s = reporteBajaColaborador;
        const f = reporteBajaForm;

        // Mes del cese para el título
        const fechaCeseObj = s.cessationDate ? new Date(s.cessationDate + 'T00:00:00') : new Date();
        const mesLabel = fechaCeseObj.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        const mesCapitalized = mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1);

        // Formatear fecha
        const fmtFecha = (str) => {
            if (!str) return '';
            const d = new Date(str + 'T00:00:00');
            return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        };

        const wb = XLSX.utils.book_new();

        // ─── HEADERS (2 filas) ───
        const cabeceras1 = [
            'TIENDA', 'PUESTO', 'MO', 'DNI',
            'NOMBRE DE COLABORADOR', 'SEXO',
            'FECHA DE INGRESO', 'FECHA DE CESE',
            'DIAS DESCANSO MEDICO', 'INASISTENCIAS',
            'TARDANZAS (MINUTOS, HORAS)',
            'HORAS NOCTURNAS', 'HORAS EXTRAS', 'FERIADOS', 'DESCUENTOS',
            'DESEMPEÑO', 'MOTIVO DE CESE', 'MOTIVO REAL',
            'COMENTARIO TIENDA - DESCRIBIR CON MAYOR DETALLE EL MOTIVO POR EL QUE SE RETIRA EL COLABORADOR DE LA EMPRESA'
        ];

        // ─── FILA DE DATOS ───
        const fila = [
            storeName || s.storeId || '',
            s.position || 'TEAM MEMBER',
            s.modality === 'Full-Time' ? 'FT' : s.modality === 'Part-Time' ? 'PT' : (s.modality || ''),
            s.dni || '',
            `${s.name || ''} ${s.lastName || ''}`.trim(),
            s.gender || s.sexo || '',
            fmtFecha(s.joinDate || s.createdAt?.split?.('T')?.[0] || ''),
            fmtFecha(s.cessationDate),
            f.diasDescansoMedico,
            f.inasistencias,
            f.tardanzas,
            f.horasNocturnas,
            f.horasExtras,
            f.feriados,
            f.descuentos,
            f.desempenio,
            f.motivoCese,
            f.motivoReal,
            f.comentario,
        ];

        const wsData = [cabeceras1, fila];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Ancho de columnas
        ws['!cols'] = [
            { wch: 14 }, { wch: 14 }, { wch: 5 }, { wch: 11 },
            { wch: 28 }, { wch: 10 },
            { wch: 14 }, { wch: 12 },
            { wch: 10 }, { wch: 12 },
            { wch: 14 },
            { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 12 },
            { wch: 12 }, { wch: 18 }, { wch: 22 },
            { wch: 50 }
        ];

        // Estilos de cabecera: fondo amarillo, texto negro, negrita
        const headerStyle = {
            fill: { fgColor: { rgb: "FFFF00" } },
            font: { bold: true, color: { rgb: "000000" } },
            alignment: { wrapText: true, horizontal: 'center', vertical: 'center' },
            border: {
                top: { style: 'thin', color: { rgb: "000000" } },
                bottom: { style: 'thin', color: { rgb: "000000" } },
                left: { style: 'thin', color: { rgb: "000000" } },
                right: { style: 'thin', color: { rgb: "000000" } }
            }
        };
        const dataStyle = {
            alignment: { wrapText: true, horizontal: 'center', vertical: 'center' },
            border: {
                top: { style: 'thin', color: { rgb: "000000" } },
                bottom: { style: 'thin', color: { rgb: "000000" } },
                left: { style: 'thin', color: { rgb: "000000" } },
                right: { style: 'thin', color: { rgb: "000000" } }
            }
        };

        cabeceras1.forEach((_, ci) => {
            const cellRef = XLSX.utils.encode_cell({ r: 0, c: ci });
            if (ws[cellRef]) ws[cellRef].s = headerStyle;
            const dataRef = XLSX.utils.encode_cell({ r: 1, c: ci });
            if (ws[dataRef]) ws[dataRef].s = dataStyle;
        });

        ws['!rows'] = [{ hpt: 40 }, { hpt: 25 }];

        XLSX.utils.book_append_sheet(wb, ws, 'Reporte de Bajas');
        XLSX.writeFile(wb, `Reporte de Bajas - ${mesCapitalized}.xlsx`);
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
            await deleteDoc(doc(db, "staff_profiles", id));
            if (uid) await deleteDoc(doc(db, "users", uid));
            setStaff((prev) => prev.filter((u) => u.id !== id));
        } catch (err) {
            console.error("Error al eliminar usuario:", err);
            alert(`Error al eliminar: ${err.message}`);
        }
    };

    const filteredStaff = staff.filter(s => {
        const matchesModality = modalityFilter === "Todos" || s.modality === modalityFilter;
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
                                onClick={() => navigate("/admin/nocturnidad")}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
                            >
                                <FileText className="w-4 h-4" />
                                Consultas
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-100 text-sm font-medium mb-1">Total Personal</p>
                                <p className="text-3xl font-bold">{staff.filter(u => {
                                    if (!u.cessationDate) return true;
                                    const t = new Date(); t.setHours(0, 0, 0, 0);
                                    return new Date(u.cessationDate + 'T00:00:00') >= t;
                                }).length}</p>
                            </div>
                            <Users className="w-12 h-12 text-blue-200" />
                        </div>
                    </div>
                    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-green-100 text-sm font-medium mb-1">Full-Time</p>
                                <p className="text-3xl font-bold">{fullTimeCount}</p>
                            </div>
                            <UserCheck className="w-12 h-12 text-green-200" />
                        </div>
                    </div>
                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white transform hover:scale-105 transition-all duration-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-purple-100 text-sm font-medium mb-1">Part-Time</p>
                                <p className="text-3xl font-bold">{partTimeCount}</p>
                            </div>
                            <Clock className="w-12 h-12 text-purple-200" />
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
                        </select>
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
                                        <button
                                            onClick={() => setCesosFilterMonth('')}
                                            className="text-xs text-orange-600 hover:text-orange-800 underline"
                                        >
                                            Limpiar filtro
                                        </button>
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
                                    <button
                                        onClick={exportarReporteBajaExcel}
                                        className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-green-600 to-green-700 text-white font-bold rounded-lg shadow hover:shadow-lg transition-all text-sm"
                                    >
                                        ⬇ Descargar Excel
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}

export default AdminDashboard;




