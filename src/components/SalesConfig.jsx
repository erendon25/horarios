import React, { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, setDoc } from '../lib/supabase/firestoreCompat';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase/client';
import { readSalesHistoryDates } from '../services/salesHistoryRead';
import { writeSalesHistoryDays } from '../services/salesHistoryWrite';
import { parseSalesFile } from '../services/salesImport';
import { Save, Calendar, DollarSign, Activity, TrendingUp, ArrowLeft, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getDatesInRange, getWeekdayAverages, mergeSalesAverageSources, SALES_HOURLY_LABELS } from '../services/salesAnalysis';

const normalizeNumericInput = (value) => {
    let text = String(value ?? '').trim().replace(/[^\d.,-]/g, '');
    if (!text) return '';
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    const commaCount = (text.match(/,/g) || []).length;
    const dotCount = (text.match(/\./g) || []).length;

    if (lastComma >= 0 && lastDot >= 0) {
        const decimalSeparator = lastComma > lastDot ? ',' : '.';
        text = text.replaceAll(decimalSeparator === ',' ? '.' : ',', '');
        if (decimalSeparator === ',') text = text.replace(',', '.');
    } else if (commaCount > 1 || dotCount > 1) {
        const separator = commaCount > 1 ? ',' : '.';
        const parts = text.split(separator);
        const decimalPart = parts.pop();
        text = `${parts.join('')}.${decimalPart}`;
    } else if (lastComma >= 0) {
        text = /^\-?\d{1,3}(,\d{3})+$/.test(text) ? text.replaceAll(',', '') : text.replace(',', '.');
    } else if (lastDot >= 0 && /^\-?\d{1,3}(\.\d{3})+$/.test(text)) {
        text = text.replaceAll('.', '');
    }

    const numeric = Number(text);
    return Number.isFinite(numeric) ? String(numeric) : '';
};
// Horas de jornada comercial: 06:00 → 05:00 (cubre turno de cierre + trasnoche)

export default function SalesConfig() {
    const db = getFirestore();
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [storeId, setStoreId] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [reloadVersion, setReloadVersion] = useState(0);
    const fileInputRef = useRef(null);

    // Estado principal
    // El mes seleccionado determinara la carga de datos (YYYY-MM)
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    // Estado de la información de Ventas/Txs por día del mes
    const [monthlyData, setMonthlyData] = useState({});
    
    // Estado de Participación por Hora Día a Día
    const [dailyHourlyParts, setDailyHourlyParts] = useState({});

    // Estado de Ventas Reales (desde Excel/CSV) para la tabla de Promedios Base
    const [realSalesData, setRealSalesData] = useState({});

    // Cargar tienda del usuario
    useEffect(() => {
        const fetchStore = async () => {
            if (!currentUser) {
                setLoading(false);
                return;
            }
            try {
                const snap = await getDoc(doc(db, 'users', currentUser.uid));
                const nextStoreId = snap.exists() ? snap.data().storeId || '' : '';
                setStoreId(nextStoreId);
                if (!nextStoreId) setLoading(false);
            } catch (error) {
                console.error('Error al identificar la tienda:', error);
                setLoading(false);
            }
        };
        fetchStore();
    }, [currentUser, db]);

    // Cargar datos al cambiar de mes o tienda
    useEffect(() => {
        if (!storeId || !selectedMonth) return;

        let cancelled = false;
        const fetchData = async () => {
            setLoading(true);
            setLoadError('');
            setMonthlyData({});
            setDailyHourlyParts({});
            setRealSalesData({});
            try {
                const docRef = doc(db, 'stores', storeId, 'sales_config', selectedMonth);
                const [year, month] = selectedMonth.split('-').map(Number);
                const lastDay = new Date(year, month, 0).getDate();
                const monthDates = getDatesInRange(`${selectedMonth}-01`, `${selectedMonth}-${lastDay}`);
                const [snap, history] = await Promise.all([
                    getDoc(docRef),
                    readSalesHistoryDates(supabase, storeId, monthDates),
                ]);
                if (cancelled) return;
                const historySales = {};
                const historyParts = {};
                history.forEach((values, date) => {
                    historySales[date] = { ...values, vta: values.totalSales ?? null, txs: values.totalTxs ?? null, updatedAt: values.updatedAt,
                        ...(values.monthlyArchive ? { importedAt: values.importedAt } : {}) };
                    historyParts[date] = values.hourlyParticipation || {};
                    if (Object.keys(values.hourlyData || {}).length && Number(values.totalSales) > 0) {
                        historyParts[date] = Object.fromEntries(SALES_HOURLY_LABELS.map((hour) => {
                            const amount = Object.values(values.hourlyData[Number(hour.slice(0, 2))] || {})
                                .reduce((sum, value) => sum + (Number(value) || 0), 0);
                            return [hour, amount / Number(values.totalSales) * 100];
                        }));
                    }
                });

                if (snap.exists()) {
                    const data = snap.data();
                    const sanitizedMonthlyData = Object.fromEntries(
                        Object.entries(data.monthlyData || {}).map(([day, values]) => [
                            day,
                            {
                                ...values,
                                vta: normalizeNumericInput(values?.vta),
                                txs: normalizeNumericInput(values?.txs),
                            },
                        ])
                    );
                    setMonthlyData(sanitizedMonthlyData);
                    const averages = mergeSalesAverageSources(
                        data.realSalesData || {}, data.dailyHourlyParts || {}, historySales, historyParts
                    );
                    setDailyHourlyParts(averages.parts);
                    setRealSalesData(averages.sales);
                } else {
                    setMonthlyData({});
                    setDailyHourlyParts(historyParts);
                    setRealSalesData(historySales);
                }
            } catch (e) {
                console.error("Error al cargar config de ventas: ", e);
                if (!cancelled) setLoadError(`No se pudieron cargar los datos de ${selectedMonth}. Reintenta la carga para editar y guardar.`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchData();
        return () => { cancelled = true; };
    }, [storeId, selectedMonth, reloadVersion]);

    // Generar días del mes
    const getDaysInMonth = (yearMonthStr) => {
        if (!yearMonthStr) return [];
        const [year, month] = yearMonthStr.split('-');
        const date = new Date(year, parseInt(month), 0);
        return Array.from({ length: date.getDate() }, (_, i) => i + 1);
    };

    const days = getDaysInMonth(selectedMonth);

    // Formatear fecha (Ej: "Lunes 1")
    const getWeekdayName = (day) => {
        const [year, month] = selectedMonth.split('-');
        const d = new Date(year, parseInt(month) - 1, day);
        const daysES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        return daysES[d.getDay()];
    };

    const handleMonthlyDataChange = (day, field, value) => {
        // Permitir solo números y decimales
        if (!/^\d*[.,]?\d*$/.test(value)) return;
        const normalized = value.replace(',', '.');

        setMonthlyData(prev => ({
            ...prev,
            [day]: {
                ...prev[day],
                [field]: normalized
            }
        }));
    };

    const handlePasteMonthly = (e, field, startDay) => {
        e.preventDefault();
        const paste = e.clipboardData.getData('text');
        const rows = paste.split(/\r?\n/).map(row => row.trim()).filter(Boolean);
        
        let currentDay = startDay;
        const newMonthlyData = { ...monthlyData };
        
        for (const val of rows) {
            // Removemos S/ y espacios, permitiendo puntos y comas numéricos
            const firstCell = val.split('\t').find(cell => cell.trim() !== '') || '';
            const cleanVal = normalizeNumericInput(firstCell);
            if (cleanVal === '') continue;
            if (currentDay <= days.length) {
                newMonthlyData[currentDay] = {
                    ...newMonthlyData[currentDay],
                    [field]: cleanVal
                };
                currentDay++;
            }
        }
        setMonthlyData(newMonthlyData);
    };

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file || !storeId || isSaving || loadError) return;
        setIsSaving(true);
        try {
            const { days } = await parseSalesFile(file);
            if (!days.size) throw new Error('El archivo no contiene ventas válidas para importar.');
            const dates = await writeSalesHistoryDays(supabase, storeId, days);
            const importedAt = new Date().toISOString();
            const importedSales = {}, importedParts = {};
            for (const [date, day] of days) {
                if (!date.startsWith(selectedMonth + '-')) continue;
                importedSales[date] = { ...day, vta: day.totalSales, txs: day.totalTxs, importedAt };
                importedParts[date] = Object.fromEntries(SALES_HOURLY_LABELS.map(hour => {
                    const amount = Object.values(day.hourlyData[Number(hour.slice(0, 2))] || {})
                        .reduce((sum, value) => sum + Number(value || 0), 0);
                    return [hour, day.totalSales > 0 ? amount / day.totalSales * 100 : 0];
                }));
            }
            // Merge imported dates without reloading the form: manually edited,
            // unsaved sales goals must survive an upload too.
            setRealSalesData(previous => ({ ...previous, ...importedSales }));
            setDailyHourlyParts(previous => ({ ...previous, ...importedParts }));
            alert('Ventas guardadas: ' + dates.length + ' jornada(s), del ' + dates[0] + ' al ' + dates.at(-1) + '. Las ventas de 00:00 a 05:59 pertenecen a la jornada anterior. Los días importados anteriormente se conservan y las metas permanecen intactas.');
        } catch (error) {
            console.error('Error importando ventas:', error);
            alert(error?.message || 'No se pudieron importar las ventas.');
        } finally {
            setIsSaving(false);
        }
    };

    const saveData = async () => {
        if (!storeId || loading || loadError || isSaving) return;
        setIsSaving(true);
        
        try {
            const docRef = doc(db, 'stores', storeId, 'sales_config', selectedMonth);
            await setDoc(docRef, {
                monthlyData,
                dailyHourlyParts,
                realSalesData
            }, { merge: true });
            
            alert('Configuración guardada correctamente.');
        } catch (e) {
            console.error('Error al guardar', e);
            alert('Error al guardar la configuración');
        } finally {
            setIsSaving(false);
        }
    };

    const hourlyLabels = SALES_HOURLY_LABELS;
    const averagesByWeekday = React.useMemo(
        () => getWeekdayAverages(selectedMonth, realSalesData, dailyHourlyParts),
        [selectedMonth, realSalesData, dailyHourlyParts]
    );

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando configuración de ventas...</div>;
    }

    if (!storeId) {
        return <div className="p-8 text-center text-red-600">Tu cuenta no tiene una tienda asignada.</div>;
    }

    // Totales calculados en vivo para la cabecera
    const totalVentaMes = Object.values(monthlyData).reduce((sum, item) => {
        const value = Number(normalizeNumericInput(item?.vta || 0));
        return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    const totalTxsMes = Object.values(monthlyData).reduce((sum, item) => {
        const value = Number(normalizeNumericInput(item?.txs || 0));
        return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 min-h-screen bg-gray-50 relative">
            {/* Pantalla de carga superpuesta al guardar */}
            {isSaving && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex flex-col items-center justify-center backdrop-blur-sm transition-all opacity-100">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-4 transform transition-all scale-100 border border-t-4 border-t-blue-600">
                         <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
                         <div className="text-center">
                             <p className="text-gray-800 font-extrabold text-xl">Guardando cambios...</p>
                             <p className="text-gray-500 text-sm mt-1">Por favor, espera un momento</p>
                         </div>
                    </div>
                </div>
            )}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => navigate('/admin')}
                        className="p-2 bg-white rounded-lg shadow-sm border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                        title="Volver al Panel"
                    >
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
                            <TrendingUp className="text-blue-600 w-8 h-8" />
                            Configuración de Ventas
                        </h1>
                        <p className="text-gray-500 mt-1">Ingresa las ventas (VTA) y transacciones (TXS) por día para el mes seleccionado.</p>
                    </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-4 bg-white p-2 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center gap-2 border-r border-gray-200 pr-4">
                        <Calendar className="text-gray-400 w-5 h-5 ml-2" />
                        <input 
                            type="month" 
                            value={selectedMonth} 
                            onChange={e => setSelectedMonth(e.target.value)}
                            className="font-medium text-gray-700 bg-transparent outline-none cursor-pointer p-2"
                        />
                    </div>
                    
                    <input 
                        type="file" 
                        accept=".csv,.xlsx,.xls"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                    
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={Boolean(loadError)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md font-semibold flex items-center gap-2 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                        title="Subir un reporte de Intraview o Inforest para actualizar las ventas y los promedios"
                        aria-label="Cargar reporte de ventas"
                    >
                        <Upload className="w-4 h-4" />
                        <span className="hidden sm:inline">Cargar Intraview / Inforest</span>
                    </button>
                    
                    <button 
                        onClick={saveData}
                        disabled={Boolean(loadError) || isSaving}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-semibold flex items-center gap-2 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                        <Save className="w-4 h-4" />
                        Guardar
                    </button>
                </div>
            </div>

            {loadError && (
                <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    <p>{loadError}</p>
                    <button onClick={() => setReloadVersion(version => version + 1)} className="rounded-md bg-red-700 px-4 py-2 font-bold text-white hover:bg-red-800">
                        Reintentar
                    </button>
                </div>
            )}

            {/* Dashboard Resumen */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 lg:w-2/3">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col">
                    <span className="text-gray-500 text-sm font-semibold uppercase tracking-wider mb-1">Venta Total Mes</span>
                    <span className="text-3xl font-bold text-gray-800">S/ {totalVentaMes.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col">
                    <span className="text-gray-500 text-sm font-semibold uppercase tracking-wider mb-1">Total TXS Mes</span>
                    <span className="text-3xl font-bold text-gray-800">{totalTxsMes.toLocaleString('en-US')}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8">
                
                {/* Columna Izquierda: Ventas Mensuales */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[650px]">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center gap-2 shrink-0">
                        <Calendar className="w-5 h-5 text-gray-500" />
                        <h2 className="font-bold text-gray-800 text-lg">Ventas Diarias ({selectedMonth})</h2>
                    </div>
                    
                    <div className="overflow-x-auto flex-1 overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-1/3">Día</th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-1/3">
                                        <div className="flex items-center gap-2"><DollarSign className="w-4 h-4"/> VTA</div>
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider w-1/3">
                                        <div className="flex items-center gap-2"><Activity className="w-4 h-4"/> TXS</div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {days.map(day => (
                                    <tr key={day} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="px-6 py-3 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-gray-900">{getWeekdayName(day)} {day}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-2 whitespace-nowrap">
                                            <div className="relative rounded-md shadow-sm">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <span className="text-gray-500 sm:text-sm">S/</span>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={monthlyData[day]?.vta || ''}
                                                    disabled={Boolean(loadError)}
                                                    onChange={e => handleMonthlyDataChange(day, 'vta', e.target.value)}
                                                    onPaste={e => handlePasteMonthly(e, 'vta', day)}
                                                    className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-8 pr-3 sm:text-sm border-gray-300 rounded-md py-2 border transition-colors"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </td>
                                        <td className="px-6 py-2 whitespace-nowrap">
                                            <input
                                                type="text"
                                                value={monthlyData[day]?.txs || ''}
                                                disabled={Boolean(loadError)}
                                                onChange={e => handleMonthlyDataChange(day, 'txs', e.target.value)}
                                                onPaste={e => handlePasteMonthly(e, 'txs', day)}
                                                className="focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md py-2 px-3 border transition-colors"
                                                placeholder="0"
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-blue-50 border-t-2 border-blue-200 sticky bottom-0">
                                <tr>
                                    <td className="px-6 py-3 text-sm font-bold text-blue-900">TOTAL MES</td>
                                    <td className="px-6 py-3 text-sm font-bold text-blue-900">
                                        S/ {totalVentaMes.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-6 py-3 text-sm font-bold text-blue-900">
                                        {totalTxsMes.toLocaleString('en-US')}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

            </div>

            {/* Promedios por Día de la Semana */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-8 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-700 to-blue-900 px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-100" />
                    <h2 className="font-bold text-white text-lg">Promedios por Día de la Semana</h2>
                </div>
                <div className="p-4 bg-blue-50/50 text-sm text-blue-800 border-b border-blue-100">
                    <p>Calculado con las ventas reales registradas y los archivos cargados del mes seleccionado. Cada promedio incluye los días registrados con valor cero y excluye los días sin datos.</p>
                </div>
                <div className="overflow-x-auto relative bg-gray-50">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-white sticky top-0 z-20 shadow-sm border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-white sticky left-0 z-30 shadow-[1px_0_0_0_#e5e7eb]">Día</th>
                                <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Promedio VTA</th>
                                <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider border-r border-gray-200 shadow-[1px_0_0_0_#e5e7eb]">Promedio TXS</th>
                                {hourlyLabels.map(hour => (
                                    <th key={hour} className="px-3 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider min-w-[70px]">
                                        {hour}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {averagesByWeekday.map(w => (
                                <tr key={w.name} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#e5e7eb] border-r border-gray-100">{w.name}<span className="block text-xs font-normal text-gray-500 mt-1">{w.count} {w.count === 1 ? 'día registrado' : 'días registrados'}</span></td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-semibold text-green-700 bg-green-50/10">S/ {w.avgVta.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold text-blue-700 bg-blue-50/10 border-r border-gray-200 shadow-[1px_0_0_0_#e5e7eb]">{w.avgTxs.toLocaleString('es-PE', { maximumFractionDigits: 2 })}</td>
                                    {hourlyLabels.map(hour => {
                                        const valNum = Number(w.parts[hour] || 0);
                                        return (
                                            <td key={hour} className={`px-3 py-2 text-center text-xs border-r border-gray-50 ${valNum > 0 ? 'text-blue-700 font-bold bg-blue-50/30' : 'text-gray-300'}`}>
                                                {valNum > 0 ? `${valNum.toFixed(1)}%` : '-'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}
