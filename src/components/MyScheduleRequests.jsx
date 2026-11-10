import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ClipboardList, RefreshCw, Trash2 } from 'lucide-react';
import { collection, getFirestore, onSnapshot, query, where } from '../lib/supabase/firestoreCompat';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';

const STATUS = {
  pending: { label: 'Pendiente', color: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Aprobada', color: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rechazada', color: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Cancelada', color: 'bg-gray-100 text-gray-700' },
};
const SHIFT_LABELS = { apertura: 'Apertura', medio: 'Medio', cierre: 'Cierre', rango: 'Horario específico' };
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : 'Fecha no disponible';
const timestamp = value => {
  const parsed = typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function MyScheduleRequests({ perfil, refreshKey = 0 }) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const staffId = perfil?.id;
  const storeId = perfil?.storeId;
  const scope = JSON.stringify([uid, staffId, storeId]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const deletingScope = useRef(null);
  const [reload, setReload] = useState(0);
  const [snapshotState, setSnapshotState] = useState({ scope: '', loading: true, requests: [], error: '' });
  const [action, setAction] = useState({ scope: '', id: null, error: '' });
  const state = snapshotState.scope === scope ? snapshotState : { loading: true, requests: [], error: '' };
  const currentAction = action.scope === scope ? action : { id: null, error: '' };

  useEffect(() => {
    if (!uid || !staffId || !storeId) return;
    let active = true;
    setSnapshotState({ scope, loading: true, requests: [], error: '' });
    const ownRequests = query(collection(getFirestore(), 'schedule_requests'),
      where('uid', '==', uid), where('staffId', '==', staffId), where('storeId', '==', storeId));
    const unsubscribe = onSnapshot(ownRequests, snapshot => {
      if (!active) return;
      const requests = snapshot.docs.map(item => ({ ...item.data(), id: item.id }))
        .filter(item => item.uid === uid && item.staffId === staffId && item.storeId === storeId)
        .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
      setSnapshotState({ scope, loading: false, requests, error: '' });
    }, error => {
      if (!active) return;
      console.error('No se pudieron cargar las solicitudes propias:', error);
      setSnapshotState({ scope, loading: false, requests: [], error: 'No se pudieron cargar tus solicitudes de horario. Actualiza el listado para reintentar.' });
    });
    return () => { active = false; unsubscribe(); };
  }, [scope, uid, staffId, storeId, reload, refreshKey]);

  const deleteRequest = async request => {
    if (deletingScope.current === scope || request.status !== 'pending'
      || request.uid !== uid || request.staffId !== staffId || request.storeId !== storeId) return;
    if (!window.confirm(`¿Eliminar tu solicitud pendiente del ${dateLabel(request.date)}?`)) return;
    deletingScope.current = scope;
    setAction({ scope, id: request.id, error: '' });
    let timeout;
    try {
      if (!/^[1-9]\d*$/.test(String(request.id))) throw new Error('La solicitud no tiene un identificador válido. Actualiza el listado.');
      const deletion = supabase.from('schedule_requests').delete()
        .eq('id', String(request.id)).eq('user_id', uid).eq('staff_id', staffId)
        .eq('store_id', storeId).eq('status', 'pending').select('id').maybeSingle();
      const result = await Promise.race([deletion, new Promise((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error('La eliminación tardó demasiado. Actualiza el listado para comprobar si se completó.')), 15000);
      })]);
      if (result.error) throw result.error;
      if (!result.data) throw new Error('La solicitud ya fue revisada o eliminada, o no tienes permiso para borrarla. Actualiza el listado para ver su estado actual.');
      if (scopeRef.current === scope) {
        setSnapshotState(previous => previous.scope === scope
          ? { ...previous, requests: previous.requests.filter(item => item.id !== request.id) } : previous);
        setAction({ scope, id: null, error: '' });
      }
    } catch (error) {
      console.error('No se pudo eliminar la solicitud propia:', error);
      if (scopeRef.current === scope) setAction({ scope, id: null, error: error?.message || 'No se pudo eliminar la solicitud. Inténtalo de nuevo.' });
    } finally {
      window.clearTimeout(timeout);
      if (deletingScope.current === scope) deletingScope.current = null;
    }
  };

  if (!uid || !staffId || !storeId) return null;
  return <section data-testid="my-schedule-requests" aria-labelledby="my-schedule-requests-title" className="mb-6 min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-md sm:p-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 id="my-schedule-requests-title" className="flex items-center gap-2 text-lg font-bold text-gray-800"><ClipboardList className="h-5 w-5 shrink-0 text-orange-600" />Mis solicitudes de horario</h2>
      <button type="button" onClick={() => { setAction({ scope, id: null, error: '' }); setReload(value => value + 1); }} disabled={Boolean(currentAction.id)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Actualizar solicitudes</button>
    </div>
    <p className="mb-4 text-sm text-gray-600">Puedes eliminar las solicitudes pendientes. Las solicitudes revisadas se conservan como historial.</p>
    {state.loading && <p role="status" className="text-sm text-gray-600">Cargando tus solicitudes…</p>}
    {state.error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
    {currentAction.error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{currentAction.error}</p>}
    {!state.loading && !state.error && state.requests.length === 0 && <p className="text-sm text-gray-500">Todavía no tienes solicitudes de horario.</p>}
    <div className="space-y-3">
      {state.requests.map(request => {
        const status = STATUS[request.status] || { label: request.status || 'Sin estado', color: 'bg-gray-100 text-gray-700' };
        const busy = currentAction.id === request.id;
        return <article key={request.id} data-testid={`my-request-${request.id}`} className="min-w-0 rounded-xl border border-gray-200 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-800"><Calendar className="h-4 w-4 shrink-0" />{dateLabel(request.date)}</p>
              <p className="mt-1 text-sm text-gray-700">{SHIFT_LABELS[request.shiftType] || request.shiftType || 'Solicitud de horario'}{request.startTime && request.endTime ? ` · ${request.startTime}–${request.endTime}` : ''}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.color}`}>{status.label}</span>
          </div>
          {request.reason && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-600">{request.reason}</p>}
          {request.adminComment && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-700"><span className="font-semibold">Respuesta de administración:</span> {request.adminComment}</p>}
          {request.status === 'pending' && <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => deleteRequest(request)} disabled={Boolean(currentAction.id)} aria-label={`Eliminar solicitud del ${dateLabel(request.date)}`}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-4 w-4" />{busy ? 'Eliminando…' : 'Eliminar solicitud'}</button>
          </div>}
        </article>;
      })}
    </div>
  </section>;
}
