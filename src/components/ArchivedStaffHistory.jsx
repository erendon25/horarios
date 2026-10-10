import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';

export default function ArchivedStaffHistory({ storeId, onClose }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState('');
  const [archive, setArchive] = useState(null);
  const [weekId, setWeekId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = bodyOverflow; };
  }, []);
  useEffect(() => {
    let active = true;
    supabase.from('staff_history_archives').select('id,display_name,archived_at').eq('store_id', storeId).order('display_name')
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure) setError('No se pudo consultar el archivo.');
        else { setRows(data || []); setSelected(data?.[0]?.id || ''); }
        setLoading(false);
      });
    return () => { active = false; };
  }, [storeId]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true); setError(''); setArchive(null);
    supabase.from('staff_history_archives').select('staff_snapshot,records').eq('id', selected).eq('store_id', storeId).maybeSingle()
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure) setError('No se pudo cargar el registro histórico.');
        else {
          setArchive(data);
          const weeks = [...(data?.records?.schedule_weeks || [])].sort((a, b) => b.week_start.localeCompare(a.week_start));
          setWeekId(String(weeks[0]?.id || ''));
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [selected, storeId]);
  const weeks = [...(archive?.records?.schedule_weeks || [])].sort((a, b) => b.week_start.localeCompare(a.week_start));
  const shifts = (archive?.records?.schedule_shifts || []).filter(s => String(s.schedule_week_id) === weekId).sort((a, b) => a.work_date.localeCompare(b.work_date));
  const time = value => String(value || '').slice(0, 5);
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="archived-history-title" className="w-full max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex justify-between gap-4 p-5 border-b shrink-0">
        <div><h2 id="archived-history-title" className="text-xl font-bold">Archivo de horarios</h2><p className="text-sm text-gray-500">Registros de consulta sin cuenta ni perfil de colaborador vinculado.</p></div>
        <button onClick={onClose} aria-label="Cerrar archivo" className="px-3 text-xl">×</button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-5 space-y-4">
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <label className="block">Nombre conservado en el archivo
          <select className="block border rounded p-2 mt-1 w-full" value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Seleccionar registro</option>{rows.map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}
          </select>
        </label>
        {loading ? <p>Cargando archivo…</p> : !rows.length ? <p>No hay registros archivados de esta tienda.</p> : archive && <>
          <p className="text-sm text-gray-500">{weeks.length} semanas conservadas. Este nombre es texto histórico y no puede seleccionarse para registrar una cuenta.</p>
          <label className="block">Semana archivada<select className="block border rounded p-2 mt-1" value={weekId} onChange={e => setWeekId(e.target.value)}>
            <option value="">Sin semana seleccionada</option>{weeks.map(w => <option key={w.id} value={w.id}>{w.week_start}</option>)}
          </select></label>
          <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Fecha', 'Turno', 'Posición', 'Notas'].map(t => <th className="p-2 border-b" key={t}>{t}</th>)}</tr></thead>
            <tbody>{shifts.map(s => <tr key={s.id}><td className="p-2 border-b whitespace-nowrap">{s.work_date}</td><td className="p-2 border-b whitespace-nowrap">{s.is_day_off ? 'DESCANSO' : s.is_holiday ? 'FERIADO' : s.start_time && s.end_time ? `${time(s.start_time)}–${time(s.end_time)}` : 'S/A'}{s.metadata?.splitShift && s.metadata.start2 && s.metadata.end2 && <div>{s.metadata.start2}–{s.metadata.end2}</div>}</td><td className="p-2 border-b">{s.position || '—'}</td><td className="p-2 border-b">{s.notes || '—'}</td></tr>)}</tbody>
          </table></div>
          {['extra_hours', 'worked_holidays'].map(key => (archive.records[key] || []).length > 0 && <details key={key}><summary className="cursor-pointer font-semibold">{key === 'extra_hours' ? 'Horas extra' : 'Feriados trabajados'} ({archive.records[key].length})</summary><div className="overflow-x-auto mt-2"><table className="w-full text-sm text-left"><thead><tr><th className="p-2">Fecha</th><th className="p-2">Detalle</th></tr></thead><tbody>{archive.records[key].map((r, i) => <tr key={i}><td className="p-2 border-b">{r.work_date || r.holiday_date || '—'}</td><td className="p-2 border-b">{key === 'extra_hours' ? `${r.duration_minutes || 0} minutos${r.activity ? ` · ${r.activity}` : ''}` : r.name || 'Feriado trabajado'}</td></tr>)}</tbody></table></div></details>)}
        </>}
      </div>
    </section>
  </div>;
}
