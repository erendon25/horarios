// components/StudyScheduleEditor.jsx
import { useState, useEffect } from 'react';
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';

export default function StudyScheduleEditor({ uid: propUid, onClose }) {
    const { uid: paramUid } = useParams();
    const uid = propUid || paramUid;

    const db = getFirestore();
    const [schedule, setSchedule] = useState({});
    const [loading, setLoading] = useState(true);

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

    useEffect(() => {
        if (!uid) return;

        const fetchSchedule = async () => {
            try {
                const ref = doc(db, 'study_schedules', uid);
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    setSchedule(snap.data());
                }
            } catch (e) {
                console.error('Error cargando horario:', e);
            } finally {
                setLoading(false);
            }
        };

        fetchSchedule();
    }, [uid, db]);

    const handleChange = (day, index, field, value) => {
        setSchedule(prev => {
            const updated = [...(prev[day] || [])];
            updated[index] = { ...updated[index], [field]: value };
            return { ...prev, [day]: updated };
        });
    };

    const addBlock = (day) => {
        setSchedule(prev => {
            const updated = [...(prev[day] || []), { start: '', end: '' }];
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
        if (!uid) return;
        try {
            await setDoc(doc(db, 'study_schedules', uid), schedule);
            alert('Horario guardado correctamente.');
        } catch (e) {
            console.error('Error al guardar:', e);
        }
    };

    if (!uid) {
        return <p className="text-red-600">UID no especificado.</p>;
    }

    if (loading) return <p>Cargando horario...</p>;

    return (
        <div className="p-4 w-full max-w-4xl mx-auto bg-white rounded shadow-md max-h-[80vh] overflow-y-auto">

            <h2 className="text-lg font-semibold text-center mb-4">Visualizar y/o editar horarios</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {days.map(day => (
                    <div key={day} className="border rounded p-3">
                        <h3 className="text-md font-medium mb-2">{labels[day]}</h3>

                        {(schedule[day] || []).map((block, idx) => (
                            <div key={idx} className="flex items-center gap-2 mb-2">
                                <input
                                    type="time"
                                    value={block.start || ''}
                                    onChange={(e) => handleChange(day, idx, 'start', e.target.value)}
                                    className="border p-1 rounded w-28"
                                />
                                <span className="text-gray-600">a</span>
                                <input
                                    type="time"
                                    value={block.end || ''}
                                    onChange={(e) => handleChange(day, idx, 'end', e.target.value)}
                                    className="border p-1 rounded w-28"
                                />
                                <button
                                    onClick={() => removeBlock(day, idx)}
                                    className="text-xs text-red-500 hover:underline"
                                >
                                    Eliminar
                                </button>
                            </div>
                        ))}

                        <button
                            onClick={() => addBlock(day)}
                            className="bg-blue-600 text-white px-3 py-1 text-sm rounded"
                        >
                            + Agregar bloque
                        </button>
                    </div>
                ))}
            </div>

            <div className="flex justify-between mt-6">
                <button
                    onClick={onClose}
                    className="bg-gray-600 text-white px-4 py-2 rounded"
                >
                    Cerrar
                </button>
                <button
                    onClick={handleSave}
                    className="bg-green-600 text-white px-4 py-2 rounded"
                >
                    Guardar horario
                </button>
            </div>
        </div>
    );
}

