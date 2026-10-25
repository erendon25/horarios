import { useCallback, useEffect, useState } from 'react';
import { db, doc, getDoc, onSnapshot } from '../lib/supabase/firestoreCompat';
import { normalizeScheduleAccessPolicy } from '../services/scheduleAccessPolicy.js';

const policyRef = (storeId) => doc(db, 'stores', storeId, 'config', 'schedule_access');
const storeKey = (storeId) => typeof storeId === 'string' ? storeId.trim() : '';
const normalizeSnapshot = (snapshot) => normalizeScheduleAccessPolicy(snapshot.exists() ? snapshot.data() ?? null : undefined);
const asError = (error) => error instanceof Error ? error : new Error('No se pudo consultar la configuración de horarios.');

export const readScheduleAccessPolicy = async (storeId) => {
  const key = storeKey(storeId);
  if (!key) throw Object.assign(
    new Error('Selecciona una tienda para consultar la configuración de horarios.'),
    { code: 'schedule_store_required' },
  );
  return normalizeSnapshot(await getDoc(policyRef(key)));
};

export const useScheduleAccessPolicy = (storeId) => {
  const key = storeKey(storeId);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ storeId: null, attempt: null, policy: null, status: 'idle', error: null });
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!key) {
      setState({ storeId: null, attempt, policy: null, status: 'idle', error: null });
      return undefined;
    }
    let active = true;
    let unsubscribe;
    setState({ storeId: key, attempt, policy: null, status: 'loading', error: null });
    const fail = (error) => {
      if (active) setState({ storeId: key, attempt, policy: null, status: 'error', error: asError(error) });
    };
    try {
      unsubscribe = onSnapshot(policyRef(key), (snapshot) => {
        if (!active) return;
        try {
          const policy = normalizeSnapshot(snapshot);
          setState({ storeId: key, attempt, policy, status: 'ready', error: null });
        } catch (error) { fail(error); }
      }, fail);
    } catch (error) { fail(error); }
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [key, attempt]);

  // Store changes and retries invalidate permissions during the first render,
  // before effect cleanup runs. A delayed response cannot expose a prior policy.
  if (!key) return { policy: null, status: 'idle', error: null, retry };
  if (state.storeId !== key || state.attempt !== attempt) {
    return { policy: null, status: 'loading', error: null, retry };
  }
  return { policy: state.policy, status: state.status, error: state.error, retry };
};

export default useScheduleAccessPolicy;
