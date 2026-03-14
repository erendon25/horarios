import React, { useEffect, useState } from 'react';
import { getFirestore, collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Check, X, Clock, Calendar, MessageSquare, User, Filter, AlertCircle } from 'lucide-react';

const ScheduleRequestsManager = ({ storeId }) => {
    const { currentUser } = useAuth();
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('pending');
    const [staffMap, setStaffMap] = useState({});

    useEffect(() => {
        if (!storeId) return;

        const db = getFirestore();
        const q = query(
            collection(db, 'schedule_requests'),
            where('storeId', '==', storeId)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const reqs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setRequests(reqs.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis()));
            setLoading(false);
        });

        // Fetch staff names to show in the list
        const fetchStaff = async () => {
            const staffSnap = await getDocs(query(collection(db, 'staff_profiles'), where('storeId', '==', storeId)));
            const sMap = {};
            staffSnap.forEach(doc => {
                const data = doc.data();
                sMap[doc.id] = `${data.name} ${data.lastName}`;
            });
            setStaffMap(sMap);
        };
        fetchStaff();

        return () => unsubscribe();
    }, [storeId]);

    const handleAction = async (requestId, status) => {
        const db = getFirestore();
        try {
            await updateDoc(doc(db, 'schedule_requests', requestId), {
                status,
                reviewedBy: currentUser.uid,
                reviewedAt: serverTimestamp()
            });
        } catch (error) {
            console.error(`Error updating request to ${status}:`, error);
            alert('Error al actualizar la solicitud.');
        }
    };

    const filteredRequests = requests.filter(r => r.status === filterStatus);

    const shiftLabels = {
        apertura: 'Apertura',
        medio: 'Medio',
        cierre: 'Cierre',
        rango: 'Rango Especial'
    };

    const formatDate = (dateStr) => {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                <p className="text-gray-500 font-medium">Cargando solicitudes...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Filtros */}
            <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-xl border border-gray-100">
                <button
                    onClick={() => setFilterStatus('pending')}
                    className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all ${filterStatus === 'pending' ? 'bg-orange-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    Pendientes
                </button>
                <button
                    onClick={() => setFilterStatus('approved')}
                    className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all ${filterStatus === 'approved' ? 'bg-green-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    Aprobadas
                </button>
                <button
                    onClick={() => setFilterStatus('denied')}
                    className={`flex-1 py-2 px-4 rounded-lg font-bold text-sm transition-all ${filterStatus === 'denied' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    Rechazadas
                </button>
            </div>

            {filteredRequests.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
                    <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">No hay solicitudes {filterStatus === 'pending' ? 'pendientes' : filterStatus === 'approved' ? 'aprobadas' : 'rechazadas'}.</p>
                </div>
            ) : (
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredRequests.map((req) => (
                        <div key={req.id} className="bg-white border-2 border-gray-100 rounded-2xl p-5 hover:border-blue-100 transition-all shadow-sm">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                                        <User className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-gray-800">{staffMap[req.staffId] || 'Cargando...'}</p>
                                        <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Solicitud de Horario</p>
                                    </div>
                                </div>
                                <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${req.status === 'pending' ? 'bg-orange-100 text-orange-600' : req.status === 'approved' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                    {req.status === 'pending' ? 'Pendiente' : req.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Calendar className="w-3.5 h-3.5 text-blue-500" />
                                        <span className="text-[10px] font-bold text-gray-400 uppercase">Fecha</span>
                                    </div>
                                    <p className="text-sm font-bold text-gray-700">{formatDate(req.date)}</p>
                                </div>
                                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Clock className="w-3.5 h-3.5 text-blue-500" />
                                        <span className="text-[10px] font-bold text-gray-400 uppercase">Turno</span>
                                    </div>
                                    <p className="text-sm font-bold text-gray-700">
                                        {shiftLabels[req.shiftType]}
                                        {req.shiftType === 'rango' && ` (${req.startTime} - ${req.endTime})`}
                                    </p>
                                </div>
                            </div>

                            <div className="bg-blue-50/50 p-4 rounded-xl mb-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                                    <span className="text-[10px] font-bold text-gray-400 uppercase">Motivo</span>
                                </div>
                                <p className="text-xs text-gray-700 italic leading-relaxed">
                                    "{req.reason}"
                                </p>
                            </div>

                            {req.status === 'pending' && (
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleAction(req.id, 'denied')}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white border-2 border-red-100 text-red-600 rounded-xl text-sm font-bold hover:bg-red-50 transition-all"
                                    >
                                        <X className="w-4 h-4" />
                                        Rechazar
                                    </button>
                                    <button
                                        onClick={() => handleAction(req.id, 'approved')}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 shadow-md transition-all transform hover:scale-[1.02]"
                                    >
                                        <Check className="w-4 h-4" />
                                        Aprobar
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ScheduleRequestsManager;
