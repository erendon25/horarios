import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, X, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase/client';
import { parseStaffPlanilla, buildStaffImportPreview } from '../services/staffPlanillaImport';
import { importStaffPlanilla } from '../services/staffPlanillaImportClient';

const actions = {
  create: 'Nuevo', existing: 'Ya registrado', inactive: 'Inactivo / cesado',
  other_store: 'Otra tienda', duplicate: 'Repetido en archivo', invalid: 'Revisar datos',
};

export default function StaffPlanillaImport({ storeId, storeName, staff = [], onImported }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [refreshError, setRefreshError] = useState('');
  const [confirmed, setConfirmed] = useState([]);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const requestVersion = useRef(0);
  const submitting = useRef(false);
  const scope = useRef({ storeId, storeName });
  scope.current = { storeId, storeName };
  const busy = reading || saving;
  const knownStaff = useMemo(() => [...staff, ...confirmed.filter(person => !staff.some(existing => existing.id === person.id))], [staff, confirmed]);
  const preview = useMemo(() => parsed ? buildStaffImportPreview(parsed, { staff: knownStaff, storeId, storeName, now: new Date() }) : null,
    [parsed, knownStaff, storeId, storeName]);
  const warnings = [...new Set((parsed?.warnings ?? []).map(warning => typeof warning === 'string' ? warning : warning.message))];

  useEffect(() => {
    requestVersion.current++;
    setParsed(null); setResult(null); setFileName(''); setError(''); setRefreshError(''); setConfirmed([]); setReading(false);
  }, [storeId, storeName]);
  useEffect(() => {
    if (!open) return;
    dialog.current.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; trigger.current?.focus(); };
  }, [open]);
  useEffect(() => () => { requestVersion.current++; }, []);

  const close = () => {
    if (submitting.current) return;
    requestVersion.current++;
    setReading(false); setOpen(false);
  };
  async function readFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || submitting.current) return;
    const version = ++requestVersion.current;
    setParsed(null); setResult(null); setFileName(file.name); setError(''); setRefreshError(''); setReading(true);
    try {
      if (!/\.(xls|xlsx)$/i.test(file.name)) throw new Error('Selecciona una planilla Excel .xls o .xlsx.');
      if (file.size > 5 * 1024 * 1024) throw new Error('La planilla debe pesar menos de 5 MB.');
      const buffer = await file.arrayBuffer();
      if (version !== requestVersion.current) return;
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellFormula: true, bookVBA: false });
      const next = parseStaffPlanilla(workbook);
      if (version !== requestVersion.current) return;
      setParsed(next);
    } catch (cause) {
      if (version === requestVersion.current) setError(cause.message || 'No se pudo leer la planilla.');
    } finally {
      if (version === requestVersion.current) setReading(false);
    }
  }
  async function save() {
    if (submitting.current || !preview?.creatable.length || busy) return;
    submitting.current = true; setSaving(true); setError(''); setResult(null); setRefreshError('');
    const target = { storeId, storeName };
    try {
      const imported = await importStaffPlanilla(supabase, { storeId, rows: preview.creatable, fileName });
      if (scope.current.storeId !== target.storeId || scope.current.storeName !== target.storeName) return;
      setResult(imported);
      setConfirmed(previous => [...previous, ...imported.created.map(person => ({ ...person, storeId, status: 'pending', needsCompletion: true }))]);
      try { await onImported?.(); }
      catch { setRefreshError('Los colaboradores se guardaron. Usa «Actualizar lista» para verlos en el panel.'); }
    } catch (cause) {
      setError(cause.message || 'No se pudo guardar la importación.');
    } finally { submitting.current = false; setSaving(false); }
  }

  return <>
    <button type="button" ref={trigger} disabled={!storeId || !storeName}
      onClick={() => setOpen(true)}
      className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-indigo-200 px-5 py-3 text-sm font-bold text-indigo-700 transition-all hover:bg-indigo-50 disabled:opacity-50">
      <Upload className="h-4 w-4" aria-hidden="true" />Importar planilla BUK
    </button>
    {open && <dialog ref={dialog} aria-labelledby="staff-planilla-title" onCancel={event => { event.preventDefault(); if (!saving) close(); }}
      onClose={() => { if (!submitting.current) setOpen(false); }}
      className="fixed inset-0 m-auto max-h-[92dvh] w-[min(960px,calc(100vw-24px))] max-w-none overflow-hidden rounded-2xl border-0 p-0 shadow-2xl backdrop:bg-black/50">
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4">
          <div><h2 id="staff-planilla-title" className="text-lg font-bold text-gray-900">Importar colaboradores</h2>
            <p className="text-sm text-gray-600">Tienda: {storeName}</p></div>
          <button type="button" aria-label="Cerrar importación" disabled={saving} onClick={close} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="text-sm text-gray-600">Carga la planilla para revisar el nombre completo, DNI, modalidad y cargo. Los demás datos podrán completarse después desde «Editar». El perfil se marcará como completo al registrar la fecha de ingreso y el carnet; el correo es opcional.</p>
          <label className="block rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-4 text-sm font-medium text-indigo-900">
            <span className="mb-2 flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" aria-hidden="true" />Planilla de colaboradores (.xls o .xlsx)</span>
            <input type="file" accept=".xls,.xlsx" aria-label="Planilla de colaboradores" disabled={busy} onChange={readFile}
              className="block w-full min-w-0 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:font-semibold" />
          </label>
          {reading && <p role="status" className="text-sm text-indigo-800">Leyendo planilla…</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {result && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <p className="font-bold">{result.createdCount} colaboradores agregados. {result.skippedCount} ya estaban registrados y se omitieron.</p>
            <p>Los perfiles están guardados y los datos adicionales pueden completarse después.</p>
            {refreshError && <p className="mt-1">{refreshError}</p>}
          </div>}
          {preview && <>
            <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Resumen de la planilla">
              <span className="rounded-full bg-indigo-100 px-3 py-1 font-bold text-indigo-900">{preview.creatable.length} nuevos</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">{preview.rows.length - preview.creatable.length} omitidos</span>
              <span className="break-all text-xs text-gray-500">{fileName}</span>
            </div>
            <p className="text-xs text-gray-600">Solo se agregarán las filas marcadas «Nuevo». Los DNI existentes se conservan y el personal cesado no se reactiva.</p>
            {!!warnings.length && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{warnings.map(message => <p key={message}>{message}</p>)}</div>}
            {!preview.rows.length && <p className="text-sm text-gray-600">No se encontraron colaboradores en la planilla.</p>}
            {!!preview.rows.length && <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="bg-gray-50 text-gray-600"><tr>
                  {['Nombre completo','DNI','Modalidad','Cargo','Resultado'].map(title => <th key={title} className="px-3 py-3 font-semibold">{title}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100">{preview.rows.map((row, index) => <tr key={`${row.rowNumber}-${index}`} className={row.action === 'create' ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-3 font-medium text-gray-900">{row.fullName || [row.name,row.lastName].filter(Boolean).join(' ') || `Fila ${row.rowNumber}`}</td>
                  <td className="whitespace-nowrap px-3 py-3">{row.dni || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3">{row.modality || '—'}</td>
                  <td className="px-3 py-3">{row.position || '—'}</td>
                  <td className="px-3 py-3"><span className={row.action === 'create' ? 'font-semibold text-indigo-800' : 'font-semibold text-gray-700'}>{actions[row.action] || 'Revisar'}</span>
                    {row.reason && <p className="mt-1 max-w-[240px] text-gray-500">{row.reason}</p>}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            {!!preview.errors?.length && <div className="space-y-1 text-xs text-red-700">{preview.errors.map((issue,index) => <p key={index}>{typeof issue === 'string' ? issue : issue.message}</p>)}</div>}
          </>}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-5 py-4">
          <button type="button" disabled={saving} onClick={close} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50">Cerrar</button>
          <button type="button" disabled={busy || !preview?.creatable.length} onClick={save}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Agregando…' : `Agregar ${preview?.creatable.length || 0} colaboradores`}
          </button>
        </footer>
      </div>
    </dialog>}
  </>;
}
