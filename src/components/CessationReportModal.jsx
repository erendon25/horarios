import React, { useMemo } from 'react';
import { X, UserX, Calendar } from 'lucide-react';

export default function CessationReportModal({ staff, onClose }) {
    // Filter only staff with terminationDate
    const ceasedStaff = useMemo(() => {
        return staff.filter(s => s.terminationDate).sort((a, b) => new Date(b.terminationDate) - new Date(a.terminationDate));
    }, [staff]);

    const metrics = useMemo(() => {
        const total = ceasedStaff.length;
        const byModality = ceasedStaff.reduce((acc, curr) => {
            acc[curr.modality] = (acc[curr.modality] || 0) + 1;
            return acc;
        }, {});

        // Group by Month (YYYY-MM)
        const byMonth = ceasedStaff.reduce((acc, curr) => {
            const date = new Date(curr.terminationDate);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        return { total, byModality, byMonth };
    }, [ceasedStaff]);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto flex flex-col">

                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-2xl z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-100 rounded-lg">
                            <UserX className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-800">Reporte de Ceses</h3>
                            <p className="text-sm text-gray-500">Histórico de bajas y métricas</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-gray-600" />
                    </button>
                </div>

                <div className="p-6 space-y-6">

                    {/* Metrics Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                            <p className="text-red-600 text-sm font-medium mb-1">Total Cesados</p>
                            <p className="text-3xl font-bold text-red-800">{metrics.total}</p>
                        </div>
                        <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                            <p className="text-orange-600 text-sm font-medium mb-1">Por Modalidad</p>
                            <div className="text-sm text-orange-800 space-y-1">
                                {Object.entries(metrics.byModality).map(([mod, count]) => (
                                    <div key={mod} className="flex justify-between">
                                        <span>{mod}:</span>
                                        <span className="font-bold">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                            <p className="text-gray-600 text-sm font-medium mb-1">Ultimos 3 Meses</p>
                            {/* Show simplified list of recent months */}
                            <div className="text-sm text-gray-800 space-y-1">
                                {Object.entries(metrics.byMonth).slice(0, 3).map(([month, count]) => (
                                    <div key={month} className="flex justify-between">
                                        <span>{month}:</span>
                                        <span className="font-bold">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* List Table */}
                    <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-gray-500 font-medium border-b">
                                <tr>
                                    <th className="px-4 py-3">Nombre</th>
                                    <th className="px-4 py-3">Modalidad</th>
                                    <th className="px-4 py-3">Fecha de Cese</th>
                                    <th className="px-4 py-3">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {ceasedStaff.length > 0 ? (
                                    ceasedStaff.map((person) => {
                                        const [y, m, d] = person.terminationDate.split('-').map(Number);
                                        const termDate = new Date(y, m - 1, d);
                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        const isPast = today > termDate;
                                        return (
                                            <tr key={person.id} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 font-medium text-gray-900">
                                                    {person.name} {person.lastName}
                                                </td>
                                                <td className="px-4 py-3 text-gray-600">{person.modality}</td>
                                                <td className="px-4 py-3 text-gray-600 flex items-center gap-2">
                                                    <Calendar className="w-4 h-4 text-gray-400" />
                                                    {person.terminationDate}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${isPast ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                        {isPast ? 'Cesado' : 'Programado'}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                                            No hay registros de ceses.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>
        </div>
    );
}
