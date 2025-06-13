// StudyScheduleForm.jsx
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
          setSchedule(snap.data());
        } else {
          setSchedule({});
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
    setSchedule(prev => {
      const prevDay = prev[day] || [];
      const updated = [...prevDay];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, [day]: updated };
    });
  };

  const addBlock = (day) => {
    setSchedule(prev => {
      const updated = [...(prev[day] || [])];
      updated.push({ start: '', end: '' });
      return { ...prev, [day]: updated };
    });
  };

  const removeBlock = (day, index) => {
    setSchedule(prev => {
      const updated = [...(prev[day] || [])];
      updated.splice(index, 1);
      return { ...prev, [day]: updated };
    });
  };

  const handleSave = async () => {
    try {
      await setDoc(doc(db, 'study_schedules', currentUser.uid), schedule);
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
          <h2 className="text-xl font-semibold mb-2">{labels[day]}</h2>
          {(schedule[day] || []).map((block, idx) => (
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