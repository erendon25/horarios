import React, { useMemo } from 'react';
import { Award, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { isStaffActive } from './Training/staffStatus';

export default function TrainingProgressReport({ staff, storeRequirements }) {
    const activeStaff = useMemo(() => staff.filter(person => isStaffActive(person)), [staff]);
    const skillStats = useMemo(() => {
        const counts = new Map();
        activeStaff.forEach(person => {
            new Set(person.skills || []).forEach(skill => {
                if (skill) counts.set(skill, (counts.get(skill) || 0) + 1);
            });
        });
        return Array.from(counts, ([name, count]) => ({
            name, count, percentage: Math.round((count / (activeStaff.length || 1)) * 100),
        })).sort((left, right) => right.percentage - left.percentage);
    }, [activeStaff]);

    return (
        <details className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-5 py-4 text-lg font-black text-slate-900">
                <span className="inline-flex items-center gap-2 align-middle">
                    <Award className="h-5 w-5 text-orange-600" />
                    Avances de entrenamiento
                </span>
                <span className="mt-1 block text-sm font-normal text-slate-500">Consulta el dominio por posición y el progreso de cada colaborador.</span>
            </summary>
            <div className="border-t border-orange-100 bg-slate-50 p-5">
                {/* Gráfico Analítico de Habilidades */}
                <div className="bg-white rounded-xl shadow-sm p-6 mb-10 border border-gray-200">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-indigo-100 rounded-lg">
                            <BarChart3 className="w-6 h-6 text-indigo-600" />
                        </div>
                        <div>
                            <h4 className="text-lg font-bold text-gray-800 uppercase tracking-tight">Análisis de Capacitación Global</h4>
                            <p className="text-xs text-gray-500 uppercase font-semibold">Tasa de dominio por posición (%)</p>
                        </div>
                    </div>

                    {skillStats.length > 0 ? (
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={skillStats}
                                    layout="vertical"
                                    margin={{ top: 0, right: 55, left: 0, bottom: 0 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                    <XAxis type="number" domain={[0, 100]} hide />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        axisLine={false}
                                        tickLine={false}
                                        width={140}
                                        interval={0}
                                        style={{
                                            fontSize: '10px',
                                            fontWeight: '700',
                                            fill: '#334155',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.025em'
                                        }}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#f1f5f9', radius: 4 }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const data = payload[0].payload;
                                                return (
                                                    <div className="bg-white border-none shadow-xl rounded-xl p-3 text-xs flex flex-col gap-1 border border-gray-100">
                                                        <p className="font-bold text-gray-800 uppercase mb-1 border-b pb-1">{data.name}</p>
                                                        <div className="flex justify-between items-center gap-4">
                                                            <span className="text-gray-500 font-medium">Cobertura:</span>
                                                            <span className="text-indigo-600 font-bold">{data.percentage}%</span>
                                                        </div>
                                                        <div className="flex justify-between items-center gap-4">
                                                            <span className="text-gray-500 font-medium">Personal capaz:</span>
                                                            <span className="text-gray-800 font-bold">{data.count} pers.</span>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Bar
                                        dataKey="percentage"
                                        radius={[0, 6, 6, 0]}
                                        barSize={24}
                                        label={{
                                            position: 'right',
                                            formatter: (val) => `${val}%`,
                                            style: { fontSize: '11px', fontWeight: '800', fill: '#1e293b', marginLeft: '10px' }
                                        }}
                                    >
                                        {skillStats.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={['#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#dc2626', '#059669', '#0891b2'][index % 7]}
                                                fillOpacity={0.9}
                                                className="hover:fill-opacity-100 transition-all duration-300"
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-[150px] flex items-center justify-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                            <p className="text-sm font-medium">No hay datos suficientes para el análisis</p>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeStaff.map(s => {
                        // Filtramos para contar solo las habilidades que existen en los requerimientos actuales de la tienda
                        const mastered = new Set(s.skills?.filter(skill => storeRequirements.includes(skill)) || []).size;
                        const total = storeRequirements.length || 1;
                        const percent = Math.round((mastered / total) * 100);

                        return (
                            <div key={s.id} className="border border-gray-100 rounded-xl p-4 bg-gray-50 flex flex-col gap-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-bold text-gray-800">{s.name} {s.lastName}</p>
                                        <p className="text-[10px] text-gray-500 uppercase tracking-widest">{s.position || 'Colaborador'}</p>
                                    </div>
                                    {s.isTrainee && (
                                        <span className="text-[9px] font-bold bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">TRAINEE</span>
                                    )}
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold text-gray-600 uppercase">
                                        <span>Progreso</span>
                                        <span>{percent}%</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden shadow-inner">
                                        <div
                                            className={`h-full transition-all duration-1000 ${percent === 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                                            style={{ width: `${percent}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-1 mt-auto">
                                    {Array.from(new Set(s.skills || [])).map(skill => (
                                        <span key={skill} className="text-[9px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-100">
                                            {skill}
                                        </span>
                                    ))}
                                    {(!s.skills || s.skills.length === 0) && (
                                        <span className="text-[9px] text-gray-400 italic">Sin habilidades registradas</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </details>
    );
}
