// ✅ StaffModal.jsx
import { useEffect, useState } from 'react';
import { getFirestore, doc, setDoc, addDoc, collection } from 'firebase/firestore';

function StaffModal({ staff = null, userData, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: staff?.name || '',
    lastName: staff?.lastName || '',
    modality: staff?.modality || 'Full-Time',
    dni: staff?.dni || '',
    sanitaryCardDate: staff?.sanitaryCardDate || '',
  });
  const [loading, setLoading] = useState(false);
  const db = getFirestore();

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name || !form.lastName) return alert('Todos los campos son obligatorios');
    setLoading(true);

    try {
      if (staff) {
        await setDoc(doc(db, 'staff_profiles', staff.id), {
          ...staff,
          ...form,
        });
      } else {
        await addDoc(collection(db, 'staff_profiles'), {
            ...form,
          storeId: userData.storeId, // ✅ Esto faltaba, añadir siempre storeId
          status: 'pending',
          createdAt: new Date(),
        });
      }
      onSaved();
    } catch (err) {
      console.error('Error al guardar:', err);
      alert('Error al guardar el colaborador.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white p-6 rounded shadow max-w-md w-full relative">
        <button onClick={onClose} className="absolute top-2 right-2 text-gray-500 hover:text-black">✖</button>
        <h2 className="text-xl font-bold mb-4">{staff ? 'Editar' : 'Agregar'} Colaborador</h2>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm">Nombre</label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              className="w-full border p-2 rounded"
            />
          </div>
          <div>
            <label className="block text-sm">Apellido</label>
            <input
              type="text"
              name="lastName"
              value={form.lastName}
              onChange={handleChange}
              className="w-full border p-2 rounded"
            />
          </div>
	  <div>
  <label className="block text-sm">DNI</label>
  <input
    type="text"
    name="dni"
    value={form.dni}
    onChange={handleChange}
    className="w-full border p-2 rounded"
  />
</div>
          <div>
            <label className="block text-sm">Modalidad</label>
            <select
              name="modality"
              value={form.modality}
              onChange={handleChange}
              className="w-full border p-2 rounded"
            >
              <option>Full-Time</option>
              <option>Part-Time</option>
            </select>
          </div>
<div>
  <label className="block text-sm">Fecha de vencimiento del carnet</label>
  <input
    type="date"
    name="sanitaryCardDate"
    value={form.sanitaryCardDate}
    onChange={handleChange}
    className="w-full border p-2 rounded"
  />
</div>

          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default StaffModal;

