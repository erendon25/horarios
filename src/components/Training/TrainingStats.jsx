import React, { useState, useEffect } from 'react';
import {
    BarChart3,
    ArrowLeft,
    Trophy,
    CheckCircle2,
    Users,
    TrendingUp,
    Download
} from 'lucide-react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell
} from 'recharts';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { SERVICE_STATIONS, PRODUCTION_STATIONS } from '../../constants/trainingPoints';

const TrainingStats = ({ onBack, activeArea }) => {
    const { userData } = useAuth();
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [topCollabs, setTopCollabs] = useState([]);

    useEffect(() => {
        const fetchStats = async () => {
            if (!userData?.storeId) return;
            setLoading(true);
            try {
                const q = query(
                    collection(db, 'staff_profiles'),
                    where('storeId', '==', userData.storeId)
                );
                const querySnapshot = await getDocs(q);
                const staff = querySnapshot.docs.map(doc => doc.data());

                const areaStations = activeArea === 'service' ? SERVICE_STATIONS : PRODUCTION_STATIONS;
                const stationCounts = {};

                // Initialize counts
                Object.keys(areaStations).forEach(key => {
                    stationCounts[key] = {
                        name: areaStations[key].title,
                        count: 0,
                        color: activeArea === 'service' ? '#f97316' : '#6366f1'
                    };
                });

                // Count skills
                staff.forEach(member => {
                    const memberSkills = member.skills || [];
                    // Ensure unique uppercase skills for counting
                    const normalized = [...new Set(memberSkills.map(s => s.toUpperCase()))];
                    normalized.forEach(skill => {
                        if (stationCounts[skill]) {
                            stationCounts[skill].count += 1;
                        }
                    });
                });

                setStats(Object.values(stationCounts));

                // Top certified collabs
                const sortedCollabs = [...staff]
                    .map(s => {
                        const memberSkills = s.skills || [];
                        const normalized = [...new Set(memberSkills.map(sk => sk.toUpperCase()))];
                        return {
                            name: `${s.name} ${s.lastName || ''}`.trim(),
                            certifiedCount: normalized.filter(skill => areaStations[skill]).length
                        };
                    })
                    .filter(s => s.certifiedCount > 0)
                    .sort((a, b) => b.certifiedCount - a.certifiedCount)
                    .slice(0, 5);

                setTopCollabs(sortedCollabs);

            } catch (error) {
                console.error("Error fetching stats:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [userData, activeArea]);

    return (
        <div className="flex flex-col h-full bg-slate-50 overflow-y-auto pb-20">
            {/* Header */}
            <div className="bg-white p-8 rounded-b-[50px] shadow-sm border-b border-gray-100 flex items-center gap-6">
                <button
                    onClick={onBack}
                    className="p-4 bg-orange-50 text-orange-600 rounded-2xl hover:bg-orange-100 transition-all active:scale-95"
                >
                    <ArrowLeft size={24} strokeWidth={3} />
                </button>
                <div>
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase">
                        Reporte de Entrenamiento
                    </h1>
                    <p className="text-[11px] text-gray-400 font-black uppercase tracking-[0.2em]">
                        {activeArea === 'service' ? 'Certificaciones de Servicio' : 'Certificaciones de Producción'}
                    </p>
                </div>
            </div>

            <div className="p-8 space-y-8 max-w-5xl mx-auto w-full">
                {/* Main Chart */}
                <div className="bg-white p-10 rounded-[48px] shadow-2xl shadow-gray-200/50 border border-white">
                    <div className="flex justify-between items-center mb-10">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-500">
                                <BarChart3 size={24} strokeWidth={3} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 tracking-tight">Certificaciones por Estación</h3>
                        </div>
                    </div>

                    <div className="h-[400px] w-full">
                        {loading ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }}
                                        interval={0}
                                        angle={-45}
                                        textAnchor="end"
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 800 }}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#f8fafc' }}
                                        contentStyle={{
                                            borderRadius: '20px',
                                            border: 'none',
                                            boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                                            padding: '15px'
                                        }}
                                    />
                                    <Bar
                                        dataKey="count"
                                        name="Certificados"
                                        radius={[10, 10, 0, 0]}
                                        barSize={40}
                                    >
                                        {stats.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Top Certified */}
                    <div className="bg-white p-8 rounded-[40px] shadow-xl shadow-gray-200/40 border border-gray-50">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500">
                                <Trophy size={20} strokeWidth={3} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 tracking-tight">Top Perfeccionamiento</h3>
                        </div>

                        <div className="space-y-4">
                            {topCollabs.map((collab, i) => (
                                <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all border border-slate-100/50">
                                    <div className="flex items-center gap-4">
                                        <span className="text-xs font-black text-gray-300 w-4">#{i + 1}</span>
                                        <span className="text-sm font-bold text-slate-700">{collab.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-full shadow-sm border border-emerald-100">
                                        <span className="text-xs font-black text-emerald-600">{collab.certifiedCount}</span>
                                        <CheckCircle2 size={12} className="text-emerald-500" />
                                    </div>
                                </div>
                            ))}
                            {topCollabs.length === 0 && (
                                <p className="text-center text-gray-400 py-10 font-medium italic">Sin datos registrados</p>
                            )}
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="space-y-6">
                        <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-8 rounded-[40px] text-white shadow-2xl shadow-orange-500/30 flex justify-between items-center overflow-hidden relative group">
                            <div className="absolute -right-4 -bottom-4 text-white p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                                <Users size={120} />
                            </div>
                            <div className="relative z-10">
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-1">Total Certificados</p>
                                <h4 className="text-4xl font-black">{stats.reduce((acc, curr) => acc + curr.count, 0)}</h4>
                            </div>
                            <div className="relative z-10 w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                                <TrendingUp size={24} strokeWidth={3} />
                            </div>
                        </div>

                        <div className="bg-white p-8 rounded-[40px] shadow-xl shadow-gray-200/40 border border-gray-100 flex items-center justify-between hover:border-orange-200 transition-all cursor-pointer">
                            <div className="flex items-center gap-6">
                                <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400">
                                    <Download size={24} />
                                </div>
                                <div>
                                    <h4 className="text-base font-black text-slate-800 tracking-tight uppercase">Exportar Reporte</h4>
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Descargar datos en Excel</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TrainingStats;
