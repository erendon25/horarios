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
    const [searchTerm, setSearchTerm] = useState(""); // ✅ Agregado para evitar error
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [storeName, setStoreName] = useState("");
    const [showScheduleEditor, setShowScheduleEditor] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState(null);
    const [selectedHolidays, setSelectedHolidays] = useState([]);
    const [showHolidayModal, setShowHolidayModal] = useState(false);
    const isCardExpiringSoon = (dateString) => {
    if (!dateString) return false;
    const now = new Date();
    const expiry = new Date(dateString);
    const diffDays = (expiry - now) / (1000 * 60 * 60 * 24);
    return diffDays <= 15;
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

                const staffDoc = await getDoc(doc(db, "staff_profiles", colab.id));
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


    // Esta función obtiene TODOS los perfiles y luego filtra por storeId
    // La usamos como alternativa cuando no se pueden usar consultas con where()
    const fetchAllStaffProfiles = async () => {
        setLoading(true);
        setError(null);

        try {
            if (!userData?.storeId) {
                console.error("No hay storeId disponible en userData");
                setError("No se encontró el ID de la tienda. Por favor vuelve a iniciar sesión.");
                setLoading(false);
                return;
            }

            console.log("Obteniendo todos los perfiles y filtrando por storeId:", userData.storeId);

            // Obtenemos TODOS los perfiles sin filtrar en Firestore
            const querySnapshot = await getDocs(collection(db, 'staff_profiles'));

            // Filtramos manualmente por storeId
            const profiles = [];
            querySnapshot.forEach(doc => {
                const data = doc.data();
                if (data.storeId === userData.storeId) {
                    profiles.push({ id: doc.id, ...data });
                }
            });

            console.log(`Se encontraron ${profiles.length} perfiles para la tienda ${userData.storeId}`);

            // Procesamos los perfiles con la información adicional
            const updatedStaff = await Promise.all(
                profiles.map(async (user) => {
                    let feriados = [];
                    let pendingHolidays = [];
                    let nocturnas = 0;

                    try {
                        if (user.uid) {
                            feriados = await getWorkedHolidaysByUid(user.uid);
                            nocturnas = await getNightHoursByUid(user.uid);

                            // Obtener feriados personales registrados desde staff_profiles
                            const staffDoc = await getDoc(doc(db, "staff_profiles", user.id));
                            if (staffDoc.exists()) {
                                const profileData = staffDoc.data();
                                const pending = profileData.pendingHolidays || [];
                                feriados = [...feriados, ...pending];
                            }
                        }
                    } catch (error) {
                        console.error(`Error obteniendo datos adicionales para ${user.name}:`, error);
                    }

                    return {
                        ...user,
                        feriados: feriados.length,
                        horasNocturnas: nocturnas,
                    };
                })
            );

            setStaff(updatedStaff);
            setFullTimeCount(updatedStaff.filter((u) => u.modality === "Full-Time").length);
            setPartTimeCount(updatedStaff.filter((u) => u.modality === "Part-Time").length);
        } catch (error) {
            console.error("Error al obtener perfiles del personal:", error);
            setError(`Error al cargar los datos: ${error.message}`);
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
            storeId: userData?.storeId || ''
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
                <h1 className="text-2xl font-bold text-red-700">Panel de Administración</h1>
                <div className="flex gap-2">
                    <button onClick={() => navigate("/admin/requirements/lunes")} className="bg-green-600 text-white px-4 py-2 rounded">Requerimientos</button>
                    <button onClick={() => navigate("/admin/generate-schedules")} className="bg-blue-600 text-white px-4 py-2 rounded">Visualizar Horarios</button>
                    <button onClick={() => navigate("/admin/nocturnidad")} className="bg-purple-600 text-white px-4 py-2 rounded">Consultas</button>
<button
            onClick={exportCarnetExpiringPDF}
            className="bg-red-600 text-white px-4 py-2 rounded flex items-center gap-1"
          >
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
          <button
            onClick={() => setEditModal({
              name: '',
              lastName: '',
              modality: 'Full-Time',
              isNew: true,
              position: 'colaborador',
              storeId: userData?.storeId || '',
              sanitaryCardDate: ''
            })}
            className="bg-blue-500 text-white px-4 py-1 rounded"
          >
            Agregar Personal
          </button>
          <button
            onClick={fetchAllStaffProfiles}
            className="bg-gray-500 text-white px-4 py-1 rounded"
          >
            Actualizar
          </button>
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
                                        <span
                                            className="text-blue-600 hover:underline cursor-pointer"
                                            onClick={() => handleViewHolidays(colab)}
                                        >
                                            {`${colab.name} ${colab.lastName}`}
                                        </span>
                                        <div className="hidden group-hover:block absolute top-6 left-0 bg-white shadow-lg p-2 text-xs border z-10">
                                            <p>Correo: {colab.email || "No vinculado"}</p>
                                            <p>Feriados: {colab.feriados}</p>
                                            <p>DNI: {colab.dni || "No registrado"}</p>
                                            <p>StoreId: {colab.storeId || "No asignado"}</p>
                                        </div>
                                    </td>
                                    <td className="px-2 py-1">{colab.modality}</td>
                                    <td className="px-2 py-1 text-center">{colab.position || 'colaborador'}</td>
                                    <td className="px-2 py-1 text-center">
                                        {colab.email ? (
                                            <FaCheck className="text-green-600 inline" />
                                        ) : (
                                            <FaTimes className="text-red-500 inline" />
                                        )}
                                    </td>
                                     <td className="px-2 py-1 space-x-2">
                            <button
                                onClick={() => handleUnlinkEmail(colab.id)}
                                className="text-sm text-red-600 hover:underline"
                                disabled={!colab.email}
                            >Desvincular correo</button>
                           
                        </td>
                                    <td className="px-2 py-1 space-x-2">
                                        <button
                                            onClick={async () => {
                                                if (!colab.uid) {
                                                    const generatedUid = generateUid();
                                                    try {
                                                        await setDoc(doc(db, 'staff_profiles', colab.id), { uid: generatedUid }, { merge: true });
                                                        await setDoc(doc(db, 'study_schedules', generatedUid), {});
                                                        colab.uid = generatedUid; // actualizar manualmente en memoria
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

                                        <button
                                            onClick={() => setEditModal({ ...colab, isNew: false })}
                                            className="text-sm text-blue-600 hover:underline"
                                        >Editar</button>
                                        <button
                                            onClick={() => handleDelete(colab.uid, colab.id)}
                                            className="text-sm text-red-600 hover:underline"
                                        >Eliminar</button>
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

            {editModal && (
                <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
                    <div className="bg-white p-6 rounded shadow-xl w-full max-w-md overflow-y-auto max-h-screen">
                        <h3 className="text-lg font-semibold mb-4">{editModal.isNew ? 'Agregar Personal' : 'Editar Usuario'}</h3>

                        <label className="block text-sm font-medium mb-1">Nombre</label>
                        <input className="w-full mb-3 p-2 border rounded" value={editModal.name} onChange={(e) => setEditModal({ ...editModal, name: e.target.value })} />

                        <label className="block text-sm font-medium mb-1">Apellido</label>
                        <input className="w-full mb-3 p-2 border rounded" value={editModal.lastName} onChange={(e) => setEditModal({ ...editModal, lastName: e.target.value })} />

                        <label className="block text-sm font-medium mb-1">DNI</label>
                        <input className="w-full mb-3 p-2 border rounded" value={editModal.dni || ''} onChange={(e) => setEditModal({ ...editModal, dni: e.target.value })} />
<label className="block text-sm font-medium mb-1">
              Fecha Carnet Sanidad
            </label>
            <input
              type="date"
              className="w-full mb-3 p-2 border rounded"
              value={editModal.sanitaryCardDate || ""}
              onChange={(e) =>
                setEditModal({
                  ...editModal,
                  sanitaryCardDate: e.target.value,
                })
              }
            />

                        <label className="block text-sm font-medium mb-1">Rol</label>
                        <select className="w-full mb-3 p-2 border rounded" value={editModal.position || ''} onChange={(e) => setEditModal({ ...editModal, position: e.target.value })}>
                            <option value="colaborador">Colaborador</option>
                            <option value="admin">Admin</option>
                        </select>

                        {editModal.position === "admin" && (
                            <>
                                <label className="block text-sm font-medium mb-1">Correo electrónico</label>
                                <input type="email" className="w-full mb-3 p-2 border rounded" value={editModal.email || ''} onChange={(e) => setEditModal({ ...editModal, email: e.target.value })} />
                            </>
                        )}

                        <label className="block text-sm font-medium mb-1">Modalidad</label>
                        <select className="w-full mb-3 p-2 border rounded" value={editModal.modality} onChange={(e) => setEditModal({ ...editModal, modality: e.target.value })}>
                            <option value="Full-Time">Full-Time</option>
                            <option value="Part-Time">Part-Time</option>
                        </select>

                        <label className="block text-sm font-medium mb-1">Tienda </label>
                        <input
                            className="w-full mb-3 p-2 border rounded bg-gray-100"
                            value={storeName || userData?.storeId || ''}
                            disabled
                            title="Este valor se asigna automáticamente según tu tienda"
                        />

                        <div className="flex justify-end gap-2 mt-4">
                            <button onClick={() => setEditModal(null)} className="px-4 py-2 bg-gray-400 text-white rounded">Cancelar</button>
                            <button onClick={handleEditSave} className="px-4 py-2 bg-blue-600 text-white rounded">Guardar</button>
                        </div>
                    </div>
                </div>
            )}
            {selectedStaff && showScheduleEditor && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
                        <h2 className="text-xl font-bold mb-4 text-center text-blue-800">Visualizar y/o editar horarios</h2>
                        <StudyScheduleEditor
                            uid={selectedStaff.uid}
                            showAllDays
                            onClose={() => setShowScheduleEditor(false)}
                        />
                    </div>
                </div>
            )}
            {showHolidayModal && selectedStaff && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded shadow-md max-w-md w-full max-h-[80vh] overflow-y-auto">
                        <h2 className="text-lg font-semibold mb-4 text-center">
                            Feriados de {selectedStaff.name} {selectedStaff.lastName}
                        </h2>
                        <ul className="list-disc pl-5 text-sm">
                            {selectedHolidays.length > 0 ? (
                                selectedHolidays.map((date, idx) => (
                                    <li key={idx}>
                                        {typeof date === "string"
                                            ? date // mantiene el string exacto registrado
                                            : new Date(date).toLocaleDateString("es-PE")} {/* solo si es Date */}
                                    </li>
                                ))
                            ) : (
                                <li>No tiene feriados registrados.</li>
                            )}

                        </ul>
                        <div className="flex justify-end mt-4">
                            <button
                                onClick={() => setShowHolidayModal(false)}
                                className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}


        </div>

    );
}

export default AdminDashboard;




