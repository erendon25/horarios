import React, { useState, useEffect } from 'react';
import {
    Users,
    ClipboardCheck,
    Search,
    Plus,
    TrendingUp,
    CheckCircle2,
    Clock,
    ChevronRight,
    Loader2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { SERVICE_STATIONS, PRODUCTION_STATIONS } from '../../constants/trainingPoints';

const TrainingDashboard = ({ onStartEvaluation, activeArea, onAreaChange, onSelectCollaborator, onShowStats }) => {
    const { userData } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState('all');
    const [collaborators, setCollaborators] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStaff = async () => {
            if (!userData?.storeId) return;
            setLoading(true);
            try {
                const q = query(
                    collection(db, 'staff_profiles'),
                    where('storeId', '==', userData.storeId)
                );
                const querySnapshot = await getDocs(q);
                const staffData = querySnapshot.docs.map(doc => {
                    const data = doc.data();
                    // Normalize skills to unique uppercase keys
                    const rawSkills = data.skills || [];
                    const normalizedSkills = [...new Set(rawSkills.map(s => s.toUpperCase()))];

                    const areaStations = activeArea === 'service' ? SERVICE_STATIONS : PRODUCTION_STATIONS;
                    const totalStations = Object.keys(areaStations).length;

                    // Count how many valid stations in the current area they are certified in
                    const areaSkills = normalizedSkills.filter(s => areaStations[s]);
                    const areaSkillsCount = areaSkills.length;

                    const progress = totalStations > 0 ? Math.min(100, Math.round((areaSkillsCount / totalStations) * 100)) : 0;

                    return {
                        id: doc.id,
                        name: `${data.name} ${data.lastName || ''}`.trim(),
                        position: data.position || 'Colaborador',
                        progress,
                        lastEvaluation: data.lastEvaluationDate || 'Nunca',
                        skills: normalizedSkills, // Use normalized for consistency
                        area: activeArea
                    };
                });
                setCollaborators(staffData);
            } catch (error) {
                console.error("Error fetching staff:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStaff();
    }, [userData, activeArea]);

    const filteredCollaborators = collaborators.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.position.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        if (filter === 'certified') return c.progress >= 90;
        if (filter === 'training') return c.progress > 0 && c.progress < 90;
        if (filter === 'pending') return c.progress === 0;
        return true;
    });

    return (
        <div className="flex flex-col h-full bg-slate-50/50 pb-20">
            {/* Header */}
            <div className="bg-white p-6 rounded-b-[40px] shadow-sm border-b border-gray-100">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h1 className="text-3xl font-black text-gray-900 mb-1 tracking-tight uppercase">
                            {activeArea === 'service' ? 'Servicio' : 'Producción'}
                        </h1>
                        <p className="text-[11px] text-gray-400 font-black uppercase tracking-[0.2em]">
                            {activeArea === 'service' ? 'Certificación de servicio al cliente' : 'Certificación de procesos de cocina'}
                        </p>
                    </div>
                </div>

                <div className="bg-gray-100 p-1.5 rounded-2xl flex mb-8 shadow-inner">
                    <button
                        onClick={() => onAreaChange('service')}
                        className={`flex-1 py-3 rounded-xl text-xs font-black transition-all ${activeArea === 'service' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-400'}`}
                    >
                        SERVICIO
                    </button>
                    <button
                        onClick={() => onAreaChange('production')}
                        className={`flex-1 py-3 rounded-xl text-xs font-black transition-all ${activeArea === 'production' ? 'bg-white text-orange-600 shadow-md' : 'text-gray-400'}`}
                    >
                        PRODUCCIÓN
                    </button>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={() => onStartEvaluation()}
                        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-4.5 px-6 rounded-[24px] font-black uppercase tracking-[0.15em] text-[10px] flex items-center justify-center gap-3 transition-all shadow-2xl shadow-orange-500/40 active:scale-95 border-b-4 border-orange-700"
                    >
                        <Plus size={18} strokeWidth={4} />
                        Nueva Evaluación
                    </button>
                    <button
                        onClick={() => onShowStats?.()}
                        className="p-4 bg-white text-orange-500 rounded-2xl border border-orange-100 shadow-sm transition-all hover:bg-orange-50 hover:scale-105 active:scale-95"
                        title="Ver Reportes y Tendencias"
                    >
                        <TrendingUp size={22} strokeWidth={3} />
                    </button>
                </div>
            </div>

            {/* Search and Stats */}
            <div className="px-6 mt-8 flex-1 flex flex-col min-h-0">
                <div className="relative mb-8">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                    <input
                        type="text"
                        placeholder="BUSCAR COLABORADOR..."
                        className="w-full pl-14 pr-6 py-5 bg-white border border-gray-100 rounded-[32px] focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all shadow-xl shadow-gray-200/50 font-bold text-sm tracking-tight"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex gap-2 mb-8 overflow-x-auto pb-4 scrollbar-hide">
                    {['all', 'pending', 'training', 'certified'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setFilter(tab)}
                            className={`px-8 py-3 rounded-full whitespace-nowrap text-[10px] font-black uppercase tracking-[0.2em] transition-all border ${filter === tab
                                ? 'bg-slate-900 border-slate-900 text-white shadow-2xl shadow-slate-900/30'
                                : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50 shadow-sm'
                                }`}
                        >
                            {tab === 'all' ? 'Ver Todos' : tab === 'pending' ? 'Sin Iniciar' : tab === 'training' ? 'En Entrenamiento' : 'Certificados'}
                        </button>
                    ))}
                </div>

                {/* Collaborators List */}
                <div className="flex-1 overflow-y-auto pb-32 pr-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-24">
                            <div className="relative">
                                <Loader2 className="w-16 h-16 text-orange-500 animate-spin" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                                </div>
                            </div>
                            <p className="text-gray-400 font-bold uppercase tracking-[0.3em] text-[10px] mt-6">Cargando Sistema</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {filteredCollaborators.map((collab, idx) => (
                                <div
                                    key={collab.id}
                                    onClick={() => onSelectCollaborator?.(collab)}
                                    style={{ animationDelay: `${idx * 50}ms` }}
                                    className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-2xl shadow-gray-200/60 hover:shadow-orange-500/20 hover:border-orange-100 transition-all duration-500 cursor-pointer group flex flex-col justify-between h-full relative overflow-hidden animate-in fade-in slide-in-from-bottom"
                                >
                                    <div className="flex items-center gap-6 mb-8">
                                        <div className="relative shrink-0">
                                            <div className="w-20 h-20 bg-gradient-to-br from-orange-50 to-white rounded-[24px] flex items-center justify-center text-orange-600 font-black text-3xl border border-orange-100 shadow-inner group-hover:scale-110 transition-transform duration-500">
                                                {collab.name.charAt(0)}
                                            </div>
                                            {collab.progress >= 90 ? (
                                                <div className="absolute -top-2 -right-2 w-8 h-8 bg-green-500 rounded-full border-4 border-white flex items-center justify-center shadow-lg">
                                                    <CheckCircle2 size={14} className="text-white" />
                                                </div>
                                            ) : collab.progress > 0 ? (
                                                <div className="absolute -top-2 -right-2 w-8 h-8 bg-orange-400 rounded-full border-4 border-white flex items-center justify-center shadow-lg">
                                                    <Clock size={14} className="text-white" />
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-black text-slate-900 truncate text-2xl tracking-tighter mb-1">{collab.name}</h3>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                <div className="inline-flex px-3 py-1 bg-slate-50 rounded-lg border border-slate-100">
                                                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none">{collab.position}</p>
                                                </div>
                                                {collab.skills?.map(skill => {
                                                    const station = SERVICE_STATIONS[skill] || PRODUCTION_STATIONS[skill];
                                                    if (!station) return null;
                                                    return (
                                                        <div key={skill} className="inline-flex px-2 py-0.5 bg-emerald-50 rounded-md border border-emerald-100">
                                                            <p className="text-[7px] text-emerald-600 font-black uppercase tracking-widest leading-none">{station.title}</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4 mb-8">
                                        <div className="flex justify-between items-end">
                                            <div>
                                                <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.25em] block mb-1">Status</span>
                                                <span className={`text-[10px] font-black uppercase tracking-widest ${collab.progress >= 90 ? 'text-green-500' : collab.progress > 0 ? 'text-orange-500' : 'text-slate-400'}`}>
                                                    {collab.progress >= 90 ? 'Certificado' : collab.progress > 0 ? 'En Entrenamiento' : 'Por Evaluar'}
                                                </span>
                                            </div>
                                            <span className="text-2xl font-black text-slate-900 tracking-tighter leading-none">{collab.progress}%</span>
                                        </div>
                                        <div className="w-full h-3 bg-gray-50 rounded-full overflow-hidden border border-gray-100 shadow-inner">
                                            <div
                                                className={`h-full rounded-full transition-all duration-[1.5s] ease-out shadow-sm ${collab.progress >= 90 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : collab.progress > 0 ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]' : 'bg-slate-200'}`}
                                                style={{ width: `${collab.progress}%` }}
                                            ></div>
                                        </div>
                                    </div>

                                    <div className="pt-6 border-t border-gray-50 flex justify-between items-center bg-gradient-to-b from-transparent to-gray-50/30 -mx-8 px-8 -mb-8 mt-2 pb-8">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-1">Última Sesión</span>
                                            <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
                                                <Clock size={12} className="text-orange-400" />
                                                {collab.lastEvaluation}
                                            </span>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                console.log('Chevron clicked for:', collab.name);
                                                onSelectCollaborator?.(collab);
                                            }}
                                            className="w-14 h-14 bg-orange-500 rounded-2xl flex items-center justify-center text-white hover:bg-orange-600 transition-all duration-300 shadow-lg shadow-orange-500/30 active:scale-95 z-20 group/btn"
                                            title="Revisar Evaluación"
                                        >
                                            <ChevronRight size={28} strokeWidth={3} className="transition-transform group-hover/btn:translate-x-0.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {!loading && filteredCollaborators.length === 0 && (
                        <div className="text-center py-24 bg-white rounded-[48px] border-2 border-dashed border-gray-50 shadow-inner">
                            <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Users size={40} className="text-gray-200" />
                            </div>
                            <p className="text-slate-900 font-black text-xl uppercase tracking-tighter italic">Vacio por aquí</p>
                            <p className="text-gray-400 text-sm mt-2 font-medium">No hay colaboradores que coincidan con tu búsqueda</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TrainingDashboard;
