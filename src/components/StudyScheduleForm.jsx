import React, { useEffect, useState } from 'react';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Clock, Plus, Trash2, Save, CheckCircle, X } from 'lucide-react';

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const labels = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo'
};

export default function StudyScheduleForm({ onSuccess }) {
  const { currentUser } = useAuth();
  const db = getFirestore();
  const [schedule, setSchedule] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'study_schedules', currentUser.uid));
        if (snap.exists()) {
          const raw = snap.data();
          const formatted = Object.fromEntries(
            days.map(day => {
              const val = raw[day];
              return [
                day,
                {
                  free: val?.free || false,
                  blocks: Array.isArray(val?.blocks) ? val.blocks : []
                }
              ];
            })
          );
          setSchedule(formatted);
        } else {
          setSchedule(Object.fromEntries(days.map(d => [d, { free: false, blocks: [] }])));
        }
      } catch (err) {
        console.error('Error al cargar horario de estudio:', err);
        alert('Error al cargar horario de estudio');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentUser]);

  const handleChange = (day, index, field, value) => {
    const blocks = [...(schedule[day]?.blocks || [])];
    blocks[index] = { ...blocks[index], [field]: value };
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        blocks
      }
    }));
  };

  const addBlock = (day) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        blocks: [...(prev[day]?.blocks || []), { start: '', end: '' }]
      }
    }));
  };

  const removeBlock = (day, index) => {
    const blocks = [...(schedule[day]?.blocks || [])];
    blocks.splice(index, 1);
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        blocks
      }
    }));
  };

  const handleToggleFree = (day, checked) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        free: checked,
        blocks: checked ? [] : (prev[day]?.blocks || [])
      }
    }));
  };

  const handleSave = async () => {
    try {
      const payload = Object.fromEntries(
        days.map(day => [
          day,
          {
            free: schedule[day]?.free || false,
            blocks: schedule[day]?.blocks || []
          }
        ])
      );
      await setDoc(doc(db, 'study_schedules', currentUser.uid), payload);
      alert('Horarios guardados correctamente.');
    } catch (err) {
      console.error('Error al guardar:', err);
      alert('Error al guardar horario');
    }
  };

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveWithFeedback = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await handleSave();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err) {
      console.error('Error al guardar:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Cargando horarios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
        <p className="text-sm text-gray-700">
          <strong>Instrucciones:</strong> Agrega los bloques de horarios de estudio para cada día. Si necesitas el día libre, marca la casilla correspondiente.
        </p>
      </div>

      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
        {days.map(day => (
          <div key={day} className="bg-white border-2 border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-all">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                {labels[day]}
              </h2>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={schedule[day]?.free || false}
                  onChange={(e) => handleToggleFree(day, e.target.checked)}
                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600 transition-colors">
                  Solicitar día libre
                </span>
              </label>
            </div>

            {schedule[day]?.free ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-green-700 font-semibold">Día libre solicitado</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-3">
                  {schedule[day]?.blocks?.map((block, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex-1 flex items-center gap-3">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-600 mb-1">Inicio</label>
                          <input
                            type="time"
                            value={block.start || ''}
                            onChange={(e) => handleChange(day, idx, 'start', e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-gray-600 mb-1">Fin</label>
                          <input
                            type="time"
                            value={block.end || ''}
                            onChange={(e) => handleChange(day, idx, 'end', e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeBlock(day, idx)}
                        className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-colors"
                        title="Eliminar bloque"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => addBlock(day)}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2.5 rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                >
                  <Plus className="w-4 h-4" />
                  Agregar bloque de horario
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button
          onClick={handleSaveWithFeedback}
          disabled={saving}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 ${
            saved 
              ? 'bg-green-500 text-white' 
              : 'bg-gradient-to-r from-green-500 to-green-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none`}
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Guardando...
            </>
          ) : saved ? (
            <>
              <CheckCircle className="w-5 h-5" />
              ¡Guardado!
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              Guardar Horarios
            </>
          )}
        </button>
      </div>
    </div>
  );
}
