
import React, { useEffect, useState } from 'react';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { Calendar, Clock, MapPin, Coffee, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';

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

                // Horas extras
                if (day.extraHours && !isNaN(day.extraHours)) {
                    totalExtra += Number(day.extraHours);
                }
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
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-blue-600" />
                        Mi Horario Semanal
                    </h2>
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
                                const extraHrs = (info?.extraHours && !isNaN(info.extraHours) && Number(info.extraHours) > 0)
                                    ? Number(info.extraHours)
                                    : 0;

                                // Calcular hora fin real sumando extras
                                let displayEnd = info?.end;
                                if (hasShift && extraHrs > 0) {
                                    const [h, m] = info.end.split(':').map(Number);
                                    const minutesToAdd = extraHrs * 60;
                                    const totalMinutes = h * 60 + m + minutesToAdd;
                                    const newH = Math.floor(totalMinutes / 60) % 24;
                                    const newM = Math.floor(totalMinutes % 60);
                                    displayEnd = `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
                                }
                                // ... existing logic ...
                                return (
                                    <tr key={day} className="hover:bg-blue-50/50 transition-colors">
                                        <td className="px-4 py-3 font-medium text-gray-800 capitalize">
                                            {weekdayLabels[day]}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {hasShift && !isOff && !isFeriado ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 font-semibold border border-blue-100">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {info.start} - {displayEnd}
                                                </span>
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
                                            {extraHrs > 0 ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold border border-red-200">
                                                    +{extraHrs}h
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
        </div>
    );
}
