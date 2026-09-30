import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { readHolidayLedger } from '../services/holidayBalance';

export default function HolidayPaymentSettings({ storeId, onSaved }) {
  const [rules, setRules] = useState([]);
  const [date, setDate] = useState('');
  const [method, setMethod] = useState('descanso');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setRules([]); setDate(''); setError(''); setMessage('');
    if (storeId) supabase.from('store_holiday_payment_rules').select('*').eq('store_id', storeId).order('holiday_date', { ascending: false }).then(({ data, error }) => {
      if (cancelled) return;
      setLoading(false);
      if (error) setError('No se pudo cargar la configuración de feriados.');
      else setRules(data);
    });
    return () => { cancelled = true; };
  }, [storeId, reload]);
  const selectDate = value => {
    setDate(value); setMessage('');
    const rule = rules.find(item => item.holiday_date === value);
    setMethod(rule?.payment_method || 'descanso'); setNote(rule?.note || '');
  };
  const save = async event => {
    event.preventDefault();
    if (!storeId || !date || busy || loading) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const rows = await readHolidayLedger(supabase, { storeId });
      const affected = rows.filter(row => row.holiday_date === date && row.balance_type === 'ganado').length;
      if (!window.confirm(`Esta decisión se aplica a TODA la tienda el ${date}: ${method === 'boleta' ? 'pago en boleta, sin acumular descanso' : 'acumular descanso compensable'}.\n\nHay ${affected} registros de feriados trabajados para esa fecha. También se aplicará a los que se registren después. No modifica descansos ya compensados. ¿Confirmar?`)) return;
      // Separate INSERT/UPDATE avoids requiring permission to rewrite store/date
      // identity columns during PostgREST upsert's ON CONFLICT update.
      const existing = rules.some(rule => rule.holiday_date === date);
      const values = { payment_method: method, note: note.trim() };
      const query = existing
        ? supabase.from('store_holiday_payment_rules').update(values).eq('store_id', storeId).eq('holiday_date', date)
        : supabase.from('store_holiday_payment_rules').insert({ ...values, store_id: storeId, holiday_date: date });
      const { data, error } = await query.select().single();
      if (error) throw error;
      setRules(previous => [data, ...previous.filter(rule => rule.holiday_date !== date)].sort((a, b) => b.holiday_date.localeCompare(a.holiday_date)));
      setMessage('Decisión guardada para toda la tienda. Los movimientos originales se conservan.');
      onSaved?.();
    } catch (cause) {
      setError(cause.code === '23514' ? 'La fecha debe ser un feriado oficial o tener feriados trabajados registrados.' : 'No se pudo guardar la decisión. Actualiza la configuración y vuelve a intentar.');
    } finally { setBusy(false); }
  };
  return <details className="mb-6 rounded-xl border border-purple-200 bg-white p-5 shadow-sm">
    <summary className="cursor-pointer text-lg font-bold text-purple-900">Feriados: descanso o pago en boleta</summary>
    <p className="mt-3 text-sm text-gray-600">Configura por fecha y tienda. Por defecto, los feriados trabajados acumulan descanso. Los destinados a boleta se muestran en el historial con efecto de 0 días, incluso si vuelves a guardar el horario.</p>
    <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">Fecha del feriado<input type="date" required value={date} onChange={e => selectDate(e.target.value)} disabled={busy || loading} className="mt-1 block w-full rounded-lg border p-2" /></label>
      <label className="text-sm font-medium">Tratamiento<select value={method} onChange={e => setMethod(e.target.value)} disabled={busy || loading} className="mt-1 block w-full rounded-lg border p-2"><option value="descanso">Acumula descanso</option><option value="boleta">Pago en efectivo en boleta · no acumula</option></select></label>
      <label className="text-sm font-medium sm:col-span-2">Referencia de la decisión (visible para colaboradores)<input maxLength={500} value={note} onChange={e => setNote(e.target.value)} disabled={busy || loading} className="mt-1 block w-full rounded-lg border p-2" placeholder="Ej.: disposición de RR. HH. para la boleta de octubre" /></label>
      <button disabled={!date || busy || loading} className="rounded-lg bg-purple-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Aplicar a toda la tienda'}</button>
      <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)} className="rounded-lg border px-4 py-2">Actualizar configuración</button>
    </form>
    {loading && <p role="status" className="mt-3">Cargando decisiones…</p>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-green-800">{message}</p>}
    <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">{rules.map(rule => <li key={rule.holiday_date}><button type="button" disabled={busy} onClick={() => selectDate(rule.holiday_date)} className="text-left text-sm text-purple-900 underline">{rule.holiday_date}: {rule.payment_method === 'boleta' ? 'Destinado a boleta · 0 días' : 'Acumula descanso'}</button></li>)}</ul>
  </details>;
}
