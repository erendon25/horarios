import React, { useEffect, useState } from 'react';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';

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

export default function StudyScheduleForm() {
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

  if (loading) return <p>Cargando...</p>;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Registrar Horarios de Estudio</h1>
      {days.map(day => (
        <div key={day} className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xl font-semibold">{labels[day]}</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={schedule[day]?.free || false}
                onChange={(e) => handleToggleFree(day, e.target.checked)}
              />
              Solicitar día libre
            </label>
          </div>

          {schedule[day]?.blocks?.map((block, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-2">
              <input
                type="time"
                value={block.start || ''}
                onChange={(e) => handleChange(day, idx, 'start', e.target.value)}
                className="border p-1 rounded"
              />
              <input
                type="time"
                value={block.end || ''}
                onChange={(e) => handleChange(day, idx, 'end', e.target.value)}
                className="border p-1 rounded"
              />
              <button
                onClick={() => removeBlock(day, idx)}
                className="text-red-600 hover:underline"
              >🗑️</button>
            </div>
          ))}

          <button
            onClick={() => addBlock(day)}
            className="bg-blue-600 text-white text-sm px-2 py-1 rounded"
            disabled={schedule[day]?.free}
          >+ Agregar bloque</button>
        </div>
      ))}
      <button
        onClick={handleSave}
        className="mt-4 bg-green-600 text-white px-4 py-2 rounded"
      >Guardar Horarios</button>
    </div>
  );
}
