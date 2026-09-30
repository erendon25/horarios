import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { readHolidayLedger, summarizeHolidayLedger, holidayMovementLabel } from '../services/holidayBalance';

export default function HolidayBalancePanel({ staffId, previousBalance, refreshKey = 0, canDelete = false, onChanged }) {
  const [state, setState] = useState({ rows: [], loading: true, error: '', staffId });
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState(null);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setState({ rows: [], loading: true, error: '', staffId });
    if (staffId) readHolidayLedger(supabase, { staffId }).then(rows => {
      if (!cancelled) setState({ rows, loading: false, error: '', staffId });
    }).catch(() => {
      if (!cancelled) setState({ rows: [], loading: false, error: 'No se pudieron consultar los feriados. Reintenta; no significa que tu saldo sea cero.', staffId });
    });
    return () => { cancelled = true; };
  }, [staffId, refreshKey, reload]);
  const loading = state.loading || state.staffId !== staffId;
  const totals = summarizeHolidayLedger(state.rows);
  const remove = async row => {
    if (!canDelete || deleting !== null || !window.confirm('¿Eliminar este movimiento? Cambiará el saldo calculado. Para indicar pago en boleta, usa la configuración por fecha, no elimines el registro. Los movimientos generados por un horario pueden reaparecer al guardar esa semana.')) return;
    setDeleting(row.id); setActionError('');
    try {
      const { error } = await supabase.from('worked_holidays').delete().eq('id', row.id).eq('staff_id', staffId).select('id').single();
      if (error) throw error;
      setReload(value => value + 1); onChanged?.();
    } catch { setActionError('No se pudo eliminar el movimiento. El saldo no se ha ajustado manualmente.'); }
    finally { setDeleting(null); }
  };
  return <section className="mb-6 rounded-2xl border border-purple-200 bg-white p-5 shadow-sm" aria-label="Mis feriados acumulados">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h2 className="text-xl font-bold text-purple-950">Feriados acumulados</h2>
      <button type="button" onClick={() => setReload(value => value + 1)} disabled={loading} className="rounded-lg border border-purple-300 px-3 py-2 text-sm text-purple-800 disabled:opacity-50">Actualizar saldo</button>
    </div>
    {actionError && <p role="alert" className="mb-3 text-red-700">{actionError}</p>}
    {loading ? <p role="status">Consultando movimientos…</p> : state.error ? <p role="alert" className="text-red-700">{state.error}</p> : <>
      <p className="text-3xl font-bold text-purple-900">{totals.balance} días <span className="text-base font-normal">de saldo calculado</span></p>
      <p className="mt-2 text-sm text-gray-600">{totals.earned} acumulados para descanso − {totals.compensated} compensados. {totals.payroll} destinados a boleta: no suman días.</p>
      <p className="mt-2 text-xs text-gray-500">Se calcula con los movimientos registrados hasta hoy. «Destinado a boleta» indica la decisión de la empresa, no confirma que el pago ya se haya realizado.</p>
      {totals.scheduled > 0 && <p className="mt-2 text-sm text-blue-800">{totals.scheduled} movimientos futuros: todavía no afectan el saldo.</p>}
      {previousBalance != null && Number(previousBalance) !== totals.balance && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Pendiente de revisión: el saldo anterior del perfil ({Number(previousBalance)} días) no coincide con estos movimientos. Administración debe validar si faltan compensaciones o pagos históricos. No se ha borrado el saldo anterior.</p>}
      {totals.balance < 0 && <p className="mt-2 text-sm text-red-700">El historial registra más descansos compensados que días acumulados. Solicita su revisión.</p>}
      <details className="mt-4">
        <summary className="cursor-pointer font-semibold text-purple-900">Ver historial ({state.rows.length})</summary>
        {state.rows.length === 0 ? <p className="mt-3 text-sm text-gray-600">No hay movimientos registrados.</p> : <ul className="mt-3 max-h-96 overflow-y-auto divide-y divide-gray-100">
          {state.rows.map(row => <li key={row.id} className="py-3">
            <div className="flex items-start justify-between gap-3"><div>
              <p className="font-medium">{new Date(`${row.holiday_date}T12:00:00`).toLocaleDateString('es-PE')} · {row.name}</p>
              <p className="text-sm text-gray-600">{holidayMovementLabel(row)}</p>
              {row.payment_note && <p className="text-xs text-gray-500">{row.payment_note}</p>}
            </div><div className="text-right"><span className="whitespace-nowrap font-bold">{row.balance_delta > 0 ? '+' : ''}{row.balance_delta} días</span>
              {canDelete && <button type="button" disabled={deleting !== null} onClick={() => remove(row)} className="mt-2 block text-xs text-red-700 underline">Eliminar registro</button>}
            </div></div>
          </li>)}
        </ul>}
      </details>
    </>}
  </section>;
}
