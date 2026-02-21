// ModalSelectorDePosiciones.jsx
import React, { useEffect, useState } from 'react';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { X, CheckCircle, Award, ShieldCheck, ShieldAlert } from 'lucide-react';

export default function ModalSelectorDePosiciones({ docId, storeId, onClose }) {
    const db = getFirestore();
    const [allPositions, setAllPositions] = useState([]);
    const [selected, setSelected] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!docId) return;

        const loadPositions = async () => {
            const positionSet = new Set();

            if (storeId) {
                try {
                    const colRef = collection(db, 'stores', storeId, 'positioning_requirements');
                    const snap = await getDocs(colRef);
                    snap.docs.forEach(d => {
                        d.data().positions?.forEach(p => positionSet.add(p));
                    });
                } catch (e) { console.error(e); }
            }

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
            onClose();
        } catch (e) {
            console.error(e);
            alert('Error al guardar');
        }
    };

    if (loading) return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
            <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-gray-600 font-medium font-sans">Cargando habilidades...</p>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] px-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-fadeIn"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-700 to-indigo-800 px-6 py-5 flex justify-between items-center text-white">
                    <div className="flex items-center gap-3">
                        <Award className="w-6 h-6 text-blue-200" />
                        <h2 className="text-xl font-bold font-sans">Dominio de Posiciones</h2>
                    </div>
                    <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-lg transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-sm text-gray-500 mb-6 font-sans">
                        Selecciona las posiciones que este colaborador ya domina totalmente. Desmarca las que necesites remover.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                        {allPositions.map(pos => {
                            const isSelected = selected.includes(pos);
                            return (
                                <button
                                    key={pos}
                                    onClick={() => toggle(pos)}
                                    className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all duration-200 group font-sans ${isSelected
                                            ? 'bg-green-50 border-green-500 shadow-sm'
                                            : 'bg-white border-gray-100 hover:border-gray-300'
                                        }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1 rounded-md ${isSelected ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400 group-hover:bg-gray-200'}`}>
                                            {isSelected ? <ShieldCheck className="w-4 h-4" /> : <Award className="w-4 h-4" />}
                                        </div>
                                        <span className={`text-sm font-bold ${isSelected ? 'text-green-800' : 'text-gray-600'}`}>
                                            {pos}
                                        </span>
                                    </div>
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected
                                            ? 'bg-green-500 border-green-500'
                                            : 'border-gray-200 group-hover:border-gray-400'
                                        }`}>
                                        {isSelected && <CheckCircle className="w-4 h-4 text-white" />}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex flex-col sm:flex-row justify-end gap-3 mt-4">
                        <button
                            onClick={onClose}
                            className="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all font-sans order-2 sm:order-1"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={save}
                            className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98] transition-all font-sans order-1 sm:order-2 flex items-center justify-center gap-2"
                        >
                            <ShieldCheck className="w-5 h-5" />
                            Guardar Cambios
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}