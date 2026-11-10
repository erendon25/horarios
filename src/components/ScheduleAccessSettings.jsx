import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Save, Shield } from 'lucide-react';
import { doc, getDoc, getFirestore } from '../lib/supabase/firestoreCompat';
import { supabase } from '../lib/supabase/client';
import { useScheduleAccessPolicy } from '../hooks/useScheduleAccessPolicy';
import { getLimaToday, getScheduleWeekStart, normalizeScheduleAccessPolicy } from '../services/scheduleAccessPolicy';

const signature = policy => JSON.stringify(policy);
const displayDate = value => value.split('-').reverse().join('/');
const defaultWeek = () => getScheduleWeekStart(getLimaToday()) || '';

export default function ScheduleAccessSettings({ storeId }) {
  const { policy, status, error, retry } = useScheduleAccessPolicy(storeId);
  const [draft, setDraft] = useState(null);
  const [original, setOriginal] = useState(null);
  const [draftStoreId, setDraftStoreId] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(defaultWeek);
  const [blockedDate, setBlockedDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const activeStore = useRef(storeId);
  activeStore.current = storeId;
  const currentPolicy = useRef(policy);
  currentPolicy.current = policy;
  const observedPolicy = useRef({ storeId: null, signature: '' });
  const inFlight = useRef(null);
  const scoped = Boolean(storeId) && draftStoreId === storeId;
  const dirty = scoped && draft && original && signature(draft) !== signature(original);
  const ready = Boolean(storeId) && status === 'ready' && policy;

  useEffect(() => {
    activeStore.current = storeId;
    setDraft(null); setOriginal(null); setDraftStoreId(null);
    setSelectedWeek(defaultWeek()); setBlockedDate('');
    setBusy(false); setSaveError(''); setMessage('');
    observedPolicy.current = { storeId, signature: '' };
    inFlight.current = null;
    return () => {
      activeStore.current = null;
      inFlight.current = null;
    };
  }, [storeId]);

  useEffect(() => {
    if (!ready || dirty || busy) return;
    const incoming = signature(policy);
    if (observedPolicy.current.storeId === storeId && observedPolicy.current.signature === incoming) return;
    observedPolicy.current = { storeId, signature: incoming };
    setDraft(policy); setOriginal(policy); setDraftStoreId(storeId);
  }, [storeId, ready, policy, dirty, busy]);

  const updateDraft = update => {
    if (!scoped || !ready || busy) return;
    setDraft(previous => previous && activeStore.current === storeId
      ? normalizeScheduleAccessPolicy(update(previous)) : previous);
    setSaveError(''); setMessage('');
  };

  const save = async event => {
    event.preventDefault();
    if (!ready || !scoped || !dirty || inFlight.current) return;
    const targetStore = storeId;
    const attempt = Symbol('schedule-access-save');
    const savedDraft = draft;
    const savedOriginal = original;
    inFlight.current = attempt;
    setBusy(true); setSaveError(''); setMessage('');
    try {
      const ref = doc(getFirestore(), 'stores', targetStore, 'config', 'schedule_access');
      const snapshot = await getDoc(ref);
      if (activeStore.current !== targetStore || inFlight.current !== attempt) return;
      const raw = snapshot.exists() ? snapshot.data() ?? null : undefined;
      normalizeScheduleAccessPolicy(raw);
      // The database locks the store's policy and applies only this draft's
      // changes, preserving concurrent edits and additional document fields.
      const { data, error: updateError } = await supabase.rpc('update_schedule_access', {
        p_store_id: targetStore,
        p_original: savedOriginal,
        p_draft: savedDraft,
      });
      if (updateError) throw updateError;
      if (activeStore.current !== targetStore || inFlight.current !== attempt) return;
      const next = normalizeScheduleAccessPolicy(data ?? null);
      // A realtime message can still contain the pre-save document. Do not
      // immediately replace the confirmed result with that stale snapshot.
      observedPolicy.current = { storeId: targetStore, signature: signature(currentPolicy.current) };
      setDraft(next); setOriginal(next); setDraftStoreId(targetStore);
      setMessage('Configuración guardada para esta tienda.');
    } catch (cause) {
      if (activeStore.current !== targetStore || inFlight.current !== attempt) return;
      console.error('Error al guardar permisos de horario:', cause);
      setSaveError('No se pudieron guardar los permisos. Tus cambios se conservan; vuelve a intentar.');
    } finally {
      if (inFlight.current === attempt) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  };

  const form = scoped ? draft : null;
  const weekEnabled = Boolean(form && selectedWeek && !form.blockedWeeks.includes(selectedWeek));
  const validBlockedDate = Boolean(blockedDate && getScheduleWeekStart(blockedDate));
  const fieldClass = 'mt-2 block w-full min-w-0 max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50';

  return <section className="mt-4 rounded-2xl border border-blue-100 bg-white shadow-sm" aria-label="Accesos a horarios">
    <details className="group">
      <summary aria-label="Accesos a horarios" className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-900 sm:text-base"><Shield className="h-5 w-5 shrink-0 text-blue-700" />Accesos a horarios</span>
        <span className="flex shrink-0 items-center gap-2">
          {(busy || saveError || dirty) && <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${saveError ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{busy ? 'Guardando…' : saveError ? 'Error al guardar' : 'Sin guardar'}</span>}
          <ChevronDown aria-hidden="true" className="h-5 w-5 text-gray-500 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-blue-100 p-5">
    <p className="text-sm text-gray-600">Configura quién puede editar los estudios y cuándo los colaboradores pueden enviar solicitudes en esta tienda.</p>
    <form onSubmit={save} className="mt-4 space-y-5">
      {(!storeId || status === 'idle') && <p role="status" className="text-sm text-gray-600">Selecciona una tienda para configurar los permisos.</p>}
      {status === 'loading' && <p role="status" className="text-sm text-gray-600">Cargando permisos de horario...</p>}
      {status === 'error' && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p>{error?.message || error || 'No se pudieron cargar los permisos de esta tienda.'}</p>
        <button type="button" onClick={retry} disabled={busy} className="mt-2 rounded-lg border border-red-300 px-3 py-2 font-semibold disabled:opacity-50">Reintentar carga de permisos</button>
      </div>}

      {form && <fieldset disabled={!ready || busy} className="min-w-0 space-y-5">
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm font-semibold text-gray-800">
            <input type="checkbox" checked={form.adminOnlyStudyEditing} onChange={event => { const checked = event.target.checked; updateDraft(previous => ({ ...previous, adminOnlyStudyEditing: checked })); }} className="mt-0.5 h-4 w-4 shrink-0" />
            Solo administración edita los horarios de estudio
          </label>
          <p className="pl-7 text-xs text-gray-600">Al activarlo, los colaboradores no verán la opción de editar estudios. Los datos registrados se conservan.</p>
          <label className="flex items-start gap-3 text-sm font-semibold text-gray-800">
            <input type="checkbox" checked={form.requestsEnabled} onChange={event => { const checked = event.target.checked; updateDraft(previous => ({ ...previous, requestsEnabled: checked })); }} className="mt-0.5 h-4 w-4 shrink-0" />
            Habilitar solicitudes de horario
          </label>
          <p className="pl-7 text-xs text-gray-600">Desactívalo para impedir nuevas solicitudes en toda la tienda.</p>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-semibold text-gray-800"><span className="flex items-center gap-2"><Calendar className="h-4 w-4" />Semana de solicitudes</span>
              <input type="date" aria-label="Semana de solicitudes" value={selectedWeek} onChange={event => setSelectedWeek(getScheduleWeekStart(event.target.value) || '')} className={fieldClass} />
            </label>
            <p className="mt-2 text-xs text-gray-600">Selecciona cualquier día; se utilizará el lunes de esa semana.</p>
            <label className="mt-4 flex items-start gap-3 text-sm font-semibold text-gray-800">
              <input type="checkbox" checked={weekEnabled} disabled={!selectedWeek} onChange={event => {
                const checked = event.target.checked;
                updateDraft(previous => ({ ...previous,
                  blockedWeeks: checked ? previous.blockedWeeks.filter(week => week !== selectedWeek) : [...new Set([...previous.blockedWeeks, selectedWeek])].sort(),
                }));
              }} className="mt-0.5 h-4 w-4 shrink-0" />
              Habilitar solicitudes en esta semana
            </label>
            <p className="mt-2 text-xs text-gray-600">También se respeta el interruptor general y las fechas bloqueadas.</p>
            {form.blockedWeeks.length > 0 && <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">{form.blockedWeeks.map(week => <li key={week} className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
              <span>Semana del {displayDate(week)}</span><button type="button" aria-label={`Quitar bloqueo de la semana ${displayDate(week)}`} onClick={() => updateDraft(previous => ({ ...previous, blockedWeeks: previous.blockedWeeks.filter(item => item !== week) }))} className="rounded-lg border px-3 py-2 font-semibold text-blue-700">Quitar bloqueo</button>
            </li>)}</ul>}
          </div>

          <div className="min-w-0 rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-semibold text-gray-800">Fecha a bloquear
              <input type="date" aria-label="Fecha a bloquear" value={blockedDate} onChange={event => setBlockedDate(event.target.value)} className={fieldClass} />
            </label>
            <button type="button" disabled={!validBlockedDate || form.blockedDates.includes(blockedDate)} onClick={() => {
              updateDraft(previous => ({ ...previous, blockedDates: [...new Set([...previous.blockedDates, blockedDate])].sort() }));
              setBlockedDate('');
            }} className="mt-3 w-full rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50">Bloquear fecha</button>
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">{form.blockedDates.map(date => <li key={date} className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
              <span>{displayDate(date)}</span><button type="button" aria-label={`Quitar bloqueo del ${displayDate(date)}`} onClick={() => updateDraft(previous => ({ ...previous, blockedDates: previous.blockedDates.filter(item => item !== date) }))} className="rounded-lg border px-3 py-2 font-semibold text-blue-700">Quitar bloqueo</button>
            </li>)}</ul>
          </div>
        </div>
      </fieldset>}

      {scoped && saveError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
      {scoped && message && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-600">{dirty ? 'Tienes cambios sin guardar.' : 'Los cambios se aplican al guardar.'}</p>
        <button type="submit" disabled={!ready || !scoped || !dirty || busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 sm:w-auto"><Save className="h-4 w-4" />{busy ? 'Guardando permisos...' : 'Guardar permisos de horario'}</button>
      </div>
    </form>
      </div>
    </details>
  </section>;
}
