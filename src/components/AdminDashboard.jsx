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
            setFullTimeCount(enriched.filter(u => u.modality === "Full-Time").length);
            setPartTimeCount(enriched.filter(u => u.modality === "Part-Time").length);

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
  };    const handleDelete = async (uid, id) => {
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
                                <p className="text-3xl font-bold">{staff.length}</p>
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
                                                    <span className={`px-4 py-2 rounded-full text-sm font-semibold inline-block ${
                                                        colab.modality === "Full-Time" 
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
                                                    {colab.email ? (
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
                                            <td className="px-6 py-5">
                                                <div className="flex flex-col gap-2">
                                                    <button 
                                                        onClick={() => handleUnlinkEmail(colab.id)} 
                                                        className="text-xs text-red-600 hover:text-red-800 hover:underline font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1" 
                                                        disabled={!colab.email}
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
            </div>
        </div>
    );
}

export default AdminDashboard;




