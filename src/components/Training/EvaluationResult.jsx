import React from 'react';
import {
    Trophy,
    AlertTriangle,
    CheckCircle2,
    ClipboardCheck,
    MessageSquare,
    Home,
    Share2,
    ChevronRight
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import {
    SERVICE_GENERAL_POINTS,
    SERVICE_STATIONS,
    KNOWLEDGE_POINTS,
    PRODUCTION_GENERAL_POINTS,
    PRODUCTION_STATIONS
} from '../../constants/trainingPoints';

const EvaluationResult = ({ data, onBackToDashboard, onEdit, canEdit }) => {
    // Helper to find point text by ID
    const getPointText = (id) => {
        const area = data.area || 'service';
        const isService = area === 'service';
        const general = isService ? SERVICE_GENERAL_POINTS : PRODUCTION_GENERAL_POINTS;
        const stations = isService ? SERVICE_STATIONS : PRODUCTION_STATIONS;

        // Search in general points
        for (const section of general) {
            const point = section.points.find(p => p.id === Number(id) || p.id === id);
            if (point) return point.text;
        }

        // Search in station points
        const stationKey = data.station;
        if (stationKey && stations[stationKey]) {
            const point = stations[stationKey].points.find(p => p.id === Number(id) || p.id === id);
            if (point) return point.text;
        }

        // Search in knowledge points
        if (isService) {
            const point = KNOWLEDGE_POINTS.find(p => p.id === Number(id) || p.id === id);
            if (point) return point.text;
        }

        return `Punto #${id}`;
    };

    // Score calculation
    const totalPoints = Object.keys(data.responses || {}).length;
    const passedPoints = Object.values(data.responses || {}).filter(v => v === true).length;
    const score = totalPoints > 0 ? Math.round((passedPoints / totalPoints) * 100) : 0;

    const isCertified = score >= 90;

    const chartData = [
        { name: 'Cumple', value: passedPoints },
        { name: 'No Cumple', value: totalPoints - passedPoints },
    ];
    const COLORS = ['#10b981', '#f43f5e'];

    const gaps = Object.entries(data.responses || {})
        .filter(([_, value]) => value === false)
        .map(([id]) => {
            return { id, text: getPointText(id) };
        });

    return (
        <div className="flex flex-col min-h-screen bg-slate-50 overflow-y-auto">
            {/* Result Header */}
            <div className={`p-12 pt-20 rounded-b-[60px] text-center shadow-2xl relative overflow-hidden ${isCertified ? 'bg-emerald-500' : 'bg-orange-500'}`}>
                {/* Visual decoration */}
                <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none select-none overflow-hidden">
                    <div className="absolute -top-10 -left-10 w-64 h-64 bg-white rounded-full blur-3xl"></div>
                    <div className="absolute -bottom-10 -right-10 w-96 h-96 bg-white rounded-full blur-3xl"></div>
                </div>

                <div className="relative z-10 animate-in zoom-in duration-1000">
                    <div className="mb-6">
                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60 mb-2">Evaluación de Estación</p>
                        <h2 className="text-2xl font-black text-white uppercase tracking-tight">{data.collaboratorName}</h2>
                        <p className="text-xs font-bold text-white/80 mt-1">{data.stationName}</p>
                    </div>
                    <div className="w-24 h-24 bg-white rounded-[32px] flex items-center justify-center mx-auto mb-8 shadow-2xl text-slate-900 border-4 border-white/20">
                        {isCertified ? <Trophy size={48} className="text-emerald-500" strokeWidth={2.5} /> : <AlertTriangle className="text-orange-500" size={48} strokeWidth={2.5} />}
                    </div>
                    <h1 className="text-7xl font-black text-white mb-4 tracking-tighter leading-none">{score}%</h1>
                    <div className="inline-flex items-center gap-3 px-8 py-3 bg-white/10 backdrop-blur-xl rounded-full border border-white/20 text-white">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse shadow-[0_0_8px_white]"></div>
                        <span className="text-[10px] font-black uppercase tracking-[0.3em]">
                            {isCertified ? 'Miembro Certificado' : 'Entrenamiento Pendiente'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="px-6 -mt-12 space-y-8 pb-32 max-w-4xl mx-auto w-full relative z-20">
                {/* Detailed Stats */}
                <div className="bg-white p-10 rounded-[48px] shadow-2xl shadow-gray-200/50 flex flex-col md:flex-row items-center gap-10 border border-white transition-transform hover:scale-[1.01] duration-500">
                    <div className="w-40 h-40 shrink-0 relative">
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-2xl font-black text-slate-800 leading-none">{passedPoints}</span>
                            <span className="text-[8px] font-black text-gray-300 uppercase tracking-widest mt-1">/ {totalPoints}</span>
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    innerRadius={65}
                                    outerRadius={80}
                                    paddingAngle={8}
                                    dataKey="value"
                                    stroke="none"
                                    cornerRadius={12}
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} className="hover:opacity-80 transition-opacity cursor-pointer focus:outline-none" />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-6 w-full">
                        <div className="flex justify-between items-end">
                            <div>
                                <h4 className="text-[9px] font-black text-gray-400 uppercase tracking-[0.3em] mb-1">Puntos Aprobados</h4>
                                <p className="text-2xl font-black text-emerald-500 tracking-tight leading-none">{passedPoints} de {totalPoints}</p>
                            </div>
                            <span className="text-[10px] font-black p-2 bg-emerald-50 text-emerald-600 rounded-lg">{(passedPoints / Math.max(1, totalPoints) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-3 bg-slate-50 rounded-full overflow-hidden shadow-inner border border-gray-100">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(16,185,129,0.3)]" style={{ width: `${(passedPoints / Math.max(1, totalPoints)) * 100}%` }}></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100/50">
                                <p className="text-[8px] font-black text-rose-400 uppercase tracking-widest mb-1">Brechas</p>
                                <p className="text-base font-black text-rose-600">{totalPoints - passedPoints}</p>
                            </div>
                            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100/50">
                                <p className="text-[8px] font-black text-amber-400 uppercase tracking-widest mb-1">Feedback</p>
                                <p className="text-base font-black text-amber-600">{Object.keys(data.feedback || {}).length}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Knowledge Gaps */}
                <div className="animate-in slide-in-from-bottom delay-500 duration-1000">
                    <div className="flex items-center gap-4 mb-6 ml-4">
                        <div className="w-10 h-1 bg-orange-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.5)]"></div>
                        <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.3em]">Diagnóstico Detallado</h3>
                    </div>
                    <div className="grid gap-6">
                        {gaps.length > 0 ? gaps.map((gap, i) => (
                            <div key={i} className="bg-white p-6 rounded-[32px] border-l-[12px] border-rose-500 shadow-xl shadow-gray-200/40 flex gap-6 transition-all hover:translate-x-2 group">
                                <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center shrink-0 text-rose-500 group-hover:scale-110 transition-all">
                                    <AlertTriangle size={28} strokeWidth={2.5} />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm text-slate-800 font-bold leading-tight mb-2 uppercase tracking-tight">
                                        Punto #{gap.id}
                                    </p>
                                    <p className="text-base text-slate-900 font-black leading-snug mb-3">
                                        {gap.text}
                                    </p>
                                    {data.feedback && data.feedback[gap.id] && (
                                        <div className="p-4 bg-slate-50 rounded-2xl border border-gray-100 relative overflow-hidden">
                                            <div className="absolute top-0 left-0 w-1 h-full bg-orange-200"></div>
                                            <p className="text-xs italic text-slate-500 leading-relaxed font-bold">
                                                "{data.feedback[gap.id]}"
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )) : (
                            <div className="bg-emerald-50 p-12 rounded-[60px] border border-emerald-100 text-center shadow-inner">
                                <div className="w-20 h-20 bg-emerald-500 rounded-[32px] flex items-center justify-center mx-auto mb-6 text-white shadow-2xl shadow-emerald-500/30">
                                    <CheckCircle2 size={40} strokeWidth={3} />
                                </div>
                                <h4 className="text-xl font-black text-emerald-800 uppercase tracking-widest">Excelencia Operativa</h4>
                                <p className="text-xs font-bold text-emerald-600/60 mt-2 max-w-xs mx-auto">El colaborador ha demostrado dominio total de los estándares de la estación.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* General Observation */}
                {data.generalFindings && (
                    <div className="bg-white p-10 rounded-[48px] border border-gray-50 shadow-2xl shadow-gray-100/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:scale-110 transition-transform">
                            <MessageSquare size={120} />
                        </div>
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center text-orange-500">
                                <MessageSquare size={16} strokeWidth={3} />
                            </div>
                            Feedforward del Proceso
                        </h3>
                        <p className="text-slate-800 text-base leading-relaxed font-bold italic relative z-10">
                            "{data.generalFindings}"
                        </p>
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            <div className="mt-auto px-8 py-10 bg-white border-t border-gray-100 flex flex-col md:flex-row gap-4 max-w-4xl mx-auto w-full items-center justify-center">
                <button
                    onClick={onBackToDashboard}
                    className="w-full md:w-auto px-10 py-5 bg-white border-2 border-slate-100 text-slate-400 rounded-[28px] font-black uppercase tracking-[0.2em] text-[10px] flex items-center justify-center gap-3 transition-all hover:bg-slate-50 hover:border-slate-200 active:scale-95"
                >
                    <Home size={20} strokeWidth={2.5} />
                    Finalizar Sesión
                </button>
                {canEdit && (
                    <button
                        onClick={onEdit}
                        className="w-full md:w-auto px-10 py-5 bg-emerald-50 text-emerald-600 border-2 border-emerald-100 rounded-[28px] font-black uppercase tracking-[0.2em] text-[10px] flex items-center justify-center gap-3 transition-all hover:bg-emerald-100 active:scale-95"
                    >
                        <ClipboardCheck size={20} strokeWidth={2.5} />
                        Revisar o Editar
                    </button>
                )}
                <button className="w-full md:w-auto px-12 py-5 bg-slate-900 text-white rounded-[28px] font-black uppercase tracking-[0.2em] text-[10px] flex items-center justify-center gap-4 transition-all hover:bg-black shadow-2xl shadow-slate-900/40 active:scale-95 border-b-4 border-slate-700">
                    <Share2 size={20} strokeWidth={2.5} />
                    Reporte Regional PDF
                </button>
            </div>
        </div>
    );
};

export default EvaluationResult;
