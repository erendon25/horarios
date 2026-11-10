import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { approvedBukShiftLabel } from '../services/bukSchedule';
import { effectiveModality } from '../services/scheduleExportData';

const clock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}${minutes >= 1440 ? ' (+1 día)' : ''}`;
const duration = minutes => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
const nameOf = person => [person?.name, person?.lastName].filter(Boolean).join(' ');
const searchable = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

function Candidate({ candidate, date, onView }) {
  const person = candidate.person;
  const name = nameOf(person);
  const options = candidate.options || [];
  const optionLabel = option => option.manual
    ? `${option.start} → ${option.end} · ${duration(option.duration)}`
    : approvedBukShiftLabel(option);
  const option = item => <li key={item.id || `${item.start}-${item.end}`} className="py-1 text-xs text-slate-700">
    {optionLabel(item)}
    {item.breakStart && <span className="mt-0.5 block text-amber-800">Break fuera del hueco: {item.breakStart}</span>}
  </li>;
  return <article data-coverage-person-id={candidate.id} data-coverage-kind={candidate.kind} className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="break-words text-sm font-bold text-slate-900">{name}</h3><p className="mt-1 text-xs text-slate-500">{[effectiveModality(person, date), person.position].filter(Boolean).join(' · ')}</p></div>
      <button type="button" aria-label={`Ver en editor a ${name}`} onClick={() => onView(candidate)} className="min-h-11 shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">Ver en editor</button>
    </div>
    <div className="mt-3"><p className="text-xs font-semibold text-slate-600">Turnos compatibles con todo el tramo</p><ul>{options.slice(0, 3).map(option)}</ul>
        {options.length > 3 && <details className="mt-2 text-xs text-blue-700"><summary className="min-h-8 cursor-pointer py-1">Ver otros {options.length - 3} turnos</summary><ul>{options.slice(3).map(option)}</ul></details>}
      </div>
  </article>;
}

export default function HeatmapCoverageCandidatesDialog({ selection, result, onClose, onViewCandidate }) {
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const id = useId();
  const [search, setSearch] = useState('');
  const query = searchable(search);
  const available = (result?.available || []).filter(item => searchable(nameOf(item.person)).includes(query));

  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    node.showModal();
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (node.open) node.close();
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-range`} data-testid="heatmap-coverage-candidates"
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="fixed inset-0 m-auto h-[min(850px,calc(100dvh-24px))] max-h-[calc(100dvh-24px)] w-[min(760px,calc(100vw-24px))] max-w-none overflow-hidden rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-200 px-4 py-3 sm:px-6">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id={`${id}-title`} className="text-lg font-bold">Colaboradores para cubrir el tramo</h2>
          <p id={`${id}-range`} data-testid="coverage-selected-range" className="mt-2 break-words text-sm font-semibold text-blue-800">{selection.position} · {clock(selection.start)}–{clock(selection.end)} · {duration(selection.end - selection.start)}</p>
          <p className="mt-1 text-xs text-slate-500">{selection.date?.split('-').reverse().join('/')} · Consulta de disponibilidad</p></div>
          <button ref={closeButton} type="button" aria-label="Cerrar búsqueda de cobertura" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X size={20} aria-hidden="true" /></button>
        </div>
      </header>
      <div data-testid="coverage-candidates-scroll" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-6">
        {!result?.valid ? <p role={result?.pending ? 'status' : 'alert'} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{result?.reason || 'Este tramo ya no tiene un faltante continuo. Vuelve a seleccionarlo en el mapa.'}</p> : <>
          <p className="text-sm text-slate-600">Solo colaboradores sin turno ese día. Se comprueban estudios, habilidades y reglas del plan semanal para cubrir todo el tramo.</p>
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input type="search" aria-label="Buscar candidato para cobertura" placeholder="Buscar colaborador…" value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" /></label>
          {available.length > 0 && <section aria-label="Sin turno asignado"><h3 className="mb-2 text-sm font-bold">Sin turno asignado · {available.length}</h3><div className="space-y-3">{available.map(candidate => <Candidate key={candidate.id} candidate={candidate} date={selection.date} onView={onViewCandidate} />)}</div></section>}
          {!available.length && <p role="status" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{query ? 'Ningún candidato coincide con la búsqueda.' : 'No hay colaboradores compatibles con todo este tramo según los datos actuales.'}</p>}
          {(result.limitations || []).length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{result.limitations.map((message, index) => <p key={index} className="py-1">{message}</p>)}</div>}
          {(result.blocked || []).length > 0 && <details className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600"><summary className="min-h-8 cursor-pointer font-semibold">Por qué otros colaboradores no aparecen ({result.blocked.length})</summary><ul className="mt-2 divide-y divide-slate-100">{result.blocked.map(item => <li key={item.id} className="py-2"><span className="font-semibold">{nameOf(item.person)}</span> · {item.reason}</li>)}</ul></details>}
        </>}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-6"><p className="text-xs text-slate-500">Ver en editor permite revisar el turno. La consulta no asigna horarios.</p><button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Cerrar</button></footer>
    </div>
  </dialog>, document.body);
}
