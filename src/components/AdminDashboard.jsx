// AdminDashboard.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
    getWorkedHolidaysByUid,
    getNightHoursByUid,
} from "../services/scheduleService";
import { FaCheck, FaTimes, FaCalendarAlt, FaFilePdf } from "react-icons/fa";
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
        <div className="p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold text-red-700">Panel de administración</h1>
                <div className="flex gap-2">
                    <button onClick={() => navigate("/admin/requirements/lunes")} className="bg-green-600 text-white px-4 py-2 rounded">Requerimientos</button>
                    <button onClick={() => navigate("/admin/generate-schedules")} className="bg-blue-600 text-white px-4 py-2 rounded">Visualizar Horarios</button>
                    <button onClick={() => navigate("/admin/nocturnidad")} className="bg-purple-600 text-white px-4 py-2 rounded">Consultas</button>
                    <button onClick={exportCarnetExpiringPDF} className="bg-red-600 text-white px-4 py-2 rounded flex items-center gap-1">
                        <FaFilePdf /> Carnets por vencer
                    </button>
                    <button onClick={handleLogout} className="bg-gray-800 text-white px-4 py-2 rounded">Cerrar sesión</button>
                </div>
            </div>

            {userData?.storeId && (
                <div className="mb-4 text-sm">
                    <p>Tienda actual: <strong>{storeName}</strong></p>
                </div>
            )}

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    <p>{error}</p>
                </div>
            )}

            <div className="flex justify-between items-center mb-2">
                <div className="text-sm text-gray-700">
                    <p>Total Full-Time: <strong>{fullTimeCount}</strong></p>
                    <p>Total Part-Time: <strong>{partTimeCount}</strong></p>
                </div>
                <div className="flex gap-2 items-center">
                    <input
                        type="text"
                        placeholder="Buscar colaborador..."
                        className="border px-2 py-1 rounded"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <select
                        className="border px-2 py-1 rounded"
                        value={modalityFilter}
                        onChange={(e) => setModalityFilter(e.target.value)}
                    >
                        <option value="Todos">Todos</option>
                        <option value="Full-Time">Full-Time</option>
                        <option value="Part-Time">Part-Time</option>
                    </select>
                    <button onClick={handleAddStaff} className="bg-blue-500 text-white px-4 py-1 rounded">Agregar Personal</button>
                    <button onClick={fetchAllStaffProfiles} className="bg-gray-500 text-white px-4 py-1 rounded">Actualizar</button>
                </div>
            </div>

            {loading ? (
                <div className="py-8 text-center">
                    <p>Cargando personal...</p>
                </div>
            ) : (
                filteredStaff.length > 0 ? (
                    <table className="table-auto w-full border">
                        <thead>
                            <tr className="bg-gray-200 text-left">
                                <th className="px-2 py-1">Nombre</th>
                                <th className="px-2 py-1">Modalidad</th>
                                <th className="px-2 py-1">Rol</th>
                                <th className="px-2 py-1">Vinculado</th>
                                <th className="px-2 py-1">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredStaff.map((colab, idx) => (
                                <tr key={idx} className="border hover:bg-gray-50 group">
                                    <td className="px-2 py-1 relative">
                                        <span onClick={() => handleViewHolidays(colab)} className="text-blue-600 hover:underline cursor-pointer">
                                            {`${colab.name} ${colab.lastName}`}
                                        </span>
                                        {/* Tooltip mejorado */}
    <div className="hidden group-hover:block absolute top-full left-0 bg-white shadow-lg p-2 text-xs border z-10 w-64">
        <div className="space-y-1">
            <p><strong>ID:</strong> {colab.id}</p>
            <p><strong>Correo:</strong> {colab.email || "No vinculado"}</p>
            <p><strong>Feriados:</strong> {colab.feriados}</p>
            <p><strong>DNI:</strong> {colab.dni || "No registrado"}</p>
            <p><strong>StoreId:</strong> {colab.storeId || "No asignado"}</p>
            {colab.uid && <p><strong>UID:</strong> {colab.uid}</p>}
        </div>
    </div>
</td>
                                    <td className="px-2 py-1">{colab.modality}</td>
                                    <td className="px-2 py-1 text-center">{colab.position || 'colaborador'}</td>
                                    <td className="px-2 py-1 text-center">
                                        {colab.email ? <FaCheck className="text-green-600 inline" /> : <FaTimes className="text-red-500 inline" />}
                                        <div>
                                            <button onClick={() => openPositionModal(colab)} className="text-sm text-indigo-600 hover:underline">Asignar posiciones</button>
                                        </div>
                                    </td>
                                    <td className="px-2 py-1 space-y-1">
                                        <button onClick={() => handleUnlinkEmail(colab.id)} className="text-sm text-red-600 hover:underline" disabled={!colab.email}>Desvincular correo</button>
                                        <div className="space-x-2">
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
                                                className="text-purple-600 hover:text-purple-800"
                                                title="Ver horarios"
                                            >
                                                <FaCalendarAlt className="inline" />
                                            </button>
                                            <button onClick={() => setEditModal({ ...colab, isNew: false })} className="text-sm text-blue-600 hover:underline">Editar</button>
                                            <button onClick={() => handleDelete(colab.uid, colab.id)} className="text-sm text-red-600 hover:underline">Eliminar</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="text-center py-8 border bg-gray-50">
                        <p>No se encontraron registros de personal para esta tienda</p>
                    </div>
                )
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
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    zIndex: 1000,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                }}>
                    <div style={{
                        background: 'white',
                        padding: '1.5rem',
                        borderRadius: '8px',
                        maxHeight: '90vh',
                        overflowY: 'auto'
                    }}>
                        <StudyScheduleEditor
                            uid={selectedStaff.uid}
                            onClose={() => {
                                setShowScheduleEditor(false);
                                setSelectedStaff(null);
                            }}
                            onSaved={fetchAllStaffProfiles} // 👈 Actualizar datos después de guardar
                        />
                    </div>
                </div>
            )}

            {positionModalOpen && (
                <ModalSelectorDePosiciones
                    docId={positionTarget?.id} // ✅ Asegúrate que sea `.id`, no `.uid`
                    onClose={() => setPositionModalOpen(false)}
                />
            )}


        </div>
    );

}
export default AdminDashboard;




