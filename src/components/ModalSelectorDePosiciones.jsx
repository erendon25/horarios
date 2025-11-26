// ModalSelectorDePosiciones.jsx
import React, { useEffect, useState } from 'react';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

export default function ModalSelectorDePosiciones({ docId, storeId, onClose }) {
    const db = getFirestore();
    const [allPositions, setAllPositions] = useState([]);
    const [selected, setSelected] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!docId) return;

        const loadPositions = async () => {
            const positionSet = new Set();

            // 1. Subcolección de la tienda actual (nuevo formato)
            if (storeId) {
                try {
                    const colRef = collection(db, 'stores', storeId, 'positioning_requirements');
                    const snap = await getDocs(colRef);
                    snap.docs.forEach(d => {
                        d.data().positions?.forEach(p => positionSet.add(p));
                    });
                } catch (e) { console.error(e); }
            }

            // 2. Fallback a colección raíz si no encontró nada
            if (positionSet.size === 0) {
                const rootSnap = await getDocs(collection(db, 'positioning_requirements'));
                rootSnap.docs.forEach(d => {
                    d.data().positions?.forEach(p => positionSet.add(p));
                });
            }

            setAllPositions(Array.from(positionSet).sort());
        };

        const loadCurrentSkills = async () => {
            const ref = doc(db, 'staff_profiles', docId);
            const snap = await getDoc(ref);
            if (snap.exists()) {
                setSelected(snap.data().skills || []);
            }
        };

        Promise.all([loadPositions(), loadCurrentSkills()])
            .then(() => setLoading(false));
    }, [docId, storeId]);

    const toggle = (pos) => {
        setSelected(prev => 
            prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
        );
    };

    const save = async () => {
        try {
            await setDoc(doc(db, 'staff_profiles', docId), { skills: selected }, { merge: true });
            alert('Habilidades guardadas');
            onClose();
        } catch (e) {
            console.error(e);
            alert('Error al guardar');
        }
    };

    if (loading) return <div className="p-8">Cargando posiciones...</div>;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
                <h2 className="text-2xl font-bold mb-6 text-center">
                    Posiciones que puede cubrir
                </h2>
                <div className="grid grid-cols-2 gap-3 mb-6">
                    {allPositions.map(pos => (
                        <label key={pos} className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selected.includes(pos)}
                                onChange={() => toggle(pos)}
                                className="w-5 h-5"
                            />
                            <span className="select-none">{pos}</span>
                        </label>
                    ))}
                </div>
                <div className="flex justify-end gap-4">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={save}
                        className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    );
}