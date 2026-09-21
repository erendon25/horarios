import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, RefreshCw, Sparkles, Target } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { SUGGESTIVE_PRODUCTS, channelDisplayName, hasCurrentSuggestiveProducts } from '../services/suggestiveSalesGoals';

const todayInLima = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const formatUnits = (value) => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 });

const formatDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('es-PE', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const businessHourOrder = (hour) => {
  const numeric = Number(hour);
  return numeric < 6 ? numeric + 24 : numeric;
};

export default function CollaboratorSuggestiveGoals({ staffId, storeId }) {
  const [selectedDate, setSelectedDate] = useState(todayInLima);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!staffId || !storeId || !selectedDate) {
      setAssignments([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadGoals = async () => {
      setLoading(true);
      setError('');
      const { data, error: loadError } = await supabase.rpc('get_my_suggestive_sales_goals', {
        p_goal_date: selectedDate,
      });

      if (cancelled) return;
      if (loadError) {
        console.error('Error cargando las metas del colaborador:', loadError);
        setAssignments([]);
        setError('No pudimos consultar tus metas en este momento. Intenta actualizar el panel.');
      } else {
        setAssignments((data || []).filter((row) => row.channel === 'SALÓN' && hasCurrentSuggestiveProducts(row.goals)));
      }
      setLoading(false);
    };

    loadGoals();
    return () => { cancelled = true; };
  }, [selectedDate, staffId, storeId, refreshToken]);

  const totals = useMemo(() => Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [
    id,
    assignments.reduce((sum, row) => sum + (Number(row.goals?.[id]) || 0), 0),
  ])), [assignments]);

  const hourlyGoals = useMemo(() => {
    const result = new Map();
    for (const assignment of assignments) {
      for (const [hour, goals] of Object.entries(assignment.hourly_goals || {})) {
        if (!result.has(hour)) result.set(hour, Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0])));
        const aggregate = result.get(hour);
        for (const product of SUGGESTIVE_PRODUCTS) aggregate[product.id] += Number(goals?.[product.id]) || 0;
      }
    }
    return [...result.entries()]
      .map(([hour, goals]) => ({ hour: Number(hour), goals }))
      .sort((left, right) => businessHourOrder(left.hour) - businessHourOrder(right.hour));
  }, [assignments]);

  const grandTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const latestPublication = assignments.reduce((latest, row) => (
    !latest || String(row.published_at) > String(latest) ? row.published_at : latest
  ), '');
  const publishedCalculation = assignments.find((row) => row.monthly_targets?.calculation?.basis === 'salon_transactions')
    ?.monthly_targets?.calculation;
  const publishedParticipation = Number.isFinite(publishedCalculation?.participation)
    ? (publishedCalculation.participation * 100).toLocaleString('es-PE', { maximumFractionDigits: 2 }) : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-indigo-950 via-indigo-900 to-blue-800 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/20">
              <Target className="h-6 w-6 text-amber-300" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">Venta sugestiva</p>
              <h2 className="mt-1 text-xl font-black">Mis metas del turno</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-indigo-100">
                Consulta tus cantidades antes de iniciar. La meta suma todo tu horario y pondera cada franja según la demanda histórica.
                {publishedParticipation !== null
                  && ` El objetivo conjunto es ${publishedParticipation} unidades entre borde de queso, Hazlo CMB V3 Canelitas y Hazlo CMB V3 Crazy por cada 100 transacciones estimadas de Salón.`}
              </p>
            </div>
          </div>

          <label className="text-[10px] font-black uppercase tracking-wide text-indigo-100">
            Fecha de la meta
            <span className="mt-1 flex items-center gap-2 rounded-xl border border-white/20 bg-white px-3 py-2 text-indigo-950 shadow-sm">
              <CalendarDays className="h-4 w-4 text-indigo-600" />
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="bg-transparent text-sm font-black outline-none"
              />
            </span>
          </label>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-black capitalize text-slate-800">{formatDate(selectedDate)}</p>
          {assignments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {assignments.map((assignment) => (
                <span key={assignment.id} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase text-blue-800">
                  {channelDisplayName(assignment.channel)} · {assignment.schedule_label}
                </span>
              ))}
            </div>
          )}
        </div>

        {loading && (
          <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/60 px-4 py-8 text-center text-sm font-bold text-indigo-700">
            Consultando tus metas publicadas…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-semibold text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-black uppercase text-red-700 shadow-sm"
            >
              <RefreshCw className="h-4 w-4" /> Reintentar consulta
            </button>
          </div>
        )}

        {!loading && !error && assignments.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center">
            <Sparkles className="mx-auto h-7 w-7 text-slate-400" />
            <p className="mt-2 text-sm font-black text-slate-700">No tienes una meta publicada para esta fecha.</p>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
              Estas metas se asignan únicamente cuando el horario publicado te posiciona en Salón. Drive Thru, Módulo, Driver, cocina y producción no reciben esta familia de metas.
            </p>
          </div>
        )}

        {!loading && !error && assignments.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SUGGESTIVE_PRODUCTS.map((product, index) => {
                const styles = [
                  'border-orange-200 bg-orange-50 text-orange-700',
                  'border-amber-200 bg-amber-50 text-amber-700',
                  'border-blue-200 bg-blue-50 text-blue-700',
                ][index];
                return (
                  <article key={product.id} className={`rounded-xl border p-4 ${styles}`}>
                    <p className="text-[10px] font-black uppercase tracking-wide opacity-75">Tu meta</p>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <p className="text-sm font-black leading-tight">{product.label}</p>
                      <strong className="text-3xl font-black leading-none">{formatUnits(totals[product.id])}</strong>
                    </div>
                    <p className="mt-2 text-[10px] font-bold uppercase opacity-70">unidades en todo el turno</p>
                  </article>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Meta total del turno</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{formatUnits(grandTotal)} <span className="text-sm text-slate-500">unidades</span></p>
              </div>
              <div className="text-left text-[10px] leading-relaxed text-slate-500 sm:text-right">
                <p>La cantidad ya considera horas altas y bajas de tu turno completo.</p>
                {latestPublication && <p>Actualizada: {new Date(latestPublication).toLocaleString('es-PE')}</p>}
              </div>
            </div>

            {hourlyGoals.length > 0 && (
              <details className="group mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-black text-indigo-900">
                  <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" /> Ver cómo se distribuye dentro del turno</span>
                  <span className="rounded-full bg-white px-2 py-1 text-[9px] uppercase text-indigo-700">{hourlyGoals.length} franjas</span>
                </summary>
                <div className="grid grid-cols-1 gap-2 border-t border-indigo-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {hourlyGoals.map(({ hour, goals }) => {
                    const total = SUGGESTIVE_PRODUCTS.reduce((sum, product) => sum + (Number(goals[product.id]) || 0), 0);
                    return (
                      <div key={hour} className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-xs text-indigo-900">{String(hour).padStart(2, '0')}:00</strong>
                          <strong className="text-xs text-slate-900">{formatUnits(total)} total</strong>
                        </div>
                        <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
                          {SUGGESTIVE_PRODUCTS.map((product) => `${product.label}: ${formatUnits(goals[product.id])}`).join(' · ')}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
