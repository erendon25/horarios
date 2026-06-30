import React, { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, getDoc, writeBatch } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Upload, Calendar, AlertCircle, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts';
import { startOfISOWeek, addWeeks, format, startOfYear } from 'date-fns';

const TURNOS = [
    { key: 'Apertura a 1pm', check: (h) => h >= 6 && h < 13 },
    { key: '1pm a 4pm', check: (h) => h >= 13 && h < 16 },
    { key: '4pm a 7pm', check: (h) => h >= 16 && h < 19 },
    { key: '7pm a 10pm', check: (h) => h >= 19 && h < 22 },
    { key: '10pm al cierre', check: (h) => h >= 22 || h < 6 }
];

const CANALES_FIJOS = ['SALÓN', 'DELIVERY', 'DRIVE THRU', 'SERV. FILA'];
const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

const addDays = (dateStr, days) => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
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
    const [dataPrevYear, setDataPrevYear] = useState(null);
    const [currentGoal, setCurrentGoal] = useState(0);
    const [viewMode, setViewMode] = useState('VTA');
    const [dateError, setDateError] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedWeek, setSelectedWeek] = useState(1);

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

    const handleWeekChange = (year, week) => {
        setSelectedYear(year);
        setSelectedWeek(week);
        let d = new Date(year, 0, 4);
        d = startOfISOWeek(d);
        d = addWeeks(d, week - 1);
        setStartDate(format(d, 'yyyy-MM-dd'));
        const dEnd = new Date(d);
        dEnd.setDate(dEnd.getDate() + 6);
        setEndDate(format(dEnd, 'yyyy-MM-dd'));
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
            const prevWeekDates = getPreviousFullIsoWeekDates(startDate);
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

    useEffect(() => {
        if (storeId) {
            loadAnalysisData();
        }
    }, [storeId]);

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
        if (!storeId) {
            throw new Error("No se pudo identificar la tienda para guardar el historial de ventas.");
        }
        if (data.length === 0) return;

        const findValue = (row, possibleKeys) => {
            const keys = Object.keys(row);
            for (let pk of possibleKeys) {
                const exact = keys.find(k => k.trim().toLowerCase() === pk);
                if (exact) return row[exact];
            }
            for (let pk of possibleKeys) {
                const pkClean = pk.replace(/[^a-z]/g, '');
                const semiExact = keys.find(k => k.toLowerCase().replace(/[^a-z]/g, '') === pkClean);
                if (semiExact) return row[semiExact];
            }
            for (let pk of possibleKeys) {
                const match = keys.find(k => {
                    const clean = k.trim().toLowerCase();
                    if (pk === 'total' || pk === 'monto' || pk === 'importe') {
                        if (clean.includes('sub') || clean.includes('dscto') || clean.includes('descuento') || clean.includes('igv') || clean.includes('impuesto') || clean.includes('propina') || clean.includes('recargo')) return false;
                    }
                    if (pk === 'pedido' || pk === 'comprobante' || pk === 'ticket') {
                        if (clean.includes('tipo') || clean.includes('estado') || clean.includes('fecha') || clean.includes('hora')) return false;
                    }
                    return clean.includes(pk);
                });
                if (match) return row[match];
            }
            return undefined;
        };

        const cleanMonto = (raw) => {
            if (raw === null || raw === undefined || raw === '') return 0;
            if (typeof raw === 'number') return raw;
            let text = String(raw).trim();
            if (text === '') return 0;

            // Salvavidas estricto: Prevenir que las fechas u horas se parseen como montos millonarios
            if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{2}\/\d{2}\/\d{4}/.test(text)) return NaN;
            if (/\d{2}:\d{2}:\d{2}/.test(text) || /^\d{2}:\d{2}$/.test(text)) return NaN;

            let isNegative = text.includes('-') || (text.startsWith('(') && text.endsWith(')'));
            text = text.replace(/[^\d.,]/g, '');
            if (!text) return 0;
            if (text.includes(',') && text.includes('.')) {
                if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
                else text = text.replace(/,/g, '');
            } else if (text.includes(',')) {
                const parts = text.split(',');
                if (parts[parts.length - 1].length === 3) text = text.replace(/,/g, '');
                else text = text.replace(',', '.');
            }
            let m = parseFloat(text);
            return isNaN(m) ? NaN : (isNegative ? -Math.abs(m) : m);
        };

        const pedidosMap = new Map();
        let currentPedidoId = null;
        let currentPedidoIsValid = false;

        data.forEach((fila) => {
            if (!fila || typeof fila !== 'object') return;
            const rawValStr = Object.values(fila).join(' ').toLowerCase();

            if (rawValStr.includes('total general') || rawValStr.includes('resumen') || rawValStr.includes('total periodo')) return;

            let colPedido = String(findValue(fila, ['nro. pedido', 'pedido', 'comprobante', 'documento', 'ticket']) || '').trim();
            let isTotalRow = colPedido.toLowerCase().includes('total ped') || rawValStr.includes('total pedido :');

            // 1. EVALUACIÓN Y SEGUIMIENTO DEL PEDIDO ACTIVO
            if (!isTotalRow && colPedido && colPedido !== 'undefined') {
                currentPedidoId = colPedido;
                const estadoVal = String(findValue(fila, ['estado', 'status', 'estado pedido', 'condicion', 'situacion']) || '').trim().toUpperCase();

                if (estadoVal) {
                    currentPedidoIsValid = !(
                        estadoVal.includes('ANULAD') || estadoVal.includes('CANCELAD') ||
                        estadoVal.includes('VOID') || estadoVal.includes('NULO') ||
                        estadoVal.includes('INACTIV') || estadoVal.includes('PENDIENTE') ||
                        estadoVal.includes('ABIERTO') || estadoVal.includes('NO COBRADO') ||
                        estadoVal.includes('ELIMINAD')
                    );
                }

                if (currentPedidoIsValid && !pedidosMap.has(currentPedidoId)) {
                    let docStr = String(findValue(fila, ['documento', 'comprobante']) || '').trim().toUpperCase();
                    // Identificador estricto de Notas de Crédito en Perú
                    let isNC = docStr.startsWith('NC') || docStr.startsWith('BC') || docStr.startsWith('FC') || docStr.startsWith('FN') || rawValStr.includes('nota de credito') || rawValStr.includes('devolucion');

                    pedidosMap.set(currentPedidoId, {
                        fechaRaw: findValue(fila, ['fecha', 'fechapedido', 'fecha pedido', 'date', 'fec.', 'fecha/hora']),
                        horaRaw: findValue(fila, ['hora', 'time', 'horapedido', 'hr', 'hora pedido']),
                        canalRaw: findValue(fila, ['canal venta', 'canal vta', 'canal', 'canal de venta', 'tipo pedido', 'origen', 'modalidad']),
                        documento: docStr,
                        itemsSum: 0,
                        totalPedido: null,
                        isNC: isNC
                    });
                } else if (currentPedidoIsValid && pedidosMap.has(currentPedidoId)) {
                    // Si el documento aparece en las filas siguientes (Items), lo actualiza
                    let docStr = String(findValue(fila, ['documento', 'comprobante']) || '').trim().toUpperCase();
                    if (docStr && docStr !== '0' && docStr !== 'UNDEFINED' && !pedidosMap.get(currentPedidoId).documento) {
                        pedidosMap.get(currentPedidoId).documento = docStr;
                        if (docStr.startsWith('NC') || docStr.startsWith('BC') || docStr.startsWith('FC')) {
                            pedidosMap.get(currentPedidoId).isNC = true;
                        }
                    }
                }
            }

            // 2. EXTRACCIÓN ROBUSTA DE LA FILA DE TOTAL (Ignorando fechas/horas infiltradas)
            if (isTotalRow) {
                if (currentPedidoId && currentPedidoIsValid && pedidosMap.has(currentPedidoId)) {
                    let rowVals = Object.values(fila);
                    let possibleTotals = [];

                    for (let val of rowVals) {
                        let strVal = String(val).trim();
                        if (!strVal || strVal.toLowerCase().includes('total')) continue;

                        let num = cleanMonto(strVal);
                        // Permitimos ceros (por si hubo 100% descuento) y descartamos NaN (fechas/letras)
                        if (!isNaN(num)) possibleTotals.push(num);
                    }

                    let totalRowMonto = 0;
                    if (possibleTotals.length > 0) {
                        // El Total final es matemáticamente el último valor del bloque numérico
                        totalRowMonto = possibleTotals[possibleTotals.length - 1];
                    }

                    if (pedidosMap.get(currentPedidoId).isNC) {
                        totalRowMonto = -Math.abs(totalRowMonto);
                    }

                    pedidosMap.get(currentPedidoId).totalPedido = totalRowMonto;
                }
                return;
            }

            // 3. SUMA DE ÍTEMS INDIVIDUALES (Backup)
            if (currentPedidoId && currentPedidoIsValid && pedidosMap.has(currentPedidoId)) {
                let numStr = findValue(fila, ['total', 'monto', 'venta', 'importe', 'neto']);
                let montoItem = cleanMonto(numStr);

                if (!isNaN(montoItem)) {
                    if (pedidosMap.get(currentPedidoId).isNC) {
                        montoItem = -Math.abs(montoItem);
                    }
                    pedidosMap.get(currentPedidoId).itemsSum += montoItem;
                }
            }
        });

        // 4. PREPARACIÓN Y CONSOLIDACIÓN A FIREBASE
        const dailyAggregations = {};
        let debugSum = 0;

        for (const [pedidoId, dataP] of pedidosMap.entries()) {
            let monto = dataP.totalPedido !== null ? dataP.totalPedido : dataP.itemsSum;
            // Se procesan montos de S/ 0 si son transacciones reales (ej. Cortesías con boleta), pero ignoramos vacíos rotundos
            if (isNaN(monto)) continue;

            let timeStr = "";
            let dateStr = "";

            if (dataP.fechaRaw instanceof Date) {
                dateStr = `${dataP.fechaRaw.getFullYear()}-${dataP.fechaRaw.getMonth() + 1}-${dataP.fechaRaw.getDate()}`;
                timeStr = `${dataP.fechaRaw.getHours()}:${dataP.fechaRaw.getMinutes()}:${dataP.fechaRaw.getSeconds()}`;
            } else {
                const cleanStr = String(dataP.fechaRaw).trim().replace(/\s+/g, ' ');
                if (cleanStr.includes(' ')) {
                    const parts = cleanStr.split(' ');
                    dateStr = parts[0];
                    if (!dataP.horaRaw) timeStr = parts.slice(1).join(' ');
                } else {
                    dateStr = cleanStr;
                }
                if (dataP.horaRaw) timeStr = String(dataP.horaRaw).trim();
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
            if (!fechaObj || isNaN(fechaObj.getTime())) continue;

            let rawHours = fechaObj.getHours();
            let businessDate = new Date(fechaObj);
            if (rawHours < 6) businessDate.setDate(businessDate.getDate() - 1);

            const fecha = `${businessDate.getFullYear()}-${String(businessDate.getMonth() + 1).padStart(2, '0')}-${String(businessDate.getDate()).padStart(2, '0')}`;
            let canalRawStr = String(dataP.canalRaw || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
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

            dayObj.totalSales += monto;
            debugSum += monto;

            // EL SEGUNDO GRAN CAMBIO: Contar por Documento en lugar de Pedido interno para limpiar tickets falsos y divisiones
            let txId = dataP.documento ? dataP.documento : pedidoId;
            dayObj._pedidosGlobal.add(txId);

            if (!dayObj.hourlyData[rawHours]) {
                dayObj.hourlyData[rawHours] = {};
                dayObj._pedidosHoraCanal[rawHours] = {};
            }
            dayObj.hourlyData[rawHours][canal] = (dayObj.hourlyData[rawHours][canal] || 0) + monto;

            if (!dayObj._pedidosHoraCanal[rawHours][canal]) dayObj._pedidosHoraCanal[rawHours][canal] = new Set();
            dayObj._pedidosHoraCanal[rawHours][canal].add(txId);
        }

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
            batch.set(docRef, dataToSave);
            count++;
            if (count >= 490) {
                await batch.commit();
                batch = writeBatch(db);
                count = 0;
            }
        }
        if (count > 0) await batch.commit();
        alert(`¡Datos procesados con éxito!\n\nVenta Total Verificada: S/ ${debugSum.toLocaleString('es-PE', { minimumFractionDigits: 2 })}\nTransacciones Finales: ${Object.keys(dailyAggregations).reduce((acc, k) => acc + dailyAggregations[k]._pedidosGlobal.size, 0)}`);
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
                <div className="bg-white p-4 border border-gray-200 shadow-sm rounded flex flex-wrap items-end gap-6 mb-8">
                    <div className="flex items-center gap-2 pr-6 border-r border-gray-200">
                        <div className="flex flex-col">
                            <label className="block text-[10px] font-black text-blue-500 uppercase mb-1">Análisis por Semana</label>
                            <div className="flex gap-2">
                                <select value={selectedYear} onChange={(e) => handleWeekChange(parseInt(e.target.value), selectedWeek)} className="bg-blue-50 border border-blue-200 rounded px-2 py-2 text-sm font-bold text-blue-800 outline-none">
                                    {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <select value={selectedWeek} onChange={(e) => handleWeekChange(selectedYear, parseInt(e.target.value))} className="bg-blue-50 border border-blue-200 rounded px-2 py-2 text-sm font-bold text-blue-800 outline-none">
                                    {Array.from({ length: 53 }, (_, i) => i + 1).map(w => <option key={w} value={w}>Semana {w}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-6">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Inicio</label>
                            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setDateError(''); }} className="bg-gray-50 border border-gray-300 rounded px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-orange-500" />
                        </div>
                        <div className="relative">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha Fin</label>
                            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`bg-gray-50 border ${dateError ? 'border-red-500' : 'border-gray-300'} rounded px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-orange-500`} />
                            {dateError && <p className="absolute top-full left-0 text-[10px] text-red-500 font-bold mt-1 whitespace-nowrap">{dateError}</p>}
                        </div>
                        <button onClick={loadAnalysisData} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded text-sm font-bold shadow-md shadow-blue-100 transition-all flex items-center gap-2 disabled:bg-gray-400 disabled:shadow-none"><Search className="w-4 h-4" /> {loading ? 'Cargando...' : 'Consultar'}</button>
                    </div>
                    <div className="ml-auto flex bg-gray-100 p-1 rounded-md">
                        <button onClick={() => setViewMode('VTA')} className={`px-4 py-2 rounded text-sm font-bold transition-all ${viewMode === 'VTA' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Ventas (S/.)</button>
                        <button onClick={() => setViewMode('TXS')} className={`px-4 py-2 rounded text-sm font-bold transition-all ${viewMode === 'TXS' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Transacciones</button>
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
                                            <span className={`text-2xl font-black ${colorClass}`}>{isPos ? '+' : ''}{fmtMoney(dif)}</span>
                                            <span className={`text-lg font-bold px-2 py-1 rounded bg-gray-50 ${colorClass}`}>{isPos ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%</span>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-4 border-orange-500 border-t-transparent"></div></div>
                ) : (dataCurrent && Number(dataCurrent.total || 0) === 0 && dataPrevWeek.total === 0 && dataPrevYear.total === 0) ? (
                    <div className="bg-white p-12 text-center border border-gray-200 rounded">
                        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-gray-600">No hay datos en este rango</h2>
                        <p className="text-gray-500 mt-2">Sube un Excel de Inforest para poblar la base de datos.</p>
                    </div>
                ) : (
                    <>
                        <AnalysisSection title="Semana Anterior" compareData={dataPrevWeek} compareLabel="SEM ANTERIOR" colorCompare="#fcd34d" colorCurrent="#f97316" viewMode={viewMode} />
                        <AnalysisSection title="Año Anterior" compareData={dataPrevYear} compareLabel="AÑO ANTERIOR" colorCompare="#d1d5db" colorCurrent="#f97316" viewMode={viewMode} />
                    </>
                )}
            </div>
        </div>
    );
};
