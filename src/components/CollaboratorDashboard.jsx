import React, { useEffect, useState } from "react";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import ExtraHoursForm from "./ExtraHoursForm";
import HolidayForm from "./HolidayForm";
import StudyScheduleForm from "./StudyScheduleForm";
import { 
  BookOpen, 
  Calendar, 
  Clock, 
  LogOut, 
  User, 
  Mail, 
  Building2, 
  Briefcase,
  X,
  CheckCircle
} from "lucide-react";

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mb-4"></div>
          <p className="text-gray-600 font-medium text-lg">Cargando perfil...</p>
        </div>
      </div>
    );
  }

  if (!perfil) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <User className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Vincular cuenta a perfil existente
            </h2>
            <p className="text-gray-600 mt-2 text-sm">Selecciona tu tienda y nombre para continuar</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Selecciona tu tienda:
              </label>
              <select 
                value={selectedStore} 
                onChange={e => setSelectedStore(e.target.value)} 
                className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white"
              >
                <option value="">-- Selecciona una tienda --</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </div>
            
            {selectedStore && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Selecciona tu nombre:
                </label>
                <select 
                  value={selectedStaffId} 
                  onChange={e => setSelectedStaffId(e.target.value)} 
                  className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white"
                >
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
              className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white py-3 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-5 h-5" />
              Confirmar vinculación
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white shadow-md border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Bienvenido, {perfil.name || ""}
              </h1>
              <p className="text-gray-600 mt-1">Panel de colaborador</p>
            </div>
            <button 
              onClick={logout}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-lg shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 font-medium"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Información del perfil */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            Información del Perfil
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">DNI</p>
                <p className="text-sm font-semibold text-gray-800">{perfil.dni}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <Mail className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Email</p>
                <p className="text-sm font-semibold text-gray-800">{perfil.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Modalidad</p>
                <p className="text-sm font-semibold text-gray-800">{perfil.modality}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <Building2 className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Sucursal</p>
                <p className="text-sm font-semibold text-gray-800">{storeName}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button 
            onClick={() => setModalType("study")}
            className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-6 rounded-xl shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 flex flex-col items-center gap-3"
          >
            <BookOpen className="w-8 h-8" />
            <span className="font-semibold text-lg">Editar Horarios de Estudio</span>
            <span className="text-sm opacity-90">Gestiona tus horarios académicos</span>
          </button>
          
          <button 
            onClick={() => setModalType("feriados")}
            className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-6 rounded-xl shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 flex flex-col items-center gap-3"
          >
            <Calendar className="w-8 h-8" />
            <span className="font-semibold text-lg">Registrar Feriados</span>
            <span className="text-sm opacity-90">Indica días festivos trabajados</span>
          </button>
          
          <button 
            onClick={() => setModalType("horas")}
            className="bg-gradient-to-r from-green-500 to-green-600 text-white p-6 rounded-xl shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 flex flex-col items-center gap-3"
          >
            <Clock className="w-8 h-8" />
            <span className="font-semibold text-lg">Registrar Horas Extras</span>
            <span className="text-sm opacity-90">Registra horas adicionales</span>
          </button>
        </div>

        {/* Modal mejorado */}
        {modalType && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-start pt-8 pb-8 overflow-y-auto" onClick={closeModal}>
            <div 
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 relative animate-fadeIn" 
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-gradient-to-r from-gray-800 to-gray-900 rounded-t-2xl px-6 py-4 flex justify-between items-center z-10">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  {modalType === "study" && <BookOpen className="w-5 h-5" />}
                  {modalType === "feriados" && <Calendar className="w-5 h-5" />}
                  {modalType === "horas" && <Clock className="w-5 h-5" />}
                  {modalType === "study" && "Editar horarios de estudio"}
                  {modalType === "feriados" && "Registrar feriado"}
                  {modalType === "horas" && "Registrar horas extras"}
                </h3>
                <button 
                  onClick={closeModal}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
              
              <div className="p-6">
                {modalType === "study" && <StudyScheduleForm onSuccess={closeModal} />}
                {modalType === "feriados" && <HolidayForm />}
                {modalType === "horas" && <ExtraHoursForm uid={currentUser.uid} onSuccess={closeModal} />}
              </div>
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
    </div>
  );
};

export default CollaboratorDashboard;

