import React, { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, writeBatch, collection, getDocs, query, orderBy, limit } from '../lib/supabase/firestoreCompat';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Upload, AlertCircle, Search, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts';
import { startOfISOWeek, endOfISOWeek, format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subDays } from 'date-fns';
import { parseCanonicalSalesRows } from '../lib/supabase/salesHistoryCompat';

const TURNOS = [
    { key: 'Apertura a 1pm', check: (h) => h >= 6 && h < 13 },
    { key: '1pm a 4pm', check: (h) => h >= 13 && h < 16 },
    { key: '4pm a 7pm', check: (h) => h >= 16 && h < 19 },
    { key: '7pm a 10pm', check: (h) => h >= 19 && h < 22 },
    { key: '10pm al cierre', check: (h) => h >= 22 || h < 6 }
];

const CANALES_FIJOS = ['SALÓN', 'DELIVERY', 'DRIVE THRU', 'SERV. FILA', 'SIN CLASIFICAR'];
const normalizeSalesChannel = (value) => {
    const normalized = String(value ?? '').trim().toLocaleUpperCase('es-PE');
    return CANALES_FIJOS.includes(normalized) ? normalized : 'SIN CLASIFICAR';
};
const DIAS_SEMANA = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
const DIAS_SEMANA_GETDAY = [1, 2, 3, 4, 5, 6, 0];

const addDays = (dateStr, days) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const subtractYear = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setFullYear(d.getFullYear() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getDatesInRange = (start, end) => {
    const dates = [];
    let curr = new Date(start + 'T12:00:00');
    const last = new Date(end + 'T12:00:00');
    while (curr <= last) {
        dates.push(`${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`);
        curr.setDate(curr.getDate() + 1);
    }
    return dates;
};

const getPreviousFullIsoWeekDates = (dateStr) => {
    const base = new Date(dateStr + 'T12:00:00');
    const day = base.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const previousMonday = new Date(base);
    previousMonday.setDate(base.getDate() + mondayOffset - 7);

    const previousSunday = new Date(previousMonday);
    previousSunday.setDate(previousMonday.getDate() + 6);

    const start = `${previousMonday.getFullYear()}-${String(previousMonday.getMonth() + 1).padStart(2, '0')}-${String(previousMonday.getDate()).padStart(2, '0')}`;
    const end = `${previousSunday.getFullYear()}-${String(previousSunday.getMonth() + 1).padStart(2, '0')}-${String(previousSunday.getDate()).padStart(2, '0')}`;
    return getDatesInRange(start, end);
};

const getSmartComparisonPeriod = (start, end) => {
    const startObj = new Date(`${start}T12:00:00`);
    const endObj = new Date(`${end}T12:00:00`);
    const isSameMonth =
        startObj.getFullYear() === endObj.getFullYear()
        && startObj.getMonth() === endObj.getMonth();
    const lastDayOfMonth = new Date(
        endObj.getFullYear(),
        endObj.getMonth() + 1,
        0
    ).getDate();
    const isFullMonth = isSameMonth && startObj.getDate() === 1 && endObj.getDate() === lastDayOfMonth;
    const currentDates = getDatesInRange(start, end);

    if (isFullMonth) {
        const previousMonthStart = new Date(startObj.getFullYear(), startObj.getMonth() - 1, 1);
        const previousMonthEnd = new Date(startObj.getFullYear(), startObj.getMonth(), 0);
        const previousStart = format(previousMonthStart, 'yyyy-MM-dd');
        const previousEnd = format(previousMonthEnd, 'yyyy-MM-dd');
        return {
            dates: getDatesInRange(previousStart, previousEnd),
            title: 'Mes Anterior',
            label: 'MES ANTERIOR',
        };
    }

    if (isSameMonth) {
        const previousMonthStart = new Date(startObj.getFullYear(), startObj.getMonth() - 1, startObj.getDate());
        const previousMonthEnd = new Date(endObj.getFullYear(), endObj.getMonth() - 1, endObj.getDate());
        const previousStart = format(previousMonthStart, 'yyyy-MM-dd');
        const previousEnd = format(previousMonthEnd, 'yyyy-MM-dd');
        return {
            dates: getDatesInRange(previousStart, previousEnd),
            title: 'Mes Anterior (Mismo Rango)',
            label: 'MES ANTERIOR',
        };
    }

    if (currentDates.length === 7) {
        return {
            dates: getPreviousFullIsoWeekDates(start),
            title: 'Semana Anterior',
            label: 'SEM ANTERIOR',
        };
    }

    const previousEnd = addDays(start, -1);
    const previousStart = addDays(previousEnd, -(currentDates.length - 1));
    return {
        dates: getDatesInRange(previousStart, previousEnd),
        title: 'Periodo Anterior',
        label: 'PERIODO ANTERIOR',
    };
};

const recoverLegacyXlsRows = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (o) => view.getUint16(o, true);
    const u32 = (o) => view.getUint32(o, true);
    const i32 = (o) => view.getInt32(o, true);
    const END_OF_CHAIN = -2;
    const sectorSize = 1 << u16(30);
    const fatCount = u32(44);
    const firstDir = i32(48);
    const sectorOffset = (sid) => (sid + 1) * sectorSize;

    const fatSectors = [];
    for (let i = 0; i < 109; i++) {
        const sid = i32(76 + i * 4);
        if (sid >= 0) fatSectors.push(sid);
    }

    const fat = [];
    fatSectors.slice(0, fatCount).forEach((sid) => {
        const off = sectorOffset(sid);
        if (off < 0 || off + sectorSize > bytes.length) return;
        for (let p = 0; p < sectorSize; p += 4) {
            fat.push(view.getInt32(off + p, true));
        }
    });

    const readChain = (startSid, maxBytes = Number.MAX_SAFE_INTEGER) => {
        const chunks = [];
        const seen = new Set();
        let sid = startSid;
        let total = 0;
        while (sid >= 0 && sid !== END_OF_CHAIN && !seen.has(sid) && total < maxBytes) {
            seen.add(sid);
            const off = sectorOffset(sid);
            if (off < 0 || off >= bytes.length) break;
            const take = Math.min(sectorSize, bytes.length - off, maxBytes - total);
            chunks.push(bytes.slice(off, off + take));
            total += take;
            sid = fat[sid];
        }
        const out = new Uint8Array(total);
        let cursor = 0;
        chunks.forEach((chunk) => {
            out.set(chunk, cursor);
            cursor += chunk.length;
        });
        return out;
    };

    const decodeUtf16 = (arr) => new TextDecoder('utf-16le', { fatal: false }).decode(arr);
    const dir = readChain(firstDir, 1024 * 1024);
    const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    let workbookEntry = null;
    for (let off = 0; off + 128 <= dir.length; off += 128) {
        const nameLen = dirView.getUint16(off + 64, true);
        if (nameLen < 2 || nameLen > 64) continue;
        const name = decodeUtf16(dir.slice(off, off + nameLen - 2));
        const type = dir[off + 66];
        if (type !== 2 || !/^(workbook|book)$/i.test(name)) continue;
        workbookEntry = {
            start: dirView.getInt32(off + 116, true),
            size: Number(dirView.getBigUint64(off + 120, true))
        };
        break;
    }
    if (!workbookEntry) return [];

    const stream = readChain(workbookEntry.start, workbookEntry.size);
    const streamView = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    const records = [];
    for (let off = 0; off + 4 <= stream.length;) {
        const rt = streamView.getUint16(off, true);
        const len = streamView.getUint16(off + 2, true);
        if (off + 4 + len > stream.length) break;
        records.push({ rt, data: stream.slice(off + 4, off + 4 + len) });
        off += 4 + len;
    }

    const decodeLatin = (arr) => new TextDecoder('windows-1252', { fatal: false }).decode(arr);
    const parseSst = () => {
        const idx = records.findIndex((r) => r.rt === 0x00FC);
        if (idx === -1) return [];
        const chunks = [records[idx].data];
        for (let j = idx + 1; j < records.length && records[j].rt === 0x003C; j++) {
            chunks.push(records[j].data);
        }
        let ci = 0;
        let pos = 0;
        const read = (n) => {
            const out = new Uint8Array(n);
            let k = 0;
            while (k < n) {
                if (ci >= chunks.length) throw new Error('SST incompleto');
                const chunk = chunks[ci];
                if (pos >= chunk.length) {
                    ci++;
                    pos = 0;
                    continue;
                }
                const take = Math.min(chunk.length - pos, n - k);
                out.set(chunk.slice(pos, pos + take), k);
                pos += take;
                k += take;
            }
            return out;
        };
        const readU8 = () => read(1)[0];
        const readU16 = () => new DataView(read(2).buffer).getUint16(0, true);
        const readU32 = () => new DataView(read(4).buffer).getUint32(0, true);
        const skip = (n) => { if (n > 0) read(n); };

        readU32();
        const unique = readU32();
        const strings = [];
        for (let i = 0; i < unique; i++) {
            try {
                const cch = readU16();
                const flags = readU8();
                const is16 = (flags & 1) !== 0;
                const rich = (flags & 8) !== 0;
                const ext = (flags & 4) !== 0;
                const richRuns = rich ? readU16() : 0;
                const extLen = ext ? readU32() : 0;
                const raw = read(cch * (is16 ? 2 : 1));
                strings.push(is16 ? decodeUtf16(raw) : decodeLatin(raw));
                skip(richRuns * 4);
                skip(extLen);
            } catch {
                break;
            }
        }
        return strings;
    };

    const sst = parseSst();
    const rkNumber = (rk) => {
        let value;
        if (rk & 0x02) {
            value = rk >> 2;
        } else {
            const buf = new ArrayBuffer(8);
            const dv = new DataView(buf);
            dv.setUint32(4, rk & 0xfffffffc, true);
            value = dv.getFloat64(0, true);
        }
        return (rk & 0x01) ? value / 100 : value;
    };

    let sheetNo = -1;
    const rowMap = {};
    records.forEach((record) => {
        const data = record.data;
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (record.rt === 0x0809 && data.length >= 4 && dv.getUint16(2, true) === 0x0010) {
            sheetNo++;
        }
        if (sheetNo < 0 || sheetNo > 0) return;
        const setCell = (r, c, value) => {
            if (!rowMap[r]) rowMap[r] = {};
            rowMap[r][c] = value;
        };
        if (record.rt === 0x00FD && data.length >= 10) {
            const r = dv.getUint16(0, true);
            const c = dv.getUint16(2, true);
            const ix = dv.getUint32(6, true);
            setCell(r, c, sst[ix] ?? `#SST${ix}`);
        } else if (record.rt === 0x0203 && data.length >= 14) {
            setCell(dv.getUint16(0, true), dv.getUint16(2, true), dv.getFloat64(6, true));
        } else if (record.rt === 0x027E && data.length >= 10) {
            setCell(dv.getUint16(0, true), dv.getUint16(2, true), rkNumber(dv.getInt32(6, true)));
        } else if (record.rt === 0x00BE && data.length >= 6) {
            const r = dv.getUint16(0, true);
            const firstCol = dv.getUint16(2, true);
            const lastCol = dv.getUint16(4, true);
            let p = 6;
            for (let c = firstCol; c <= lastCol && p + 6 <= data.length; c++, p += 6) {
                setCell(r, c, rkNumber(dv.getInt32(p, true)));
            }
        }
    });

    const rows = Object.keys(rowMap)
        .map(Number)
        .sort((a, b) => a - b)
        .map((r) => {
            const row = rowMap[r];
            const max = Math.max(...Object.keys(row).map(Number));
            return Array.from({ length: max + 1 }, (_, i) => row[i] ?? '');
        });

    const headerKeywords = ['pedido', 'fecha', 'monto', 'documento', 'canal'];
    let headerIdx = -1;
    let bestScore = 0;
    rows.forEach((row, idx) => {
        const text = row.map((cell) => String(cell).toLowerCase()).join('|');
        const score = headerKeywords.reduce((acc, kw) => acc + (text.includes(kw) ? 1 : 0), 0);
        if (score > bestScore && score >= 3) {
            bestScore = score;
            headerIdx = idx;
        }
    });
    if (headerIdx === -1) return [];

    const headers = rows[headerIdx].map((h) => String(h || '').trim().toLowerCase());
    const fechaIdx = headers.findIndex((h) => h.includes('fecha') && h.includes('hora'));
    const rawText = decodeUtf16(bytes);
    const rawDates = [...rawText.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g)].map((m) => m[0]);
    const datePlaceholders = new Map();

    return rows.slice(headerIdx + 1).map((row) => {
        const normalized = [...row];
        if (fechaIdx >= 0) {
            const current = String(normalized[fechaIdx] || '');
            if (current.startsWith('#SST')) {
                if (!datePlaceholders.has(current)) {
                    datePlaceholders.set(current, rawDates[datePlaceholders.size] || '');
                }
                normalized[fechaIdx] = datePlaceholders.get(current);
            }
        }
        const obj = {};
        normalized.forEach((cell, idx) => {
            const key = headers[idx];
            if (key) obj[key] = cell;
        });
        return obj;
    }).filter((row) => Object.values(row).some((value) => value !== '' && value !== null && value !== undefined));
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
    const [dataPrevMonth, setDataPrevMonth] = useState(null);
    const [previousPeriodMeta, setPreviousPeriodMeta] = useState({
        title: 'Semana Anterior',
        label: 'SEM ANTERIOR',
    });
    const [dataPrevYear, setDataPrevYear] = useState(null);
    const [currentGoal, setCurrentGoal] = useState(0);
    const [viewMode, setViewMode] = useState('VTA');
    const [selectedHourlyTxsDay, setSelectedHourlyTxsDay] = useState('all');
    const [dateError, setDateError] = useState('');
    const [selectedCanalDetail, setSelectedCanalDetail] = useState(null);
    const [selectedDayDetail, setSelectedDayDetail] = useState(null);
    const [comparePeriod, setComparePeriod] = useState('week');
    const [availableRange, setAvailableRange] = useState({ min: null, max: null });
    const [lastUploadInfo, setLastUploadInfo] = useState(null);
    const [activeQuickFilter, setActiveQuickFilter] = useState('week');
    const [dataRevision, setDataRevision] = useState(0);

    useEffect(() => {
        const fetchStore = async () => {
            if (!currentUser) return;
            try {
                const snap = await getDoc(doc(db, 'users', currentUser.uid));
                if (snap.exists()) setStoreId(snap.data().storeId || '');
            } catch (error) {
                console.error("Error cargando tienda del usuario:", error);
            }
        };
        fetchStore();
    }, [currentUser, db]);

    const fetchAvailableRange = async (targetStoreId = storeId) => {
        if (!targetStoreId) return null;
        try {
            const salesRef = collection(db, 'stores', targetStoreId, 'sales_history');
            const firstQ = query(salesRef, orderBy('__name__'), limit(1));
            const lastQ = query(salesRef, orderBy('__name__', 'desc'), limit(1));
            const [firstSnap, lastSnap] = await Promise.all([getDocs(firstQ), getDocs(lastQ)]);
            const min = firstSnap.docs[0]?.id || null;
            const max = lastSnap.docs[0]?.id || null;
            setAvailableRange({ min, max });
            return { min, max };
        } catch (err) {
            console.error("Error detectando rango disponible:", err);
            return null;
        }
    };

    useEffect(() => {
        if (storeId) fetchAvailableRange(storeId);
    }, [storeId]);

    const todayStr = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const applyQuickFilter = (key) => {
        const today = new Date();
        let start, end;
        switch (key) {
            case 'today':
                start = end = todayStr();
                break;
            case 'yesterday':
                start = end = format(subDays(today, 1), 'yyyy-MM-dd');
                break;
            case 'week':
                start = format(startOfISOWeek(today), 'yyyy-MM-dd');
                end = format(endOfISOWeek(today), 'yyyy-MM-dd');
                break;
            case 'prevWeek': {
                const prev = subDays(today, 7);
                start = format(startOfISOWeek(prev), 'yyyy-MM-dd');
                end = format(endOfISOWeek(prev), 'yyyy-MM-dd');
                break;
            }
            case 'month':
                start = format(startOfMonth(today), 'yyyy-MM-dd');
                end = format(endOfMonth(today), 'yyyy-MM-dd');
                break;
            case 'prevMonth': {
                const prev = subMonths(today, 1);
                start = format(startOfMonth(prev), 'yyyy-MM-dd');
                end = format(endOfMonth(prev), 'yyyy-MM-dd');
                break;
            }
            case 'year':
                start = format(startOfYear(today), 'yyyy-MM-dd');
                end = format(endOfYear(today), 'yyyy-MM-dd');
                break;
            case 'all':
                if (!availableRange.min || !availableRange.max) return;
                start = availableRange.min;
                end = availableRange.max;
                break;
            default:
                return;
        }
        setActiveQuickFilter(key);
        setStartDate(start);
        setEndDate(end);
        setDateError('');
    };

    const loadAnalysisData = async () => {
        if (!storeId || !startDate || !endDate) return;
        if (startDate > endDate) {
            setDateError("La fecha de inicio no puede ser mayor a la fecha de fin.");
            return;
        }
        setDateError('');
        setLoading(true);
        try {
            const currentDates = getDatesInRange(startDate, endDate);
            const smartComparison = getSmartComparisonPeriod(startDate, endDate);
            const prevWeekDates = currentDates.map(d => addDays(d, -7));

            setPreviousPeriodMeta({
                title: smartComparison.title,
                label: smartComparison.label,
            });

            const prevMonthDates = currentDates.map(d => {
                const date = new Date(d + 'T12:00:00');
                date.setMonth(date.getMonth() - 1);
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            });
            const prevYearDates = currentDates.map(d => subtractYear(d));

            const compareDatesMap = {
                week: prevWeekDates,
                month: prevMonthDates,
                year: prevYearDates
            };

            const fetchRange = async (datesArr) => {
                const results = await Promise.all(datesArr.map(d => getDoc(doc(db, 'stores', storeId, 'sales_history', d))));
                const agg = {
                    total: 0, txs: 0,
                    rowCount: 0,
                    canales: {}, canalesTxs: {}, turnos: {}, turnosTxs: {}, dias: {}, diasTxs: {},
                    horasTxs: {}, horasTxsPorDia: {},
                    canalesHoras: {}, canalesHorasTxs: {}, canalesDias: {}, canalesDiasTxs: {},
                    canalesHorasPorFecha: {}, canalesHorasTxsPorFecha: {},
                    ventasPorFecha: {}, txsPorFecha: {}
                };

                TURNOS.forEach(t => { agg.turnos[t.key] = 0; agg.turnosTxs[t.key] = 0; });
                DIAS_SEMANA.forEach((_, idx) => { agg.dias[idx] = 0; agg.diasTxs[idx] = 0; });
                Array.from({ length: 24 }, (_, hour) => { agg.horasTxs[hour] = 0; });
                DIAS_SEMANA.forEach((_, dayIndex) => {
                    agg.horasTxsPorDia[dayIndex] = {};
                    Array.from({ length: 24 }, (_, hour) => {
                        agg.horasTxsPorDia[dayIndex][hour] = 0;
                    });
                });
                CANALES_FIJOS.forEach(c => {
                    agg.canalesHoras[c] = {};
                    agg.canalesHorasTxs[c] = {};
                    agg.canalesDias[c] = {};
                    agg.canalesDiasTxs[c] = {};
                    agg.canalesHorasPorFecha[c] = {};
                    agg.canalesHorasTxsPorFecha[c] = {};
                    Array.from({ length: 24 }, (_, hour) => {
                        agg.canalesHoras[c][hour] = 0;
                        agg.canalesHorasTxs[c][hour] = 0;
                    });
                    DIAS_SEMANA.forEach((_, dayIndex) => {
                        agg.canalesDias[c][dayIndex] = 0;
                        agg.canalesDiasTxs[c][dayIndex] = 0;
                    });
                });

                results.forEach((snap, idx) => {
                    if (snap.exists()) {
                        const dayData = snap.data();
                        agg.rowCount += 1;
                        agg.total += dayData.totalSales || 0;
                        agg.txs += dayData.totalTxs || 0;

                        const dateObj = new Date(datesArr[idx] + 'T12:00:00');
                        const dow = dateObj.getDay();
                        agg.dias[dow] += dayData.totalSales || 0;
                        agg.diasTxs[dow] += dayData.totalTxs || 0;

                        agg.ventasPorFecha[datesArr[idx]] = dayData.totalSales || 0;
                        agg.txsPorFecha[datesArr[idx]] = dayData.totalTxs || 0;

                        if (dayData.hourlyData) {
                            Object.entries(dayData.hourlyData).forEach(([hourStr, canalData]) => {
                                const hour = parseInt(hourStr, 10);
                                let sumHour = 0, sumHourTxs = 0;

                                Object.entries(canalData).forEach(([rawCanal, rawValue]) => {
                                    const canal = normalizeSalesChannel(rawCanal);
                                    const val = Number(rawValue) || 0;
                                    if (!agg.canales[canal]) agg.canales[canal] = 0;
                                    agg.canales[canal] += val;
                                    sumHour += val;

                                    const txsVal = Number(dayData.hourlyTxs?.[hourStr]?.[rawCanal]) || 0;
                                    if (!agg.canalesTxs[canal]) agg.canalesTxs[canal] = 0;
                                    agg.canalesTxs[canal] += txsVal;
                                    sumHourTxs += txsVal;

                                    agg.canalesHoras[canal][hour] = (agg.canalesHoras[canal][hour] || 0) + val;
                                    agg.canalesHorasTxs[canal][hour] = (agg.canalesHorasTxs[canal][hour] || 0) + txsVal;
                                    agg.canalesDias[canal][dow] = (agg.canalesDias[canal][dow] || 0) + val;
                                    agg.canalesDiasTxs[canal][dow] = (agg.canalesDiasTxs[canal][dow] || 0) + txsVal;

                                    if (!agg.canalesHorasPorFecha[canal][datesArr[idx]]) {
                                        agg.canalesHorasPorFecha[canal][datesArr[idx]] = {};
                                        agg.canalesHorasTxsPorFecha[canal][datesArr[idx]] = {};
                                    }
                                    agg.canalesHorasPorFecha[canal][datesArr[idx]][hour] = (agg.canalesHorasPorFecha[canal][datesArr[idx]][hour] || 0) + val;
                                    agg.canalesHorasTxsPorFecha[canal][datesArr[idx]][hour] = (agg.canalesHorasTxsPorFecha[canal][datesArr[idx]][hour] || 0) + txsVal;
                                });

                                const turnoObj = TURNOS.find(t => t.check(hour));
                                agg.horasTxs[hour] = (agg.horasTxs[hour] || 0) + sumHourTxs;
                                agg.horasTxsPorDia[dow][hour] =
                                    (agg.horasTxsPorDia[dow][hour] || 0) + sumHourTxs;
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

            const [resCurr, resPrev, resPrevMonth, resYear, goal] = await Promise.all([
                fetchRange(currentDates), fetchRange(prevWeekDates), fetchRange(prevMonthDates), fetchRange(prevYearDates), fetchConfig()
            ]);

            setDataCurrent(resCurr);
            setDataPrevWeek(resPrev);
            setDataPrevMonth(resPrevMonth);
            setDataPrevYear(resYear);
            setCurrentGoal(goal);

            setPreviousPeriodMeta(
                comparePeriod === 'month'
                    ? { title: 'Mes Anterior', label: 'MES ANTERIOR' }
                    : comparePeriod === 'year'
                    ? { title: 'Año Anterior', label: 'AÑO ANTERIOR' }
                    : { title: 'Semana Anterior', label: 'SEM ANTERIOR' }
            );
        } catch (err) {
            console.error("Error fetching data", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!storeId || !startDate || !endDate) return;
        if (startDate > endDate) return;
        const t = setTimeout(() => { loadAnalysisData(); }, 350);
        return () => clearTimeout(t);
    }, [storeId, comparePeriod, startDate, endDate, dataRevision]);

    useEffect(() => {
        if (comparePeriod === 'month') {
            setPreviousPeriodMeta({ title: 'Mes Anterior', label: 'MES ANTERIOR' });
        } else if (comparePeriod === 'year') {
            setPreviousPeriodMeta({ title: 'Año Anterior', label: 'AÑO ANTERIOR' });
        } else {
            setPreviousPeriodMeta({ title: 'Semana Anterior', label: 'SEM ANTERIOR' });
        }
    }, [comparePeriod, startDate, endDate]);

    const parseHTMLTable = (text) => {
        const parser = new DOMParser();
        const docHtml = parser.parseFromString(text, 'text/html');
        const tables = docHtml.querySelectorAll('table');
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
        if (!storeId) {
            alert("No se pudo identificar la tienda. Espera unos segundos y vuelve a intentar. Si el problema continúa, revisa la conexión a internet.");
            if (fileInputRef.current) fileInputRef.current.value = null;
            return;
        }

        const fileName = file.name.toLowerCase();
        const isCSV = fileName.endsWith('.csv') || fileName.endsWith('.txt');
        setIsSaving(true);

        if (isCSV) {
            import('papaparse').then(({ default: Papa }) => {
                Papa.parse(file, {
                    header: true, skipEmptyLines: true,
                    complete: async (results) => {
                        try { await processSalesRows(results.data); }
                        catch (err) { alert(err?.message || "Error al procesar el archivo CSV."); }
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
                    try {
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
                    } catch (xlsxError) {
                        console.warn("Lectura XLS estándar falló. Intentando recuperación BIFF:", xlsxError);
                        allRawData = recoverLegacyXlsRows(data);
                    }
                }
                if (allRawData.length === 0) {
                    throw new Error("No se encontraron filas de ventas en el archivo.");
                }
                await processSalesRows(allRawData);
            } catch (err) {
                console.error("Error al procesar Excel:", err);
                alert(err?.message || "Hubo un error al procesar el archivo.");
            } finally {
                setIsSaving(false);
                if (fileInputRef.current) fileInputRef.current.value = null;
                setStartDate(s => s + "");
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const processSalesRows = async (data) => {
        if (!storeId) {
            throw new Error("No se pudo identificar la tienda para guardar el historial de ventas.");
        }
        if (!Array.isArray(data) || data.length === 0) return;

        const parsed = parseCanonicalSalesRows(data);
        if (parsed.history.length === 0) {
            throw new Error("No se encontraron pedidos válidos con fecha, hora, documento y monto para guardar.");
        }
        if (parsed.history.length > 1000) {
            throw new Error("El archivo supera el máximo seguro de 1000 días por carga. Divídelo en dos archivos para conservar cada carga atómica.");
        }

        const batch = writeBatch(db);
        for (const day of parsed.history) {
            batch.set(doc(db, 'stores', storeId, 'sales_history', day.date), {
                totalSales: day.totalSales,
                totalTxs: day.totalTxs,
                hourlyData: day.hourlyData,
                hourlyTxs: day.hourlyTxs,
            });
        }
        await batch.commit();

        const min = parsed.dates[0];
        const max = parsed.dates[parsed.dates.length - 1];
        setLastUploadInfo({
            min,
            max,
            dias: parsed.dates.length,
            ventas: parsed.totalSales,
            txs: parsed.totalTxs,
        });
        setStartDate(min);
        setEndDate(max);
        setActiveQuickFilter(null);
        await fetchAvailableRange(storeId);
        setDataRevision(revision => revision + 1);

        alert(`¡Datos procesados con éxito!\n\nRango detectado: ${min} a ${max}\nDías cargados: ${parsed.dates.length}\nVenta Total Verificada: S/ ${parsed.totalSales.toLocaleString('es-PE', { minimumFractionDigits: 2 })}\nTransacciones Finales: ${parsed.totalTxs}`);
    };
    const allCanales = CANALES_FIJOS;

    const AnalysisSection = ({ title, compareData, compareLabel, colorCompare, colorCurrent, viewMode, showHourlyChart = false }) => {
        if (!dataCurrent || !compareData) return null;
        const isTxs = viewMode === 'TXS';

        const getTurnosByCanal = (data, canal) => {
            if (!canal) {
                return TURNOS.map(t => ({
                    name: t.key,
                    value: isTxs ? (data.turnosTxs[t.key] || 0) : (data.turnos[t.key] || 0)
                }));
            }
            return TURNOS.map(t => {
                let sum = 0;
                for (let h = 0; h < 24; h++) {
                    if (t.check(h)) {
                        sum += isTxs ? (data.canalesHorasTxs[canal]?.[h] || 0) : (data.canalesHoras[canal]?.[h] || 0);
                    }
                }
                return {
                    name: t.key,
                    value: sum
                };
            });
        };

        const getDayDetails = () => {
            if (selectedDayDetail === null) return null;

            const targetDayOfWeek = DIAS_SEMANA_GETDAY[selectedDayDetail];
            const currentDates = getDatesInRange(startDate, endDate);
            const compareDates = comparePeriod === 'month' ? currentDates.map(d => {
                const date = new Date(d + 'T12:00:00');
                date.setMonth(date.getMonth() - 1);
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            }) : comparePeriod === 'year' ? currentDates.map(d => subtractYear(d)) : currentDates.map(d => addDays(d, -7));

            let currentSum = 0, currentCount = 0, compareSum = 0, compareCount = 0;
            const currentDayData = [];
            const compareDayData = [];

            currentDates.forEach((d) => {
                const dateObj = new Date(d + 'T12:00:00');
                if (dateObj.getDay() === targetDayOfWeek) {
                    const val = isTxs ? (dataCurrent.txsPorFecha[d] || 0) : (dataCurrent.ventasPorFecha[d] || 0);
                    currentSum += val;
                    currentCount++;
                    currentDayData.push({ fecha: d, valor: val });
                }
            });

            compareDates.forEach((d) => {
                const dateObj = new Date(d + 'T12:00:00');
                if (dateObj.getDay() === targetDayOfWeek) {
                    const val = isTxs ? (compareData.txsPorFecha[d] || 0) : (compareData.ventasPorFecha[d] || 0);
                    compareSum += val;
                    compareCount++;
                    compareDayData.push({ fecha: d, valor: val });
                }
            });

            const currentAvg = currentCount > 0 ? currentSum / currentCount : 0;
            const compareAvg = compareCount > 0 ? compareSum / compareCount : 0;
            const diff = currentAvg - compareAvg;
            const pct = compareAvg > 0 ? (diff / compareAvg) * 100 : 0;

            const canalesBreakdown = allCanales.map(canal => {
                const currentCanalData = isTxs
                    ? (dataCurrent.canalesDiasTxs[canal] || {})
                    : (dataCurrent.canalesDias[canal] || {});
                const compareCanalData = isTxs
                    ? (compareData.canalesDiasTxs[canal] || {})
                    : (compareData.canalesDias[canal] || {});

                const currentVal = currentCanalData[targetDayOfWeek] || 0;
                const compareVal = compareCanalData[targetDayOfWeek] || 0;
                const canalDiff = currentVal - compareVal;
                const canalPct = compareVal > 0 ? (canalDiff / compareVal) * 100 : 0;

                return {
                    canal,
                    currentVal,
                    compareVal,
                    diff: canalDiff,
                    pct: canalPct
                };
            }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

            const sumHorasCanalFecha = (dataObj, canal, fecha) => {
                if (!dataObj) return 0;
                const src = isTxs
                    ? (dataObj.canalesHorasTxsPorFecha?.[canal]?.[fecha] || {})
                    : (dataObj.canalesHorasPorFecha?.[canal]?.[fecha] || {});
                let total = 0;
                for (const h in src) total += src[h] || 0;
                return total;
            };

            const fechaCanalBreakdown = currentDayData.map(({ fecha }) => {
                const canales = {};
                let total = 0;
                allCanales.forEach(canal => {
                    const v = sumHorasCanalFecha(dataCurrent, canal, fecha);
                    canales[canal] = v;
                    total += v;
                });
                return { fecha, canales, total };
            });

            const canalTotalsActual = {};
            const canalTotalsCompare = {};
            allCanales.forEach(c => { canalTotalsActual[c] = 0; canalTotalsCompare[c] = 0; });
            currentDayData.forEach(({ fecha }) => {
                allCanales.forEach(c => { canalTotalsActual[c] += sumHorasCanalFecha(dataCurrent, c, fecha); });
            });
            compareDayData.forEach(({ fecha }) => {
                allCanales.forEach(c => { canalTotalsCompare[c] += sumHorasCanalFecha(compareData, c, fecha); });
            });

            return {
                dayName: DIAS_SEMANA[selectedDayDetail],
                currentDayData,
                compareDayData,
                currentAvg,
                compareAvg,
                diff,
                pct,
                canalesBreakdown,
                fechaCanalBreakdown,
                canalTotalsActual,
                canalTotalsCompare,
            };
        };

        const chartCanal = allCanales.map(c => ({
            name: c,
            [compareLabel]: isTxs ? (compareData.canalesTxs[c] || 0) : parseFloat((compareData.canales[c] || 0).toFixed(2)),
            "PERIODO ACTUAL": isTxs ? (dataCurrent.canalesTxs[c] || 0) : parseFloat((dataCurrent.canales[c] || 0).toFixed(2))
        }));

        const getChartTurno = () => {
            if (selectedCanalDetail) {
                const horasData = isTxs ? (dataCurrent.canalesHorasTxs[selectedCanalDetail] || {}) : (dataCurrent.canalesHoras[selectedCanalDetail] || {});
                const horasDataCompare = isTxs ? (compareData.canalesHorasTxs[selectedCanalDetail] || {}) : (compareData.canalesHoras[selectedCanalDetail] || {});

                return TURNOS.map(t => {
                    let current = 0, compare = 0;
                    for (let h = 0; h < 24; h++) {
                        if (t.check(h)) {
                            current += horasData[h] || 0;
                            compare += horasDataCompare[h] || 0;
                        }
                    }
                    return {
                        name: t.key,
                        [compareLabel]: compare,
                        "PERIODO ACTUAL": current
                    };
                });
            }
            return TURNOS.map(t => ({
                name: t.key,
                [compareLabel]: isTxs ? (compareData.turnosTxs[t.key] || 0) : parseFloat((compareData.turnos[t.key] || 0).toFixed(2)),
                "PERIODO ACTUAL": isTxs ? (dataCurrent.turnosTxs[t.key] || 0) : parseFloat((dataCurrent.turnos[t.key] || 0).toFixed(2))
            }));
        };

        const getActiveCompareData = () => {
            if (comparePeriod === 'month') return dataPrevMonth;
            if (comparePeriod === 'year') return dataPrevYear;
            return dataPrevWeek;
        };

        const getActiveCompareLabel = () => {
            if (comparePeriod === 'month') return 'MES ANTERIOR';
            if (comparePeriod === 'year') return 'AÑO ANTERIOR';
            return previousPeriodMeta.label;
        };

        const getChartTurnoByDay = () => {
            if (!selectedCanalDetail || selectedDayDetail === null) return getChartTurno();

            const activeCompareData = getActiveCompareData();
            const activeCompareLabel = getActiveCompareLabel();
            const targetDayOfWeek = DIAS_SEMANA_GETDAY[selectedDayDetail];

            const currentDates = getDatesInRange(startDate, endDate);
            const compareDates = comparePeriod === 'month' ? currentDates.map(d => {
                const date = new Date(d + 'T12:00:00');
                date.setMonth(date.getMonth() - 1);
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            }) : comparePeriod === 'year' ? currentDates.map(d => subtractYear(d)) : currentDates.map(d => addDays(d, -7));

            return TURNOS.map(t => {
                let current = 0, compare = 0;

                currentDates.forEach((d) => {
                    const dateObj = new Date(d + 'T12:00:00');
                    if (dateObj.getDay() === targetDayOfWeek) {
                        const horasData = isTxs ? (dataCurrent.canalesHorasTxsPorFecha[selectedCanalDetail]?.[d] || {}) : (dataCurrent.canalesHorasPorFecha[selectedCanalDetail]?.[d] || {});
                        for (let h = 0; h < 24; h++) {
                            if (t.check(h)) {
                                current += horasData[h] || 0;
                            }
                        }
                    }
                });

                compareDates.forEach((d) => {
                    const dateObj = new Date(d + 'T12:00:00');
                    if (dateObj.getDay() === targetDayOfWeek) {
                        const horasData = isTxs ? (activeCompareData.canalesHorasTxsPorFecha[selectedCanalDetail]?.[d] || {}) : (activeCompareData.canalesHorasPorFecha[selectedCanalDetail]?.[d] || {});
                        for (let h = 0; h < 24; h++) {
                            if (t.check(h)) {
                                compare += horasData[h] || 0;
                            }
                        }
                    }
                });

                return {
                    name: t.key,
                    [activeCompareLabel]: compare,
                    "PERIODO ACTUAL": current
                };
            });
        };

        const getChartDia = () => {
            if (selectedCanalDetail) {
                const diasData = isTxs ? (dataCurrent.canalesDiasTxs[selectedCanalDetail] || {}) : (dataCurrent.canalesDias[selectedCanalDetail] || {});
                const diasDataCompare = isTxs ? (compareData.canalesDiasTxs[selectedCanalDetail] || {}) : (compareData.canalesDias[selectedCanalDetail] || {});

                return DIAS_SEMANA.map((d, i) => {
                    const getDayValue = DIAS_SEMANA_GETDAY[i];
                    return {
                        name: `${i + 1}. ${d}`,
                        [compareLabel]: diasDataCompare[getDayValue] || 0,
                        "PERIODO ACTUAL": diasData[getDayValue] || 0,
                        _realIdx: getDayValue
                    };
                });
            }
            return DIAS_SEMANA.map((d, i) => {
                const getDayValue = DIAS_SEMANA_GETDAY[i];
                return {
                    name: `${i + 1}. ${d}`,
                    [compareLabel]: isTxs ? (compareData.diasTxs[getDayValue] || 0) : parseFloat((compareData.dias[getDayValue] || 0).toFixed(2)),
                    "PERIODO ACTUAL": isTxs ? (dataCurrent.diasTxs[getDayValue] || 0) : parseFloat((dataCurrent.dias[getDayValue] || 0).toFixed(2)),
                    _realIdx: getDayValue
                };
            });
        };

        const chartTurno = getChartTurno();
        const chartDia = getChartDia();

        const currentHourlyTxs = selectedHourlyTxsDay === 'all'
            ? dataCurrent.horasTxs
            : dataCurrent.horasTxsPorDia?.[selectedHourlyTxsDay];
        const comparedHourlyTxs = selectedHourlyTxsDay === 'all'
            ? compareData.horasTxs
            : compareData.horasTxsPorDia?.[selectedHourlyTxsDay];
        const businessHours = [...Array.from({ length: 18 }, (_, index) => index + 6), 0, 1, 2, 3, 4, 5];
        const allHourlyTxs = businessHours.map((hour) => ({
            name: `${String(hour).padStart(2, '0')}:00`,
            [compareLabel]: comparedHourlyTxs?.[hour] || 0,
            "PERIODO ACTUAL": currentHourlyTxs?.[hour] || 0,
        }));
        const firstTransactionIndex = allHourlyTxs.findIndex(
            (item) => item[compareLabel] > 0 || item["PERIODO ACTUAL"] > 0
        );
        const lastTransactionIndex = allHourlyTxs.reduce(
            (last, item, index) =>
                item[compareLabel] > 0 || item["PERIODO ACTUAL"] > 0 ? index : last,
            -1
        );
        const chartHourlyTxs = firstTransactionIndex >= 0
            ? allHourlyTxs.slice(firstTransactionIndex, lastTransactionIndex + 1)
            : allHourlyTxs;

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
                                        const isSelected = selectedCanalDetail === c;
                                        return (
                                            <tr key={c} className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-100' : 'hover:bg-blue-50'}`} onClick={() => setSelectedCanalDetail(isSelected ? null : c)}>
                                                <td className={`p-2 font-semibold flex items-center gap-2 ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                                                    {isSelected && <span className="text-lg">✓</span>}
                                                    {c}
                                                </td>
                                                <td className={`p-2 text-right font-bold ${v.color}`}>{v.icon} {fmtPct(v.pct)}</td>
                                                <td className={`p-2 text-right font-bold ${v.color}`}>{isTxs ? v.dif : fmtNum(v.dif)}</td>
                                            </tr>
                                        );
                                    })}
                                    <tr className={`border-t-2 border-gray-200 ${selectedCanalDetail ? 'bg-gray-100' : 'bg-gray-50'} cursor-pointer`} onClick={() => setSelectedCanalDetail(null)}>
                                        <td className="p-2 font-black text-gray-800">Total general {selectedCanalDetail && <span className="text-xs font-normal text-gray-600">(click para limpiar)</span>}</td>
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
                                    {(() => {
                                        const currentTurnos = getTurnosByCanal(dataCurrent, selectedCanalDetail);
                                        const compareTurnos = getTurnosByCanal(compareData, selectedCanalDetail);
                                        return TURNOS.map((t, idx) => {
                                            const act = currentTurnos[idx].value;
                                            const ant = compareTurnos[idx].value;
                                            const v = calcVar(act, ant);
                                            return (
                                                <tr key={t.key} className="border-b border-gray-50 hover:bg-gray-50">
                                                    <td className="p-2 text-gray-700 italic">{t.key}</td>
                                                    <td className={`p-2 text-right font-bold ${v.color}`}>{v.icon} {fmtPct(v.pct)}</td>
                                                    <td className={`p-2 text-right font-bold ${v.color}`}>{isTxs ? v.dif : fmtNum(v.dif)}</td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {selectedCanalDetail ? (
                        <div className="flex-1 space-y-6">
                            <div className="bg-white border border-gray-200 shadow-sm rounded p-4">
                                <h3 className="text-center font-bold text-gray-800 mb-3 uppercase">Seleccionar Día - {selectedCanalDetail}</h3>
                                <div className="overflow-x-auto">
                                    <div className="flex gap-2 pb-2">
                                        {DIAS_SEMANA.map((d, idx) => {
                                            const isSelected = selectedDayDetail === idx;
                                            return (
                                                <button
                                                    key={idx}
                                                    onClick={() => setSelectedDayDetail(isSelected ? null : idx)}
                                                    className={`px-4 py-2 rounded font-bold text-sm transition-all ${
                                                        isSelected
                                                            ? 'bg-green-500 text-white'
                                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                                >
                                                    {d}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4">
                                <h3 className="text-center font-bold text-red-700 italic mb-2">{isTxs ? 'Transacciones por turno' : 'Ventas por turno'}</h3>
                                <p className="text-center text-xs text-gray-500 mb-2">Comparando con: {getActiveCompareLabel()}</p>
                                <div className="h-64 px-2">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={selectedDayDetail !== null ? getChartTurnoByDay() : chartTurno} margin={{ top: 10, right: 0, left: 0, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false} interval={0} />
                                            <YAxis width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                            <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px' }} formatter={(val) => isTxs ? val : `S/ ${val.toLocaleString()}`} labelFormatter={(label) => `Turno: ${label}`} />
                                            <Bar dataKey={compareLabel} fill={colorCompare}>
                                                {isTxs && <LabelList dataKey={compareLabel} position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                            </Bar>
                                            <Bar dataKey="PERIODO ACTUAL" fill={colorCurrent}>
                                                {isTxs && <LabelList dataKey="PERIODO ACTUAL" position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="p-2 text-left font-bold text-gray-600">TURNO</th>
                                            <th className="p-2 text-right font-bold text-gray-600">VAR</th>
                                            <th className="p-2 text-right font-bold text-gray-600">DIF {isTxs ? 'TXS' : 'S/.'}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(selectedDayDetail !== null ? getChartTurnoByDay() : chartTurno).map(t => {
                                            const activeLabel = selectedDayDetail !== null ? getActiveCompareLabel() : compareLabel;
                                            const act = t['PERIODO ACTUAL'];
                                            const ant = t[activeLabel];
                                            const v = calcVar(act, ant);
                                            return (
                                                <tr key={t.name} className="border-b hover:bg-gray-50">
                                                    <td className="p-2 font-semibold text-gray-700">{t.name}</td>
                                                    <td className={`p-2 text-right font-bold ${v.color}`}>{v.icon} {fmtPct(v.pct)}</td>
                                                    <td className={`p-2 text-right font-bold ${v.color}`}>{isTxs ? v.dif : fmtNum(v.dif)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {selectedDayDetail !== null && (
                                <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4">
                                    <h3 className="text-center font-bold text-purple-700 italic mb-2">
                                        {DIAS_SEMANA[selectedDayDetail]} - {isTxs ? 'Transacciones por hora' : 'Ventas por hora'} - {selectedCanalDetail}
                                    </h3>
                                    <div className="h-64 px-2">
                                        {(() => {
                                            const businessHours = [...Array.from({ length: 18 }, (_, index) => index + 6), 0, 1, 2, 3, 4, 5];
                                            const activeCompareData = getActiveCompareData();
                                            const activeCompareLabel = getActiveCompareLabel();
                                            const targetDayOfWeek = DIAS_SEMANA_GETDAY[selectedDayDetail];

                                            const currDates = getDatesInRange(startDate, endDate);
                                            const cmpDates = comparePeriod === 'month'
                                                ? currDates.map(d => {
                                                    const dd = new Date(d + 'T12:00:00');
                                                    dd.setMonth(dd.getMonth() - 1);
                                                    return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
                                                })
                                                : comparePeriod === 'year'
                                                    ? currDates.map(d => subtractYear(d))
                                                    : currDates.map(d => addDays(d, -7));

                                            const sumHours = (dataObj, fechas) => {
                                                const acc = {};
                                                for (let h = 0; h < 24; h++) acc[h] = 0;
                                                if (!dataObj) return acc;
                                                const src = isTxs
                                                    ? (dataObj.canalesHorasTxsPorFecha?.[selectedCanalDetail] || {})
                                                    : (dataObj.canalesHorasPorFecha?.[selectedCanalDetail] || {});
                                                fechas.forEach(d => {
                                                    const dow = new Date(d + 'T12:00:00').getDay();
                                                    if (dow !== targetDayOfWeek) return;
                                                    const hh = src[d] || {};
                                                    for (let h = 0; h < 24; h++) {
                                                        acc[h] += hh[h] || 0;
                                                    }
                                                });
                                                return acc;
                                            };

                                            const horasActual = sumHours(dataCurrent, currDates);
                                            const horasCompare = sumHours(activeCompareData, cmpDates);

                                            const lineChartData = businessHours.map(h => ({
                                                name: `${String(h).padStart(2, '0')}:00`,
                                                [activeCompareLabel]: horasCompare[h] || 0,
                                                'ACTUAL': horasActual[h] || 0,
                                                diferencia: (horasActual[h] || 0) - (horasCompare[h] || 0)
                                            }));

                                            return (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={lineChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                                        <XAxis dataKey="name" interval={2} tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                                                        <YAxis allowDecimals={false} width={45} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                                        <Tooltip
                                                            contentStyle={{ fontSize: '12px' }}
                                                            formatter={(value, name) => {
                                                                if (name === 'diferencia') return [`${isTxs ? value : fmtNum(value)}`, 'Diferencia'];
                                                                return [`${isTxs ? value : fmtNum(value)}`, name];
                                                            }}
                                                        />
                                                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                                                        <Line type="monotone" dataKey={activeCompareLabel} stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                                                        <Line type="monotone" dataKey="ACTUAL" stroke="#f97316" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                                                        <Line type="monotone" dataKey="diferencia" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 5 }} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            );
                                        })()}
                                    </div>
                                    <p className="text-center text-xs text-gray-500 mt-2 pb-2">
                                        Línea punteada = Diferencia (Actual - {getActiveCompareLabel().toUpperCase()})
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : (
                    <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {isTxs && showHourlyChart && <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4 xl:col-span-2">
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-1 px-4">
                                <h3 className="font-bold text-violet-700 italic">Tendencia lineal de transacciones por hora</h3>
                                <select
                                    value={selectedHourlyTxsDay}
                                    onChange={(event) => setSelectedHourlyTxsDay(event.target.value)}
                                    className="border border-violet-200 bg-violet-50 text-violet-800 rounded-md px-3 py-1.5 text-xs font-bold outline-none"
                                >
                                    <option value="all">Toda la semana</option>
                                    {DIAS_SEMANA.map((day, index) => (
                                        <option key={day} value={index}>{day}</option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-center text-xs text-gray-500 mb-2">
                                Evolución desde la primera hasta la última transacción del día seleccionado.
                            </p>
                            <div className="h-72 px-3">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartHourlyTxs} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                        <XAxis dataKey="name" interval={1} tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                                        <YAxis allowDecimals={false} width={45} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            contentStyle={{ fontSize: '12px' }}
                                            formatter={(value, name) => [`${value} transacciones`, name]}
                                        />
                                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                                        <Line type="monotone" dataKey={compareLabel} stroke={colorCompare} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                                        <Line type="monotone" dataKey="PERIODO ACTUAL" stroke={colorCurrent} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>}

                        <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4">
                            <div className="flex items-center justify-center gap-3 mb-2">
                                <h3 className="text-center font-bold text-red-700 italic">{selectedCanalDetail ? `${selectedCanalDetail} - ${isTxs ? 'Transacciones' : 'Ventas'}` : (isTxs ? 'Transacciones por canal' : 'Ventas por canal')}</h3>
                                {selectedCanalDetail && (
                                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs font-bold">
                                        Filtrado
                                    </span>
                                )}
                            </div>
                            <div className="h-64 px-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={selectedCanalDetail ? [chartCanal.find(c => c.name === selectedCanalDetail)] : chartCanal} margin={{ top: 10, right: 0, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} interval={0} />
                                        <YAxis width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px' }} formatter={(val) => isTxs ? val : `S/ ${val.toLocaleString()}`} labelFormatter={(label) => `Canal: ${label}`} />
                                        <Bar dataKey={compareLabel} fill={colorCompare}>
                                            {isTxs && <LabelList dataKey={compareLabel} position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                        </Bar>
                                        <Bar dataKey="PERIODO ACTUAL" fill={colorCurrent}>
                                            {isTxs && <LabelList dataKey="PERIODO ACTUAL" position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="mt-2 text-[10px] w-full overflow-x-auto border-t border-gray-200 px-2">
                                <table className="w-full text-center table-fixed">
                                    <thead>
                                        <tr className="border-b text-gray-500">
                                            <th className="p-1 border-r border-gray-100 bg-white" style={{ width: '100px' }}></th>
                                            {(selectedCanalDetail ? [selectedCanalDetail] : allCanales).map(c => <th key={c} className="p-1 font-bold border-r border-gray-100 uppercase truncate" title={c}>{c}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block" style={{ backgroundColor: colorCompare }}></span> {compareLabel}
                                            </td>
                                            {(selectedCanalDetail ? [selectedCanalDetail] : allCanales).map(c => {
                                                const val = isTxs ? (compareData.canalesTxs[c] || 0) : (compareData.canales[c] || 0);
                                                return <td key={c} className="p-1 border-r border-gray-100">{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                        <tr className="bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block" style={{ backgroundColor: colorCurrent }}></span> ACTUAL
                                            </td>
                                            {(selectedCanalDetail ? [selectedCanalDetail] : allCanales).map(c => {
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
                                    <BarChart data={chartTurno} margin={{ top: 10, right: 0, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={false} tickLine={false} interval={0} />
                                        <YAxis width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px' }} formatter={(val) => isTxs ? val : `S/ ${val.toLocaleString()}`} labelFormatter={(label) => `Turno: ${label}`} />
                                        <Bar dataKey={compareLabel} fill={colorCompare}>
                                            {isTxs && <LabelList dataKey={compareLabel} position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                        </Bar>
                                        <Bar dataKey="PERIODO ACTUAL" fill={colorCurrent}>
                                            {isTxs && <LabelList dataKey="PERIODO ACTUAL" position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                        </Bar>
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
                                            {chartTurno.map(t => {
                                                return <td key={t.name} className="p-1 border-r border-gray-100">{isTxs ? t[compareLabel] : fmtNum(t[compareLabel])}</td>
                                            })}
                                        </tr>
                                        <tr className="bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block shrink-0" style={{ backgroundColor: colorCurrent }}></span> ACT
                                            </td>
                                            {chartTurno.map(t => {
                                                return <td key={t.name} className="p-1 border-r border-gray-100">{isTxs ? t["PERIODO ACTUAL"] : fmtNum(t["PERIODO ACTUAL"])}</td>
                                            })}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="bg-white border border-gray-200 shadow-sm flex flex-col relative pt-4 xl:col-span-2 mt-4">
                            <div className="flex items-center justify-center gap-3 mb-2">
                                <h3 className="text-center font-bold text-red-700 italic">{isTxs ? 'Transacciones por día' : 'Ventas por día'}</h3>
                                {selectedCanalDetail && selectedDayDetail && (
                                    <span className="bg-green-100 text-green-700 px-3 py-1 rounded text-xs font-bold">
                                        {DIAS_SEMANA[selectedDayDetail]} seleccionado
                                    </span>
                                )}
                            </div>
                            <div className="h-64 px-2">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartDia} margin={{ top: 10, right: 0, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} interval={0} />
                                        <YAxis width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ fontSize: '12px' }} formatter={(val) => isTxs ? val : `S/ ${val.toLocaleString()}`} labelFormatter={(label) => `Día: ${label}`} />
                                        <Bar dataKey={compareLabel} fill={colorCompare}>
                                            {isTxs && <LabelList dataKey={compareLabel} position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                        </Bar>
                                        <Bar dataKey="PERIODO ACTUAL" fill={colorCurrent}>
                                            {isTxs && <LabelList dataKey="PERIODO ACTUAL" position="top" style={{ fontSize: '10px', fill: '#6b7280' }} />}
                                        </Bar>
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
                                                let val;
                                                if (selectedCanalDetail) {
                                                    val = isTxs ? (compareData.canalesDiasTxs[selectedCanalDetail]?.[d._realIdx] || 0) : (compareData.canalesDias[selectedCanalDetail]?.[d._realIdx] || 0);
                                                } else {
                                                    val = isTxs ? (compareData.diasTxs[d._realIdx] || 0) : (compareData.dias[d._realIdx] || 0);
                                                }
                                                const isSelected = selectedCanalDetail && selectedDayDetail === d._realIdx;
                                                return <td key={d.name} className={`p-1 border-r border-gray-100 ${isSelected ? 'bg-green-100' : ''} ${selectedCanalDetail ? 'cursor-pointer hover:bg-green-50' : ''}`} onClick={() => selectedCanalDetail && setSelectedDayDetail(isSelected ? null : d._realIdx)}>{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                        <tr className="border-b bg-white">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-500 flex items-center gap-1">
                                                <span className="w-2 h-2 inline-block shrink-0" style={{ backgroundColor: colorCurrent }}></span> ACTUAL
                                            </td>
                                            {chartDia.map(d => {
                                                let val;
                                                if (selectedCanalDetail) {
                                                    val = isTxs ? (dataCurrent.canalesDiasTxs[selectedCanalDetail]?.[d._realIdx] || 0) : (dataCurrent.canalesDias[selectedCanalDetail]?.[d._realIdx] || 0);
                                                } else {
                                                    val = isTxs ? (dataCurrent.diasTxs[d._realIdx] || 0) : (dataCurrent.dias[d._realIdx] || 0);
                                                }
                                                const isSelected = selectedCanalDetail && selectedDayDetail === d._realIdx;
                                                return <td key={d.name} className={`p-1 border-r border-gray-100 ${isSelected ? 'bg-green-100' : ''} ${selectedCanalDetail ? 'cursor-pointer hover:bg-green-50' : ''}`} onClick={() => selectedCanalDetail && setSelectedDayDetail(isSelected ? null : d._realIdx)}>{isTxs ? val : fmtNum(val)}</td>
                                            })}
                                        </tr>
                                        <tr className="border-b bg-gray-50">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-600 italic">VAR</td>
                                            {chartDia.map(d => {
                                                let act, ant;
                                                if (selectedCanalDetail) {
                                                    act = isTxs ? (dataCurrent.canalesDiasTxs[selectedCanalDetail]?.[d._realIdx] || 0) : (dataCurrent.canalesDias[selectedCanalDetail]?.[d._realIdx] || 0);
                                                    ant = isTxs ? (compareData.canalesDiasTxs[selectedCanalDetail]?.[d._realIdx] || 0) : (compareData.canalesDias[selectedCanalDetail]?.[d._realIdx] || 0);
                                                } else {
                                                    act = isTxs ? (dataCurrent.diasTxs[d._realIdx] || 0) : (dataCurrent.dias[d._realIdx] || 0);
                                                    ant = isTxs ? (compareData.diasTxs[d._realIdx] || 0) : (compareData.dias[d._realIdx] || 0);
                                                }
                                                const v = calcVar(act, ant);
                                                const isSelected = selectedCanalDetail && selectedDayDetail === d._realIdx;
                                                return <td key={d.name} className={`p-1 font-bold border-r border-gray-100 ${v.color} ${isSelected ? 'bg-green-100' : ''} ${selectedCanalDetail ? 'cursor-pointer hover:bg-green-50' : ''}`} onClick={() => selectedCanalDetail && setSelectedDayDetail(isSelected ? null : d._realIdx)}>{v.icon} {fmtPct(v.pct)}</td>
                                            })}
                                        </tr>
                                        <tr className="bg-gray-50">
                                            <td className="p-1 text-left font-bold border-r border-gray-100 pl-2 text-gray-600 italic">DIF {isTxs ? 'TXS' : 'S/.'}</td>
                                            {chartDia.map(d => {
                                                let act, ant;
                                                if (selectedCanalDetail) {
                                                    act = isTxs ? (dataCurrent.canalesDiasTxs[selectedCanalDetail]?.[d._realIdx] || 0) : (dataCurrent.canalesDias[selectedCanalDetail]?.[d._realIdx] || 0);
                                                    ant = isTxs ? (compareData.canalesDiasTxs[selectedCanalDetail]?.[d._realIdx] || 0) : (compareData.canalesDias[selectedCanalDetail]?.[d._realIdx] || 0);
                                                } else {
                                                    act = isTxs ? (dataCurrent.diasTxs[d._realIdx] || 0) : (dataCurrent.dias[d._realIdx] || 0);
                                                    ant = isTxs ? (compareData.diasTxs[d._realIdx] || 0) : (compareData.dias[d._realIdx] || 0);
                                                }
                                                const v = calcVar(act, ant);
                                                const isSelected = selectedCanalDetail && selectedDayDetail === d._realIdx;
                                                return <td key={d.name} className={`p-1 font-bold border-r border-gray-100 ${v.color} ${isSelected ? 'bg-green-100' : ''} ${selectedCanalDetail ? 'cursor-pointer hover:bg-green-50' : ''}`} onClick={() => selectedCanalDetail && setSelectedDayDetail(isSelected ? null : d._realIdx)}>{isTxs ? v.dif : fmtNum(v.dif)}</td>
                                            })}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {!selectedCanalDetail && (
                            <div className="bg-white border border-gray-200 shadow-sm rounded p-4 mt-4 xl:col-span-2">
                                <h3 className="text-center font-bold text-gray-800 mb-3 uppercase">Detalle por Día</h3>
                                <div className="overflow-x-auto mb-4">
                                    <div className="flex gap-2 pb-2">
                                        {DIAS_SEMANA.map((d, idx) => {
                                            const isSelected = selectedDayDetail === idx;
                                            return (
                                                <button
                                                    key={idx}
                                                    onClick={() => setSelectedDayDetail(isSelected ? null : idx)}
                                                    className={`px-4 py-2 rounded font-bold text-sm transition-all whitespace-nowrap ${
                                                        isSelected
                                                            ? 'bg-blue-500 text-white'
                                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                    }`}
                                                >
                                                    {d}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {selectedDayDetail !== null && getDayDetails() && (() => {
                                    const details = getDayDetails();
                                    return (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div className="bg-blue-50 border border-blue-200 rounded p-3">
                                                    <p className="text-xs font-bold text-blue-600 uppercase mb-1">Promedio Actual ({details.currentDayData.length} {details.dayName})</p>
                                                    <p className="text-2xl font-black text-blue-700">{isTxs ? details.currentAvg.toFixed(0) : fmtMoney(details.currentAvg)}</p>
                                                </div>
                                                <div className="bg-gray-50 border border-gray-200 rounded p-3">
                                                    <p className="text-xs font-bold text-gray-600 uppercase mb-1">Promedio {compareLabel.toUpperCase()} ({details.compareDayData.length} {details.dayName})</p>
                                                    <p className="text-2xl font-black text-gray-700">{isTxs ? details.compareAvg.toFixed(0) : fmtMoney(details.compareAvg)}</p>
                                                </div>
                                                <div className={`${details.diff >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border rounded p-3`}>
                                                    <p className="text-xs font-bold uppercase mb-1" style={{color: details.diff >= 0 ? '#059669' : '#dc2626'}}>Variación</p>
                                                    <p className="text-2xl font-black" style={{color: details.diff >= 0 ? '#059669' : '#dc2626'}}>
                                                        {isTxs ? details.diff.toFixed(0) : fmtNum(details.diff)}
                                                    </p>
                                                    <p className="text-sm font-bold" style={{color: details.diff >= 0 ? '#059669' : '#dc2626'}}>
                                                        {details.diff >= 0 ? '▲' : '▼'} {Math.abs(details.pct).toFixed(1)}%
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="overflow-x-auto">
                                                    <h4 className="text-xs font-bold text-gray-700 uppercase mb-2">Fechas ({details.dayName})</h4>
                                                    <table className="w-full text-xs">
                                                        <thead className="bg-gray-50 border-b">
                                                            <tr>
                                                                <th className="p-2 text-left font-bold text-gray-600">Fecha</th>
                                                                <th className="p-2 text-right font-bold text-gray-600">Valor</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {details.currentDayData.map(d => (
                                                                <tr key={d.fecha} className="border-b hover:bg-gray-50">
                                                                    <td className="p-2 font-semibold text-gray-700">{d.fecha}</td>
                                                                    <td className="p-2 text-right font-bold text-blue-600">
                                                                        {isTxs ? d.valor.toFixed(0) : fmtNum(d.valor)}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                <div className="overflow-x-auto">
                                                    <h4 className="text-xs font-bold text-gray-700 uppercase mb-2">Diferencias por Canal ({details.dayName})</h4>
                                                    <table className="w-full text-xs">
                                                        <thead className="bg-gray-50 border-b">
                                                            <tr>
                                                                <th className="p-2 text-left font-bold text-gray-600">Canal</th>
                                                                <th className="p-2 text-right font-bold text-gray-600">Actual</th>
                                                                <th className="p-2 text-right font-bold text-gray-600">{compareLabel}</th>
                                                                <th className="p-2 text-right font-bold text-gray-600">Dif</th>
                                                                <th className="p-2 text-right font-bold text-gray-600">Var</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {details.canalesBreakdown.map(c => {
                                                                const isPos = c.diff >= 0;
                                                                const colorClass = isPos ? 'text-green-600' : 'text-red-600';
                                                                return (
                                                                    <tr key={c.canal} className="border-b hover:bg-gray-50">
                                                                        <td className="p-2 font-semibold text-gray-700">{c.canal}</td>
                                                                        <td className="p-2 text-right font-bold text-blue-600">
                                                                            {isTxs ? c.currentVal.toFixed(0) : fmtNum(c.currentVal)}
                                                                        </td>
                                                                        <td className="p-2 text-right font-semibold text-gray-500">
                                                                            {isTxs ? c.compareVal.toFixed(0) : fmtNum(c.compareVal)}
                                                                        </td>
                                                                        <td className={`p-2 text-right font-bold ${colorClass}`}>
                                                                            {isTxs ? c.diff.toFixed(0) : fmtNum(c.diff)}
                                                                        </td>
                                                                        <td className={`p-2 text-right font-bold ${colorClass}`}>
                                                                            {c.compareVal > 0 ? `${isPos ? '▲' : '▼'} ${Math.abs(c.pct).toFixed(1)}%` : '-'}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>

                                            <div className="overflow-x-auto">
                                                <h4 className="text-xs font-bold text-gray-700 uppercase mb-2">Detalle por fecha y canal ({details.dayName})</h4>
                                                <table className="w-full text-xs">
                                                    <thead className="bg-gray-50 border-b">
                                                        <tr>
                                                            <th className="p-2 text-left font-bold text-gray-600">Fecha</th>
                                                            {allCanales.map(c => (
                                                                <th key={c} className="p-2 text-right font-bold text-gray-600">{c}</th>
                                                            ))}
                                                            <th className="p-2 text-right font-bold text-gray-800 bg-gray-100">TOTAL</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {details.fechaCanalBreakdown.map(row => (
                                                            <tr key={row.fecha} className="border-b hover:bg-gray-50">
                                                                <td className="p-2 font-semibold text-gray-700">{row.fecha}</td>
                                                                {allCanales.map(c => (
                                                                    <td key={c} className="p-2 text-right font-semibold text-gray-700">
                                                                        {isTxs ? (row.canales[c] || 0).toFixed(0) : fmtNum(row.canales[c] || 0)}
                                                                    </td>
                                                                ))}
                                                                <td className="p-2 text-right font-bold text-blue-600 bg-blue-50">
                                                                    {isTxs ? row.total.toFixed(0) : fmtNum(row.total)}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="bg-blue-50 border-t-2 border-blue-200">
                                                            <td className="p-2 font-black text-blue-800 uppercase">Total actual</td>
                                                            {allCanales.map(c => (
                                                                <td key={c} className="p-2 text-right font-black text-blue-700">
                                                                    {isTxs ? (details.canalTotalsActual[c] || 0).toFixed(0) : fmtNum(details.canalTotalsActual[c] || 0)}
                                                                </td>
                                                            ))}
                                                            <td className="p-2 text-right font-black text-blue-800 bg-blue-100">
                                                                {isTxs ? Object.values(details.canalTotalsActual).reduce((a, b) => a + b, 0).toFixed(0) : fmtNum(Object.values(details.canalTotalsActual).reduce((a, b) => a + b, 0))}
                                                            </td>
                                                        </tr>
                                                        <tr className="bg-gray-100">
                                                            <td className="p-2 font-black text-gray-700 uppercase">Total {compareLabel.toLowerCase()}</td>
                                                            {allCanales.map(c => (
                                                                <td key={c} className="p-2 text-right font-black text-gray-600">
                                                                    {isTxs ? (details.canalTotalsCompare[c] || 0).toFixed(0) : fmtNum(details.canalTotalsCompare[c] || 0)}
                                                                </td>
                                                            ))}
                                                            <td className="p-2 text-right font-black text-gray-800 bg-gray-200">
                                                                {isTxs ? Object.values(details.canalTotalsCompare).reduce((a, b) => a + b, 0).toFixed(0) : fmtNum(Object.values(details.canalTotalsCompare).reduce((a, b) => a + b, 0))}
                                                            </td>
                                                        </tr>
                                                        <tr className="bg-white border-t">
                                                            <td className="p-2 font-black text-gray-700 uppercase">Variación</td>
                                                            {allCanales.map(c => {
                                                                const act = details.canalTotalsActual[c] || 0;
                                                                const ant = details.canalTotalsCompare[c] || 0;
                                                                const v = calcVar(act, ant);
                                                                return (
                                                                    <td key={c} className={`p-2 text-right font-bold ${v.color}`}>
                                                                        {v.icon} {fmtPct(v.pct)}
                                                                    </td>
                                                                );
                                                            })}
                                                            <td className="p-2 text-right font-bold bg-gray-50">
                                                                {(() => {
                                                                    const act = Object.values(details.canalTotalsActual).reduce((a, b) => a + b, 0);
                                                                    const ant = Object.values(details.canalTotalsCompare).reduce((a, b) => a + b, 0);
                                                                    const v = calcVar(act, ant);
                                                                    return <span className={v.color}>{v.icon} {fmtPct(v.pct)}</span>;
                                                                })()}
                                                            </td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                    )}
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
                        <div className="text-center"><p className="text-gray-800 font-extrabold text-xl">Procesando Historial...</p></div>
                    </div>
                </div>
            )}

            <div className="bg-white border-b border-gray-200 shadow-sm px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/admin')} className="p-2 text-gray-500 hover:text-orange-600 transition-colors"><ArrowLeft className="w-6 h-6" /></button>
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 italic uppercase flex items-center gap-2">COMPARATIVO VENTAS</h1>
                        <p className="text-xs font-bold text-orange-500 bg-orange-100 px-2 py-0.5 inline-block rounded">Operadora LCPM</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <input type="file" accept=".csv,.xlsx,.xls" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!storeId || isSaving}
                        className={`px-6 py-2.5 rounded text-sm font-bold shadow-md transition-colors flex items-center gap-2 ${
                            !storeId || isSaving
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-gray-100'
                                : 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-200'
                        }`}
                    >
                        <Upload className="w-4 h-4" />
                        {storeId ? 'Cargar Excel Inforest' : 'Cargando tienda...'}
                    </button>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
                {(availableRange.min || lastUploadInfo) && (
                    <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px]">
                        {availableRange.min && (
                            <span className="inline-flex items-center gap-2 bg-gray-800 text-white px-3 py-1.5 rounded font-bold">
                                <Database className="w-3.5 h-3.5" /> Histórico disponible: {availableRange.min} → {availableRange.max}
                            </span>
                        )}
                        {lastUploadInfo && (
                            <span className="inline-flex items-center gap-2 bg-green-100 text-green-800 border border-green-200 px-3 py-1.5 rounded font-bold">
                                Último archivo: {lastUploadInfo.min} → {lastUploadInfo.max} · {lastUploadInfo.dias} días · {lastUploadInfo.txs} tx
                            </span>
                        )}
                    </div>
                )}

                {availableRange.max && addDays(availableRange.max, 2) < todayStr() && (
                    <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                        Historial desactualizado: el último día registrado es {availableRange.max}. Los ceros posteriores no representan ventas confirmadas.
                    </div>
                )}

                <div className="bg-white p-4 border border-gray-200 shadow-sm rounded flex flex-wrap items-end gap-6 mb-4">
                    <div className="flex items-center gap-6">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Inicio</label>
                            <input type="date" value={startDate} min={availableRange.min || undefined} max={availableRange.max || undefined} onChange={(e) => { setStartDate(e.target.value); setDateError(''); setActiveQuickFilter(null); }} className="bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-orange-500" />
                        </div>
                        <div className="relative">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Fin</label>
                            <input type="date" value={endDate} min={availableRange.min || undefined} max={availableRange.max || undefined} onChange={(e) => { setEndDate(e.target.value); setActiveQuickFilter(null); }} className={`bg-gray-50 border ${dateError ? 'border-red-500' : 'border-gray-300'} rounded px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-orange-500`} />
                            {dateError && <p className="absolute top-full left-0 text-[10px] text-red-500 font-bold mt-1 whitespace-nowrap">{dateError}</p>}
                        </div>
                        <button onClick={loadAnalysisData} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded text-sm font-bold shadow-md shadow-blue-100 transition-all flex items-center gap-2 disabled:bg-gray-400 disabled:shadow-none"><Search className="w-4 h-4" /> {loading ? 'Cargando...' : 'Consultar'}</button>
                    </div>
                    <div className="ml-auto flex flex-col gap-3 items-end">
                        <div className="flex bg-gray-100 p-1 rounded-md">
                            <button onClick={() => setViewMode('VTA')} className={`px-4 py-2 rounded text-sm font-bold transition-all ${viewMode === 'VTA' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Ventas (S/.)</button>
                            <button onClick={() => setViewMode('TXS')} className={`px-4 py-2 rounded text-sm font-bold transition-all ${viewMode === 'TXS' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Transacciones</button>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-3 border border-gray-200 shadow-sm rounded mb-3 flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] font-black text-gray-500 uppercase mr-1">Filtros rápidos:</span>
                    {[
                        { k: 'today', label: 'Hoy' },
                        { k: 'yesterday', label: 'Ayer' },
                        { k: 'week', label: 'Esta semana' },
                        { k: 'prevWeek', label: 'Semana pasada' },
                        { k: 'month', label: 'Este mes' },
                        { k: 'prevMonth', label: 'Mes pasado' },
                        { k: 'year', label: 'Este año' },
                        { k: 'all', label: 'Todo el histórico', disabled: !availableRange.min }
                    ].map(btn => {
                        const isActive = activeQuickFilter === btn.k;
                        return (
                            <button
                                key={btn.k}
                                disabled={btn.disabled}
                                onClick={() => applyQuickFilter(btn.k)}
                                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                                    btn.disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : isActive ? 'bg-orange-500 text-white shadow'
                                    : 'bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700'
                                }`}
                            >
                                {btn.label}
                            </button>
                        );
                    })}
                </div>

                <div className="bg-white p-3 border border-gray-200 shadow-sm rounded mb-8 flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] font-black text-gray-500 uppercase mr-1">Filtro de comparación:</span>
                    {[
                        { k: 'week', label: 'Semana Anterior' },
                        { k: 'month', label: 'Mes Anterior' },
                        { k: 'year', label: 'Año Anterior' }
                    ].map(opt => {
                        const isActive = comparePeriod === opt.k;
                        return (
                            <button
                                key={opt.k}
                                onClick={() => setComparePeriod(opt.k)}
                                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                                    isActive ? 'bg-blue-600 text-white shadow'
                                    : 'bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-700'
                                }`}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>

                {dataCurrent && !loading && (() => {
                    const ventaReal = dataCurrent?.total || 0;
                    const dif = ventaReal - currentGoal;
                    const pctAvance = currentGoal > 0 ? (ventaReal / currentGoal) * 100 : 0;
                    const pctDif = currentGoal > 0 ? (dif / currentGoal) * 100 : 0;
                    const isPos = dif >= 0;
                    const colorClass = isPos ? 'text-green-600' : 'text-red-600';
                    const rangeDates = getDatesInRange(startDate, endDate);
                    const diasRango = rangeDates.length;
                    const hoyStr = todayStr();
                    const diasCon = rangeDates.filter(d => (dataCurrent.ventasPorFecha?.[d] || 0) > 0 && d <= hoyStr).length;
                    const promedioDia = diasCon > 0 ? ventaReal / diasCon : 0;
                    const proyeccion = promedioDia * diasRango;
                    const proyDif = proyeccion - currentGoal;
                    const proyPct = currentGoal > 0 ? (proyDif / currentGoal) * 100 : 0;
                    return (
                        <div className="bg-white p-6 border border-gray-200 shadow-sm rounded mb-8">
                            {dataCurrent.rowCount > 0 && dataCurrent.rowCount < diasRango && (
                                <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                                    Cobertura incompleta: {dataCurrent.rowCount} de {diasRango} días tienen una fila de ventas.
                                </p>
                            )}
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-sm font-black text-gray-800 uppercase tracking-tight">Meta vs Venta — {startDate} → {endDate}</h3>
                                    <p className="text-[11px] text-gray-500">{diasCon} de {diasRango} días con ventas registradas</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] font-bold text-gray-500 uppercase">Avance de Meta</div>
                                    <div className={`text-2xl font-black ${pctAvance >= 100 ? 'text-green-600' : pctAvance >= 80 ? 'text-orange-500' : 'text-red-600'}`}>{pctAvance.toFixed(1)}%</div>
                                </div>
                            </div>

                            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden mb-6">
                                <div
                                    className={`h-full ${pctAvance >= 100 ? 'bg-green-500' : pctAvance >= 80 ? 'bg-orange-400' : 'bg-red-500'}`}
                                    style={{ width: `${Math.min(100, pctAvance)}%` }}
                                />
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="flex flex-col">
                                    <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Meta Acumulada</span>
                                    <span className="text-xl font-black text-gray-800">{fmtMoney(currentGoal)}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Venta Real Acumulada</span>
                                    <span className="text-xl font-black text-orange-600">{fmtMoney(ventaReal)}</span>
                                </div>
                                <div className="flex flex-col border-l border-gray-200 pl-4">
                                    <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Diferencia vs Meta</span>
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className={`text-xl font-black ${colorClass}`}>{isPos ? '+' : ''}{fmtMoney(dif)}</span>
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded bg-gray-50 ${colorClass}`}>{isPos ? '▲' : '▼'} {Math.abs(pctDif).toFixed(1)}%</span>
                                    </div>
                                </div>
                                <div className="flex flex-col border-l border-gray-200 pl-4">
                                    <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Proyección al cierre del rango</span>
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className={`text-xl font-black ${proyDif >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtMoney(proyeccion)}</span>
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded bg-gray-50 ${proyDif >= 0 ? 'text-green-600' : 'text-red-600'}`}>{proyDif >= 0 ? '▲' : '▼'} {Math.abs(proyPct).toFixed(1)}%</span>
                                    </div>
                                    <span className="text-[10px] text-gray-400 mt-1">Basada en S/ {fmtNum(promedioDia)} / día</span>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {loading ? (
                    <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-4 border-orange-500 border-t-transparent"></div></div>
                ) : (dataCurrent && dataCurrent.rowCount === 0) ? (
                    <div className="bg-white p-12 text-center border border-gray-200 rounded">
                        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-gray-600">No hay datos en este rango</h2>
                        <p className="text-gray-500 mt-2">No existe ninguna fila para {startDate} → {endDate}. Cambia el rango o carga el archivo de Inforest.</p>
                    </div>
                ) : (
                    <>
                        {comparePeriod === 'week' && dataPrevWeek && (
                            <AnalysisSection title={previousPeriodMeta.title} compareData={dataPrevWeek} compareLabel={previousPeriodMeta.label} colorCompare="#fcd34d" colorCurrent="#f97316" viewMode={viewMode} showHourlyChart />
                        )}
                        {comparePeriod === 'month' && dataPrevMonth && (
                            <AnalysisSection title="Mes Anterior" compareData={dataPrevMonth} compareLabel="MES ANTERIOR" colorCompare="#a78bfa" colorCurrent="#f97316" viewMode={viewMode} />
                        )}
                        {comparePeriod === 'year' && dataPrevYear && (
                            <AnalysisSection title="Año Anterior" compareData={dataPrevYear} compareLabel="AÑO ANTERIOR" colorCompare="#d1d5db" colorCurrent="#f97316" viewMode={viewMode} />
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
