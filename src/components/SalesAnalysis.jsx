import React, { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, writeBatch } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Upload, Calendar, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts';

const TURNOS = [
    { key: 'Apertura a 1pm', check: (h) => h >= 6 && h < 13 },
    { key: '1pm a 4pm', check: (h) => h >= 13 && h < 16 },
    { key: '4pm a 7pm', check: (h) => h >= 16 && h < 19 },
    { key: '7pm a 10pm', check: (h) => h >= 19 && h < 22 },
    { key: '10pm al cierre', check: (h) => h >= 22 || h < 6 }
];

const CANALES_FIJOS = ['SALÓN', 'DELIVERY', 'DRIVE THRU', 'SERV. FILA'];
const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const addDays = (dateStr, days) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getDatesInRange = (start, end) => {
    const dates = [];
    let curr = start;
    while (curr <= end) {
        dates.push(curr);
        curr = addDays(curr, 1);
    }
    return dates;
};

const fmtMoney = (val) => val != null ? `S/ ${val.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'S/ 0.00';
const fmtNum = (val) => val != null ? val.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
const fmtPct = (val) => val != null ? `${val > 0 ? '+' : ''}${val.toFixed(1)}%` : '0.0%';

export default function SalesAnalysis() {
    const db = getFirestore();
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const [storeId, setStoreId] = useState('');
    const [loading, setLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const fileInputRef = useRef(null);

    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const [endDate, setEndDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    const [dataCurrent, setDataCurrent] = useState(null);
    const [dataPrevWeek, setDataPrevWeek] = useState(null);
    const [dataPrevYear, setDataPrevYear] = useState(null);
    const [currentGoal, setCurrentGoal] = useState(0);
    const [viewMode, setViewMode] = useState('VTA');

    useEffect(() => {
        const fetchStore = async () => {
            if (!currentUser) return;
            const snap = await getDoc(doc(db, 'users', currentUser.uid));
            if (snap.exists()) setStoreId(snap.data().storeId || '');
        };
        fetchStore();
    }, [currentUser, db]);

    useEffect(() => {
        if (!storeId || !startDate || !endDate) return;

        const fetchData = async () => {
            if (startDate > endDate) {
                alert("La fecha de inicio no puede ser mayor a la fecha de fin.");
                return;
            }

            setLoading(true);
            try {
                const currentDates = getDatesInRange(startDate, endDate);
                const prevWeekDates = currentDates.map(d => addDays(d, -7));
                const prevYearDates = currentDates.map(d => addDays(d, -364));

                const fetchRange = async (datesArr) => {
                    const results = await Promise.all(datesArr.map(d => getDoc(doc(db, 'stores', storeId, 'sales_history', d))));
                    const agg = {
                        total: 0, txs: 0,
                        canales: {}, canalesTxs: {}, turnos: {}, turnosTxs: {}, dias: {}, diasTxs: {}
                    };

                    TURNOS.forEach(t => { agg.turnos[t.key] = 0; agg.turnosTxs[t.key] = 0; });
                    DIAS_SEMANA.forEach((_, idx) => { agg.dias[idx] = 0; agg.diasTxs[idx] = 0; });

                    results.forEach((snap, idx) => {
                        if (snap.exists()) {
                            const dayData = snap.data();
                            agg.total += dayData.totalSales || 0;
                            agg.txs += dayData.totalTxs || 0;

                            const dateObj = new Date(datesArr[idx] + 'T12:00:00');
                            const dow = dateObj.getDay();
                            agg.dias[dow] += dayData.totalSales || 0;
                            agg.diasTxs[dow] += dayData.totalTxs || 0;

                            if (dayData.hourlyData) {
                                Object.entries(dayData.hourlyData).forEach(([hourStr, canalData]) => {
                                    const hour = parseInt(hourStr, 10);
                                    let sumHour = 0, sumHourTxs = 0;

                                    Object.entries(canalData).forEach(([canal, val]) => {
                                        if (!agg.canales[canal]) agg.canales[canal] = 0;
                                        agg.canales[canal] += val;
                                        sumHour += val;

                                        const txsVal = dayData.hourlyTxs?.[hourStr]?.[canal] || 0;
                                        if (!agg.canalesTxs[canal]) agg.canalesTxs[canal] = 0;
                                        agg.canalesTxs[canal] += txsVal;
                                        sumHourTxs += txsVal;
                                    });

                                    const turnoObj = TURNOS.find(t => t.check(hour));
                                    if (turnoObj) {
                                        agg.turnos[turnoObj.key] += sumHour;
                                        agg.turnosTxs[turnoObj.key] += sumHourTxs;
                                    }
                                });
                            }
                        }
                    });
                    return agg;
                };

                const uniqueMonths = [...new Set(currentDates.map(d => d.substring(0, 7)))];
                const fetchConfig = async () => {
                    const configs = await Promise.all(uniqueMonths.map(m => getDoc(doc(db, 'stores', storeId, 'sales_config', m))));
                    let totalGoal = 0;
                    const configDataByMonth = {};
                    configs.forEach((snap, idx) => {
                        if (snap.exists()) configDataByMonth[uniqueMonths[idx]] = snap.data().monthlyData || {};
                    });
                    currentDates.forEach(d => {
                        const month = d.substring(0, 7);
                        const day = parseInt(d.substring(8, 10), 10).toString();
                        if (configDataByMonth[month] && configDataByMonth[month][day]) {
                            totalGoal += Number(configDataByMonth[month][day].vta || 0);
                        }
                    });
                    return totalGoal;
                };

                const [resCurr, resPrev, resYear, goal] = await Promise.all([
                    fetchRange(currentDates), fetchRange(prevWeekDates), fetchRange(prevYearDates), fetchConfig()
                ]);

                setDataCurrent(resCurr); setDataPrevWeek(resPrev); setDataPrevYear(resYear); setCurrentGoal(goal);
            } catch (err) {
                console.error("Error fetching data", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [storeId, startDate, endDate]);

    // LECTURA DE MÚLTIPLES TABLAS EN INFOREST
    const parseHTMLTable = (text) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const tables = doc.querySelectorAll('table');
        if (tables.length === 0) return [];

        const allResults = [];
        tables.forEach((table) => {
            const trs = table.querySelectorAll('tr');
            if (trs.length < 2) return;

            let headerIdx = -1;
            let maxMatches = 0;
            const kws = ['fecha', 'hora', 'comprobante', 'pedido', 'total', 'canal', 'documento', 'importe'];

            for (let i = 0; i < Math.min(20, trs.length); i++) {
                const cells = trs[i].querySelectorAll('td, th');
                const rowText = Array.from(cells).map(c => c.textContent.toLowerCase().trim()).join('|');
                let m = 0;
                for (const kw of kws) if (rowText.includes(kw)) m++;
                if (m > maxMatches && m >= 2) {
                    maxMatches = m;
                    headerIdx = i;
                }
            }

            if (headerIdx !== -1) {
                const headerCells = trs[headerIdx].querySelectorAll('td, th');
                const headers = Array.from(headerCells).map(c => c.textContent.trim().toLowerCase());

                for (let i = headerIdx + 1; i < trs.length; i++) {
                    const cells = trs[i].querySelectorAll('td, th');
                    if (cells.length === 0) continue;
                    const row = {};
                    cells.forEach((cell, idx) => {
                        if (idx < headers.length && headers[idx]) {
                            row[headers[idx]] = cell.textContent.trim();
                        }
                    });
                    if (Object.values(row).some(v => v !== '')) allResults.push(row);
                }
            }
        });
        return allResults;
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();
        const isCSV = fileName.endsWith('.csv') || fileName.endsWith('.txt');
        setIsSaving(true);

        if (isCSV) {
            import('papaparse').then(({ default: Papa }) => {
                Papa.parse(file, {
                    header: true, skipEmptyLines: true,
                    complete: async (results) => {
                        try { await processSalesRows(results.data); }
                        catch (err) { alert("Error al procesar el archivo CSV."); }
                        finally {
                            setIsSaving(false);
                            if (fileInputRef.current) fileInputRef.current.value = null;
                            setStartDate(s => s + "");
                        }
                    }
                });
            });
            return;
        }

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const isZip = data[0] === 0x50 && data[1] === 0x4B;
                const isCFB = data[0] === 0xD0 && data[1] === 0xCF;
                const isTextBased = !isZip && !isCFB;

                let allRawData = [];

                if (isTextBased) {
                    const text = new TextDecoder('windows-1252', { fatal: false }).decode(data);
                    allRawData = parseHTMLTable(text);
                    if (allRawData.length === 0) {
                        const { default: Papa } = await import('papaparse');
                        const result = Papa.parse(text, { header: true, skipEmptyLines: true });
                        allRawData = result.data;
                    }
                } else {
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                    for (let sheetName of workbook.SheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                        let hIdx = -1, maxM = 0;
                        const kws = ['fecha', 'pedido', 'total', 'canal', 'comprobante'];
                        for (let i = 0; i < Math.min(20, rows.length); i++) {
                            const rStr = rows[i].map(c => String(c).toLowerCase()).join('|');
                            let m = 0;
                            for (let kw of kws) if (rStr.includes(kw)) m++;
                            if (m > maxM && m >= 2) { maxM = m; hIdx = i; }
                        }
                        if (hIdx !== -1) {
                            const sData = XLSX.utils.sheet_to_json(sheet, { range: hIdx, raw: true, defval: '' });
                            allRawData = allRawData.concat(sData);
                        }
                    }
                }
                await processSalesRows(allRawData);
            } catch (err) {
                console.error("Error al procesar Excel:", err);
                alert("Hubo un error al procesar el archivo.");
            } finally {
                setIsSaving(false);
                if (fileInputRef.current) fileInputRef.current.value = null;
                setStartDate(s => s + "");
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const processSalesRows = async (data) => {
        if (data.length === 0) return;

        // Búsqueda inteligente evitando "Subtotales" o "Dsctos"
        const findValue = (row, possibleKeys) => {
            const keys = Object.keys(row);
            for (let pk of possibleKeys) {
                const exact = keys.find(k => k.trim().toLowerCase() === pk);
                if (exact) return row[exact];
            }
            for (let pk of possibleKeys) {
                const match = keys.find(k => {
                    const clean = k.trim().toLowerCase();
                    if (pk === 'total' && (clean.includes('sub') || clean.includes('dscto') || clean.includes('descuento') || clean.includes('neto'))) return false;
                    return clean.includes(pk);
                });
                if (match) return row[match];
            }
            return undefined;
        };

        // Detectar columna de estado (para excluir transacciones anuladas)
        const firstRow = data.find(r => r && typeof r === 'object') || {};
        const allKeys = Object.keys(firstRow);
        const estadoKey = allKeys.find(k => {
            const c = k.trim().toLowerCase();
            return c === 'estado' || c === 'status' || c === 'estado pedido' ||
                   c === 'estatus' || c === 'condicion' || c === 'condición' ||
                   c === 'tipo' || c === 'situacion' || c === 'situación';
        }) || null;
        if (estadoKey) console.log(`[SalesAnalysis] Columna de estado detectada: "${estadoKey}"`);

        const dailyAggregations = {};
        let debugSum = 0, debugRows = 0, debugSkipped = 0;

        data.forEach((fila, index) => {
            if (!fila || typeof fila !== 'object') return;

            // 1. Filtrar filas de resumen/subtotales que genera Inforest
            const rawValStr = Object.values(fila).join(' ').toLowerCase();
            if (
                rawValStr.includes('total general') ||
                rawValStr.includes('total reportado') ||
                rawValStr.includes('total periodo') ||
                rawValStr.includes('total por') ||
                rawValStr.includes('subtotal') ||
                rawValStr.includes('sub-total') ||
                rawValStr.includes('gran total') ||
                rawValStr.includes('total del') ||
                rawValStr.includes('resumen')
            ) { debugSkipped++; return; }

            // 2. Filtrar transacciones ANULADAS / CANCELADAS
            if (estadoKey) {
                const estadoVal = String(fila[estadoKey] || '').trim().toUpperCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (
                    estadoVal.includes('ANULAD') ||
                    estadoVal.includes('CANCELAD') ||
                    estadoVal.includes('VOID') ||
                    estadoVal.includes('NULO') ||
                    estadoVal.includes('INACTIV')
                ) {
                    console.log(`[SalesAnalysis] Fila ANULADA ignorada (fila ${index}):`, JSON.stringify(fila));
                    debugSkipped++;
                    return;
                }
            } else {
                // Sin columna de estado: detectar por texto en cualquier celda
                if (
                    rawValStr.includes('anulad') ||
                    rawValStr.includes('cancelad') ||
                    rawValStr.includes('void')
                ) {
                    console.log(`[SalesAnalysis] Fila posiblemente ANULADA ignorada (fila ${index}):`, JSON.stringify(fila));
                    debugSkipped++;
                    return;
                }
            }

            let pedidoRaw = String(findValue(fila, ['comprobante', 'nro comprobante', 'nro. comprobante', 'documento', 'ticket', 'pedido', 'correlativo', 'factura', 'boleta']) || '').trim();
            const fechaRaw = findValue(fila, ['fecha', 'fechapedido', 'fecha pedido', 'date', 'fec.', 'fecha/hora']);
            const horaRaw = findValue(fila, ['hora', 'time', 'horapedido', 'hr', 'hora pedido']);
            const totalRaw = findValue(fila, ['total', 'monto', 'venta', 'ventas', 'importe', 'bruto']);
            const canalRaw = findValue(fila, ['canal venta', 'canal vta', 'canal', 'canal de venta', 'tipo pedido', 'origen']);

            if (!fechaRaw || totalRaw === undefined || totalRaw === null || totalRaw === '') { debugSkipped++; return; }
            if (pedidoRaw.toLowerCase().includes("total pe") || pedidoRaw.toLowerCase().includes("total pedido")) { debugSkipped++; return; }

            if (!pedidoRaw) pedidoRaw = `UNK-ROW-${index}`;

            let numStr = String(totalRaw).replace(/[^\d.,-]/g, '');
            if (numStr.includes(',') && numStr.includes('.')) {
                if (numStr.indexOf(',') < numStr.indexOf('.')) numStr = numStr.replace(/,/g, '');
                else numStr = numStr.replace(/\./g, '').replace(',', '.');
            } else if (numStr.includes(',')) {
                numStr = numStr.replace(',', '.');
            }
            const monto = parseFloat(numStr);
            if (isNaN(monto) || monto === 0) { debugSkipped++; return; }

            let timeStr = "";
            let dateStr = "";

            if (fechaRaw instanceof Date) {
                dateStr = `${fechaRaw.getFullYear()}-${fechaRaw.getMonth() + 1}-${fechaRaw.getDate()}`;
                timeStr = `${fechaRaw.getHours()}:${fechaRaw.getMinutes()}:${fechaRaw.getSeconds()}`;
            } else {
                const cleanStr = String(fechaRaw).trim().replace(/\s+/g, ' ');
                if (cleanStr.includes(' ')) {
                    const parts = cleanStr.split(' ');
                    dateStr = parts[0];
                    if (!horaRaw) timeStr = parts.slice(1).join(' ');
                } else {
                    dateStr = cleanStr;
                }
                if (horaRaw) timeStr = String(horaRaw).trim();
            }

            let y, m, d;
            const partesFecha = dateStr.split(/[\/\-]/);
            if (partesFecha.length >= 3) {
                if (partesFecha[0].length === 4) {
                    y = parseInt(partesFecha[0], 10); m = parseInt(partesFecha[1], 10) - 1; d = parseInt(partesFecha[2], 10);
                } else {
                    d = parseInt(partesFecha[0], 10); m = parseInt(partesFecha[1], 10) - 1; y = parseInt(partesFecha[2], 10);
                    if (y < 100) y += 2000;
                }
            }

            let hh = 0, mm2 = 0, ss = 0;
            if (timeStr) {
                const tMatch = timeStr.match(/(\d+):(\d+)(?::(\d+))?\s*(a\.m\.|p\.m\.|am|pm)?/i);
                if (tMatch) {
                    hh = parseInt(tMatch[1], 10); mm2 = parseInt(tMatch[2], 10); ss = parseInt(tMatch[3] || 0, 10);
                    const modifier = tMatch[4] ? tMatch[4].toLowerCase() : null;
                    if (modifier && modifier.includes('p') && hh < 12) hh += 12;
                    if (modifier && modifier.includes('a') && hh === 12) hh = 0;
                }
            }

            let fechaObj = new Date(y, m, d, hh, mm2, ss);
            if (!fechaObj || isNaN(fechaObj.getTime())) return;

            let rawHours = fechaObj.getHours();

            let businessDate = new Date(fechaObj);
            if (rawHours < 6) businessDate.setDate(businessDate.getDate() - 1);

            const fecha = `${businessDate.getFullYear()}-${String(businessDate.getMonth() + 1).padStart(2, '0')}-${String(businessDate.getDate()).padStart(2, '0')}`;

            let canalRawStr = String(canalRaw || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
            let canal = 'SALÓN';

            if (canalRawStr.includes('DELIVERY') || canalRawStr.includes('RAPPI') || canalRawStr.includes('PEDIDOS YA') || canalRawStr.includes('PEDIDOSYA') || canalRawStr.includes('DIDI') || canalRawStr.includes('UBER') || canalRawStr.includes('CALL CENTER')) canal = 'DELIVERY';
            else if (canalRawStr.includes('DRIVE') || canalRawStr.includes('AUTO')) canal = 'DRIVE THRU';
            else if (canalRawStr.includes('FILA') || canalRawStr.includes('MODULO') || canalRawStr.includes('MÓDULO')) canal = 'SERV. FILA';
            else if (canalRawStr.includes('LOCAL') || canalRawStr.includes('SALON') || canalRawStr.includes('SALÓN')) canal = 'SALÓN';
            else if (canalRawStr !== '') canal = 'SALÓN';

            if (!dailyAggregations[fecha]) {
                dailyAggregations[fecha] = { totalSales: 0, hourlyData: {}, _pedidosGlobal: new Set(), _pedidosHoraCanal: {} };
            }

            const dayObj = dailyAggregations[fecha];

            // Deduplicar por número de comprobante:
            // Si ya procesamos este pedido en este mismo día, no sumarlo dos veces.
            // Las filas sin comprobante (UNK-ROW-*) siempre se cuentan.
            const esDesconocido = pedidoRaw.startsWith('UNK-ROW-');
            const esDuplicado = !esDesconocido && pedidoRaw !== '' && dayObj._pedidosGlobal.has(pedidoRaw);

            if (esDuplicado) {
                console.log(`[SalesAnalysis] Duplicado omitido: ${pedidoRaw} en ${fecha} (S/ ${monto.toFixed(2)})`);
                debugSkipped++;
                return;
            }

            dayObj.totalSales += monto;
            debugSum += monto;
            debugRows++;
            if (pedidoRaw) dayObj._pedidosGlobal.add(pedidoRaw);

            if (!dayObj.hourlyData[rawHours]) {
                dayObj.hourlyData[rawHours] = {};
                dayObj._pedidosHoraCanal[rawHours] = {};
            }
            dayObj.hourlyData[rawHours][canal] = (dayObj.hourlyData[rawHours][canal] || 0) + monto;

            if (!dayObj._pedidosHoraCanal[rawHours][canal]) dayObj._pedidosHoraCanal[rawHours][canal] = new Set();
            if (pedidoRaw) dayObj._pedidosHoraCanal[rawHours][canal].add(pedidoRaw);
        });

        console.log(`[SalesAnalysis] DIAGNÓSTICO DE PROCESAMIENTO:`);
        console.log(`  - Total filas en archivo: ${data.length}`);
        console.log(`  - Filas válidas procesadas: ${debugRows}`);
        console.log(`  - Filas ignoradas/saltadas: ${debugSkipped}`);
        console.log(`  - SUMA TOTAL CALCULADA: S/ ${debugSum.toFixed(2)}`);
        console.log(`  - Días operativos: ${Object.keys(dailyAggregations).length}`);
        Object.entries(dailyAggregations).forEach(([d, v]) => console.log(`    ${d}: S/ ${v.totalSales.toFixed(2)} (${v._pedidosGlobal.size} txs)`));

        let batch = writeBatch(db);
        let count = 0;
        for (const [date, dataRaw] of Object.entries(dailyAggregations)) {
            const dataToSave = {
                totalSales: dataRaw.totalSales,
                totalTxs: dataRaw._pedidosGlobal.size,
                hourlyData: dataRaw.hourlyData,
                hourlyTxs: {}
            };
            for (const hr in dataRaw._pedidosHoraCanal) {
                dataToSave.hourlyTxs[hr] = {};
                for (const cn in dataRaw._pedidosHoraCanal[hr]) {
                    dataToSave.hourlyTxs[hr][cn] = dataRaw._pedidosHoraCanal[hr][cn].size;
                }
            }

            const docRef = doc(db, 'stores', storeId, 'sales_history', date);
            batch.set(docRef, dataToSave, { merge: true });
            count++;
            if (count >= 490) {
                await batch.commit();
                batch = writeBatch(db); // Re-inicializar el batch
                count = 0;
            }
        }
        if (count > 0) await batch.commit();
        alert(`¡Datos guardados con éxito! Se reescribieron y consolidaron ${Object.keys(dailyAggregations).length} días.`);
    };

    const allCanales = CANALES_FIJOS;

    const AnalysisSection = ({ title, compareData, compareLabel, colorCompare, colorCurrent, viewMode }) => {
        if (!dataCurrent || !compareData) return null;
        const isTxs = viewMode === 'TXS';

        const chartCanal = allCanales.map(c => ({
            name: c,
            [compareLabel]: isTxs ? (compareData.canalesTxs[c] || 0) : parseFloat((compareData.canales[c] || 0).toFixed(2)),
            "PERIODO ACTUAL": isTxs ? (dataCurrent.canalesTxs[c] || 0) : parseFloat((dataCurrent.canales[c] || 0).toFixed(2))
        }));

        const chartTurno = TURNOS.map(t => ({
            name: t.key,
            [compareLabel]: isTxs ? (compareData.turnosTxs[t.key] || 0) : parseFloat((compareData.turnos[t.key] || 0).toFixed(2)),
            "PERIODO ACTUAL": isTxs ? (dataCurrent.turnosTxs[t.key] || 0) : parseFloat((dataCurrent.turnos[t.key] || 0).toFixed(2))
        }));

        const chartDia = DIAS_SEMANA.map((d, i) => {
            const realIdx = (i + 1) % 7;
            return {
                name: `${i + 1}. ${DIAS_SEMANA[realIdx]}`,
                [compareLabel]: isTxs ? (compareData.diasTxs[realIdx] || 0) : parseFloat((compareData.dias[realIdx] || 0).toFixed(2)),
                "PERIODO ACTUAL": isTxs ? (dataCurrent.diasTxs[realIdx] || 0) : parseFloat((dataCurrent.dias[realIdx] || 0).toFixed(2)),
                _realIdx: realIdx
            };
        });

        const calcVar = (act, ant) => {
            if (!ant || ant === 0) return { pct: 0, dif: act, color: 'text-gray-500', icon: '-' };
            const pct = ((act - ant) / ant) * 100;
            const dif = act - ant;
            const isPos = dif >= 0;
            return { pct, dif, color: isPos ? 'text-green-600' : 'text-red-600', icon: isPos ? '▲' : '▼' };
        };

        const totalAct = isTxs ? dataCurrent.txs : dataCurrent.total;
        const totalAnt = isTxs ? compareData.txs : compareData.total;
        const totalVar = calcVar(totalAct, totalAnt);

        return (
            <div className="mt-10 border-t border-gray-300 pt-8">
                <h2 className="text-xl font-black text-gray-800 mb-6 uppercase tracking-tight flex items-center gap-2">
                    <span className="bg-orange-500 w-2 h-6 rounded-sm"></span> VS {title}
                </h2>

                <div className="flex flex-col lg:flex-row gap-6">
                    <div className="w-full lg:w-72 shrink-0 space-y-4">
                        <div className="bg-black text-white p-4 rounded shadow-md border-l-4" style={{ borderLeftColor: colorCompare }}>
                            <p className="text-xs font-bold uppercase text-gray-400">{compareLabel}</p>
                            <p className="text-2xl font-black mt-1">{isTxs ? totalAnt : fmtMoney(totalAnt)}</p>
                        </div>
                        <div className="bg-black text-white p-4 rounded shadow-md border-l-4" style={{ borderLeftColor: colorCurrent }}>
                            <p className="text-xs font-bold uppercase text-gray-400">PERIODO ACTUAL</p>
                            <p className="text-2xl font-black mt-1">{isTxs ? totalAct : fmtMoney(totalAct)}</p>
                        </div>

                        <div className="bg-white border border-gray-200 shadow-sm text-xs">
                            <div className="bg-gray-100 font-bold p-2 border-b flex justify-between">
                                <span>VAR VS {title.split(' ')[0]}</span>
                                <span className="px-2 bg-white border text-[10px] rounded">(Todas)</span>
                            </div>
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-gray-500">
                                        <th className="text-left p-2 font-bold uppercase">CANAL</th>
                                        <th className="text-right p-2 font-bold uppercase">VAR</th>
                                        <th className="text-right p-2 font-bold uppercase">DIF {isTxs ? 'TXS' : 'S/.'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allCanales.map(c => {
                                        const act = isTxs ? (dataCurrent.canalesTxs[c] || 0) : (dataCurrent.canales[c] || 0);
                                        const ant = isTxs ? (compareData.canalesTxs[c] || 0) : (compareData.canales[c] || 0);
                                        const v = calcVar(act, ant);
                                        return (
                                            <tr key={c} className="border-b border-gray-50 hover:bg-gray-50">
                                                <td className="p-2 text-gray-700 font-semibold">{c}</td>
                                                <td className={`p-2 text-right font-bold ${v.color}`}>{v.icon} {fmtPct(v.pct)}</td>
                                                <td className={`p-2 text-right font-bold ${v.color}`}>{isTxs ? v.dif : fmtNum(v.dif)}</td>
                                            </tr>
                                        );
                                    })}
                                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                                        <td className="p-2 font-black text-gray-800">Total general</td>
                                        <td className={`p-2 text-right font-black ${totalVar.color}`}>{totalVar.icon} {fmtPct(totalVar.pct)}</td>
                                        <td className={`p-2 text-right font-black ${totalVar.color}`}>{isTxs ? totalVar.dif : fmtNum(totalVar.dif)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div className="bg-white border border-gray-200 shadow-sm text-xs">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-gray-500">
                                        <th className="text-left p-2 font-bold uppercase">TURNO</th>
                                        <th className="text-right p-2 font-bold uppercase">VAR</th>
                                        <th className="text-right p-2 font-bold uppercase">DIF {isTxs ? 'TXS' : 'S/.'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {TURNOS.map(t => {
                                        const act = isTxs ? (dataCurrent.turnosTxs[t.key] || 0) : (dataCurrent.turnos[t.key] || 0);
                                        const ant = isTxs ? (compareData.turnosTxs[t.key] || 0) : (compareData.turnos[t.key] || 0);
                                        const v = calcVar(act, ant);
                                        return (
                                            <tr key={t.key} className="border-b border-gray-50 hover:bg-gray-50">
                                                <td className="p-2 text-gray-700 italic">{t.key}</td>
                                                <td className={`p-2 text-right font-bold ${v.color}`}>{v.icon} {fmtPct(v.pct)}</td>
                                                <td className={`p-2 text-right font-bold ${v.color}`}>{isTxs ? v.dif : fmtNum(v.dif)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4">
                            <h3 className="text-center font-bold text-red-700 italic mb-2">{isTxs ? 'Transacciones por canal' : 'Ventas por canal'}</h3>
                            <div className="h-64 px-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartCanal} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                        <YAxis width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px' }} formatter={(val) => isTxs ? val : `S/ ${val.toLocaleString()}`} />
                                        <Bar dataKey={compareLabel} fill={colorCompare} />
                                        <Bar dataKey="PERIODO ACTUAL" fill={colorCurrent} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="mt-2 text-[10px] w-full overflow-x-auto border-t border-gray-200 px-2">
                                <table className="w-full text-center table-fixed">
                                    <thead>
                                        <tr className="border-b text-gray-500">
                                            <th className="p-1 border-r border-gray-100 bg-white" style={{ width: '100px' }}></th>
                                            {allCanales.map(c => <th key={c} className="p-1 font-bold border-r border-gray-100 uppercase truncate" title={c}>{c}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block" style={{ backgroundColor: colorCompare }}></span> {compareLabel}
                                            </td>
                                            {allCanales.map(c => {
                                                const val = isTxs ? (compareData.canalesTxs[c] || 0) : (compareData.canales[c] || 0);
                                                return <td key={c} className="p-1 border-r border-gray-100">{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                        <tr className="bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block" style={{ backgroundColor: colorCurrent }}></span> ACTUAL
                                            </td>
                                            {allCanales.map(c => {
                                                const val = isTxs ? (dataCurrent.canalesTxs[c] || 0) : (dataCurrent.canales[c] || 0);
                                                return <td key={c} className="p-1 border-r border-gray-100">{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4">
                            <h3 className="text-center font-bold text-red-700 italic mb-2">{isTxs ? 'Transacciones por turno' : 'Ventas por turno'}</h3>
                            <div className="h-64 px-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartTurno} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                        <YAxis width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px' }} formatter={(val) => isTxs ? val : `S/ ${val.toLocaleString()}`} />
                                        <Bar dataKey={compareLabel} fill={colorCompare} />
                                        <Bar dataKey="PERIODO ACTUAL" fill={colorCurrent} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="mt-2 text-[9px] w-full overflow-x-auto border-t border-gray-200 px-2">
                                <table className="w-full text-center table-fixed">
                                    <thead>
                                        <tr className="border-b text-gray-500">
                                            <th className="p-1 border-r border-gray-100 bg-white" style={{ width: '100px' }}></th>
                                            {TURNOS.map(t => <th key={t.key} className="p-1 font-bold border-r border-gray-100 uppercase leading-tight max-w-[60px] truncate" title={t.key}>{t.key}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block shrink-0" style={{ backgroundColor: colorCompare }}></span> {compareLabel.split(' ')[1] || 'ANT'}
                                            </td>
                                            {TURNOS.map(t => {
                                                const val = isTxs ? (compareData.turnosTxs[t.key] || 0) : (compareData.turnos[t.key] || 0);
                                                return <td key={t.key} className="p-1 border-r border-gray-100">{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                        <tr className="bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block shrink-0" style={{ backgroundColor: colorCurrent }}></span> ACT
                                            </td>
                                            {TURNOS.map(t => {
                                                const val = isTxs ? (dataCurrent.turnosTxs[t.key] || 0) : (dataCurrent.turnos[t.key] || 0);
                                                return <td key={t.key} className="p-1 border-r border-gray-100">{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4 xl:col-span-2 mt-4">
                            <h3 className="text-center font-bold text-red-700 italic mb-2">{isTxs ? 'Transacciones por día' : 'Ventas por día'}</h3>
                            <div className="h-64 px-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartDia} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                        <YAxis width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px' }} formatter={(val) => isTxs ? val : `S/ ${val.toLocaleString()}`} />
                                        <Bar dataKey={compareLabel} fill={colorCompare} />
                                        <Bar dataKey="PERIODO ACTUAL" fill={colorCurrent} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="mt-2 text-[10px] w-full overflow-x-auto border-t border-gray-200 px-2">
                                <table className="w-full text-center table-fixed">
                                    <thead>
                                        <tr className="border-b text-gray-500 bg-white">
                                            <th className="p-1 border-r border-gray-100" style={{ width: '100px' }}></th>
                                            {chartDia.map(d => <th key={d.name} className="p-1 font-bold border-r border-gray-100 uppercase">{d.name}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block shrink-0" style={{ backgroundColor: colorCompare }}></span> {compareLabel}
                                            </td>
                                            {chartDia.map(d => {
                                                const val = isTxs ? (compareData.diasTxs[d._realIdx] || 0) : (compareData.dias[d._realIdx] || 0);
                                                return <td key={d.name} className="p-1 border-r border-gray-100">{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                        <tr className="border-b bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block shrink-0" style={{ backgroundColor: colorCurrent }}></span> ACTUAL
                                            </td>
                                            {chartDia.map(d => {
                                                const val = isTxs ? (dataCurrent.diasTxs[d._realIdx] || 0) : (dataCurrent.dias[d._realIdx] || 0);
                                                return <td key={d.name} className="p-1 border-r border-gray-100">{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                        <tr className="border-b bg-gray-50">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-600 italic">VAR</td>
                                            {chartDia.map(d => {
                                                const act = isTxs ? (dataCurrent.diasTxs[d._realIdx] || 0) : (dataCurrent.dias[d._realIdx] || 0);
                                                const ant = isTxs ? (compareData.diasTxs[d._realIdx] || 0) : (compareData.dias[d._realIdx] || 0);
                                                const v = calcVar(act, ant);
                                                return <td key={d.name} className={`p-1 font-bold border-r border-gray-100 ${v.color}`}>{v.icon} {fmtPct(v.pct)}</td>
                                            })}
                                        </tr>
                                        <tr className="bg-gray-50">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-600 italic">DIF {isTxs ? 'TXS' : 'S/.'}</td>
                                            {chartDia.map(d => {
                                                const act = isTxs ? (dataCurrent.diasTxs[d._realIdx] || 0) : (dataCurrent.dias[d._realIdx] || 0);
                                                const ant = isTxs ? (compareData.diasTxs[d._realIdx] || 0) : (compareData.dias[d._realIdx] || 0);
                                                const v = calcVar(act, ant);
                                                return <td key={d.name} className={`p-1 font-bold border-r border-gray-100 ${v.color}`}>{isTxs ? v.dif : fmtNum(v.dif)}</td>
                                            })}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-[#f3f4f6] pb-20">
            {isSaving && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex flex-col items-center justify-center backdrop-blur-sm">
                    <div className="bg-white p-8 rounded shadow-2xl flex flex-col items-center gap-4 border-t-4 border-orange-500">
                        <div className="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent"></div>
                        <div className="text-center">
                            <p className="text-gray-800 font-extrabold text-xl">Procesando Historial...</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white border-b border-gray-200 shadow-sm px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/admin')} className="p-2 text-gray-500 hover:text-orange-600 transition-colors">
                        <ArrowLeft className="w-6 h-6" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 italic uppercase flex items-center gap-2">
                            COMPARATIVO VENTAS
                        </h1>
                        <p className="text-xs font-bold text-orange-500 bg-orange-100 px-2 py-0.5 inline-block rounded">Operadora LCPM</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <input type="file" accept=".csv,.xlsx,.xls" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2.5 rounded text-sm font-bold shadow-md shadow-orange-200 transition-colors flex items-center gap-2"
                    >
                        <Upload className="w-4 h-4" /> Cargar Excel Inforest
                    </button>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
                <div className="bg-white p-4 border border-gray-200 shadow-sm rounded flex flex-wrap items-end gap-6 mb-8">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Inicio</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-orange-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Fin</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-orange-500"
                        />
                    </div>

                    <div className="ml-auto flex bg-gray-100 p-1 rounded-md">
                        <button
                            onClick={() => setViewMode('VTA')}
                            className={`px-4 py-2 rounded text-sm font-bold transition-all ${viewMode === 'VTA' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Ventas (S/.)
                        </button>
                        <button
                            onClick={() => setViewMode('TXS')}
                            className={`px-4 py-2 rounded text-sm font-bold transition-all ${viewMode === 'TXS' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Transacciones
                        </button>
                    </div>
                </div>

                {dataCurrent && !loading && (
                    <div className="bg-white p-6 border border-gray-200 shadow-sm rounded flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
                        <div className="flex flex-col">
                            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Meta Acumulada</span>
                            <span className="text-2xl font-black text-gray-800">{fmtMoney(currentGoal)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Venta Real Acumulada</span>
                            <span className="text-2xl font-black text-orange-600">{fmtMoney(dataCurrent?.total || 0)}</span>
                        </div>
                        <div className="flex flex-col border-l border-gray-200 pl-6">
                            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Diferencia (Venta vs Meta)</span>
                            <div className="flex items-center gap-3">
                                {(() => {
                                    const dif = (dataCurrent?.total || 0) - currentGoal;
                                    const pct = currentGoal > 0 ? (dif / currentGoal) * 100 : 0;
                                    const isPos = dif >= 0;
                                    const colorClass = isPos ? 'text-green-600' : 'text-red-600';
                                    return (
                                        <>
                                            <span className={`text-2xl font-black ${colorClass}`}>
                                                {isPos ? '+' : ''}{fmtMoney(dif)}
                                            </span>
                                            <span className={`text-lg font-bold px-2 py-1 rounded bg-gray-50 ${colorClass}`}>
                                                {isPos ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
                                            </span>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center p-20">
                        <div className="animate-spin rounded-full h-10 w-10 border-4 border-orange-500 border-t-transparent"></div>
                    </div>
                ) : (dataCurrent && dataCurrent.total === 0 && dataPrevWeek.total === 0 && dataPrevYear.total === 0) ? (
                    <div className="bg-white p-12 text-center border border-gray-200 rounded">
                        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-gray-600">No hay datos en este rango</h2>
                        <p className="text-gray-500 mt-2">Sube un Excel de Inforest para poblar la base de datos.</p>
                    </div>
                ) : (
                    <>
                        <AnalysisSection
                            title="Semana Anterior"
                            compareData={dataPrevWeek}
                            compareLabel="SEM ANTERIOR"
                            colorCompare="#fcd34d"
                            colorCurrent="#f97316"
                            viewMode={viewMode}
                        />

                        <AnalysisSection
                            title="Año Anterior"
                            compareData={dataPrevYear}
                            compareLabel="AÑO ANTERIOR"
                            colorCompare="#d1d5db"
                            colorCurrent="#f97316"
                            viewMode={viewMode}
                        />
                    </>
                )}
            </div>

        </div>
    );
}

