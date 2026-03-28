
import React, { useEffect, useState } from 'react';
import { getFirestore, doc, onSnapshot, query, collection, where } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Coffee, AlertCircle, ChevronLeft, ChevronRight, ClipboardList, X } from 'lucide-react';

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const weekdayLabels = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo'
};

const getWeekKey = (s) => {
    if (!s) return '';
    const [Y, M, D] = s.split('-').map(Number);
    const start = new Date(Y, M - 1, D);
    if (isNaN(start.getTime())) return '';
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const format = (date) =>
        [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');
    return `${format(start)}_to_${format(end)}`;
};

export default function WeeklyView({ perfilId }) {
    const [weekStartDate, setWeekStartDate] = useState('');
    const [schedule, setSchedule] = useState({});
    const [approvedRequests, setApprovedRequests] = useState([]);
    const [allRequests, setAllRequests] = useState([]);
    const [showRequestsModal, setShowRequestsModal] = useState(false);
    const db = getFirestore();

    // Helper para formatear fecha local a YYYY-MM-DD sin conversión a UTC
    const toLocalDateStr = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Setear lunes actual al inicio
    useEffect(() => {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 (Dom) - 6 (Sab)
        const diff = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
        const monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        setWeekStartDate(toLocalDateStr(monday));
    }, []);

    // Escuchar cambios en el horario
    useEffect(() => {
        if (!perfilId || !weekStartDate) return;
        const wk = getWeekKey(weekStartDate);
        const docRef = doc(db, 'schedules', `${perfilId}_${wk}`);

        const unsub = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                setSchedule(snap.data());
            } else {
                setSchedule({});
            }
        });

        return () => unsub();
    }, [perfilId, weekStartDate, db]);

    // Escuchar solicitudes aprobadas
    useEffect(() => {
        if (!perfilId || !weekStartDate) return;
        const startStr = weekStartDate;
        const [y, m, d] = weekStartDate.split('-').map(Number);
        const end = new Date(y, m - 1, d + 6);
        const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

        const q = query(
            collection(db, 'schedule_requests'),
            where('staffId', '==', perfilId),
            where('status', '==', 'approved'),
            where('date', '>=', startStr),
            where('date', '<=', endStr)
        );

        const unsub = onSnapshot(q, (snap) => {
            const reqs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setApprovedRequests(reqs);
        });

        // Escuchar todas las solicitudes para el modal (opcionalmente filtrado por semana o general)
        const qAll = query(
            collection(db, 'schedule_requests'),
            where('staffId', '==', perfilId)
        );
        const unsubAll = onSnapshot(qAll, (snap) => {
            const reqs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllRequests(reqs.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis()));
        });

        return () => {
            unsub();
            unsubAll();
        };
    }, [perfilId, weekStartDate, db]);

    // Calcular totales
    // Calcular totales
    const calculateTotalHours = () => {
        let totalMinutes = 0;
        let totalExtra = 0;

        Object.values(schedule).forEach(day => {
            if (day?.start && day?.end && !day.off && !day.feriado) {
                // Horas base
                const [sh, sm] = day.start.split(':').map(Number);
                const [eh, em] = day.end.split(':').map(Number);
                let diff = (eh * 60 + em) - (sh * 60 + sm);
                if (diff < 0) diff += 1440; // Cruza medianoche
                totalMinutes += diff;

                // Horas extras (Ant, Post y Genéricas)
                const pre = Number(day.extraHoursPre || 0);
                const post = Number(day.extraHoursPost || day.extraHours || 0);
                if (!isNaN(pre)) totalExtra += pre;
                if (!isNaN(post)) totalExtra += post;
                
                                 
            }
        });

        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        const totalBaseStr = `${h}:${m.toString().padStart(2, '0')}`;
        const totalExtraStr = totalExtra.toFixed(1).replace('.0', ''); // Ej: 2 o 2.5

        return { base: totalBaseStr, extra: totalExtraStr };
    };

    const totals = calculateTotalHours();

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6 border border-gray-100">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-blue-600" />
                            Mi Horario Semanal
                        </h2>
                        <button
                            onClick={() => setShowRequestsModal(true)}
                            className="bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-xs font-bold border border-orange-200 hover:bg-orange-100 transition-colors flex items-center gap-1"
                        >
                            <ClipboardList className="w-3 h-3" />
                            Ver Mis Solicitudes
                        </button>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">Revisa tus turnos y posiciones asignadas</p>
                </div>

                <div className="flex items-center gap-3 bg-white p-1 rounded-lg shadow-sm border border-gray-200">
                    <button
                        onClick={() => {
                            const [y, m, d] = weekStartDate.split('-').map(Number);
                            const newDate = new Date(y, m - 1, d - 7);
                            setWeekStartDate(toLocalDateStr(newDate));
                        }}
                        className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600 transition-colors"
                        title="Semana anterior"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>

                    <span className="text-sm font-semibold text-gray-700 min-w-[140px] text-center capitalize">
                        {(() => {
                            if (!weekStartDate) return 'Cargando...';
                            const [y, m, d] = weekStartDate.split('-').map(Number);
                            const start = new Date(y, m - 1, d);
                            const end = new Date(start);
                            end.setDate(start.getDate() + 6);

                            const format = date => date.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
                            return `${format(start)} - ${format(end)}`;
                        })()}
                    </span>

                    <button
                        onClick={() => {
                            const [y, m, d] = weekStartDate.split('-').map(Number);
                            const newDate = new Date(y, m - 1, d + 7);
                            setWeekStartDate(toLocalDateStr(newDate));
                        }}
                        className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600 transition-colors"
                        title="Semana siguiente"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>

                    <button
                        onClick={() => {
                            const today = new Date();
                            const dayOfWeek = today.getDay();
                            const diff = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
                            const monday = new Date(today);
                            monday.setDate(today.getDate() + diff);
                            setWeekStartDate(toLocalDateStr(monday));
                        }}
                        className="ml-2 px-3 py-1 bg-blue-50 text-blue-600 text-xs font-bold rounded hover:bg-blue-100 transition-colors"
                    >
                        HOY
                    </button>
                </div>
            </div>

            {/* Mensaje si no hay datos y no se está cargando (implícito por snapshot) */}
            {Object.keys(schedule).length === 0 ? (
                <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">No hay horarios publicados para esta semana.</p>
                    <p className="text-xs text-gray-400 mt-1">Asegúrate de estar viendo la semana correcta o consulta con tu gerente.</p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100 text-gray-700 font-semibold uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3">Día</th>
                                <th className="px-4 py-3 text-center">Horario</th>
                                <th className="px-4 py-3 text-center">Posición</th>
                                <th className="px-4 py-3 text-center">Extras</th>
                                <th className="px-4 py-3 text-center">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {weekdays.map((day) => {
                                const info = schedule[day];
                                const isOff = info?.off;
                                const isFeriado = info?.feriado;
                                const hasShift = info?.start && info?.end;
                                 const extraHrsPre = Number(info?.extraHoursPre || 0);
                                 const extraHrsPost = Number(info?.extraHoursPost || info?.extraHours || 0);
                                 const totalExtraDay = extraHrsPre + extraHrsPost;

                                 let displayStart = info?.start;
                                 let displayEnd = info?.end;

                                 if (hasShift) {
                                     // HE Pre: retrocede el inicio
                                     if (extraHrsPre > 0 && info.start) {
                                         const [h, m] = info.start.split(':').map(Number);
                                         let totalMins = h * 60 + m - (extraHrsPre * 60);
                                         if (totalMins < 0) totalMins = 0; // tope visual
                                         displayStart = `${Math.floor(totalMins / 60).toString().padStart(2, '0')}:${(totalMins % 60).toString().padStart(2, '0')}`;
                                     }
                                     // HE Post: avanza el fin
                                     if (extraHrsPost > 0 && info.end) {
                                         const [h, m] = info.end.split(':').map(Number);
                                         let totalMins = h * 60 + m + (extraHrsPost * 60);
                                         displayEnd = `${Math.floor(totalMins / 60) % 24}:${(totalMins % 60).toString().padStart(2, '0')}`;
                                         // Asegurar formato HH:mm
                                         const [fH, fM] = displayEnd.split(':');
                                         displayEnd = `${fH.padStart(2, '0')}:${fM.padStart(2, '0')}`;
                                     }
                                 }
                                // ... existing logic ...
                                return (
                                    <tr key={day} className="hover:bg-blue-50/50 transition-colors">
                                        <td className="px-4 py-3 font-medium text-gray-800 capitalize">
                                            {weekdayLabels[day]}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {hasShift && !isOff && !isFeriado ? (
                                                <>
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 font-semibold border border-blue-100">
                                                        <Clock className="w-3.5 h-3.5" />
                                                        {displayStart} - {displayEnd}
                                                    </span>
                                                    {totalExtraDay > 0 && (
                                                        <div className="flex flex-col gap-0.5 mt-1">
                                                            <span className="text-[10px] text-gray-400 font-medium italic">Turno: {info.start}-{info.end}</span>
                                                            {extraHrsPre > 0 && <span className="text-[10px] text-red-600 font-bold uppercase">+{extraHrsPre}h HE ANT</span>}
                                                            {extraHrsPost > 0 && <span className="text-[10px] text-red-600 font-bold uppercase">+{extraHrsPost}h HE DESP</span>}
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-gray-400">
                                                    {isOff ? '--' : isFeriado ? '--' : '--'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {info?.position ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 font-medium border border-purple-100">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {info.position}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 text-xs italic">
                                                    {isOff ? 'Día Libre' : isFeriado ? 'Feriado' : 'Sin asignar'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {totalExtraDay > 0 ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold border border-red-200">
                                                    +{totalExtraDay}h
                                                </span>
                                            ) : (
                                                <span className="text-gray-300">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {isOff ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                                                    <Coffee className="w-3 h-3" />
                                                    Libre
                                                </span>
                                            ) : isFeriado ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold">
                                                    <AlertCircle className="w-3 h-3" />
                                                    Feriado
                                                </span>
                                            ) : hasShift ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                                                    Turno Asignado
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 text-xs">-</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t border-gray-200">
                            <tr>
                                <td colSpan="5" className="px-4 py-4">
                                    <div className="flex flex-col sm:flex-row justify-end items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs uppercase font-bold text-gray-500">Horas Base:</span>
                                            <span className="bg-white px-3 py-1 rounded border border-gray-200 font-mono font-bold text-gray-800 shadow-sm">
                                                {totals.base}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs uppercase font-bold text-red-500">Horas Extras:</span>
                                            <span className="bg-red-50 px-3 py-1 rounded border border-red-200 font-mono font-bold text-red-700 shadow-sm">
                                                +{totals.extra}
                                            </span>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* Solicitudes Aprobadas */}
            {approvedRequests.length > 0 && (
                <div className="mt-6 animate-fadeIn">
                    <h3 className="text-sm font-bold text-orange-600 uppercase tracking-widest flex items-center gap-2 mb-3">
                        <ClipboardList className="w-4 h-4" />
                        Tus Solicitudes Aprobadas para esta Semana
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {approvedRequests.map(req => (
                            <div key={req.id} className="bg-orange-50 border border-orange-100 rounded-xl p-3 shadow-sm">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-bold text-orange-800 bg-orange-200 px-2 py-0.5 rounded-full">
                                        {weekdayLabels[weekdays[new Date(req.date + 'T00:00:00').getDay() === 0 ? 6 : new Date(req.date + 'T00:00:00').getDay() - 1]]} {req.date.split('-').reverse().slice(0, 2).join('/')}
                                    </span>
                                    <span className="text-[10px] font-extrabold text-orange-600 uppercase">
                                        {req.shiftType === 'rango' ? 'Rango' : req.shiftType}
                                    </span>
                                </div>
                                {req.shiftType === 'rango' && (
                                    <p className="text-xs font-bold text-orange-900 mb-1 flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {req.startTime} - {req.endTime}
                                    </p>
                                )}
                                <p className="text-xs text-gray-600 italic">"{req.reason}"</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Modal de Solicitudes para el Colaborador */}
            {showRequestsModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowRequestsModal(false)}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-300" onClick={e => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-orange-500 to-red-600 px-8 py-5 flex justify-between items-center text-white">
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <ClipboardList className="w-5 h-5" />
                                Historial de Solicitudes
                            </h3>
                            <button onClick={() => setShowRequestsModal(false)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 max-h-[70vh] overflow-y-auto">
                            {allRequests.length === 0 ? (
                                <div className="text-center py-10 text-gray-400">
                                    <AlertCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
                                    <p>No tienes solicitudes registradas.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {allRequests.map(req => (
                                        <div key={req.id} className="border-2 border-gray-50 rounded-2xl p-4 hover:border-orange-100 transition-all">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <p className="font-bold text-gray-800">{weekdayLabels[weekdays[new Date(req.date + 'T00:00:00').getDay() === 0 ? 6 : new Date(req.date + 'T00:00:00').getDay() - 1]]} {req.date.split('-').reverse().join('/')}</p>
                                                    <p className="text-xs text-blue-600 font-bold uppercase">{req.shiftType} {req.shiftType === 'rango' && `(${req.startTime} - ${req.endTime})`}</p>
                                                </div>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${req.status === 'pending' ? 'bg-orange-100 text-orange-600' : req.status === 'approved' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                                    {req.status === 'pending' ? 'Pendiente' : req.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                                                </span>
                                            </div>
                                            <div className="bg-gray-50 p-3 rounded-xl">
                                                <p className="text-xs text-gray-600 italic leading-relaxed">"{req.reason}"</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
