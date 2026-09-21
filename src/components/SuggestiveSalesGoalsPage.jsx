import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, CloudUpload, Database, RefreshCw, Target, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where } from '../lib/supabase/firestoreCompat';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../supabase';
import { supabase } from '../lib/supabase/client';
import {
    SUGGESTIVE_PRODUCTS,
    SUGGESTIVE_PRODUCT_SET,
    SUGGESTIVE_TRX_RULES,
    buildTransactionSuggestiveSalesPlan,
} from '../services/suggestiveSalesGoals';

const todayDate = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
};
const currentMonth = () => todayDate().slice(0, 7);
const lastDateOfMonth = (month) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return '';
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return `${month}-${String(lastDay).padStart(2, '0')}`;
};
const formatUnits = (value) => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 1 });
const formatPercent = (rate) => (rate * 100).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const participationConfigKey = (month) => `suggestive_sales_goals:${month}`;

export default function SuggestiveSalesGoalsPage() {
    const navigate = useNavigate();
    const { userData } = useAuth();
    const storeId = userData?.storeId || '';
    const [month, setMonth] = useState(currentMonth);
    const [assignmentDate, setAssignmentDate] = useState(todayDate);
    const [source, setSource] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);
    const [publication, setPublication] = useState({ state: 'idle', count: 0, message: '' });
    const [participationDraft, setParticipationDraft] = useState('30');
    const [savingParticipation, setSavingParticipation] = useState(false);
    const [participationMessage, setParticipationMessage] = useState('');
    const [participationError, setParticipationError] = useState('');
    const draftValue = Number(participationDraft);
    const validDraft = participationDraft.trim() !== '' && Number.isFinite(draftValue)
        && draftValue >= 0 && draftValue <= 100;
    const hasParticipationChange = validDraft && source && Math.abs(draftValue / 100 - source.participation) > 1e-10;

    const plan = useMemo(() => {
        if (!source || source.month !== month || source.storeId !== storeId) return null;
        return buildTransactionSuggestiveSalesPlan({ ...source, month });
    }, [month, source, storeId]);

    useEffect(() => {
        if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
            setSource(null);
            setLoading(false);
            return undefined;
        }

        let cancelled = false;
        const loadSource = async () => {
            setSource(null);
            setLoading(true);
            setError('');
            setParticipationMessage('');
            setParticipationError('');
            try {
                const [historySnap, schedulesSnap, staffSnap, configSnap, participationSnap] = await Promise.all([
                    getDocs(query(collection(db, 'stores', storeId, 'sales_history'), orderBy('__name__'))),
                    getDocs(query(collection(db, 'schedules'), where('storeId', '==', storeId))),
                    getDocs(query(collection(db, 'staff_profiles'), where('storeId', '==', storeId))),
                    getDoc(doc(db, 'stores', storeId, 'sales_config', month)),
                    getDoc(doc(db, 'stores', storeId, 'config', participationConfigKey(month))),
                ]);
                if (cancelled) return;
                const participation = participationSnap.data()?.participation ?? SUGGESTIVE_TRX_RULES.participation;
                if (!Number.isFinite(participation) || participation < 0 || participation > 1) {
                    throw new Error('El porcentaje guardado de venta sugestiva no es válido.');
                }
                setParticipationDraft(String(Number((participation * 100).toFixed(8))));
                setSource({
                    month,
                    storeId,
                    participation,
                    monthlyData: configSnap.data()?.monthlyData || {},
                    history: historySnap.docs.map((item) => ({ ...item.data(), date: item.id })),
                    schedules: schedulesSnap.docs.map((item) => ({ ...item.data(), id: item.id })),
                    staff: staffSnap.docs.map((item) => ({ ...item.data(), id: item.id })),
                });
            } catch (loadError) {
                console.error('Error calculando metas de venta sugestiva:', loadError);
                if (!cancelled) {
                    setSource(null);
                    setError('No se pudo cruzar el histórico con los horarios de colaboradores.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadSource();
        return () => { cancelled = true; };
    }, [storeId, month, refreshToken]);

    useEffect(() => {
        if (!plan || loading || !storeId || !/^\d{4}-\d{2}$/.test(month)) return undefined;
        if (plan.metrics.missingDays > 0 || plan.metrics.untimedDays > 0) {
            setPublication({ state: 'error', count: 0,
                message: 'Faltan TRX diarias o detalle horario. Completa los datos para publicar el mes sin metas incompletas.' });
            return undefined;
        }

        let cancelled = false;
        setPublication({ state: 'publishing', count: 0, message: '' });
        const timer = window.setTimeout(async () => {
            setPublication((current) => ({ ...current, state: 'publishing', message: '' }));
            const rows = plan.rows
                .filter((row) => row.channel === 'SALÓN' && !row.missingStaff && row.assigneeId)
                .map((row) => ({
                    staffId: row.assigneeId,
                    date: row.date,
                    channel: row.channel,
                    schedule: row.schedule,
                    goals: row.goals,
                    hourlyGoals: row.hourlyGoals,
                    coveredHours: row.coveredHours,
                }));
            const { data, error: publishError } = await supabase.rpc('publish_suggestive_sales_goals', {
                p_store_id: storeId,
                p_month_start: `${month}-01`,
                p_rows: rows,
                p_targets: { ...plan.targets, calculation: {
                    basis: 'salon_transactions', participation: plan.metrics.participation,
                    salonShare: plan.metrics.salonShare,
                    productSet: SUGGESTIVE_PRODUCT_SET,
                } },
            });
            if (cancelled) return;
            if (publishError) {
                console.error('Error publicando metas de venta sugestiva:', publishError);
                setPublication({
                    state: 'error',
                    count: 0,
                    message: 'El cálculo se muestra, pero no pudo publicarse en los paneles de colaboradores.',
                });
            } else {
                setPublication({ state: 'published', count: Number(data) || rows.length, message: '' });
            }
        }, 700);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [loading, month, plan, storeId]);

    const saveParticipation = async (event) => {
        event.preventDefault();
        if (!validDraft || !plan || !hasParticipationChange || savingParticipation
            || publication.state === 'publishing') return;
        setSavingParticipation(true);
        setParticipationMessage('');
        setParticipationError('');
        const participation = draftValue / 100;
        try {
            await setDoc(doc(db, 'stores', storeId, 'config', participationConfigKey(month)), {
                participation,
            });
            setSource((current) => current?.month === month && current?.storeId === storeId
                ? { ...current, participation } : current);
            setParticipationMessage(`Objetivo de ${formatPercent(participation)}% guardado para ${month}.`);
        } catch (saveError) {
            console.error('Error guardando el porcentaje de venta sugestiva:', saveError);
            setParticipationError('No se pudo guardar el porcentaje. Las metas mantienen el último valor guardado; vuelve a intentarlo.');
        } finally {
            setSavingParticipation(false);
        }
    };

    const changeMonth = (value) => {
        setMonth(value);
        if (!/^\d{4}-\d{2}$/.test(value)) {
            setAssignmentDate('');
            return;
        }
        const today = todayDate();
        setAssignmentDate(today.startsWith(`${value}-`) ? today : `${value}-01`);
    };

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            <header className="bg-white border-b border-slate-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={() => navigate('/admin')}
                            className="p-2 text-slate-500 hover:text-orange-600 transition-colors"
                            aria-label="Volver al panel admin"
                        >
                            <ArrowLeft className="w-6 h-6" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Venta sugestiva</h1>
                            <p className="text-xs font-semibold text-slate-500 mt-1">Metas comerciales de salón por producto, horario y colaborador.</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                        <label className="text-[10px] font-black uppercase text-slate-500">
                            Mes objetivo
                            <input
                                type="month"
                                disabled={savingParticipation}
                                value={month}
                                onChange={(event) => changeMonth(event.target.value)}
                                className="block mt-1 bg-white text-slate-900 border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => setRefreshToken((current) => current + 1)}
                            disabled={loading || !storeId || savingParticipation}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black uppercase hover:bg-slate-800 disabled:opacity-50 transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            Actualizar datos
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
                <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 font-semibold">
                        <Database className="w-4 h-4 text-blue-600" />
                        El histórico de SKU se carga desde el apartado Análisis de ventas.
                    </span>
                    {plan && (
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="font-black text-slate-800">
                                {plan.coveredDays} días con detalle de productos
                            </span>
                            {publication.state === 'publishing' && (
                                <span className="inline-flex items-center gap-1.5 font-bold text-indigo-700">
                                    <CloudUpload className="h-4 w-4 animate-pulse" /> Publicando en paneles…
                                </span>
                            )}
                            {publication.state === 'published' && (
                                <span className="inline-flex items-center gap-1.5 font-bold text-green-700">
                                    <CheckCircle2 className="h-4 w-4" /> {publication.count} metas publicadas
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {publication.state === 'error' && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {publication.message}
                    </div>
                )}

                {!storeId && !loading && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                        No hay una tienda asociada al usuario actual.
                    </div>
                )}

                {error && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                    </div>
                )}

                <form onSubmit={saveParticipation} className="mb-4 rounded-xl border border-indigo-200 bg-white p-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="text-xs font-bold text-slate-700">
                            Participación objetivo de venta sugestiva (%)
                            <input
                                type="number" min="0" max="100" step="0.01" required
                                value={participationDraft}
                                onChange={(event) => {
                                    setParticipationDraft(event.target.value);
                                    setParticipationMessage('');
                                    setParticipationError('');
                                }}
                                disabled={!plan || loading || savingParticipation}
                                className="mt-1 block w-36 rounded-lg border border-slate-300 px-3 py-2 text-lg font-black text-indigo-900 disabled:opacity-50"
                                aria-describedby="participation-help"
                            />
                        </label>
                        <button type="submit"
                            disabled={!plan || !validDraft || !hasParticipationChange || loading || savingParticipation || publication.state === 'publishing'}
                            className="rounded-lg bg-indigo-700 px-4 py-3 text-xs font-black text-white hover:bg-indigo-800 disabled:opacity-50">
                            {savingParticipation ? 'Guardando…' : 'Guardar y recalcular metas'}
                        </button>
                    </div>
                    <p id="participation-help" className="mt-2 text-xs text-slate-500">
                        Admite de 0% a 100%, con decimales. Se guarda por tienda y mes. SALÓN mantiene el 60% estimado de las TRX totales.
                        {plan && <> Valor aplicado: <strong>{formatPercent(plan.metrics.participation)}%</strong>.</>}
                    </p>
                    {!validDraft && <p className="mt-2 text-xs font-semibold text-red-700">Ingresa un porcentaje entre 0 y 100.</p>}
                    {hasParticipationChange && <p className="mt-2 text-xs text-amber-700">Cambio pendiente de guardar. Al guardar se recalculan las cantidades y se publican si el mes tiene datos suficientes.</p>}
                    {participationMessage && <p role="status" className="mt-2 text-xs font-semibold text-green-700">{participationMessage}</p>}
                    {participationError && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{participationError}</p>}
                </form>

                <SuggestiveGoalsWorkspace
                    plan={plan}
                    loading={loading}
                    error={error}
                    month={month}
                    assignmentDate={assignmentDate}
                    onAssignmentDateChange={setAssignmentDate}
                />
            </main>
        </div>
    );
}

function SuggestiveGoalsWorkspace({
    plan,
    loading,
    error,
    month,
    assignmentDate,
    onAssignmentDateChange,
}) {
    const summaries = Array.isArray(plan?.summaries) ? plan.summaries : [];
    const planRows = Array.isArray(plan?.rows) ? plan.rows : [];
    const channelTargets = plan?.channelTargets && typeof plan.channelTargets === 'object' ? plan.channelTargets : {};
    const selectedRows = planRows.filter((row) => row.date === assignmentDate);
    const selectedTotals = Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [
        id,
        selectedRows.reduce((sum, row) => sum + (row.goals[id] || 0), 0),
    ]));
    const hasExactHistory = summaries.some((product) => product?.hasHistory);
    const metrics = plan?.metrics;
    const participationLabel = formatPercent(metrics?.participation ?? SUGGESTIVE_TRX_RULES.participation);
    const salonLabel = formatPercent(metrics?.salonShare ?? SUGGESTIVE_TRX_RULES.salonShare);
    const exampleGoal = Math.max(0, Math.ceil(1000 * (metrics?.salonShare ?? SUGGESTIVE_TRX_RULES.salonShare)
        * (metrics?.participation ?? SUGGESTIVE_TRX_RULES.participation) - 1e-9));
    const selectedDay = plan?.daily?.find((day) => day.date === assignmentDate);
    const unassignedTotal = selectedRows
        .filter((row) => row.missingStaff)
        .reduce((sum, row) => sum + SUGGESTIVE_PRODUCTS.reduce(
            (rowSum, product) => rowSum + (Number(row.goals[product.id]) || 0),
            0,
        ), 0);
    const selectedDateLabel = /^\d{4}-\d{2}-\d{2}$/.test(assignmentDate)
        ? new Date(`${assignmentDate}T12:00:00`).toLocaleDateString('es-PE', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
        })
        : 'fecha no seleccionada';

    return (
        <section className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-start gap-3">
                <Target className="w-6 h-6 text-orange-400 mt-0.5" />
                <div>
                    <h2 className="text-lg font-black uppercase tracking-tight">Metas de venta sugestiva</h2>
                    <p className="text-xs text-slate-300 mt-1">Distribución exclusiva para salón por fecha y turno completo del colaborador.</p>
                </div>
            </div>

            <div className="p-5">
                <div className="mb-5 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
                    <p className="font-black">Objetivo: {participationLabel} unidades sugestivas por cada 100 TRX de SALÓN</p>
                    <p className="mt-2">TRX totales × {salonLabel}% de participación estimada de SALÓN × {participationLabel}% de venta sugestiva.</p>
                    <p className="mt-1 text-xs">Borde de queso + VS HAZLO CMB V3 CANELITAS + VS HAZLO CMB V3 CRAZY suman ese {participationLabel}%. Cada unidad registrada del SKU cuenta una vez. Ejemplo: 1.000 TRX × {salonLabel}% × {participationLabel}% = {formatUnits(exampleGoal)} unidades entre los tres productos.</p>
                    {metrics && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div><span className="block text-xs">TRX base del mes</span><strong>{formatUnits(metrics.totalTransactions)}</strong></div>
                        <div><span className="block text-xs">TRX estimadas de SALÓN</span><strong>{formatUnits(metrics.salonTransactions)}</strong></div>
                        <div><span className="block text-xs">Meta conjunta mensual</span><strong>{formatUnits(metrics.totalGoal)} unidades</strong></div>
                        <div><span className="block text-xs">Participación registrada*</span><strong>{metrics.actualParticipation === null ? 'Sin detalle comparable' : `${(metrics.actualParticipation * 100).toFixed(1)}%`}</strong></div>
                    </div>}
                    <p className="mt-3 text-xs leading-relaxed">*Unidades de los tres SKU vendidas en SALÓN ÷ (TRX totales × 60%), sólo en fechas con TRX y detalle completo de SKU. El 60% se aplica como supuesto sobre tickets, no como porcentaje comprobado de TRX. No mide tickets únicos con venta sugestiva.</p>
                    <p className="mt-2 text-xs">Se usan TRX registradas del día; si faltan, las configuradas del mes; y luego el promedio histórico del mismo día de semana (promedio general si no hay muestra). Se redondea la meta conjunta diaria hacia arriba para alcanzar al menos el {participationLabel}%.</p>
                    {metrics?.estimatedDays > 0 && <p className="mt-2 text-xs font-bold">{metrics.estimatedDays} días calculados con TRX estimadas a partir del histórico.</p>}
                    {metrics?.equalMixDays > 0 && <p className="mt-2 text-xs font-bold">{metrics.equalMixDays} días sin mezcla histórica de los tres SKU actuales de SALÓN: reparto inicial equitativo. Reimporta el Excel detallado para incorporar los productos HAZLO CMB V3; los antiguos combos x4 no se convierten a estos SKU.</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {SUGGESTIVE_PRODUCTS.map((product) => {
                        const summary = summaries.find((item) => item?.id === product.id);
                        const progress = summary?.target > 0 ? (summary.actual / summary.target) * 100 : 0;
                        return (
                            <article key={product.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-black text-slate-800 uppercase">{product.label}</p>
                                        <p className="text-[10px] text-slate-500 mt-1">SKU: {product.importName}</p>
                                    </div>
                                    <div className="text-[9px] font-black uppercase text-slate-500 text-right">
                                        Meta mensual calculada
                                        <strong className="block mt-1 text-xl text-slate-900">{formatUnits(summary?.target)}</strong>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                                    <div><span className="block text-[9px] uppercase font-bold text-slate-400">Vendido</span><strong className="text-base text-orange-600">{formatUnits(summary?.actual)}</strong></div>
                                    <div><span className="block text-[9px] uppercase font-bold text-slate-400">Pendiente</span><strong className="text-base text-slate-800">{formatUnits(summary?.gap)}</strong></div>
                                    <div><span className="block text-[9px] uppercase font-bold text-slate-400">Avance</span><strong className="text-base text-blue-700">{progress.toFixed(1)}%</strong></div>
                                </div>
                                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mt-3">
                                    <div className="h-full bg-orange-500" style={{ width: `${Math.min(100, progress)}%` }} />
                                </div>
                                <p className="text-[10px] text-slate-500 mt-3">
                                    Peso en la meta conjunta: <strong>{((summary?.mixShare || 0) * 100).toFixed(1)}%</strong>. La mezcla histórica de SALÓN reparte la cantidad; las TRX determinan el total.
                                </p>
                            </article>
                        );
                    })}
                </div>

                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="text-xs font-black uppercase text-blue-900">Alcance de esta meta</p>
                    <p className="mt-1 text-xs leading-relaxed text-blue-800">
                        Borde de queso, VS HAZLO CMB V3 CANELITAS y VS HAZLO CMB V3 CRAZY se asignan únicamente a colaboradores posicionados en Salón. Drive Thru y Módulo quedan fuera de este cálculo porque tendrán metas comerciales distintas.
                    </p>
                    {plan && (
                        <div className="mt-3 overflow-x-auto rounded border border-blue-200 bg-white">
                            <table className="w-full text-xs">
                                <thead className="bg-blue-900 text-white">
                                    <tr>
                                        <th className="p-2.5 text-left font-black uppercase">Producto</th>
                                        <th className="p-2.5 text-right font-black uppercase">Meta Salón</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {SUGGESTIVE_PRODUCTS.map((product) => (
                                        <tr key={product.id} className="border-t border-blue-100">
                                            <td className="p-2.5 font-bold text-slate-800">{product.label}</td>
                                            <td className="p-2.5 text-right font-black text-blue-800">{formatUnits(channelTargets[product.id]?.['SALÓN'])}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {loading && <div className="py-10 text-center text-sm font-bold text-slate-500">Cruzando ventas, horarios y posiciones…</div>}

                {!loading && !error && plan && (
                    <>
                        {!hasExactHistory && (
                            <p className="mt-5 bg-amber-50 border border-amber-200 text-amber-800 rounded p-3 text-sm">
                                <strong>Falta el histórico detallado de estos SKU.</strong> La distribución usa transacciones por hora como respaldo. Carga nuevamente el reporte Inforest detallado desde Análisis de ventas para calcular la participación real de cada producto.
                            </p>
                        )}

                        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                                <Users className="w-5 h-5 text-blue-600" />
                                <div>
                                    <span className="block">Asignación diaria por colaborador</span>
                                    <span className="block mt-0.5 text-[10px] font-semibold capitalize text-slate-500">{selectedDateLabel}</span>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-end gap-2">
                                <label className="text-[10px] font-black uppercase text-slate-500">
                                    Fecha de asignación
                                    <span className="mt-1 flex items-center gap-2 rounded-lg border border-indigo-300 bg-white px-3 py-2">
                                        <CalendarDays className="h-4 w-4 text-indigo-600" />
                                        <input
                                            type="date"
                                            value={assignmentDate}
                                            min={month ? `${month}-01` : undefined}
                                            max={lastDateOfMonth(month) || undefined}
                                            onChange={(event) => onAssignmentDateChange(event.target.value)}
                                            className="bg-transparent text-sm font-black text-slate-900 outline-none"
                                        />
                                    </span>
                                </label>
                                <div className={`text-xs font-bold px-3 py-2.5 rounded border ${unassignedTotal > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-green-50 text-green-800 border-green-200'}`}>
                                    {unassignedTotal > 0
                                        ? `${formatUnits(unassignedTotal)} unidades sin colaborador este día`
                                        : 'Todas las unidades del día tienen responsable'}
                                </div>
                            </div>
                        </div>

                        <p className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-800">
                            {selectedDay && <span className="mb-2 block font-bold">
                                TRX del día: {selectedDay.transactions === null ? 'sin datos' : formatUnits(selectedDay.transactions)} ({({ recorded: 'registradas', configured: 'configuradas', estimated: 'estimadas', missing: 'sin datos' })[selectedDay.transactionSource]})
                                {` × ${salonLabel}% × ${participationLabel}% = `}{formatUnits(selectedDay.totalGoal)} unidades entre los tres productos.
                            </span>}
                            <strong>La meta mostrada es la suma de todo el turno.</strong> Por ejemplo, un horario de 09:00 a 19:00 incorpora cada hora entre 09:00 y 18:59: las horas de alta demanda aportan más y las horas de baja demanda aportan menos. Abre “franjas ponderadas” para revisar el aporte horario.
                        </p>

                        {selectedRows.length > 0 ? (
                            <div className="mt-3 overflow-auto max-h-[620px] border border-slate-200 rounded">
                                <table className="w-full min-w-[980px] text-xs">
                                    <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10">
                                        <tr>
                                            <th className="p-2.5 text-left font-black uppercase">Fecha</th>
                                            <th className="p-2.5 text-left font-black uppercase">Colaborador</th>
                                            <th className="p-2.5 text-left font-black uppercase">Horario</th>
                                            <th className="p-2.5 text-left font-black uppercase">Canal</th>
                                            {SUGGESTIVE_PRODUCTS.map((product) => (
                                                <th key={product.id} scope="col" className="p-2.5 text-right font-black uppercase">
                                                    {product.importName}
                                                </th>
                                            ))}
                                            <th className="p-2.5 text-right font-black uppercase">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedRows.map((row, index) => {
                                            const total = SUGGESTIVE_PRODUCTS.reduce((sum, product) => sum + (row.goals[product.id] || 0), 0);
                                            const dateLabel = new Date(`${row.date}T12:00:00`).toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: '2-digit' });
                                            return (
                                                <tr key={`${row.date}-${row.assigneeId}-${row.channel}-${row.schedule}-${index}`} className={`border-t ${row.missingStaff ? 'bg-amber-50' : 'bg-white hover:bg-blue-50'}`}>
                                                    <td className="p-2.5 font-bold text-slate-700 capitalize whitespace-nowrap">{dateLabel}</td>
                                                    <td className={`p-2.5 font-bold ${row.missingStaff ? 'text-amber-800' : 'text-slate-900'}`}>{row.assignee}</td>
                                                    <td className="p-2.5 text-slate-600 min-w-[190px]">
                                                        <div className="font-semibold whitespace-nowrap">{row.schedule}</div>
                                                        <details className="mt-1 group">
                                                            <summary className="cursor-pointer select-none text-[10px] font-bold text-indigo-700 hover:text-indigo-900">
                                                                {row.coveredHours?.length || 0} franjas ponderadas
                                                            </summary>
                                                            <div className="mt-2 flex max-w-[240px] flex-wrap gap-1">
                                                                {(row.coveredHours || []).map((hour) => {
                                                                    const hourGoals = row.hourlyGoals?.[hour] || {};
                                                                    const hourTotal = SUGGESTIVE_PRODUCTS.reduce((sum, product) => sum + (hourGoals[product.id] || 0), 0);
                                                                    const detail = SUGGESTIVE_PRODUCTS
                                                                        .map((product) => `${product.label}: ${formatUnits(hourGoals[product.id])}`)
                                                                        .join(' · ');
                                                                    return (
                                                                        <span
                                                                            key={hour}
                                                                            title={detail}
                                                                            className={`rounded border px-1.5 py-1 text-[9px] font-black ${hourTotal > 0 ? 'border-indigo-200 bg-white text-indigo-800' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                                                                        >
                                                                            {String(hour).padStart(2, '0')}:00 · {formatUnits(hourTotal)}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </details>
                                                    </td>
                                                    <td className="p-2.5 font-bold text-blue-700">{row.channelLabel}</td>
                                                    {SUGGESTIVE_PRODUCTS.map((product) => <td key={product.id} className="p-2.5 text-right font-bold text-slate-700">{formatUnits(row.goals[product.id])}</td>)}
                                                    <td className="p-2.5 text-right font-black text-slate-900 bg-slate-50">{formatUnits(total)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-900 text-white sticky bottom-0">
                                        <tr>
                                            <td colSpan="4" className="p-2.5 font-black uppercase">Total del día</td>
                                            {SUGGESTIVE_PRODUCTS.map((product) => <td key={product.id} className="p-2.5 text-right font-black">{formatUnits(selectedTotals[product.id])}</td>)}
                                            <td className="p-2.5 text-right font-black">{formatUnits(Object.values(selectedTotals).reduce((sum, value) => sum + (Number(value) || 0), 0))}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        ) : (
                            <div className="mt-4 border border-dashed border-slate-300 rounded p-8 text-center text-sm text-slate-500">
                                No hay asignaciones de venta sugestiva para {selectedDateLabel}.
                            </div>
                        )}

                        <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                            Método: la meta conjunta del día se obtiene de TRX × {salonLabel}% × {participationLabel}%. Las TRX por hora distribuyen esa cantidad dentro de SALÓN; se usa el patrón horario de la tienda como respaldo cuando falta el de SALÓN. La mezcla histórica de los tres productos divide las unidades por SKU. Cada colaborador recibe la suma de los minutos que cubre en su turno; cuando coinciden, comparten la demanda. Los minutos sin cobertura quedan como “Sin colaborador asignado”.
                        </p>
                    </>
                )}
            </div>
        </section>
    );
}
