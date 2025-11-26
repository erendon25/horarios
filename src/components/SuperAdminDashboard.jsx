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
      await addDoc(collection(db, 'stores'), newStore);
      toast.success('Tienda creada exitosamente');
      setNewStore({ name: '', ciudad: '', direccion: '' });
    } catch (err) {
      toast.error('Error al crear tienda');
    }
  };

  const handleDeleteStore = async (storeId) => {
    try {
      await deleteDoc(doc(db, 'stores', storeId));
      toast.success('Tienda eliminada');
    } catch (err) {
      toast.error('Error al eliminar tienda');
    }
  };

  const handleUpdateStore = async () => {
    try {
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
      if (!adminEmail.includes('@') || adminPassword.length < 6) {
        toast.error('Email inválido o contraseña muy corta (mín. 6 caracteres)');
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
        createdAt: new Date()
      });

      toast.success('Administrador creado');
      setAdminEmail('');
      setAdminPassword('');
      setSelectedStoreId('');
    } catch (err) {
      toast.error('Error al crear administrador');
    }
  };

  const handleUnlinkEmail = async (id) => {
    const confirm = window.confirm('¿Estás seguro de desvincular el correo del colaborador?');
    if (!confirm) return;

    try {
      const ref = doc(db, 'staff_profiles', id);
      await updateFirestoreDoc(ref, { email: '' });
      toast.success('Correo desvinculado');
      setStaffProfiles(prev => prev.map(p => p.id === id ? { ...p, email: '' } : p));
    } catch (error) {
      toast.error('No se pudo desvincular el correo');
    }
  };
const handleMigrateStudySchedules = async () => {
  const studySnap = await getDocs(collection(db, 'study_schedules'));

  for (const docSnap of studySnap.docs) {
    const data = docSnap.data();
    const uid = docSnap.id;

    // Verifica si ya tiene uid, para no reescribir innecesariamente
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

      console.log(`✅ Migrado y actualizado: ${uid}`);
    } else {
      console.log(`ℹ️ Ya tiene UID asignado: ${uid}`);
    }
  }

  alert('Migración completada.');
};

  const filteredStaff = staffProfiles.filter(profile => {
    const matchesName = profile.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStore = storeFilter === '' || profile.storeId === storeFilter;
    const matchesModality = modalityFilter === '' || profile.modality === modalityFilter;
    return matchesName && matchesStore && matchesModality;
  });
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Panel de Superusuario</h1>
 <button
        onClick={handleMigrateStudySchedules}
        className="mb-4 px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
      >
        Migrar horarios de estudio
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-semibold mb-2">Tiendas registradas</h2>
          <div className="space-y-4">
            {stores.map((store) => (
              <div key={store.id} className="p-4 border rounded shadow bg-white">
                <h3 className="text-lg font-bold">{store.name}</h3>
                <p><strong>Ciudad:</strong> {store.ciudad}</p>
                <p><strong>Dirección:</strong> {store.direccion}</p>
                <div className="mt-2 flex gap-2">
                  <button className="bg-yellow-500 text-white px-2 py-1 rounded" onClick={() => handleEditStore(store)}>Editar</button>
                  <button className="bg-red-600 text-white px-2 py-1 rounded" onClick={() => handleDeleteStore(store.id)}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>

          {editingStoreId && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-2">Editar Tienda</h2>
              <input className="block w-full p-2 border mb-2" placeholder="Nombre" value={newStore.name} onChange={(e) => setNewStore({ ...newStore, name: e.target.value })} />
              <input className="block w-full p-2 border mb-2" placeholder="Ciudad" value={newStore.ciudad} onChange={(e) => setNewStore({ ...newStore, ciudad: e.target.value })} />
              <input className="block w-full p-2 border mb-2" placeholder="Dirección" value={newStore.direccion} onChange={(e) => setNewStore({ ...newStore, direccion: e.target.value })} />
              <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={handleUpdateStore}>Actualizar</button>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">Crear nueva tienda</h2>
            <input className="block w-full p-2 border mb-2" placeholder="Nombre" value={newStore.name} onChange={(e) => setNewStore({ ...newStore, name: e.target.value })} />
            <input className="block w-full p-2 border mb-2" placeholder="Ciudad" value={newStore.ciudad} onChange={(e) => setNewStore({ ...newStore, ciudad: e.target.value })} />
            <input className="block w-full p-2 border mb-2" placeholder="Dirección" value={newStore.direccion} onChange={(e) => setNewStore({ ...newStore, direccion: e.target.value })} />
            <button className="bg-green-600 text-white px-4 py-2 rounded" onClick={handleCreateStore}>Crear tienda</button>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">Crear administrador</h2>
            <select className="block w-full p-2 border mb-2" value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)}>
              <option value="">Seleccione tienda</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
            <input className="block w-full p-2 border mb-2" placeholder="Email del administrador" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            <input className="block w-full p-2 border mb-2" type="password" placeholder="Contraseña" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
            <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={handleCreateAdmin}>Crear administrador</button>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">Colaboradores registrados</h2>
            <input type="text" placeholder="Buscar por nombre..." className="w-full p-2 border mb-2" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            <div className="flex gap-2 mb-4">
              <select className="p-2 border w-1/2" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
                <option value="">Todas las tiendas</option>
                {stores.map(store => (<option key={store.id} value={store.id}>{store.name}</option>))}
              </select>
              <select className="p-2 border w-1/2" value={modalityFilter} onChange={(e) => setModalityFilter(e.target.value)}>
                <option value="">Todas las modalidades</option>
                <option value="Full-Time">Full-Time</option>
                <option value="Part-Time">Part-Time</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {filteredStaff.map((profile) => (
                <div key={profile.id} className="p-4 border rounded shadow bg-white">
                  <h3 className="text-lg font-bold">{profile.name || 'Sin nombre asignado'}</h3>
                  <p className="text-sm text-gray-600">ID: {profile.id}</p>
                  <p className="text-sm">Tienda: {stores.find(s => s.id === profile.storeId)?.name || 'Sin tienda'}</p>
                  <p className="text-sm">Modalidad: {profile.modality || 'Sin modalidad'}</p>
                  <p title={profile.email || 'Sin correo'} className="text-xs italic text-gray-500 truncate">Correo: {profile.email || 'Sin correo asignado'}</p>
                  {profile.email && (
                    <button onClick={() => handleUnlinkEmail(profile.id)} className="mt-2 text-red-600 text-sm underline">Desvincular correo</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminDashboard;

