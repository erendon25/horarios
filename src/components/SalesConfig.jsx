import React, { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Save, Calendar, Clock, DollarSign, Activity, TrendingUp, ArrowLeft, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
// Horas de jornada comercial: 06:00 → 05:00 (cubre turno de cierre + trasnoche)

export default function SalesConfig() {
    const db = getFirestore();
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [storeId, setStoreId] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
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
            if (!currentUser) return;
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            if (snap.exists()) setStoreId(snap.data().storeId || '');
        };
        fetchStore();
    }, [currentUser, db]);

    // Cargar datos al cambiar de mes o tienda
    useEffect(() => {
        if (!storeId || !selectedMonth) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const docRef = doc(db, 'stores', storeId, 'sales_config', selectedMonth);
                const snap = await getDoc(docRef);

                if (snap.exists()) {
                    const data = snap.data();
                    setMonthlyData(data.monthlyData || {});
                    setDailyHourlyParts(data.dailyHourlyParts || {});
                    setRealSalesData(data.realSalesData || {});
                } else {
                    setMonthlyData({});
                    setDailyHourlyParts({});
                    setRealSalesData({});
                }
            } catch (e) {
                console.error("Error al cargar config de ventas: ", e);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [storeId, selectedMonth]);

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
        if (!/^\d*\.?\d*$/.test(value)) return;

        setMonthlyData(prev => ({
            ...prev,
            [day]: {
                ...prev[day],
                [field]: value
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
            const cleanVal = val.replace(/[^\d.,]/g, '').replace(',', '.'); 
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

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const data = evt.target.result;
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];

            // Extraer filas genéricas para ubicar la verdadera línea de cabeceras
            const rowsArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            console.log("Primeras filas para diagnostico interno: ", rowsArray.slice(0, 15));

            let headerRowIndex = 0;
            let maxMatches = 0;
            const keywords = ['fecha', 'hora', 'pedido', 'documento', 'correlativo', 'caja', 'estado', 'total', 'importe', 'venta', 'cliente', 'canal', 'estadoitem'];
            
            // Buscar en las primeras 20 filas la que tenga la mayor concentración de palabras clave
            for (let i = 0; i < Math.min(20, rowsArray.length); i++) {
                const rowStr = rowsArray[i].map(c => String(c).toLowerCase().trim().replace(/\s/g, '')).join('|');
                
                let matchCount = 0;
                for (let kw of keywords) {
                    if (rowStr.includes(kw)) matchCount++;
                }

                if (matchCount > maxMatches) {
                    maxMatches = matchCount;
                    headerRowIndex = i;
                }
            }
            console.log(">>> Cabecera real ganadora en la fila:", headerRowIndex, " con ", maxMatches, " coincidencias.");

            // Convertir a JSON empezando desde la fila real de cabeceras
            const rawData = XLSX.utils.sheet_to_json(sheet, {
                range: headerRowIndex,
                raw: true,      // preserva Date objects nativos
                defval: '',
            });

            procesarRows(rawData);
        };
        reader.readAsArrayBuffer(file);
        e.target.value = null;
    };

    const procesarRows = (data) => {
        if (data.length === 0) return;

        // Diagnóstico: columnas disponibles
        console.log('=== DIAGNÓSTICO XLSX ===');
        console.log('Primera fila campos:', Object.keys(data[0]));
        console.log('Muestra:', { FechaPedido: data[0].FechaPedido || data[0].Fecha, Total: data[0].Total, Pedido: data[0].Pedido });
        console.log('========================');


                // Función utilitaria para buscar columnas sin importar espacios ni mayúsculas
                const findValue = (row, possibleKeys) => {
                    const keys = Object.keys(row);
                    for (let key of keys) {
                        if (possibleKeys.includes(key.trim().toLowerCase())) {
                            return row[key];
                        }
                    }
                    return undefined;
                };

                const ventasPorDiaHora = {}; 
                const totalesDiarios = {};   
                const pedidosPorDia = {}; // Pedidos únicos por día para TXS correcto

                data.forEach(fila => {
                    if (!fila || typeof fila !== 'object') return;

                    // Ignorar ítems anulados/cancelados
                    const estadoItem = String(findValue(fila, ['estadoitem', 'estado item', 'estado']) || '').trim().toLowerCase();
                    if (estadoItem && (estadoItem.includes('anulad') || estadoItem.includes('cancel'))) return;

                    // Si es Inforest, ignoramos su fila de resumen final
                    const pedidoRaw = String(findValue(fila, ['pedido']) || '').trim();
                    if (pedidoRaw.includes("Total Pedido")) return;

                    const fechaRaw = findValue(fila, ['fecha', 'fechapedido', 'fecha pedido', 'date']);
                    const totalRaw = findValue(fila, ['total', 'monto', 'venta', 'ventas']);
                    
                    if (!fechaRaw || totalRaw === undefined || totalRaw === null || totalRaw === '') return;

                    // Parseo agnóstico de dinero (S/ 1,500.50 -> 1500.50)
                    let numStr = String(totalRaw).replace(/[^\d.,-]/g, '');
                    if (numStr.includes(',') && numStr.includes('.')) {
                        if (numStr.indexOf(',') < numStr.indexOf('.')) {
                            numStr = numStr.replace(/,/g, ''); // 1,500.50
                        } else {
                            numStr = numStr.replace(/\./g, '').replace(',', '.'); // 1.500,50
                        }
                    } else if (numStr.includes(',')) {
                        numStr = numStr.replace(',', '.'); // 500,50
                    }
                    const monto = parseFloat(numStr);
                    if (isNaN(monto) || monto === 0) return;

                    // Parseo de fecha a prueba de balas
                    let fechaObj;
                    if (fechaRaw instanceof Date) {
                        fechaObj = fechaRaw;
                    } else if (typeof fechaRaw === 'string') {
                        const cleanStr = fechaRaw.trim().replace(/\s+/g, ' ');
                        const [datePart, ...timeParts] = cleanStr.split(' ');
                        const timePart = timeParts.join(' ');
                        const partes = datePart.split(/[\/\-]/);
                        if (partes.length === 3) {
                            let y, m, d;
                            if (partes[0].length === 4) {
                                y = parseInt(partes[0], 10); m = parseInt(partes[1], 10) - 1; d = parseInt(partes[2], 10);
                            } else {
                                d = parseInt(partes[0], 10); m = parseInt(partes[1], 10) - 1; y = parseInt(partes[2], 10);
                                if (y < 100) y += 2000;
                            }
                            let hh = 0, mm2 = 0, ss = 0;
                            if (timePart) {
                                const tParts = timePart.split(':');
                                hh = parseInt(tParts[0], 10) || 0; mm2 = parseInt(tParts[1], 10) || 0; ss = parseInt(tParts[2], 10) || 0;
                            }
                            fechaObj = new Date(y, m, d, hh, mm2, ss);
                        } else {
                            fechaObj = new Date(fechaRaw);
                        }
                    } else {
                        fechaObj = new Date(fechaRaw);
                    }

                    if (!fechaObj || isNaN(fechaObj.getTime())) return;

                    let yr = fechaObj.getFullYear();
                    let mo = fechaObj.getMonth() + 1;
                    let da = fechaObj.getDate();
                    const rawHours = fechaObj.getHours();

                    // Ajuste de Día de Negocio (Shift de Trasnoche)
                    // Ventas registradas hasta las 05:59am se computan hacia el día anterior
                    if (rawHours < 6) {
                        const prevDay = new Date(fechaObj);
                        prevDay.setDate(prevDay.getDate() - 1);
                        yr = prevDay.getFullYear();
                        mo = prevDay.getMonth() + 1;
                        da = prevDay.getDate();
                    }

                    const fecha = `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
                    const horaStr = String(rawHours).padStart(2, '0') + ':00'; 

                    if (!ventasPorDiaHora[fecha]) ventasPorDiaHora[fecha] = {};
                    ventasPorDiaHora[fecha][horaStr] = (ventasPorDiaHora[fecha][horaStr] || 0) + monto;
                    totalesDiarios[fecha] = (totalesDiarios[fecha] || 0) + monto;

                    // Contar Pedidos ÚNICOS por día (no ítems individuales)
                    if (!pedidosPorDia[fecha]) pedidosPorDia[fecha] = new Set();
                    if (pedidoRaw) pedidosPorDia[fecha].add(pedidoRaw);
                });

                // Log de totales por fecha para diagnóstico
                console.log('=== TOTALES PARSEADOS POR FECHA ===');
                Object.keys(totalesDiarios).sort().forEach(f => {
                    console.log(`${f}: S/${totalesDiarios[f].toFixed(2)} | TXS: ${pedidosPorDia[f]?.size || 0}`);
                });
                console.log('===================================');

                const txsDiarios = {};
                Object.keys(pedidosPorDia).forEach(f => {
                    txsDiarios[f] = pedidosPorDia[f].size;
                });

                // Mantener los metas manuales intactos
                const participacionFinal = {}; 
                const newRealSalesData = {};

                Object.keys(ventasPorDiaHora).forEach(fecha => {
                    participacionFinal[fecha] = {};
                    hourlyLabels.forEach(hourLabel => {
                        const ventaHora = ventasPorDiaHora[fecha][hourLabel] || 0;
                        participacionFinal[fecha][hourLabel] = totalesDiarios[fecha] > 0 
                                                               ? ((ventaHora / totalesDiarios[fecha]) * 100).toFixed(2) 
                                                               : "0.00";
                    });

                    // Guardar los totales reales de este CSV para promediarlos
                    newRealSalesData[fecha] = {
                        vta: totalesDiarios[fecha],
                        txs: txsDiarios[fecha] || 0
                    };
                });

                setDailyHourlyParts(participacionFinal);
                setRealSalesData(newRealSalesData);
                alert("¡Datos procesados! La matriz de participación por hora se ha rellenado correctamente con las proporciones leídas del archivo.\n\nEl cuadro de metas (Ventas Diarias) se mantiene intacto. No olvides guardar.");
    }; // fin procesarRows

    const saveData = async () => {
        if (!storeId) return;
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

    // 24 horas en orden de jornada comercial (06:00 -> 05:00)
    const hourlyLabels = Array.from({ length: 24 }, (_, i) => {
        const h = (i + 6) % 24; // empieza en 6am, termina en 5am
        return String(h).padStart(2, '0') + ':00';
    });

    const averagesByWeekday = React.useMemo(() => {
        const result = [
            { id: 1, name: 'Lunes', count: 0, vta: 0, txs: 0, parts: {} },
            { id: 2, name: 'Martes', count: 0, vta: 0, txs: 0, parts: {} },
            { id: 3, name: 'Miércoles', count: 0, vta: 0, txs: 0, parts: {} },
            { id: 4, name: 'Jueves', count: 0, vta: 0, txs: 0, parts: {} },
            { id: 5, name: 'Viernes', count: 0, vta: 0, txs: 0, parts: {} },
            { id: 6, name: 'Sábado', count: 0, vta: 0, txs: 0, parts: {} },
            { id: 0, name: 'Domingo', count: 0, vta: 0, txs: 0, parts: {} },
        ];

        const [year, month] = selectedMonth.split('-');

        days.forEach(day => {
            const d = new Date(year, parseInt(month) - 1, day);
            const wKey = d.getDay();
            const dateStr = `${year}-${month}-${String(day).padStart(2, '0')}`;
            
            // Usar Ventas Reales en lugar de Metas para el Promedio
            const realData = realSalesData[dateStr] || {};
            const vta = Number(realData.vta || 0);
            const txs = Number(realData.txs || 0);
            
            const wObj = result.find(w => w.id === wKey);
            if (vta > 0 || txs > 0) {
                wObj.vta += vta;
                wObj.txs += txs;
                wObj.count += 1;
            }
            const parts = dailyHourlyParts[dateStr];
            if (parts) {
                hourlyLabels.forEach(hour => {
                    if (!wObj.parts[hour]) wObj.parts[hour] = 0;
                    wObj.parts[hour] += Number(parts[hour] || 0);
                });
                wObj.partsCount = (wObj.partsCount || 0) + 1;
            }
        });

        result.forEach(w => {
            if (w.count > 0) {
                w.avgVta = w.vta / w.count;
                w.avgTxs = w.txs / w.count;
            } else {
                w.avgVta = 0;
                w.avgTxs = 0;
            }

            if (w.partsCount > 0) {
                hourlyLabels.forEach(hour => {
                    w.parts[hour] = w.parts[hour] / w.partsCount;
                });
            }
        });

        return result;
    }, [selectedMonth, days, realSalesData, dailyHourlyParts, hourlyLabels]);

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando configuración de ventas...</div>;
    }

    // Totales calculados en vivo para la cabecera
    const totalVentaMes = Object.values(monthlyData).reduce((sum, item) => sum + Number(item?.vta || 0), 0);
    const totalTxsMes = Object.values(monthlyData).reduce((sum, item) => sum + Number(item?.txs || 0), 0);
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
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md font-semibold flex items-center gap-2 transition-colors"
                        title="Subir archivo XLSX/CSV de ventas para calcular la matriz porcentual por hora"
                    >
                        <Upload className="w-4 h-4" />
                        <span className="hidden sm:inline">Cargar XLSX/CSV</span>
                    </button>
                    
                    <button 
                        onClick={saveData}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-semibold flex items-center gap-2 transition-colors"
                    >
                        <Save className="w-4 h-4" />
                        Guardar
                    </button>
                </div>
            </div>

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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Columna Izquierda: Ventas Mensuales */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[650px]">
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

                {/* Columna Derecha: Participación por Hora Diaria (Desde CSV) */}
                <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[650px]">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <Clock className="w-5 h-5 text-gray-500" />
                            <h2 className="font-bold text-gray-800 text-lg">Matriz de Participación Diaria</h2>
                        </div>
                    </div>
                    
                    <div className="p-4 bg-green-50/50 text-sm text-green-800 border-b border-green-100 flex flex-col gap-2 shrink-0">
                        <p>Esta matriz se genera <strong>automáticamente</strong> al subir tu archivo CSV de ventas.</p>
                        <p>Ya no necesitas ingresar los porcentajes base manualmente.</p>
                        
                        {Object.keys(dailyHourlyParts).length > 0 ? (
                            <div className="flex items-center justify-between mt-2">
                                <span className="font-bold text-green-700">✓ {Object.keys(dailyHourlyParts).length} días cargados</span>
                                <button 
                                    onClick={() => {
                                        if(window.confirm('¿Seguro que deseas limpiar la matriz diaria cargada?')) {
                                            setDailyHourlyParts({});
                                        }
                                    }}
                                    className="text-xs bg-red-100 text-red-700 px-3 py-1.5 rounded-full font-bold hover:bg-red-200 transition-colors"
                                >
                                    Limpiar
                                </button>
                            </div>
                        ) : (
                            <div className="mt-2 text-orange-600 font-bold bg-orange-50 p-2 rounded border border-orange-200">
                                ⚠ Sube un archivo CSV con tus ventas para generar la participación por hora de cada día.
                            </div>
                        )}
                    </div>

                    <div className="overflow-y-auto overflow-x-auto flex-1 relative bg-gray-50">
                        {Object.keys(dailyHourlyParts).length > 0 ? (
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-white sticky top-0 z-20 shadow-sm border-b border-gray-200">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider bg-white sticky left-0 z-30 shadow-[1px_0_0_0_#e5e7eb]">Fecha</th>
                                        {hourlyLabels.map(hour => (
                                            <th key={hour} className="px-3 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider min-w-[70px]">
                                                {hour}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                    {Object.keys(dailyHourlyParts).sort().map(fecha => {
                                        const horaParticiones = dailyHourlyParts[fecha];
                                        return (
                                            <tr key={fecha} className="hover:bg-blue-50/30 transition-colors">
                                                <td className="px-4 py-2 whitespace-nowrap text-xs font-bold text-gray-700 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#e5e7eb]">
                                                    {fecha}
                                                </td>
                                                {hourlyLabels.map(hour => {
                                                    const valNum = Number(horaParticiones[hour] || 0);
                                                    return (
                                                        <td key={hour} className={`px-3 py-2 text-center text-xs border-r border-gray-50 ${valNum > 0 ? 'text-green-700 font-bold bg-green-50/30' : 'text-gray-300'}`}>
                                                            {valNum > 0 ? `${valNum.toFixed(1)}%` : '-'}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8 text-center space-y-4">
                                <Activity className="w-16 h-16 text-gray-300" />
                                <p>Sube tu CSV Diario ('Cargar CSV Diario') para autocompletar la participación y las ventas del mes.</p>
                            </div>
                        )}
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
                    <p>Calculado automáticamente a partir de los datos cargados en el mes seleccionado. Te permite visualizar el comportamiento base de un Lunes, Martes, etc.</p>
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
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#e5e7eb] border-r border-gray-100">{w.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-semibold text-green-700 bg-green-50/10">S/ {w.avgVta.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold text-blue-700 bg-blue-50/10 border-r border-gray-200 shadow-[1px_0_0_0_#e5e7eb]">{Math.round(w.avgTxs).toLocaleString('en-US')}</td>
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
