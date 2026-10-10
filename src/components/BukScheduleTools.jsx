import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { getFirestore, doc, getDoc } from '../lib/supabase/firestoreCompat';
import { useAuth } from '../contexts/AuthContext';
import { createBukWorkbook, createBukPlanningWorkbook } from '../services/bukSchedule';

export default function BukScheduleTools({ storeId, staff, schedules, weekStart }) {
  const { currentUser } = useAuth();
  const [storeName, setStoreName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setStoreName(''); setManagerName(''); setError('');
    if (!storeId) return;
    Promise.all([
      getDoc(doc(getFirestore(), 'stores', storeId)),
      currentUser?.uid ? getDoc(doc(getFirestore(), 'users', currentUser.uid)) : Promise.resolve(null),
    ]).then(([store, user]) => {
      if (!active) return;
      setStoreName(store.exists() ? store.data().name || '' : '');
      const manager = staff.find(person => String(person.position || '').trim().toUpperCase() === 'GERENTE');
      const userData = user?.exists() ? user.data() : {};
      setManagerName(manager ? `${manager.name || ''} ${manager.lastName || ''}`.trim()
        : `${userData.name || userData.first_name || ''} ${userData.lastName || userData.last_name || ''}`.trim());
    }).catch(() => { if (active) setError('No se pudieron consultar los datos de la tienda.'); });
    return () => { active = false; };
  }, [storeId, currentUser?.uid, staff]);
  const data = { staff, schedules, weekStart, storeName, supervisorName: managerName };
  const perform = async action => {
    setError(''); setBusy(true);
    try {
      if (action === 'pdf') {
        const { exportBukPlanningPDF } = await import('../services/bukPlanningPDF');
        exportBukPlanningPDF(data);
      } else XLSX.writeFile(action === 'buk' ? createBukWorkbook(data) : createBukPlanningWorkbook(data), `${action === 'buk' ? 'BUK' : 'Planificacion'}_${weekStart}.xls`, { bookType: 'biff8' });
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  const button = 'rounded-lg px-5 py-2.5 text-white shadow-md font-medium disabled:opacity-50';
  return <div className="contents">
    <button type="button" className={`${button} bg-teal-600`} disabled={busy || !weekStart || !storeName || !managerName} onClick={() => perform('buk')}>Excel BUK</button>
    <button type="button" className={`${button} bg-blue-700`} disabled={busy || !weekStart} onClick={() => perform('planning')}>Excel planificación</button>
    <button type="button" className={`${button} bg-green-600`} disabled={busy || !weekStart} onClick={() => perform('pdf')}>PDF</button>
    {error && <p role="alert" className="w-full whitespace-pre-line text-xs text-red-700">{error}</p>}
  </div>;
}
