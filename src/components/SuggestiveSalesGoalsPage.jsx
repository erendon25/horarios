import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, CloudUpload, Plus, RefreshCw, Save, Target, Trash2, Upload, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from '../lib/supabase/firestoreCompat';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../supabase';
import { supabase } from '../lib/supabase/client';
import { buildRevenueSuggestiveSalesPlan, discoverSuggestiveChannels } from '../services/suggestiveSalesGoals';
import { exactReportProductName, getReportedProductNames } from '../services/productMatching';
import { readSalesHistoryDates, readSalesHistoryRange } from '../services/salesHistoryRead';
import { getDatesInRange } from '../services/salesAnalysis';
import { parseSalesFile } from '../services/salesImport';
import { writeSalesHistoryDays } from '../services/salesHistoryWrite';
import WeeklySuggestiveSalesReport from './WeeklySuggestiveSalesReport';
import { suggestiveProductParticipation } from '../services/suggestiveSalesDefaults';
import { suggestiveChannelLabel } from '../services/suggestiveChannels';
import {
    buildSuggestiveSalesDraft, serializeSuggestiveSalesConfiguration,
    loadSuggestiveSalesConfiguration, saveSuggestiveSalesConfiguration,
    readSuggestiveSalesDraftCache, writeSuggestiveSalesDraftCache,
    canApplySuggestiveSalesConfigurationLoad,
} from '../services/suggestiveSalesConfiguration';

const todayDate = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
};
const lastDateOfMonth = month => {
    if (!/^\d{4}-\d{2}$/.test(month)) return '';
    const [year, number] = month.split('-').map(Number);
    return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
};
const money = value => value === null || value === undefined ? 'Sin datos' : Number(value).toLocaleString('es-PE', { style: 'currency', currency: 'PEN' });
const units = value => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 });
const percent = value => value === null || value === undefined ? 'Sin datos' : `${(value * 100).toLocaleString('es-PE', { maximumFractionDigits: 2 })}%`;
const browserStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const scopeId = scope => JSON.stringify([scope.userId, scope.storeId, scope.month]);
const participationInput = product => {
    const rate = suggestiveProductParticipation(product);
    return rate === null ? '' : Number((rate * 100).toFixed(4));
};

export default function SuggestiveSalesGoalsPage() {
    const navigate = useNavigate();
    const { userData, currentUser } = useAuth();
    const storeId = userData?.storeId || '';
    const userId = currentUser?.uid || currentUser?.id || userData?.uid || userData?.id || '';
    const [month, setMonth] = useState(() => todayDate().slice(0, 7));
    const [assignmentDate, setAssignmentDate] = useState(todayDate);
    const [source, setSource] = useState(null);
    const [draft, setDraft] = useState(buildSuggestiveSalesDraft);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [saving, setSaving] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [publication, setPublication] = useState({ state: 'idle', count: 0, message: '' });
    const [customName, setCustomName] = useState('');
    const [customPrice, setCustomPrice] = useState('');
    const [importing, setImporting] = useState(false);
    const reportInput = useRef(null);
    const scope = useMemo(() => ({ userId, storeId, month }), [userId, storeId, month]);
    const settingsScope = scopeId(scope);
    const activeScope = useRef(scope);
    activeScope.current = scope;
    const draftRef = useRef(draft);
    const revision = useRef(0);
    const dirty = useRef(false);
    const saveQueue = useRef(Promise.resolve());
    const [loadedSettingsScope, setLoadedSettingsScope] = useState('');
    const loadedScopeRef = useRef('');
    const [settingsStatus, setSettingsStatus] = useState('idle');
    const [settingsError, setSettingsError] = useState('');
    const cacheDraft = useCallback((savedScope, savedDraft, savedDirty, savedRevision) => {
        try { writeSuggestiveSalesDraftCache(browserStorage(), savedScope, { draft: savedDraft, dirty: savedDirty, revision: savedRevision }); }
        catch (failure) { setSettingsError(failure.message); }
    }, []);
    const persistSettings = useCallback((snapshot, savedScope, savedRevision, automatic = false) => {
        const configuration = serializeSuggestiveSalesConfiguration(snapshot);
        const pending = saveQueue.current.catch(() => {}).then(async () => {
            if (activeScope.current.userId !== savedScope.userId || activeScope.current.storeId !== savedScope.storeId) {
                throw new Error('La cuenta o la tienda cambió. La configuración permanece en su borrador.');
            }
            if (scopeId(activeScope.current) === scopeId(savedScope) && revision.current === savedRevision) setSettingsStatus('saving');
            await saveSuggestiveSalesConfiguration({ month: savedScope.month, configuration,
                write: (key, value) => setDoc(doc(db, 'stores', savedScope.storeId, 'config', key), value) });
            const cached = readSuggestiveSalesDraftCache(browserStorage(), savedScope);
            if (cached?.revision === savedRevision) cacheDraft(savedScope, snapshot, false, savedRevision);
            if (scopeId(activeScope.current) === scopeId(savedScope) && revision.current === savedRevision) {
                dirty.current = false;
                setSettingsStatus(automatic ? 'autosaved' : 'saved'); setSettingsError('');
            }
        });
        saveQueue.current = pending.catch(() => {});
        return pending.catch(failure => {
            if (scopeId(activeScope.current) === scopeId(savedScope) && revision.current === savedRevision) {
                setSettingsStatus('error');
                setSettingsError('No se pudo guardar la configuración. El borrador se conserva en este navegador; reintenta guardar.');
            }
            throw failure;
        });
    }, [cacheDraft]);

    useEffect(() => {
        if (!storeId || !/^\d{4}-\d{2}$/.test(month)) { setSource(null); setLoading(false); return undefined; }
        let cancelled = false;
        const requestScope = scope;
        const cached = readSuggestiveSalesDraftCache(browserStorage(), requestScope);
        const keepMemoryDraft = loadedScopeRef.current === scopeId(requestScope) && dirty.current;
        if (!keepMemoryDraft) {
            revision.current = cached?.revision || 0;
            dirty.current = cached?.dirty === true;
        }
        const requestRevision = revision.current;
        if (cached && !keepMemoryDraft) { draftRef.current = cached.draft; setDraft(cached.draft); }
        const load = async () => {
            setLoading(true); setSource(null); setError(''); setNotice(''); setSettingsError(''); setSettingsStatus('idle');
            setPublication({ state: 'idle', count: 0, message: '' });
            try {
                const historyPromise = readSalesHistoryRange(supabase, storeId).then(async range => {
                    if (!range.min) return [];
                    const end = range.max;
                    if (range.min > end) return [];
                    return [...(await readSalesHistoryDates(supabase, storeId, getDatesInRange(range.min, end))).values()];
                });
                const [history, schedules, staff, config, goalConfig] = await Promise.all([
                    historyPromise,
                    getDocs(query(collection(db, 'schedules'), where('storeId', '==', storeId))),
                    getDocs(query(collection(db, 'staff_profiles'), where('storeId', '==', storeId))),
                    getDoc(doc(db, 'stores', storeId, 'sales_config', month)),
                    loadSuggestiveSalesConfiguration({ month,
                        read: async key => (await getDoc(doc(db, 'stores', storeId, 'config', key))).data() }),
                ]);
                if (cancelled || scopeId(activeScope.current) !== scopeId(requestScope)) return;
                setSource({ month, storeId, history, monthlyData: config.data()?.monthlyData || {},
                    schedules: schedules.docs.map(item => ({ ...item.data(), id: item.id })),
                    staff: staff.docs.map(item => ({ ...item.data(), id: item.id })) });
                if (canApplySuggestiveSalesConfigurationLoad({ requestScope, activeScope: activeScope.current,
                    requestRevision, currentRevision: revision.current, dirty: dirty.current })) {
                    const nextDraft = buildSuggestiveSalesDraft(goalConfig);
                    draftRef.current = nextDraft; setDraft(nextDraft);
                    cacheDraft(requestScope, nextDraft, false, revision.current);
                }
                loadedScopeRef.current = scopeId(requestScope);
                setLoadedSettingsScope(scopeId(requestScope));
            } catch (failure) {
                console.error('Error preparando venta sugestiva:', failure);
                if (!cancelled) setError('No se pudieron consultar las metas de venta, los reportes y los horarios. Actualiza para reintentar.');
            } finally { if (!cancelled) setLoading(false); }
        };
        load();
        return () => { cancelled = true; };
    }, [storeId, month, refreshToken, scope, cacheDraft]);

    const { plan, calculationError } = useMemo(() => {
        if (!source || source.month !== month || source.storeId !== storeId) return { plan: null, calculationError: '' };
        try {
            if (String(draft.participation).trim() === '') throw Error('Indica la participación mínima.');
            const pricedProducts = draft.products.filter(product => Number(product.price) > 0
                && Number.isFinite(Number(product.price)) && suggestiveProductParticipation(product) !== null
                && exactReportProductName(product.reportName));
            return { plan: buildRevenueSuggestiveSalesPlan({ ...source, products: pricedProducts,
                channels: draft.channels, participation: Number(draft.participation) / 100 }), calculationError: '' };
        } catch (failure) { return { plan: null, calculationError: failure.message }; }
    }, [source, month, storeId, draft]);
    const selectedDay = plan?.daily.find(day => day.date === assignmentDate);
    const selectedRows = plan?.rows.filter(row => row.date === assignmentDate) || [];
    const selectedProducts = plan?.products || [];
    const reportProductNames = useMemo(() => getReportedProductNames(source?.history || []), [source]);
    const reportedChannels = useMemo(() => new Set(discoverSuggestiveChannels(source?.history || [])), [source]);
    const selectedUnassigned = selectedRows.filter(row => row.missingStaff).reduce((sum, row) => sum + Object.values(row.goals).reduce((a, b) => a + b, 0), 0);
    const ready = Boolean(plan?.products.length && plan?.channels.length && !loading);
    const exactNamesComplete = draft.products.filter(product => product.enabled).every(product => exactReportProductName(product.reportName));
    const validOptionalPrices = draft.products.every(product => product.price === ''
        || (Number.isFinite(Number(product.price)) && Number(product.price) > 0 && Number(product.price) <= 1000000000));
    const validParticipation = String(draft.participation).trim() !== '' && Number.isFinite(Number(draft.participation))
        && Number(draft.participation) >= 0 && Number(draft.participation) <= 100;
    const validProductTargets = draft.products.every(product => suggestiveProductParticipation(product) !== null);
    const missingProductPrices = draft.products.filter(product => product.price === '');
    const uniqueProductNames = new Set(draft.products.map(product => exactReportProductName(product.reportName))).size === draft.products.length;
    const canSaveConfiguration = Boolean(source && loadedSettingsScope === settingsScope && !loading && !calculationError
        && exactNamesComplete && validOptionalPrices && validParticipation && validProductTargets && uniqueProductNames);
    const canPublish = ready && canSaveConfiguration && !missingProductPrices.length;
    const updateDraft = updater => {
        const nextDraft = updater(draftRef.current);
        draftRef.current = nextDraft; revision.current += 1; dirty.current = true;
        setDraft(nextDraft); cacheDraft(scope, nextDraft, true, revision.current);
        setSettingsStatus('pending'); setSettingsError(''); setNotice('');
        setPublication({ state: 'idle', count: 0, message: '' });
    };
    const updateProduct = (id, patch) => updateDraft(current => ({ ...current, products: current.products.map(product => product.id === id ? { ...product, ...patch } : product) }));
    const removeProduct = id => updateDraft(current => ({ ...current, products: current.products.filter(product => product.locked || product.id !== id) }));
    const updateChannel = (id, patch) => updateDraft(current => ({ ...current, channels: current.channels.map(channel => channel.id === id ? { ...channel, ...patch } : channel) }));
    useEffect(() => {
        if (!dirty.current || !canSaveConfiguration || saving || importing || publication.state === 'publishing') return undefined;
        const snapshot = draft, savedScope = scope, savedRevision = revision.current;
        const timer = setTimeout(() => { void persistSettings(snapshot, savedScope, savedRevision, true).catch(() => {}); }, 500);
        return () => clearTimeout(timer);
    }, [draft, scope, canSaveConfiguration, saving, importing, publication.state, persistSettings]);
    const saveConfiguration = async event => {
        event.preventDefault();
        if (!canSaveConfiguration || saving) return;
        setSaving(true); setError(''); setNotice('');
        try {
            await persistSettings(draft, scope, revision.current);
            setNotice('Configuración guardada. Revisa la distribución antes de publicar las metas.');
        } catch (failure) { console.error('Error guardando la configuración:', failure); }
        finally { setSaving(false); }
    };
    const publish = async () => {
        if (!canPublish || saving || publication.state === 'publishing') return;
        if (plan.metrics.missingGoalDates.length) {
            setPublication({ state: 'error', count: 0, message: 'Completa las metas de venta del mes antes de reemplazar las metas publicadas. Usa cero para los días sin venta prevista.' }); return;
        }
        if (plan.metrics.missingHistoryDates.length) {
            setPublication({ state: 'error', count: 0, message: 'Hay fechas con meta de venta y sin reportes monetarios suficientes. Completa el histórico antes de publicar.' }); return;
        }
        if (plan.metrics.missingChannelDates.length) {
            setPublication({ state: 'error', count: 0, message: 'Hay canales seleccionados sin reportes de venta para calcular su participación. Carga sus reportes o retíralos de la evaluación.' }); return;
        }
        const rows = plan.rows.filter(row => !row.missingStaff && row.assigneeId).map(row => ({
            staffId: row.assigneeId, date: row.date, channel: row.channel, schedule: row.schedule,
            goals: row.goals, hourlyGoals: row.hourlyGoals, coveredHours: row.coveredHours,
        }));
        if (!rows.length) { setPublication({ state: 'error', count: 0, message: 'No hay metas asignadas a colaboradores para publicar. Revisa las posiciones y los horarios.' }); return; }
        setPublication({ state: 'publishing', count: 0, message: '' });
        try {
            await persistSettings(draft, scope, revision.current);
            const { data, error: failure } = await supabase.rpc('publish_suggestive_sales_goals', {
                p_store_id: storeId, p_month_start: `${month}-01`, p_rows: rows,
                p_targets: { ...plan.targets, calculation: { basis: 'channel_sales_revenue', participation: Number(draft.participation) / 100,
                    products: selectedProducts.map(({ id, label, price, reportName, participation }) => ({ id, label, price, reportName, participation })), channels: plan.channels } },
            });
            if (failure) throw failure;
            setPublication({ state: 'published', count: Number(data) || rows.length, message: '' });
        } catch (failure) {
            console.error('Error publicando venta sugestiva:', failure);
            setPublication({ state: 'error', count: 0, message: 'No se pudieron publicar las metas. El cálculo y la configuración se conservan para volver a intentarlo.' });
        }
    };
    const canAddProduct = Boolean(exactReportProductName(customName) && (customPrice === ''
        || (Number.isFinite(Number(customPrice)) && Number(customPrice) > 0 && Number(customPrice) <= 1000000000))
        && !draft.products.some(product => exactReportProductName(product.reportName) === exactReportProductName(customName)));
    const addCustomProduct = () => {
        if (!canAddProduct) return;
        const id = `product-${crypto.randomUUID()}`;
        const reportName = exactReportProductName(customName);
        updateDraft(current => ({ ...current, products: [...current.products, { id, label: reportName, reportName, price: customPrice, participation: 0.30, enabled: true }] }));
        setCustomName(''); setCustomPrice('');
    };
    const changeMonth = value => {
        setMonth(value); setSource(null);
        setAssignmentDate(todayDate().startsWith(`${value}-`) ? todayDate() : `${value}-01`);
    };
    const importReport = async event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file || !storeId || loading || saving || importing || publication.state === 'publishing') return;
        setImporting(true); setError(''); setNotice('');
        try {
            const { days } = await parseSalesFile(file);
            if (!days.size) throw new Error('No se encontraron ventas válidas en el reporte.');
            const dates = await writeSalesHistoryDays(supabase, storeId, days);
            setSource(current => current && current.storeId === storeId ? { ...current,
                history: [...new Map([...(current.history || []).map(day => [day.date, day]), ...days]
                    .map(([date, day]) => [date, { ...day, date }])).values()].sort((a, b) => a.date.localeCompare(b.date)) } : current);
            setPublication({ state: 'idle', count: 0, message: '' });
            setNotice(`${file.name}: ${dates.length} jornadas cargadas, del ${dates[0]} al ${dates.at(-1)}. Se reemplazan sólo las jornadas incluidas; las demás se conservan.`);
        } catch (failure) {
            console.error('Error importando el reporte de venta sugestiva:', failure);
            setError(failure?.message || 'No se pudo importar el reporte de Intraview o Inforest.');
        } finally { setImporting(false); }
    };
    const busy = saving || importing || publication.state === 'publishing';

    return <div className="min-h-screen bg-slate-50 pb-16">
        <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
                <div className="flex items-center gap-3"><button type="button" onClick={() => navigate('/admin')} aria-label="Volver al panel admin" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></button>
                    <div><h1 className="text-2xl font-black text-slate-900">Venta sugestiva</h1><p className="mt-1 text-sm text-slate-500">Porcentaje semanal por canal y metas por producto y colaborador.</p></div></div>
                <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-bold text-slate-600">Mes objetivo<input type="month" value={month} disabled={busy} onChange={event => changeMonth(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                    <input ref={reportInput} type="file" accept=".xlsx,.xls,.csv" aria-label="Cargar reporte de ventas" onChange={importReport} className="hidden" />
                    <button type="button" onClick={() => reportInput.current?.click()} disabled={loading || busy || !storeId} title="Archivos de Intraview o Inforest (.xlsx, .xls y .csv)" className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Upload className="h-4 w-4" />{importing ? 'Leyendo reporte…' : 'Cargar reporte de ventas'}</button>
                    <button type="button" disabled={loading || busy || !storeId} onClick={() => setRefreshToken(value => value + 1)} className="rounded-lg bg-slate-900 p-2.5 text-white disabled:opacity-50" aria-label="Actualizar datos"><RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} /></button></div>
            </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-5 px-4 pt-6 sm:px-6">
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            {settingsError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{settingsError}</p>}
            {!storeId && !loading && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No hay una tienda asociada a tu usuario.</p>}
            <form onSubmit={saveConfiguration} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-black text-slate-900">1. Define qué evaluar</h2>
                <p className="mt-1 text-xs text-slate-500">Bordes y Hazlo Combo permanecen como productos predeterminados, con una meta inicial de 30% cada uno. Puedes ajustar sus metas y precios; los cambios se guardan automáticamente.</p>
                <fieldset disabled={loading || busy || !source} className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
                    <div><h3 className="text-sm font-bold text-slate-800">Productos y precio unitario</h3><div className="mt-2 space-y-2">
                        {draft.products.map(product => <div key={product.id} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
                            <label className="min-w-0 flex-1 basis-52 text-xs font-bold text-slate-600">Nombre exacto en el reporte
                                <input type="text" maxLength="160" list="suggestive-report-product-names" readOnly={Boolean(product.locked)} aria-describedby="suggestive-product-name-help" value={product.reportName ?? ''}
                                    onChange={event => updateProduct(product.id, { reportName: event.target.value, label: event.target.value || product.label })}
                                    aria-label={`Nombre exacto en el reporte de ${product.label}`} placeholder="Nombre de la columna Producto"
                                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900" />
                            </label>
                            <label className="text-xs font-bold text-slate-600">Precio para meta (S/)<input type="number" min="0.01" step="0.01" value={product.price} onChange={event => updateProduct(product.id, { price: event.target.value })} aria-label={`Precio de ${product.label}`} placeholder="Opcional" className="mt-1 block w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal text-slate-900" /></label>
                            <label className="text-xs font-bold text-slate-600">Meta (%)<input type="number" min="0" max="100" step="0.01" value={participationInput(product)} onChange={event => updateProduct(product.id, { participation: event.target.value === '' ? '' : Number(event.target.value) / 100 })} aria-label={`Meta de participación de ${product.label}`} className="mt-1 block w-24 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-normal text-slate-900" /></label>
                            {product.locked ? <span className="rounded bg-slate-100 px-2 py-1.5 text-[10px] font-semibold text-slate-600">Predeterminado</span>
                                : <button type="button" onClick={() => removeProduct(product.id)} aria-label={`Quitar producto ${product.label}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" />Quitar</button>}
                        </div>)}
                    </div>{!draft.products.length && <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Aún no has agregado productos para evaluar.</p>}
                    <p id="suggestive-product-name-help" className="mt-2 text-xs leading-relaxed text-slate-600">El nombre debe coincidir con la columna Producto del reporte, incluidas mayúsculas, acentos y signos. Si escribes un nombre distinto, no se reconocerán sus ventas. Puedes elegir una sugerencia de los reportes cargados para evitar errores.</p>
                    <p className="mt-2 text-xs text-slate-500">El porcentaje semanal usa los importes reales del reporte. El precio es opcional y se usa para calcular las unidades de las metas diarias.</p>
                    <datalist id="suggestive-report-product-names">{reportProductNames.map(name => <option key={name} value={name} />)}</datalist>
                    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3"><label className="min-w-0 flex-1 basis-52 text-xs font-bold text-slate-600">Nombre exacto del nuevo producto<input maxLength="160" list="suggestive-report-product-names" aria-describedby="suggestive-product-name-help" value={customName} onChange={event => setCustomName(event.target.value)} placeholder="Nombre de la columna Producto" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                        <label className="text-xs font-bold text-slate-600">Precio para meta (S/)<input type="number" min="0.01" step="0.01" value={customPrice} onChange={event => setCustomPrice(event.target.value)} aria-label="Precio del nuevo producto" placeholder="Opcional" className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label>
                        <button type="button" onClick={addCustomProduct} disabled={!canAddProduct} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40" aria-label="Agregar producto"><Plus className="h-4 w-4" />Agregar producto</button></div></div>
                    <div><h3 className="text-sm font-bold text-slate-800">Canales evaluados</h3><div className="mt-2 space-y-2">{draft.channels.map(channel => <div key={channel.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" aria-label={channel.id} checked={channel.enabled} onChange={event => updateChannel(channel.id, { enabled: event.target.checked })} className="h-4 w-4" />{suggestiveChannelLabel(channel.id)}{!reportedChannels.has(channel.id) && <span className="text-[10px] font-normal text-amber-700">Sin reportes</span>}</label>
                    </div>)}</div>
                        <p className="mt-2 text-xs text-slate-500">Las metas se asignan automáticamente a los colaboradores que ocupan la posición correspondiente a cada canal en el horario.</p>
                        <p className="mt-2 text-xs text-slate-500">Salón y Módulo son los canales predeterminados. Módulo figura como Serv. Fila en los reportes; cada producto tiene su meta por separado en cada canal.</p>
                        <p className="mt-5 text-xs leading-relaxed text-slate-500">La meta de cada producto se aplica a su porcentaje de venta en cada canal seleccionado. Cargar otro reporte conserva los productos, metas, precios y canales de evaluación.</p>
                    </div>
                </fieldset>
                {calculationError && <p role="alert" className="mt-3 text-sm text-amber-800">{calculationError}</p>}
                {!exactNamesComplete && !calculationError && <p role="alert" className="mt-3 text-sm text-amber-800">Completa el nombre exacto del reporte de cada producto seleccionado antes de guardar o publicar. Los registros históricos se conservan.</p>}
                {!validProductTargets && <p role="alert" className="mt-3 text-sm text-amber-800">Completa una meta entre 0% y 100% para cada producto. El borrador se conserva mientras terminas de editar.</p>}
                <div className="mt-5 flex flex-wrap items-center gap-3"><button type="submit" disabled={!canSaveConfiguration || busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><Save className="h-4 w-4" />{saving ? 'Guardando…' : 'Guardar configuración'}</button>{notice && <p role="status" className="text-xs font-semibold text-green-700">{notice}</p>}</div>
                {settingsStatus !== 'idle' && <p role="status" className={`mt-3 text-xs font-semibold ${settingsStatus === 'error' ? 'text-amber-800' : settingsStatus === 'pending' || settingsStatus === 'saving' ? 'text-slate-600' : 'text-green-700'}`}>
                    {({ pending: 'Cambios pendientes de guardar.', saving: 'Guardando configuración…', autosaved: 'Configuración guardada automáticamente.', saved: 'Configuración guardada.', error: 'El borrador se conserva; reintenta guardar.' })[settingsStatus]}
                </p>}
            </form>

            {!loading && source && <WeeklySuggestiveSalesReport history={source.history} products={draft.products} channels={draft.channels} participation={Number(draft.participation) / 100} />}

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div className="flex items-center gap-2"><Target className="h-5 w-5 text-orange-600" /><h2 className="font-black text-slate-900">3. Revisa la meta diaria</h2></div>
                    <label className="text-xs font-bold text-slate-600">Fecha de evaluación<input type="date" value={assignmentDate} min={`${month}-01`} max={lastDateOfMonth(month)} onChange={event => setAssignmentDate(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label></div>
                <div className="p-5">
                    {!loading && missingProductPrices.length > 0 && <p className="mb-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Completa el precio de {missingProductPrices.map(product => product.label).join(', ')} para calcular y publicar todas las metas diarias. Sus metas de participación semanal se conservan.</p>}
                    {loading ? <p className="py-8 text-center text-sm text-slate-500">Consultando reportes, metas y horarios…</p> : !ready ? <p className="py-8 text-center text-sm text-slate-500">Para calcular metas diarias, completa el precio de los productos y selecciona un canal. El seguimiento semanal funciona sin introducir precios.</p> : <>
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950"><p className="font-bold">Meta de venta del día: {money(selectedDay?.salesGoal)}</p><p className="mt-1 text-xs">Meta de venta × participación del canal × meta de cada producto ÷ su precio. Las unidades se redondean hacia arriba.</p><p className="mt-2 text-xs">Participación del canal: {({ recorded: 'reporte cargado de esta fecha', 'same-weekday': 'reportes anteriores del mismo día de la semana', historical: 'reportes anteriores disponibles', missing: 'sin histórico suficiente' })[selectedDay?.shareSource]}. Jornada comercial de 06:00 a 05:59.</p></div>
                        {selectedDay?.salesGoal === null && <p className="mt-3 text-sm text-amber-800">Esta fecha no tiene una meta de venta cargada. Regístrala en Metas de ventas para calcular las cantidades.</p>}
                        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[670px] text-sm">
                            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
                                <th className="p-3">Canal</th><th className="p-3 text-right">Participación</th><th className="p-3 text-right">Meta del canal</th>
                                {selectedProducts.map(product => <th key={product.id} className="p-3 text-right">{product.label}<span className="block text-[10px] font-normal">{money(product.price)} por unidad · Meta {percent(product.participation)}</span></th>)}
                            </tr></thead>
                            <tbody>{selectedDay?.channels.map(channel => <tr key={channel.id} className="border-t border-slate-100">
                                <td className="p-3 font-bold">{suggestiveChannelLabel(channel.id)}</td><td className="p-3 text-right">{channel.share === null ? 'Sin reportes' : percent(channel.share)}</td><td className="p-3 text-right">{money(channel.channelSalesGoal)}</td>
                                {selectedProducts.map(product => <td key={product.id} className="p-3 text-right text-lg font-black text-orange-700">
                                    <strong>{channel.share === null ? '—' : units(channel.goals[product.id])}</strong>
                                    <span className="mt-1 block text-[10px] font-normal text-slate-600">Venta objetivo: {money(channel.suggestiveRevenueByProduct?.[product.id])}</span>
                                    <span className="mt-1 block text-[10px] font-normal text-slate-600">Vendido: {channel.actual[product.id] === null ? 'Sin detalle' : units(channel.actual[product.id])}</span>
                                </td>)}
                            </tr>)}</tbody>
                        </table></div>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                            {selectedProducts.map(product => {
                                const hasRecorded = Boolean(selectedDay?.hasProductHistory[product.id]);
                                const actual = selectedDay?.actual[product.id] || 0;
                                const target = selectedDay?.goals[product.id] || 0;
                                return <article key={product.id} aria-label={`Resultado diario de ${product.label}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <h3 className="text-sm font-bold text-slate-900">{product.label}</h3>
                                    <p className="mt-1 break-words text-[10px] text-slate-500">{product.reportName || 'Nombre exacto pendiente de completar'}</p>
                                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                        <div><dt className="text-slate-500">Meta del día</dt><dd className="mt-1 text-lg font-black text-orange-700">{units(target)}</dd></div>
                                        <div><dt className="text-slate-500">Vendidos registrados</dt><dd className="mt-1 font-bold text-slate-900">{hasRecorded ? units(actual) : 'Sin detalle'}</dd></div>
                                        <div><dt className="text-slate-500">Pendientes</dt><dd className="mt-1 font-bold text-slate-900">{hasRecorded ? units(Math.max(0, target - actual)) : 'Sin detalle'}</dd></div>
                                    </dl>
                                    <p className="mt-3 text-[10px] text-slate-500">Sólo esta fecha y los canales seleccionados. Las ventas no se atribuyen a colaboradores.</p>
                                </article>;
                            })}
                        </div>
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-black text-slate-900"><Users className="h-5 w-5 text-blue-600" />Asignación por colaborador y posición</h3><span className={`rounded-lg px-3 py-2 text-xs font-bold ${selectedUnassigned ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>{selectedUnassigned ? `${units(selectedUnassigned)} unidades sin cobertura` : 'Sin unidades pendientes de asignar'}</span></div>
                        <p className="mt-2 text-xs text-slate-500">La venta histórica por hora pondera el turno; los colaboradores comparten cada minuto cubierto. Los descansos y las horas sin responsable conservan su parte como pendiente.</p>
                        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Colaborador</th><th className="p-3">Canal</th><th className="p-3">Horario</th>{selectedProducts.map(product => <th key={product.id} className="p-3 text-right">{product.label}</th>)}</tr></thead><tbody>{selectedRows.map((row, index) => <tr key={`${row.assigneeId}-${row.channel}-${index}`} className={`border-t border-slate-100 ${row.missingStaff ? 'bg-amber-50' : ''}`}><td className="p-3 font-semibold">{row.assignee}</td><td className="p-3 text-xs">{suggestiveChannelLabel(row.channel)}</td><td className="p-3 text-xs">{row.schedule}<details className="mt-1"><summary className="cursor-pointer text-blue-700">Ver franjas</summary><div className="mt-2 space-y-1 text-slate-500">{Object.entries(row.hourlyGoals).sort(([a], [b]) => ((+a + 18) % 24) - ((+b + 18) % 24)).map(([hour, goals]) => <p key={hour}>{String(hour).padStart(2, '0')}:00 · {selectedProducts.map(product => `${product.label}: ${units(goals[product.id])}`).join(' · ')}</p>)}</div></details></td>{selectedProducts.map(product => <td key={product.id} className="p-3 text-right font-black">{units(row.goals[product.id])}</td>)}</tr>)}{!selectedRows.length && <tr><td colSpan={selectedProducts.length + 3} className="p-6 text-center text-slate-500">No hay unidades calculadas para esta fecha.</td></tr>}</tbody><tfoot className="border-t-2 border-slate-200 bg-slate-50 font-black"><tr><td colSpan="3" className="p-3">Total del día</td>{selectedProducts.map(product => <td key={product.id} className="p-3 text-right">{units(selectedDay?.goals[product.id])}</td>)}</tr></tfoot></table></div>
                    </>}
                </div>
            </section>
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5"><div><h2 className="font-black text-slate-900">4. Publica después de revisar</h2><p className="mt-1 text-xs text-slate-500">Publicar actualiza las metas de los colaboradores para {month}. Abrir o editar esta vista conserva la revisión en pantalla.</p></div>
                <button type="button" onClick={publish} disabled={!canPublish || busy} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-40"><CloudUpload className="h-4 w-4" />{publication.state === 'publishing' ? 'Publicando…' : 'Publicar metas del mes'}</button>
                {publication.state === 'published' && <p role="status" className="flex w-full items-center gap-2 text-sm font-semibold text-green-700"><CheckCircle2 className="h-4 w-4" />{publication.count} asignaciones publicadas.</p>}
                {publication.state === 'error' && <p role="alert" className="flex w-full items-center gap-2 text-sm text-red-700"><AlertCircle className="h-4 w-4" />{publication.message}</p>}
            </section>
        </main>
    </div>;
}
