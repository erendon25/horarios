import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  getDocs,
  updateDoc as updateFirestoreDoc
} from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { getAuth as getAuthMain, createUserWithEmailAndPassword } from 'firebase/auth';
import { firebaseConfig } from '../firebase';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Building2, 
  Store, 
  MapPin, 
  ShieldAlert, 
  UserPlus, 
  Users, 
  LogOut, 
  Trash2, 
  Edit, 
  Search,
  Filter,
  Link2Off,
  Database,
  CheckCircle,
  Home
} from 'lucide-react';

function SuperAdminDashboard() {
  const [stores, setStores] = useState([]);
  const [newStore, setNewStore] = useState({ name: '', ciudad: '', direccion: '' });
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [editingStoreId, setEditingStoreId] = useState(null);
  const [staffProfiles, setStaffProfiles] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [modalityFilter, setModalityFilter] = useState('');
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const { logout, currentUser } = useAuth();
  const navigate = useNavigate();

  const db = getFirestore();

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'stores'), (snapshot) => {
      const storeList = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setStores(storeList);
    });
    return () => unsubscribe();
  }, [db]);

  useEffect(() => {
    const fetchStaff = async () => {
      const snapshot = await getDocs(collection(db, 'staff_profiles'));
      const result = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaffProfiles(result);
    };
    fetchStaff();
  }, [db]);

  const handleCreateStore = async () => {
    try {
      if (!newStore.name || !newStore.ciudad || !newStore.direccion) {
        toast.error('Todos los campos son obligatorios para crear una tienda');
        return;
      }
      await addDoc(collection(db, 'stores'), newStore);
      toast.success('Tienda creada exitosamente');
      setNewStore({ name: '', ciudad: '', direccion: '' });
    } catch (err) {
      toast.error('Error al crear tienda');
    }
  };

  const handleDeleteStore = async (storeId) => {
    const confirm = window.confirm('¿Estás seguro de que deseas eliminar esta tienda?');
    if (!confirm) return;
    try {
      await deleteDoc(doc(db, 'stores', storeId));
      toast.success('Tienda eliminada');
    } catch (err) {
      toast.error('Error al eliminar tienda');
    }
  };

  const handleUpdateStore = async () => {
    try {
      if (!newStore.name || !newStore.ciudad || !newStore.direccion) {
        toast.error('Todos los campos son obligatorios');
        return;
      }
      await updateDoc(doc(db, 'stores', editingStoreId), {
        name: newStore.name.trim(),
        ciudad: newStore.ciudad.trim(),
        direccion: newStore.direccion.trim(),
      });
      toast.success('Tienda actualizada');
      setNewStore({ name: '', ciudad: '', direccion: '' });
      setEditingStoreId(null);
    } catch (err) {
      toast.error('Error al actualizar tienda');
    }
  };

  const handleEditStore = (store) => {
    setEditingStoreId(store.id);
    setNewStore({
      name: store.name || '',
      ciudad: store.ciudad || '',
      direccion: store.direccion || ''
    });
  };

  const handleCreateAdmin = async () => {
    try {
      if (!adminEmail.includes('@') || adminPassword.length < 6 || !selectedStoreId) {
        toast.error('Email inválido, contraseña muy corta (mín. 6) o tienda no seleccionada');
        return;
      }

      const tempApp = initializeApp(firebaseConfig, 'TempApp');
      const tempAuth = getAuthMain(tempApp);
      const userCredential = await createUserWithEmailAndPassword(tempAuth, adminEmail, adminPassword);
      const uid = userCredential.user.uid;

      await setDoc(doc(db, 'users', uid), {
        email: adminEmail,
        role: 'admin',
        storeId: selectedStoreId,
        createdAt: new Date().toISOString()
      });

      toast.success('Administrador creado exitosamente');
      setAdminEmail('');
      setAdminPassword('');
      setSelectedStoreId('');
    } catch (err) {
      console.error(err);
      toast.error('Error al crear administrador: ' + err.message);
    }
  };

  const handleUnlinkEmail = async (id) => {
    const confirm = window.confirm('¿Estás seguro de desvincular el correo del colaborador?');
    if (!confirm) return;

    try {
      const ref = doc(db, 'staff_profiles', id);
      await updateFirestoreDoc(ref, { email: '', uid: '' });
      toast.success('Correo y acceso desvinculados');
      setStaffProfiles(prev => prev.map(p => p.id === id ? { ...p, email: '', uid: '' } : p));
    } catch (error) {
      toast.error('No se pudo desvincular el correo');
    }
  };

  const handleMigrateStudySchedules = async () => {
    const confirm = window.confirm('¿Deseas intentar migrar los horarios de estudio antiguos al nuevo formato?');
    if (!confirm) return;

    try {
      const studySnap = await getDocs(collection(db, 'study_schedules'));
      let count = 0;

      for (const docSnap of studySnap.docs) {
        const data = docSnap.data();
        const uid = docSnap.id;

        if (!data.uid) {
          const updated = { uid };

          weekdays.forEach((day) => {
            const blocks = data[day];
            if (Array.isArray(blocks)) {
              updated[day] = {
                free: blocks.length === 0,
                blocks: blocks.map((b) => ({
                  start: b.start || b.startTime,
                  end: b.end || b.endTime
                }))
              };
            }
          });

          await setDoc(doc(db, 'study_schedules', uid), {
            ...data,
            ...updated
          });
          count++;
          console.log(`✅ Migrado: ${uid}`);
        }
      }
      toast.success(`Migración completada. ${count} horarios actualizados.`);
    } catch (error) {
      toast.error('Error durante la migración.');
      console.error(error);
    }
  };
  
  const handleLogout = async () => {
      try {
          await logout();
          navigate('/login');
      } catch (err) {
          toast.error("Error al salir");
      }
  }

  const filteredStaff = staffProfiles.filter(profile => {
    const matchesName = profile.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStore = storeFilter === '' || profile.storeId === storeFilter;
    const matchesModality = modalityFilter === '' || profile.modality === modalityFilter;
    return matchesName && matchesStore && matchesModality;
  });

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      {/* HEADER */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-8 h-8 text-fuchsia-600" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-700 to-fuchsia-600 bg-clip-text text-transparent hidden sm:block">
                Superadmin Dashboard
              </h1>
            </div>
            
            <div className="flex gap-3 items-center">
              {currentUser?.email === 'erickrendon18@gmail.com' && (
                  <button 
                    onClick={() => navigate('/admin')}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg shadow hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm font-medium"
                  >
                    <Home className="w-4 h-4" />
                    Regresar a Admin
                  </button>
              )}
              <button
                onClick={handleMigrateStudySchedules}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg shadow-sm hover:shadow transform hover:-translate-y-0.5 transition-all text-sm font-medium"
                title="Migrar datos legacy de usuarios"
              >
                <Database className="w-4 h-4" />
                Migrar DB Scripts
              </button>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg shadow hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm font-medium"
              >
                <LogOut className="w-4 h-4" />
                Salir
              </button>
            </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* ROW PRIMARY */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* GESTIÓN DE TIENDAS */}
          <div className="bg-white rounded-2xl shadow border border-gray-100 p-6">
             <div className="flex items-center gap-2 mb-6 text-indigo-700">
               <Building2 className="w-6 h-6" />
               <h2 className="text-xl font-bold">Gestión de Tiendas</h2>
             </div>

             <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-6">
                <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                  {editingStoreId ? 'Editando Tienda' : 'Registrar Nueva Tienda'}
                </h3>
                <div className="space-y-3">
                  <div className="relative">
                    <Store className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input 
                      type="text" 
                      placeholder="Nombre de la tienda" 
                      className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={newStore.name} 
                      onChange={(e) => setNewStore({ ...newStore, name: e.target.value })} 
                    />
                  </div>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input 
                      type="text" 
                      placeholder="Ciudad" 
                      className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={newStore.ciudad} 
                      onChange={(e) => setNewStore({ ...newStore, ciudad: e.target.value })} 
                    />
                  </div>
                  <input 
                    type="text" 
                    placeholder="Dirección exacta" 
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={newStore.direccion} 
                    onChange={(e) => setNewStore({ ...newStore, direccion: e.target.value })} 
                  />
                  <div className="pt-2 flex gap-3">
                      {editingStoreId ? (
                         <>
                           <button onClick={handleUpdateStore} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg font-bold shadow transition-colors flex justify-center items-center gap-2">
                             <CheckCircle className="w-4 h-4"/>
                             Guardar Cambios
                           </button>
                           <button onClick={() => { setEditingStoreId(null); setNewStore({name:'', ciudad:'', direccion:''}); }} className="px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-bold transition-colors">
                             Cancelar
                           </button>
                         </>
                      ) : (
                         <button onClick={handleCreateStore} className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-bold shadow transition-colors flex justify-center items-center gap-2">
                           <Store className="w-4 h-4"/>
                           Crear Tienda
                         </button>
                      )}
                  </div>
                </div>
             </div>

             <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Tiendas Activas ({stores.length})</h3>
             <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                {stores.length > 0 ? stores.map(store => (
                   <div key={store.id} className="p-4 border border-gray-100 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow group flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                     <div>
                       <h4 className="font-bold text-gray-800 flex items-center gap-2">{store.name}</h4>
                       <span className="text-xs text-gray-500 block mt-1"><span className="font-semibold text-gray-700">Ciudad:</span> {store.ciudad}</span>
                       <span className="text-xs text-gray-500 block"><span className="font-semibold text-gray-700">Ref:</span> {store.direccion}</span>
                     </div>
                     <div className="flex gap-2">
                         <button onClick={() => handleEditStore(store)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100" title="Editar">
                           <Edit className="w-4 h-4" />
                         </button>
                         <button onClick={() => handleDeleteStore(store.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100" title="Eliminar">
                           <Trash2 className="w-4 h-4" />
                         </button>
                     </div>
                   </div>
                )) : (
                  <p className="text-sm text-gray-500 italic text-center py-4">No hay tiendas creadas</p>
                )}
             </div>
          </div>

          {/* GESTION DE ADMINISTRADORES */}
          <div className="bg-white rounded-2xl shadow border border-gray-100 p-6 flex flex-col">
             <div className="flex items-center gap-2 mb-6 text-fuchsia-600">
               <UserPlus className="w-6 h-6" />
               <h2 className="text-xl font-bold">Crear Accesos de Administrador</h2>
             </div>
             <p className="text-sm text-gray-500 mb-6">Genera credenciales con roles de administrador asignados a una tienda específica.</p>

             <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 flex-1 flex flex-col justify-center space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">Tienda Asignada</label>
                  <select 
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-fuchsia-500 outline-none bg-white font-medium" 
                    value={selectedStoreId} 
                    onChange={(e) => setSelectedStoreId(e.target.value)}
                  >
                    <option value="">-- Seleccionar Tienda --</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>{store.name} - {store.ciudad}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">Correo Electrónico</label>
                  <input 
                    type="email" 
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-fuchsia-500 outline-none" 
                    placeholder="admin@empresa.com" 
                    value={adminEmail} 
                    onChange={(e) => setAdminEmail(e.target.value)} 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">Contraseña Temporal</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-fuchsia-500 outline-none font-mono" 
                    placeholder="Min. 6 caracteres" 
                    value={adminPassword} 
                    onChange={(e) => setAdminPassword(e.target.value)} 
                  />
                </div>

                <div className="pt-4">
                  <button onClick={handleCreateAdmin} className="w-full bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-700 hover:to-purple-700 text-white py-3 rounded-xl font-bold shadow-md transition-all flex justify-center items-center gap-2 transform hover:-translate-y-0.5">
                    <ShieldAlert className="w-5 h-5"/>
                    Confirmar Creación de Administrador
                  </button>
                </div>
             </div>
          </div>
        </div>

        {/* DIRECTORIO DE COLABORADORES */}
        <div className="bg-white rounded-2xl shadow border border-gray-100 p-6">
           <div className="flex items-center gap-2 mb-6 text-emerald-600">
             <Users className="w-6 h-6" />
             <h2 className="text-xl font-bold">Directorio Global de Colaboradores</h2>
           </div>

           <div className="flex flex-col md:flex-row gap-4 mb-6">
             <div className="relative flex-1">
               <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
               <input 
                 type="text" 
                 placeholder="Buscar por nombre..." 
                 className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-gray-50" 
                 value={searchTerm} 
                 onChange={(e) => setSearchTerm(e.target.value)} 
               />
             </div>
             <div className="flex gap-2 w-full md:w-auto">
               <div className="relative flex-1 md:w-48">
                 <Filter className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                 <select 
                   className="w-full pl-9 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-gray-50 text-sm" 
                   value={storeFilter} 
                   onChange={(e) => setStoreFilter(e.target.value)}
                 >
                   <option value="">Todas las tiendas</option>
                   {stores.map(store => (<option key={store.id} value={store.id}>{store.name}</option>))}
                 </select>
               </div>
               <div className="relative flex-1 md:w-48">
                 <Filter className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                 <select 
                   className="w-full pl-9 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-gray-50 text-sm" 
                   value={modalityFilter} 
                   onChange={(e) => setModalityFilter(e.target.value)}
                 >
                   <option value="">Todas las mods.</option>
                   <option value="Full-Time">Full-Time</option>
                   <option value="Part-Time">Part-Time</option>
                 </select>
               </div>
             </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
             {filteredStaff.map((profile) => (
               <div key={profile.id} className="p-4 border rounded-xl hover:shadow-lg transition-all bg-white relative group flex flex-col h-full border-gray-200">
                 <div className="flex-1">
                   <h3 className="text-base font-bold text-gray-800 leading-tight mb-1">{profile.name || 'Sin nombre'} {profile.lastName || ''}</h3>
                   <div className="space-y-1 mb-3">
                     <p className="text-xs text-gray-500 font-mono bg-gray-100 px-1 py-0.5 rounded w-fit">ID: {profile.id}</p>
                     
                     <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                         profile.modality === 'Full-Time' ? 'bg-green-100 text-green-700' :
                         profile.modality === 'Part-Time' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                     }`}>
                       {profile.modality || 'Indefinido'}
                     </span>
                     
                     <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 ml-1">
                       {stores.find(s => s.id === profile.storeId)?.name || 'Sin tienda'}
                     </span>
                   </div>
                   
                   <p className="text-[11px] text-gray-500 mt-2 line-clamp-1" title={profile.email || 'Ninguno'}>
                     <span className="font-semibold text-gray-700">Email:</span> {profile.email || <span className="italic">No vinculado</span>}
                   </p>
                 </div>

                 {profile.email && (
                   <div className="mt-4 pt-3 border-t border-gray-100">
                     <button 
                       onClick={() => handleUnlinkEmail(profile.id)} 
                       className="flex items-center justify-center gap-1 w-full text-xs font-bold text-red-600 hover:text-white border border-red-200 hover:bg-red-500 py-1.5 rounded transition-colors"
                     >
                       <Link2Off className="w-3 h-3" />
                       Desvincular Correo
                     </button>
                   </div>
                 )}
               </div>
             ))}
             
             {filteredStaff.length === 0 && (
                <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-400">
                   <Users className="w-12 h-12 mb-3 opacity-20" />
                   <p className="text-sm font-medium">No se encontraron colaboradores</p>
                </div>
             )}
           </div>

        </div>

      </main>
    </div>
  );
}

export default SuperAdminDashboard;
