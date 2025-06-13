import React, { useEffect, useState } from "react";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import ExtraHoursForm from "./ExtraHoursForm";
import HolidayForm from "./HolidayForm";
import StudyScheduleForm from "./StudyScheduleForm";

const CollaboratorDashboard = () => {
  const { currentUser, logout } = useAuth();
  const [perfil, setPerfil] = useState(null);
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalType, setModalType] = useState(null);
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [availableStaff, setAvailableStaff] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");

  useEffect(() => {
    const fetchPerfil = async () => {
      if (!currentUser) return;
      const db = getFirestore();
      const q = query(collection(db, "staff_profiles"), where("uid", "==", currentUser.uid));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const perfilData = snapshot.docs[0].data();
        setPerfil(perfilData);

        if (perfilData.storeId) {
          const storeRef = doc(db, "stores", perfilData.storeId);
          const storeSnap = await getDoc(storeRef);
          if (storeSnap.exists()) {
            setStoreName(storeSnap.data().name || "");
          }
        }
      } else {
        setPerfil(null);
      }
      setLoading(false);
    };
    fetchPerfil();
  }, [currentUser]);

  useEffect(() => {
    const loadStores = async () => {
      const db = getFirestore();
      const storeSnap = await getDocs(collection(db, "stores"));
      setStores(storeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    loadStores();
  }, []);

 useEffect(() => {
  const loadAvailableStaff = async () => {
    if (!selectedStore) return;
    const db   = getFirestore();
    const q    = query(collection(db, "staff_profiles"),
                       where("storeId", "==", selectedStore));
    const snap = await getDocs(q);

    const libres = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      // 👇 sin correo ⇒ candidato a vincular
      .filter(p => !p.email || p.email.trim() === "");

    // ordenar alfabéticamente para mayor comodidad
    libres.sort((a, b) => a.name.localeCompare(b.name, "es"));
    setAvailableStaff(libres);
  };
  loadAvailableStaff();
}, [selectedStore]);

  const vincularCuenta = async () => {
    if (!selectedStaffId || !currentUser) return;
    const db = getFirestore();
    await updateDoc(doc(db, "staff_profiles", selectedStaffId), {
      uid: currentUser.uid,
      email: currentUser.email || ""
    });
    window.location.reload();
  };

  const closeModal = () => setModalType(null);

  if (loading) return <p className="text-center mt-10">Cargando perfil...</p>;

  if (!perfil) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white shadow p-6 rounded">
        <h2 className="text-lg font-bold mb-4 text-center text-blue-800">Vincular cuenta a perfil existente</h2>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Selecciona tu tienda:</label>
          <select value={selectedStore} onChange={e => setSelectedStore(e.target.value)} className="w-full border p-2 rounded">
            <option value="">-- Selecciona una tienda --</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </div>
        {selectedStore && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Selecciona tu nombre:</label>
            <select value={selectedStaffId} onChange={e => setSelectedStaffId(e.target.value)} className="w-full border p-2 rounded">
              <option value="">-- Selecciona tu nombre --</option>
              {availableStaff.map(persona => (
                <option key={persona.id} value={persona.id}>{persona.name} {persona.lastName}</option>
              ))}
            </select>
          </div>
        )}
        <button
          onClick={vincularCuenta}
          disabled={!selectedStaffId}
          className="w-full bg-green-600 text-white py-2 rounded disabled:opacity-50"
        >
          Confirmar vinculación
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto mt-8 p-4">
      <h2 className="text-xl font-bold text-blue-800 mb-2">
        Bienvenido, {perfil.name || ""}
      </h2>
      <p><strong>DNI:</strong> {perfil.dni}</p>
      <p><strong>Email:</strong> {perfil.email}</p>
      <p><strong>Modalidad:</strong> {perfil.modality}</p>
      <p><strong>Sucursal:</strong> {storeName}</p>

      <div className="flex flex-wrap gap-4 mt-6">
        <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={() => setModalType("study")}>Editar horarios de estudio</button>
        <button className="bg-blue-500 text-white px-4 py-2 rounded" onClick={() => setModalType("feriados")}>Registrar feriados</button>
        <button className="bg-green-600 text-white px-4 py-2 rounded" onClick={() => setModalType("horas")}>Registrar horas extras</button>
        <button className="bg-gray-700 text-white px-4 py-2 rounded ml-auto" onClick={logout}>Cerrar sesión</button>
      </div>

      {modalType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start pt-10 z-50 overflow-y-auto">
          <div className="bg-white p-6 rounded shadow-lg w-full max-w-2xl relative animate-fadeIn">
            {modalType === "study" && <><h3 className="text-lg font-semibold mb-4">Editar horarios de estudio</h3><StudyScheduleForm onSuccess={closeModal} /></>}
            {modalType === "feriados" && <><h3 className="text-lg font-semibold mb-4">Registrar feriado</h3><HolidayForm /></>}
            {modalType === "horas" && <><h3 className="text-lg font-semibold mb-4">Registrar horas extras</h3><ExtraHoursForm uid={currentUser.uid} onSuccess={closeModal} /></>}
            <button onClick={closeModal} className="mt-6 px-4 py-2 bg-gray-700 text-white rounded">Cerrar</button>
          </div>
        </div>
      )}

      <style>{`
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default CollaboratorDashboard;

