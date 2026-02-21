// ✅ StaffModal.jsx
import { useState } from 'react';
import { getFirestore, doc, setDoc, addDoc, collection } from 'firebase/firestore';

function StaffModal({ staff = null, userData, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: staff?.name || '',
    lastName: staff?.lastName || '',
    modality: staff?.modality || 'Full-Time',
    dni: staff?.dni || '',
    gender: staff?.gender || '',
    joinDate: staff?.joinDate || '',
    sanitaryCardDate: staff?.sanitaryCardDate || '',
    cessationDate: staff?.cessationDate || '',
    isTrainee: staff?.isTrainee || false,
    trainingEndDate: staff?.trainingEndDate || '',
  });
  const [loading, setLoading] = useState(false);
  const db = getFirestore();

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name || !form.lastName) return alert('Nombre y apellido son obligatorios');
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
          storeId: userData.storeId,
          status: 'pending',
          createdAt: new Date().toISOString(),
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

  const inputCls = "w-full border border-gray-300 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm";
  const labelCls = "block text-sm font-medium text-gray-600 mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {staff ? 'Editar' : 'Agregar'} Colaborador
          </h2>
          <button onClick={onClose} className="text-white hover:text-blue-200 text-2xl font-bold leading-none">&times;</button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">

          {/* Nombre + Apellido */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nombre *</label>
              <input type="text" name="name" value={form.name} onChange={handleChange} className={inputCls} placeholder="Ej: Aydan" />
            </div>
            <div>
              <label className={labelCls}>Apellido *</label>
              <input type="text" name="lastName" value={form.lastName} onChange={handleChange} className={inputCls} placeholder="Ej: Cari Sanchez" />
            </div>
          </div>

          {/* DNI + Sexo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>DNI</label>
              <input type="text" name="dni" value={form.dni} onChange={handleChange} className={inputCls} placeholder="Ej: 73221235" maxLength={15} />
            </div>
            <div>
              <label className={labelCls}>Sexo</label>
              <select name="gender" value={form.gender} onChange={handleChange} className={inputCls}>
                <option value="">— Seleccionar —</option>
                <option value="MASCULINO">MASCULINO</option>
                <option value="FEMENINO">FEMENINO</option>
              </select>
            </div>
          </div>

          {/* Modalidad + Fecha de ingreso */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Modalidad</label>
              <select name="modality" value={form.modality} onChange={handleChange} className={inputCls}>
                <option>Full-Time</option>
                <option>Part-Time</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Fecha de Ingreso</label>
              <input type="date" name="joinDate" value={form.joinDate} onChange={handleChange} className={inputCls} />
            </div>
          </div>

          {/* Carnet sanitario */}
          <div>
            <label className={labelCls}>Fecha de vencimiento del carnet sanitario</label>
            <input type="date" name="sanitaryCardDate" value={form.sanitaryCardDate} onChange={handleChange} className={inputCls} />
          </div>

          {/* Fecha de cese — solo si NO es trainee */}
          {!form.isTrainee && (
            <div>
              <label className="block text-sm font-medium text-red-600 mb-1">
                Fecha de Cese <span className="font-normal text-gray-400">(dejar vacío si está activo)</span>
              </label>
              <input
                type="date"
                name="cessationDate"
                value={form.cessationDate}
                onChange={handleChange}
                className="w-full border border-red-300 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 text-sm"
              />
              {form.cessationDate && (
                <p className="text-xs text-gray-500 mt-1">
                  ⚠️ Dejará de contarse a partir del{' '}
                  {new Date(form.cessationDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}.
                </p>
              )}
            </div>
          )}

          {/* Trainee toggle */}
          <div
            onClick={() => setForm(prev => ({ ...prev, isTrainee: !prev.isTrainee, cessationDate: '', trainingEndDate: '' }))}
            className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all select-none ${form.isTrainee
                ? 'border-orange-400 bg-orange-50'
                : 'border-gray-200 bg-gray-50 hover:border-gray-300'
              }`}
          >
            <div className={`w-10 h-6 rounded-full relative transition-colors ${form.isTrainee ? 'bg-orange-500' : 'bg-gray-300'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${form.isTrainee ? 'left-5' : 'left-1'}`} />
            </div>
            <div>
              <p className={`text-sm font-semibold ${form.isTrainee ? 'text-orange-700' : 'text-gray-600'}`}>
                🎓 Colaborador de Entrenamiento
              </p>
              <p className="text-xs text-gray-400 mt-0.5">No cuenta en los totales de plantilla</p>
            </div>
          </div>

          {/* Fecha de fin de entrenamiento — solo si es trainee */}
          {form.isTrainee && (
            <div>
              <label className="block text-sm font-medium text-orange-600 mb-1">
                Fecha de Fin de Entrenamiento <span className="font-normal text-gray-400">(dejar vacío si no se sabe aún)</span>
              </label>
              <input
                type="date"
                name="trainingEndDate"
                value={form.trainingEndDate}
                onChange={handleChange}
                className="w-full border border-orange-300 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
              />
              {form.trainingEndDate && (
                <p className="text-xs text-orange-500 mt-1">
                  🎓 Dejará de aparecer en el sistema a partir del{' '}
                  {new Date(form.trainingEndDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}.
                </p>
              )}
            </div>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StaffModal;
