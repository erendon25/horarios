// StudyScheduleEditor.jsx – FIXED: load study schedule directly by uid
import { useState, useEffect } from 'react';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
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
        const load = async () => {
            if (!uid) return;
            setLoading(true);

            try {
                const ref = doc(db, 'study_schedules', uid);
                const snap = await getDoc(ref);

                if (snap.exists()) {
                    const data = snap.data();
                    setSchedule(data);
                } else {
                    console.warn('No se encontró horario de estudio para UID:', uid);
                    const empty = Object.fromEntries(days.map(d => [d, { free: false, blocks: [] }]));
                    setSchedule(empty);
                }
            } catch (error) {
                console.error('Error al cargar el horario de estudio:', error);
                setSchedule({});
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [uid]);

    const handleChange = (day, index, field, value) => {
        const blocks = [...(schedule[day]?.blocks || [])];
        blocks[index] = { ...blocks[index], [field]: value };
        setSchedule(prev => ({ ...prev, [day]: { ...prev[day], blocks } }));
    };

    const addBlock = (day) => {
        const blocks = [...(schedule[day]?.blocks || [])];
        blocks.push({ start: '', end: '' });
        setSchedule(prev => ({ ...prev, [day]: { ...prev[day], blocks } }));
    };

    const removeBlock = (day, index) => {
        const blocks = [...(schedule[day]?.blocks || [])];
        blocks.splice(index, 1);
        setSchedule(prev => ({ ...prev, [day]: { ...prev[day], blocks } }));
    };

    const toggleFree = (day, checked) => {
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
        if (!uid) return;
        try {
            const payload = Object.fromEntries(
                days.map(day => [day, {
                    free: schedule[day]?.free || false,
                    blocks: schedule[day]?.blocks || []
                }])
            );
            await setDoc(doc(db, 'study_schedules', uid), { uid, ...payload });
            alert('Horario guardado correctamente.');
        } catch (e) {
            console.error('Error al guardar:', e);
        }
    };

    if (!uid) return <p className="text-red-600">UID no especificado.</p>;
    if (loading) return <p>Cargando horario...</p>;

    return (
        <div className="p-4 w-full max-w-4xl mx-auto bg-white rounded shadow-md max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-center mb-4">Visualizar y/o editar horarios</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {days.map(day => (
                    <div key={day} className="border rounded p-3">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-md font-medium">{labels[day]}</h3>
                            <label className="text-sm flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={schedule[day]?.free || false}
                                    onChange={e => toggleFree(day, e.target.checked)}
                                /> Día libre
                            </label>
                        </div>

                        {schedule[day]?.blocks?.map((block, idx) => (
                            <div key={idx} className="flex items-center gap-2 mb-2">
                                <input
                                    type="time"
                                    value={block.start || ''}
                                    onChange={e => handleChange(day, idx, 'start', e.target.value)}
                                    className="border p-1 rounded w-28"
                                />
                                <span className="text-gray-600">a</span>
                                <input
                                    type="time"
                                    value={block.end || ''}
                                    onChange={e => handleChange(day, idx, 'end', e.target.value)}
                                    className="border p-1 rounded w-28"
                                />
                                <button
                                    onClick={() => removeBlock(day, idx)}
                                    className="text-xs text-red-500 hover:underline"
                                >Eliminar</button>
                            </div>
                        ))}

                        <button
                            onClick={() => addBlock(day)}
                            className="bg-blue-600 text-white px-3 py-1 text-sm rounded"
                            disabled={schedule[day]?.free}
                        >+ Agregar bloque</button>
                    </div>
                ))}
            </div>

            <div className="flex justify-between mt-6">
                <button
                    onClick={onClose}
                    className="bg-gray-600 text-white px-4 py-2 rounded"
                >Cerrar</button>
                <button
                    onClick={handleSave}
                    className="bg-green-600 text-white px-4 py-2 rounded"
                >Guardar horario</button>
            </div>
        </div>
    );
}

