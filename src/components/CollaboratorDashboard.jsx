import React, { useEffect, useState } from "react";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
// import ExtraHoursForm from "./ExtraHoursForm"; // ELIMINADO
import HolidayForm from "./HolidayForm";
import StudyScheduleForm from "./StudyScheduleForm";
import WeeklyView from "./WeeklyView";
import {
  BookOpen,
  Calendar,
  Clock, // Se mantiene por si se usa en iconos, aunque ya no en botón
  LogOut,
  User,
  Mail,
  Building2,
  Briefcase,
  X,
  CheckCircle,
  Quote,
  Edit,
  Save,
  PlusCircle,
  Award,
  Lock,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck
} from "lucide-react";
import { MOTIVATIONAL_QUOTES } from "../constants/quotes";
import ModalSelectorDePosiciones from "./ModalSelectorDePosiciones";

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

  const [dailyQuote, setDailyQuote] = useState("");
  const [isEditingBirthday, setIsEditingBirthday] = useState(false);
  const [tempBirthDate, setTempBirthDate] = useState("");
  const [lockSettings, setLockSettings] = useState({ restrictionsEnabled: false, reenableDate: '' });
  const [storeStaff, setStoreStaff] = useState([]);
  const [selectedTrainerStaff, setSelectedTrainerStaff] = useState(null);
  const [storeRequirements, setStoreRequirements] = useState([]);

  const isRestricted = () => {
    if (isHealthCardBlocked()) return true;
    if (!lockSettings.restrictionsEnabled) return false;
    const today = new Date().toISOString().split('T')[0];
    return today < lockSettings.reenableDate;
  };

  const getSanitaryCardStatus = () => {
    if (!perfil?.sanitaryCardDate) return 'none';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(perfil.sanitaryCardDate + 'T00:00:00');

    if (today > expiry) return 'expired';

    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 15) return 'warning';
    return 'valid';
  };

  const isHealthCardBlocked = () => {
    const status = getSanitaryCardStatus();
    if (status === 'expired' && !perfil?.sanitaryCardUnlock) return true;
    return false;
  };

  const isTrainer = perfil?.position === 'ENTRENADOR';

  useEffect(() => {
    const fetchStoreStaff = async () => {
      if (!isTrainer || !perfil?.storeId) return;
      const db = getFirestore();
      const q = query(collection(db, "staff_profiles"), where("storeId", "==", perfil.storeId));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStoreStaff(list.sort((a, b) => a.name.localeCompare(b.name)));
    };
    fetchStoreStaff();
  }, [isTrainer, perfil?.storeId]);

  useEffect(() => {
    const fetchRequirements = async () => {
      if (!perfil?.storeId) return;
      const db = getFirestore();
      try {
        const q = query(collection(db, "stores", perfil.storeId, "positioning_requirements"));
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
    fetchRequirements();
  }, [perfil?.storeId]);

  useEffect(() => {
    const randomIndex = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
    setDailyQuote(MOTIVATIONAL_QUOTES[randomIndex]);
  }, []);

  useEffect(() => {
    const fetchLock = async () => {
      if (!perfil?.storeId) return;
      const db = getFirestore();
      try {
        const docRef = doc(db, "stores", perfil.storeId, "config", "schedule_lock");
        const snap = await getDoc(docRef);
        if (snap.exists()) setLockSettings(snap.data());
      } catch (e) { console.error(e); }
    };
    fetchLock();
  }, [perfil]);

  useEffect(() => {
    const fetchPerfil = async () => {
      if (!currentUser) return;
      const db = getFirestore();
      const q = query(collection(db, "staff_profiles"), where("uid", "==", currentUser.uid));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        let perfilData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };

        // --- PROCESAR CAMBIO DE MODALIDAD PROGRAMADO ---
        const todayStr = new Date().toISOString().split('T')[0];
        if (perfilData.modalityChangeDate && perfilData.modalityChangeDate <= todayStr && perfilData.nextModality) {
          const newModality = perfilData.nextModality;
          const changeDate = perfilData.modalityChangeDate;

          // Actualizar localmente
          perfilData = {
            ...perfilData,
            modality: newModality,
            joinDate: changeDate,
            modalityChangeDate: '',
            nextModality: '',
            feriados: 0,
            pendingHolidays: []
          };

          // Actualizar en Firebase
          updateDoc(doc(db, "staff_profiles", perfilData.id), {
            modality: newModality,
            joinDate: changeDate,
            modalityChangeDate: '',
            nextModality: '',
            feriados: 0,
            pendingHolidays: []
          }).catch(e => console.error("Error al ejecutar cambio de modalidad:", e));
        }

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
      const db = getFirestore();
      // Traer todos los perfiles de la tienda (las reglas permiten leer perfiles
      // sin uid para el flujo de vincular). El filtrado de "sin vincular" se hace
      // en cliente para cubrir uid==null, uid=="" y campo ausente.
      const q = query(
        collection(db, "staff_profiles"),
        where("storeId", "==", selectedStore)
      );
      const snap = await getDocs(q);

      const libres = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => !p.uid) // filtra uid==null, uid=="" y campo ausente
        .sort((a, b) => a.name.localeCompare(b.name, "es"));

      setAvailableStaff(libres);
    };
    loadAvailableStaff();
  }, [selectedStore]);

  const vincularCuenta = async () => {
    if (!selectedStaffId || !currentUser) return;
    const db = getFirestore();
    try {
      // 1. Leer el perfil seleccionado para obtener el storeId
      const { setDoc, getDoc: getDocument, updateDoc: updateDocument, serverTimestamp } = await import("firebase/firestore");
      const staffDocRef = doc(db, "staff_profiles", selectedStaffId);
      const staffSnap = await getDocument(staffDocRef);
      const staffData = staffSnap.exists() ? staffSnap.data() : {};
      const staffStoreId = staffData.storeId || "";

      // 2. Vincular el perfil de staff con la cuenta de auth
      await updateDoc(doc(db, "staff_profiles", selectedStaffId), {
        uid: currentUser.uid,
        email: currentUser.email || ""
      });

      // 3. Asegurar que exista el documento de usuario con rol y storeId correctos
      const userDocRef = doc(db, "users", currentUser.uid);
      const userSnap = await getDocument(userDocRef);
      if (!userSnap.exists()) {
        await setDoc(userDocRef, {
          email: currentUser.email || "",
          role: "collaborator",
          storeId: staffStoreId,
          createdAt: serverTimestamp(),
        });
      } else {
        // Actualizar storeId en caso de que no lo tenga
        const existingData = userSnap.data();
        if (!existingData.storeId && staffStoreId) {
          await updateDocument(userDocRef, { storeId: staffStoreId });
        }
      }

      window.location.reload();
    } catch (err) {
      console.error("Error al vincular cuenta:", err);
      alert("Error al vincular la cuenta. Intenta de nuevo.");
    }
  };



  const handleSaveBirthday = async () => {
    if (!perfil?.id) return;
    try {
      const db = getFirestore();
      await updateDoc(doc(db, "staff_profiles", perfil.id), {
        birthDate: tempBirthDate
      });
      setPerfil(prev => ({ ...prev, birthDate: tempBirthDate }));
      setIsEditingBirthday(false);
    } catch (error) {
      console.error("Error al guardar fecha de nacimiento:", error);
      alert("Error al actualizar la fecha. Intentalo de nuevo.");
    }
  };

  const startEditingBirthday = () => {
    setTempBirthDate(perfil?.birthDate || "");
    setIsEditingBirthday(true);
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
            {/* Added Birthday Field */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg group transition-all duration-200 hover:shadow-sm">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-xl" role="img" aria-label="birthday">🎂</span>
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500 font-medium">Cumpleaños</p>
                {isEditingBirthday ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="date"
                      value={tempBirthDate}
                      onChange={(e) => setTempBirthDate(e.target.value)}
                      className="text-sm border border-gray-300 rounded px-2 py-1 w-full focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    />
                    <button onClick={handleSaveBirthday} className="text-green-600 hover:text-green-800 p-1 hover:bg-green-50 rounded-full transition-colors">
                      <Save className="w-4 h-4" />
                    </button>
                    <button onClick={() => setIsEditingBirthday(false)} className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded-full transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">
                      {perfil.birthDate ? (() => {
                        const [y, m, d] = perfil.birthDate.split('-');
                        return `${d}/${m}/${y}`;
                      })() : <span className="text-gray-400 italic font-normal">Sin asignar</span>}
                    </p>
                    <button
                      onClick={startEditingBirthday}
                      className="opacity-0 group-hover:opacity-100 transition-all duration-200 text-blue-500 hover:text-blue-700 p-1 hover:bg-blue-50 rounded-full"
                      title={perfil.birthDate ? "Editar fecha" : "Agregar fecha"}
                    >
                      {perfil.birthDate ? <Edit className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {/* Carnet Sanitario */}
            <div className={`flex items-center gap-3 p-3 rounded-lg group transition-all duration-200 hover:shadow-sm ${getSanitaryCardStatus() === 'expired' ? 'bg-red-50' :
              getSanitaryCardStatus() === 'warning' ? 'bg-orange-50' : 'bg-gray-50'
              }`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getSanitaryCardStatus() === 'expired' ? 'bg-red-100' :
                getSanitaryCardStatus() === 'warning' ? 'bg-orange-100' : 'bg-blue-100'
                }`}>
                {getSanitaryCardStatus() === 'expired' ? <ShieldAlert className="w-5 h-5 text-red-600" /> :
                  getSanitaryCardStatus() === 'warning' ? <AlertTriangle className="w-5 h-5 text-orange-600" /> :
                    <ShieldCheck className="w-5 h-5 text-blue-600" />}
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500 font-medium">Carnet Sanitario</p>
                <div className="flex items-center justify-between">
                  <p className={`text-sm font-semibold ${getSanitaryCardStatus() === 'expired' ? 'text-red-700' :
                    getSanitaryCardStatus() === 'warning' ? 'text-orange-700' : 'text-gray-800'
                    }`}>
                    {perfil.sanitaryCardDate ? (() => {
                      const [y, m, d] = perfil.sanitaryCardDate.split('-');
                      return `${d}/${m}/${y}`;
                    })() : <span className="text-gray-400 italic font-normal">No registrado</span>}
                  </p>
                  {perfil.sanitaryCardUnlock && (
                    <Lock className="w-3 h-3 text-green-500" title="Desbloqueado por Admin" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notificaciones de Carnet Sanitario */}
        {getSanitaryCardStatus() === 'expired' && !perfil?.sanitaryCardUnlock && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-xl flex items-center gap-3 shadow-md">
            <ShieldAlert className="w-8 h-8 text-red-600" />
            <div>
              <p className="text-red-800 font-bold text-lg">⚠️ ACCESO RESTRINGIDO</p>
              <p className="text-sm text-red-700">
                Tu carnet de sanidad ha vencido. Por seguridad y normativa, <b>no puedes ingresar disponibilidades</b> hasta que tramites tu nuevo carnet y sea validado por administración.
              </p>
            </div>
          </div>
        )}

        {getSanitaryCardStatus() === 'expired' && perfil?.sanitaryCardUnlock && (
          <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-6 rounded-r-xl flex items-center gap-3 shadow-md">
            <ShieldCheck className="w-8 h-8 text-green-600" />
            <div>
              <p className="text-green-800 font-bold">Carnet Vencido - Acceso Permitido</p>
              <p className="text-sm text-green-700">
                Tu carnet está vencido, pero la administración ha habilitado temporalmente tu acceso. Por favor, regulariza tu situación lo antes posible.
              </p>
            </div>
          </div>
        )}

        {getSanitaryCardStatus() === 'warning' && (
          <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6 rounded-r-xl flex items-center gap-3 shadow-md">
            <AlertTriangle className="w-8 h-8 text-orange-600 animate-bounce" />
            <div>
              <p className="text-orange-800 font-bold">Próximo Vencimiento</p>
              <p className="text-sm text-orange-700">
                Tu carnet de sanidad vence en menos de 15 días. Recuerda iniciar los trámites de renovación para evitar el bloqueo de acceso.
              </p>
            </div>
          </div>
        )}

        {/* Bloqueo de Cambios Warning */}
        {isRestricted() && !isHealthCardBlocked() && (
          <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-6 rounded-r-xl flex items-center gap-3 shadow-sm">
            <Lock className="w-6 h-6 text-orange-600 animate-pulse" />
            <div>
              <p className="text-orange-800 font-bold">Cambios Bloqueos temporalmente</p>
              <p className="text-sm text-orange-700">
                La administración ha restringido los cambios hasta el <b>{new Date(lockSettings.reenableDate + 'T00:00:00').toLocaleDateString('es-ES')}</b> para evitar modificaciones de última hora.
              </p>
            </div>
          </div>
        )}

        {/* Botones de acción */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => !isRestricted() && setModalType("study")}
            className={`${isRestricted() ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white transform hover:scale-105'} p-6 rounded-xl shadow-md transition-all duration-200 flex flex-col items-center gap-3`}
            disabled={isRestricted()}
          >
            <BookOpen className="w-8 h-8" />
            <span className="font-semibold text-lg">Editar Horarios de Estudio</span>
            <span className="text-sm opacity-90">{isRestricted() ? 'Cambios inhabilitados' : 'Gestiona tus horarios académicos'}</span>
          </button>

          <button
            onClick={() => !isRestricted() && setModalType("feriados")}
            className={`${isRestricted() ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-purple-500 to-purple-600 text-white transform hover:scale-105'} p-6 rounded-xl shadow-md transition-all duration-200 flex flex-col items-center gap-3`}
            disabled={isRestricted()}
          >
            <Calendar className="w-8 h-8" />
            <span className="font-semibold text-lg">Registrar Feriados</span>
            <span className="text-sm opacity-90">{isRestricted() ? 'Cambios inhabilitados' : 'Indica días festivos trabajados'}</span>
          </button>
        </div>

        {/* --- SECCIÓN DE HABILIDADES Y PROGRESO (Para todos) --- */}
        {perfil?.id && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border-t-4 border-orange-400">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Award className="w-7 h-7 text-orange-500" />
                  Mi Progreso y Habilidades
                </h2>
                <p className="text-gray-500 text-sm">Visualiza las áreas que has dominado en la tienda.</p>
              </div>

              {/* Solo Trainees pueden auto-gestionarse, o si el admin lo permite. 
                  Para colaboradores regulares, el progreso lo marca el Trainer/Admin */}
              {perfil.isTrainee && (
                <button
                  onClick={() => setModalType("skills")}
                  className="px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                >
                  <PlusCircle className="w-5 h-5" />
                  Actualizar Mis Skills
                </button>
              )}
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
              {(() => {
                const masteredCount = perfil.skills?.filter(s => storeRequirements.includes(s)).length || 0;
                const totalCount = storeRequirements.length || 1;
                const percent = Math.round((masteredCount / totalCount) * 100);

                return (
                  <>
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-sm font-bold text-gray-700">Progreso Total</span>
                      <span className="text-sm font-bold text-orange-600">
                        {masteredCount} de {totalCount} posiciones
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden border border-gray-200 shadow-inner">
                      <div
                        className="bg-gradient-to-r from-orange-400 to-orange-600 h-full transition-all duration-1000 ease-out shadow-md"
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2 uppercase font-bold tracking-wider">
                      {Math.min(100, percent)}% de maestría alcanzada
                    </p>
                  </>
                );
              })()}
            </div>

            {/* Lista visual de Skills actuales */}
            <div className="flex flex-wrap gap-2">
              {perfil.skills && perfil.skills.length > 0 ? (
                perfil.skills.map(s => (
                  <span key={s} className="px-4 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-bold border border-green-200 flex items-center gap-2 shadow-sm">
                    <CheckCircle className="w-4 h-4 text-green-500" /> {s}
                  </span>
                ))
              ) : (
                <div className="w-full py-4 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <p className="text-gray-400 italic text-sm">Aún no hay habilidades registradas en tu perfil.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- CONSOLA DE ENTRENADOR --- */}
        {isTrainer && (
          <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6 border-t-4 border-blue-600">
            <div className="bg-gradient-to-r from-blue-700 to-indigo-800 px-6 py-4 flex items-center gap-3">
              <Award className="w-6 h-6 text-white" />
              <h2 className="text-xl font-bold text-white">Consola de Entrenador</h2>
            </div>
            <div className="p-6">
              <p className="text-gray-500 text-sm mb-6">Como Entrenador, puedes gestionar el progreso de los colaboradores en entrenamiento de tu tienda.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {storeStaff.map(staffMember => (
                  <div
                    key={staffMember.id}
                    className="border border-gray-100 rounded-xl p-4 bg-gray-50 hover:bg-white hover:shadow-md transition-all group"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-bold text-gray-800">{staffMember.name} {staffMember.lastName}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest">{staffMember.modality}</p>
                      </div>
                      {staffMember.isTrainee && (
                        <span className="text-[9px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">TRAINEE</span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1 mb-4 h-12 overflow-y-auto">
                      {staffMember.skills?.map(s => (
                        <span key={s} className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded border border-green-100">
                          {s}
                        </span>
                      ))}
                      {(!staffMember.skills || staffMember.skills.length === 0) && (
                        <span className="text-[10px] text-gray-400 italic">Sin habilidades registradas</span>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setSelectedTrainerStaff(staffMember);
                        setModalType("trainer_skills");
                      }}
                      className="w-full py-2 bg-white border border-blue-200 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                    >
                      GESTIONAR SKILLS
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* --- SECCIÓN DE HORARIO SEMANAL --- */}
        {perfil?.id && (
          <WeeklyView perfilId={perfil.id} />
        )}

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
                  {modalType === "skills" && <Award className="w-5 h-5" />}
                  {modalType === "trainer_skills" && <Award className="w-5 h-5" />}
                  {modalType === "study" && "Editar horarios de estudio"}
                  {modalType === "feriados" && "Registrar feriado"}
                  {modalType === "skills" && "Mis Habilidades"}
                  {modalType === "trainer_skills" && `Gestionar: ${selectedTrainerStaff?.name}`}
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
                {modalType === "skills" && (
                  <ModalSelectorDePosiciones
                    docId={perfil.id}
                    storeId={perfil.storeId}
                    onClose={() => {
                      closeModal();
                      // Refrescar perfil localmente para ver cambios
                      const fetchPerfil = async () => {
                        const db = getFirestore();
                        const snap = await getDoc(doc(db, "staff_profiles", perfil.id));
                        if (snap.exists()) setPerfil({ id: snap.id, ...snap.data() });
                      };
                      fetchPerfil();
                    }}
                  />
                )}
                {modalType === "trainer_skills" && (
                  <ModalSelectorDePosiciones
                    docId={selectedTrainerStaff.id}
                    storeId={perfil.storeId}
                    onClose={() => {
                      closeModal();
                      // Refrescar lista de staff para el entrenador
                      const fetchStoreStaff = async () => {
                        const db = getFirestore();
                        const q = query(collection(db, "staff_profiles"), where("storeId", "==", perfil.storeId));
                        const snap = await getDocs(q);
                        setStoreStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name)));
                      };
                      fetchStoreStaff();
                    }}
                  />
                )}
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

      {/* Footer Motivacional */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center">
          <div className="flex flex-col items-center justify-center gap-2">
            <Quote className="w-8 h-8 text-blue-300 transform rotate-180" />
            <p className="text-gray-600 font-medium italic text-lg max-w-2xl">
              "{dailyQuote}"
            </p>
          </div>
        </div>
      </footer>






    </div>
  );
};

export default CollaboratorDashboard;
