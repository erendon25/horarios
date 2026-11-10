import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { approvedBukShiftLabel } from '../services/bukSchedule';

const searchable = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const clockMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export default function ApprovedShiftPicker({
  options = [], value = '', onChange, label, placeholder = 'Elegir ingreso…',
  contextLabel, contextKey, disabled = false, currentLabel,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const dialog = useRef(null);
  const trigger = useRef(null);
  const closeButton = useRef(null);
  const openedContext = useRef(null);
  const applying = useRef(false);
  const operationVersion = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const latest = useRef({ options, disabled, contextKey, onChange });
  latest.current = { options, disabled, contextKey, onChange };
  const id = useId();
  const selected = options.find(option => option.id === value);
  const selectedLabel = currentLabel || (selected ? approvedBukShiftLabel(selected) : '') || placeholder;
  const query = searchable(search);
  const visible = useMemo(() => options.filter(option => searchable(approvedBukShiftLabel(option)).includes(query)), [options, query]);

  const close = () => {
    operationVersion.current += 1;
    applying.current = false;
    setChoosing(false);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const node = dialog.current;
    if (!node) return undefined;
    node.showModal();
    const bodyOverflow = document.body.style.overflow;
    const pageOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    // Keep the mobile keyboard closed until the user explicitly taps Search.
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      operationVersion.current += 1;
      applying.current = false;
      if (node.open) node.close();
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = pageOverflow;
      if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (open && (disabled || openedContext.current !== contextKey)) close();
  }, [open, disabled, contextKey]);

  const choose = async optionId => {
    if (applying.current) return;
    const current = latest.current;
    if (!openRef.current || current.disabled || current.contextKey !== openedContext.current) {
      close();
      return;
    }
    if (!current.options.some(option => option.id === optionId)) {
      setError('Ese horario ya no está disponible. Revisa las opciones y vuelve a elegir.');
      return;
    }
    applying.current = true;
    const version = ++operationVersion.current;
    const scope = current.contextKey;
    setChoosing(true); setError('');
    try {
      const applied = await current.onChange(optionId);
      if (version !== operationVersion.current || latest.current.contextKey !== scope || !openRef.current) return;
      if (applied === false) {
        setError('Ese horario ya no está disponible. Revisa las opciones y vuelve a elegir.');
        return;
      }
      close();
    } catch (cause) {
      if (version === operationVersion.current && latest.current.contextKey === scope && openRef.current) {
        setError(cause?.message || 'No se pudo seleccionar el horario. Vuelve a intentarlo.');
      }
    } finally {
      if (version === operationVersion.current) {
        applying.current = false;
        setChoosing(false);
      }
    }
  };

  return <>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={`${id}-dialog`} data-selected-shift-id={value || ''} disabled={disabled} title={selectedLabel}
      onClick={() => {
        if (latest.current.disabled) return;
        openedContext.current = latest.current.contextKey;
        operationVersion.current += 1;
        applying.current = false;
        setSearch(''); setError(''); setChoosing(false); setOpen(true);
      }}
      className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-left text-xs font-semibold leading-relaxed text-gray-900 hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500">
      <span className="min-w-0 break-words">{selectedLabel}</span><ChevronDown className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
    </button>
    {open && typeof document !== 'undefined' && createPortal(
      <dialog ref={dialog} id={`${id}-dialog`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-context`}
        onCancel={event => { event.preventDefault(); close(); }}
        onClose={() => { if (openRef.current) close(); }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
        className="fixed inset-0 m-auto h-[min(900px,calc(100dvh-24px))] max-h-[calc(100dvh-24px)] w-[min(900px,calc(100vw-24px))] max-w-none overflow-hidden rounded-2xl border-0 bg-white p-0 font-sans text-gray-900 shadow-2xl backdrop:bg-black/60">
        <div className="flex h-full min-h-0 flex-col">
          <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h2 id={`${id}-title`} className="text-xl font-bold">Seleccionar horario</h2>
                <p id={`${id}-context`} className="mt-1 break-words text-sm text-gray-600">{contextLabel || 'Elige un horario disponible.'}</p>
              </div>
              <button ref={closeButton} type="button" aria-label="Cerrar selector de horarios" onClick={close}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"><X className="h-5 w-5" aria-hidden="true" /></button>
            </div>
            {currentLabel && value && !selected && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Horario actual: {currentLabel}</p>}
            <label className="relative mt-4 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input type="search" aria-label="Buscar horario" placeholder="Buscar horario…" value={search} onChange={event => { setSearch(event.target.value); setError(''); }}
                className="min-h-11 w-full min-w-0 rounded-xl border border-gray-300 bg-white py-2 pl-10 pr-3 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
          </header>
          <div data-testid="approved-shift-options" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            {visible.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{visible.map(option => {
              const details = approvedBukShiftLabel(option).split(' · ').slice(1).join(' · ');
              const overnight = clockMinutes(option.end) <= clockMinutes(option.start);
              return <button key={option.id} type="button" data-shift-id={option.id} aria-label={approvedBukShiftLabel(option)}
                aria-pressed={value === option.id} disabled={choosing} onClick={() => choose(option.id)}
                className={`min-h-[112px] w-full rounded-xl border-2 p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${value === option.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50'}`}>
                <span className="flex items-center justify-between gap-3">
                  <span><span className="block text-xs font-semibold text-gray-500">Ingreso</span><span className="text-xl font-bold tabular-nums">{option.start}</span></span>
                  <span aria-hidden="true" className="text-xl text-gray-400">→</span>
                  <span><span className="block text-xs font-semibold text-gray-500">Salida</span><span className="text-xl font-bold tabular-nums">{option.end}</span></span>
                  {value === option.id && <Check className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />}
                </span>
                <span className="mt-3 block text-sm text-gray-700">{details}</span>
                {overnight && <span className="mt-1 block text-xs text-gray-500">Salida al día siguiente</span>}
              </button>;
            })}</div> : <p role="status" className="rounded-xl bg-gray-50 p-5 text-sm text-gray-600">{options.length ? 'No hay horarios que coincidan con la búsqueda.' : 'No hay horarios disponibles para este día. Revisa la disponibilidad o la distribución semanal.'}</p>}
          </div>
          <footer className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
            {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <div className="flex items-center justify-between gap-3"><p role="status" aria-live="polite" className="text-xs text-gray-600">{visible.length} {visible.length === 1 ? 'horario disponible' : 'horarios disponibles'}</p>
              <button type="button" onClick={close} className="min-h-11 rounded-xl border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">Cerrar selector</button></div>
          </footer>
        </div>
      </dialog>, document.body,
    )}
  </>;
}
