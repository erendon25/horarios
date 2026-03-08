import React, { useState, useEffect } from 'react';
import { X, Search, Calculator, DollarSign, ListOrdered, Users, Calendar, TrendingUp, TrendingDown, Target, Building2 } from 'lucide-react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

const VHLConsultation = ({ storeId, onClose }) => {
    const [viewType, setViewType] = useState('day'); // 'day', 'week', 'month'
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [sales, setSales] = useState('');
    const [transactions, setTransactions] = useState('');
    const [excludeTrainees, setExcludeTrainees] = useState(true);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [staff, setStaff] = useState([]);
    const [storeName, setStoreName] = useState('');

    useEffect(() => {
        const fetchStoreName = async () => {
            if (!storeId) return;
            const snap = await getDoc(doc(db, 'stores', storeId));
            if (snap.exists()) setStoreName(snap.data().name || 'Tienda');
        };
        fetchStoreName();
    }, [storeId]);

    const calculateMetrics = async () => {
        if (!storeId || !selectedDate) return;
        setLoading(true);
        setResults(null);

        try {
            // 1. Fetch Staff to know modality and trainee status
            const staffQuery = query(collection(db, 'staff_profiles'), where('storeId', '==', storeId));
            const staffSnap = await getDocs(staffQuery);
            const staffList = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            let totalManHours = 0;
            let workersIncluded = 0;

            // Define the date range based on viewType
            let startDate, endDate;

            // Handle different date formats from inputs
            let baseDate;
            if (viewType === 'month') {
                const [y, m] = selectedDate.split('-');
                baseDate = new Date(parseInt(y), parseInt(m) - 1, 1);
                startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
                endDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
            } else {
                baseDate = new Date(selectedDate + 'T00:00:00');
                if (viewType === 'day') {
                    startDate = new Date(baseDate);
                    endDate = new Date(baseDate);
                } else if (viewType === 'week') {
                    // Get Monday of the week
                    const day = baseDate.getDay();
                    const diff = (day === 0 ? -6 : 1 - day);
                    startDate = new Date(baseDate);
                    startDate.setDate(baseDate.getDate() + diff);
                    endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 6);
                }
            }

            const fmt = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

            // Get all unique weekKeys in the range more reliably
            const weekKeys = new Set();
            let currWk = new Date(startDate);
            while (currWk <= endDate || (currWk.getMonth() === endDate.getMonth() && currWk.getDate() <= endDate.getDate())) {
                const d = currWk.getDay();
                const diff = (d === 0 ? -6 : 1 - d);
                const mon = new Date(currWk);
                mon.setDate(currWk.getDate() + diff);
                const sun = new Date(mon);
                sun.setDate(mon.getDate() + 6);
                weekKeys.add(`${fmt(mon)}_to_${fmt(sun)}`);

                currWk.setDate(currWk.getDate() + 1);
                if (currWk > endDate && currWk.getTime() > endDate.getTime() + 86400000) break;
            }

            // 2. Fetch all schedules for these weeks (Fetching by direct ID is more robust)
            const schedules = {};
            const staffIds = staffList.map(s => s.id);

            for (const wkKey of Array.from(weekKeys)) {
                // Fetch in parallel for all staff members of this store to avoid missing docs without storeId field
                const docRefs = staffIds.map(staffId => doc(db, 'schedules', `${staffId}_${wkKey}`));

                // Group in batches if needed, but for 50-100 staff, Promise.all is fine
                const snaps = await Promise.all(docRefs.map(ref => getDoc(ref)));

                snaps.forEach(snap => {
                    if (snap.exists()) {
                        const data = snap.data();
                        const docId = snap.id;
                        // Extract staffId carefully from "staffId_YYYY-MM-DD_to_YYYY-MM-DD"
                        // The weekKey part starts at the first YYYY-MM-DD which has a specific pattern
                        const staffId = docId.replace(`_${wkKey}`, '');

                        if (!schedules[staffId]) schedules[staffId] = {};
                        schedules[staffId][wkKey] = data;
                    }
                });
            }

            const weekdaysArr = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

            // 3. Process each day in range
            let dayRunner = new Date(startDate);
            dayRunner.setHours(0, 0, 0, 0);
            const endLimit = new Date(endDate);
            endLimit.setHours(23, 59, 59, 999);

            let ftCount = 0;
            let ptCount = 0;
            let debugLog = [];

            while (dayRunner <= endLimit) {
                const dayName = weekdaysArr[dayRunner.getDay() === 0 ? 6 : dayRunner.getDay() - 1];
                const dayDateStr = fmt(dayRunner);

                // Find weekKey for this day (Monday to Sunday)
                const d = dayRunner.getDay();
                const diff = (d === 0 ? -6 : 1 - d);
                const mon = new Date(dayRunner);
                mon.setDate(dayRunner.getDate() + diff);
                const sun = new Date(mon);
                sun.setDate(mon.getDate() + 6);
                const currentWk = `${fmt(mon)}_to_${fmt(sun)}`;

                debugLog.push(`Procesando día: ${dayDateStr} (${dayName}) con WeekKey: ${currentWk}`);

                staffList.forEach(person => {
                    const fullName = `${person.name} ${person.lastName}`;
                    const isTrainee = person.isTrainee === true || person.isTrainee === 'true' || person.isTrainee === 1;

                    if (excludeTrainees && isTrainee) {
                        debugLog.push(`  - SKIP ${fullName}: Es Trainee`);
                        return;
                    }

                    const personScheds = schedules[person.id];
                    if (!personScheds) {
                        debugLog.push(`  - SKIP ${fullName}: No se encontraron horarios para este ID`);
                        return;
                    }
                    if (!personScheds[currentWk]) {
                        debugLog.push(`  - SKIP ${fullName}: No hay horario para la semana ${currentWk}`);
                        return;
                    }

                    const dayData = personScheds[currentWk][dayName];
                    if (!dayData) {
                        debugLog.push(`  - SKIP ${fullName}: Datos de día ${dayName} vacíos`);
                        return;
                    }

                    // "no dia libre, no feriado"
                    if (dayData.off === true || String(dayData.off) === 'true') {
                        debugLog.push(`  - SKIP ${fullName}: Marcado como OFF`);
                        return;
                    }
                    if (dayData.feriado === true || String(dayData.feriado) === 'true') {
                        debugLog.push(`  - SKIP ${fullName}: Marcado como FERIADO`);
                        return;
                    }

                    // Solo si tiene hora de inicio, trabajó ese día
                    if (!dayData.start || dayData.start === '') {
                        debugLog.push(`  - SKIP ${fullName}: Sin hora de inicio (No asignado)`);
                        return;
                    }

                    // Determinar modalidad efectiva
                    let effModality = (person.modality || '').toLowerCase().trim();
                    if (person.modalityChangeDate && person.nextModality && dayDateStr >= person.modalityChangeDate) {
                        effModality = person.nextModality.toLowerCase().trim();
                    }

                    if (effModality.includes('full')) {
                        totalManHours += 8;
                        ftCount++;
                        workersIncluded++;
                        debugLog.push(`  + COUNT ${fullName}: FULL-TIME (8h)`);
                    } else if (effModality.includes('part')) {
                        totalManHours += 4;
                        ptCount++;
                        workersIncluded++;
                        debugLog.push(`  + COUNT ${fullName}: PART-TIME (4h)`);
                    } else {
                        debugLog.push(`  - SKIP ${fullName}: Modalidad desconocida (${effModality})`);
                    }
                });

                dayRunner.setDate(dayRunner.getDate() + 1);
            }

            const salesNum = parseFloat(sales) || 0;
            const transNum = parseFloat(transactions) || 0;

            setResults({
                totalHours: totalManHours,
                workersCount: workersIncluded,
                ftCount,
                ptCount,
                vhl: totalManHours > 0 ? (salesNum / totalManHours).toFixed(2) : 0,
                thl: totalManHours > 0 ? (transNum / totalManHours).toFixed(2) : 0,
                period: viewType === 'day' ? selectedDate : `${fmt(startDate)} a ${fmt(endDate)}`,
                debug: debugLog
            });

        } catch (err) {
            console.error("Error calculating VHL/THL:", err);
            alert("Error al calcular datos: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-700 via-blue-800 to-indigo-900 p-8 text-white relative">
                    <button
                        onClick={onClose}
                        className="absolute top-6 right-6 p-2 hover:bg-white/20 rounded-full transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-sm">
                            <Calculator className="w-8 h-8 text-blue-200" />
                        </div>
                        <div>
                            <h2 className="text-3xl font-black tracking-tight">VHL & THL</h2>
                            <p className="text-blue-200 font-medium uppercase text-xs tracking-widest">{storeName}</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-8 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                        {/* Selector de periodo */}
                        <div className="space-y-4">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <Calendar className="w-4 h-4" /> Periodo de Consulta
                            </label>
                            <div className="flex p-1 bg-gray-100 rounded-xl">
                                {['day', 'week', 'month'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setViewType(type)}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${viewType === type ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        {type === 'day' ? 'Día' : type === 'week' ? 'Semana' : 'Mes'}
                                    </button>
                                ))}
                            </div>
                            <input
                                type={viewType === 'month' ? 'month' : 'date'}
                                value={selectedDate}
                                onChange={e => setSelectedDate(e.target.value)}
                                className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-gray-700"
                            />
                        </div>

                        {/* Filtro Trainees */}
                        <div className="space-y-4">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <Users className="w-4 h-4" /> Filtrar Personal
                            </label>
                            <label className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all cursor-pointer ${excludeTrainees ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                                <div className="flex flex-col">
                                    <span className="font-bold text-gray-800">Solo Tienda</span>
                                    <span className="text-[10px] text-gray-500 font-medium uppercase">Excluir Entrenamiento</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={excludeTrainees}
                                    onChange={e => setExcludeTrainees(e.target.checked)}
                                    className="w-6 h-6 text-blue-600 rounded-lg"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                        {/* Ventas */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <DollarSign className="w-4 h-4" /> Venta del Periodo
                            </label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">S/</span>
                                <input
                                    type="number"
                                    value={sales}
                                    onChange={e => setSales(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full pl-10 pr-4 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-green-500 focus:bg-white transition-all outline-none font-black text-xl text-gray-800"
                                />
                            </div>
                        </div>

                        {/* Transacciones */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <ListOrdered className="w-4 h-4" /> Transacciones
                            </label>
                            <input
                                type="number"
                                value={transactions}
                                onChange={e => setTransactions(e.target.value)}
                                placeholder="0"
                                className="w-full px-4 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-purple-500 focus:bg-white transition-all outline-none font-black text-xl text-gray-800"
                            />
                        </div>
                    </div>

                    <button
                        onClick={calculateMetrics}
                        disabled={loading || !sales}
                        className="w-full py-5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-2xl font-black text-lg shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-3"
                    >
                        {loading ? (
                            <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <Calculator className="w-6 h-6" />
                                CALCULAR MÉTRICAS
                            </>
                        )}
                    </button>

                    {/* Resultados */}
                    {results && (
                        <div className="mt-10 space-y-6 animate-in slide-in-from-bottom duration-500">
                            <div className="flex items-center gap-2 px-2">
                                <TrendingUp className="w-4 h-4 text-green-500" />
                                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Resultados para {results.period}</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-gradient-to-br from-green-600 to-emerald-700 p-6 rounded-3xl relative overflow-hidden group shadow-lg shadow-green-100">
                                    <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                                        <Target className="w-24 h-24 text-white" />
                                    </div>
                                    <p className="text-green-100 font-bold text-[10px] uppercase tracking-widest mb-1">VHL</p>
                                    <p className="text-4xl font-black text-white leading-none">S/ {results.vhl}</p>
                                    <p className="text-[9px] text-green-100/70 font-bold uppercase mt-4">Venta por Hora Lograda</p>
                                </div>

                                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-3xl relative overflow-hidden group shadow-lg shadow-blue-100">
                                    <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                                        <TrendingUp className="w-24 h-24 text-white" />
                                    </div>
                                    <p className="text-blue-100 font-bold text-[10px] uppercase tracking-widest mb-1">THL</p>
                                    <p className="text-4xl font-black text-white leading-none">{results.thl}</p>
                                    <p className="text-[9px] text-blue-100/70 font-bold uppercase mt-4">Transacciones x Hora Lograda</p>
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-center">
                                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Horas Totales</p>
                                        <p className="text-xl font-black text-gray-800">{results.totalHours}</p>
                                    </div>
                                    <div className="text-center border-x border-gray-200">
                                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Personal FT</p>
                                        <p className="text-xl font-black text-blue-600">{results.ftCount}</p>
                                        <p className="text-[8px] text-gray-400 font-bold uppercase">x 8 hrs</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Personal PT</p>
                                        <p className="text-xl font-black text-purple-600">{results.ptCount}</p>
                                        <p className="text-[8px] text-gray-400 font-bold uppercase">x 4 hrs</p>
                                    </div>
                                </div>
                            </div>

                            {/* Debug Section */}
                            <div className="mt-8">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-2">Detalle de Auditoría (Trazabilidad)</p>
                                <div className="bg-gray-900 rounded-xl p-4 h-48 overflow-y-auto font-mono text-[10px] text-green-400 custom-scrollbar">
                                    {results.debug.map((line, idx) => (
                                        <div key={idx} className={line.includes('+ COUNT') ? 'text-green-400' : line.includes('- SKIP') ? 'text-orange-400' : 'text-gray-400 font-bold'}>
                                            {line}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VHLConsultation;
