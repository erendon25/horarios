import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, Search, X } from 'lucide-react';

const filters = [['all', 'Todos'], ['unassigned', 'Sin turno'], ['alerts', 'Con alertas']];
const nativeDialogOpen = () => Boolean(document.querySelector('dialog[open]'));

function useDesktopPanel() {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const change = () => setDesktop(media.matches);
    change();
    if (media.addEventListener) media.addEventListener('change', change);
    else media.addListener(change);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', change);
      else media.removeListener(change);
    };
  }, []);
  return desktop;
}

const fullName = person => [person?.name, person?.lastName].filter(Boolean).join(' ') || 'Colaborador';
const shiftLabel = item => item.ceased ? 'Cese' : item.off ? 'Día libre' : item.holiday ? 'Feriado compensado' : item.shiftLabel || 'Sin turno';

function ScheduleModalityBadge({ modality, id }) {
  const text = String(modality ?? '').trim();
  const compact = text.toLowerCase().replace(/[\s_-]+/g, '');
  const kind = ['fulltime', 'full', 'ft'].includes(compact) ? 'full-time'
    : ['parttime', 'part', 'pt'].includes(compact) ? 'part-time' : 'unknown';
  const label = kind === 'full-time' ? 'Full-Time' : kind === 'part-time' ? 'Part-Time' : text || 'Sin modalidad';
  const color = kind === 'full-time' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : kind === 'part-time' ? 'border-violet-200 bg-violet-50 text-violet-800' : 'border-slate-200 bg-slate-100 text-slate-700';
  return <span id={id} data-testid="focus-modality-badge" data-modality={kind}
    className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-5 ${kind === 'unknown' ? 'max-w-[50%] break-words whitespace-normal' : 'whitespace-nowrap'} ${color}`}>{label}</span>;
}

export default function ScheduleFocusStaffPanel({
  open, onClose, items = [], selectedId, selectedPerson, selectedModality, onSelect, onBack,
  search = '', onSearchChange, filter = 'all', onFilterChange,
  scrollRef, renderEditor, dayLabel, draftReady = true, returnFocusRef,
}) {
  const desktop = useDesktopPanel();
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const backRef = useRef(null);
  const listRef = useRef(null);
  const rowRefs = useRef(new Map());
  const scrollTop = useRef(0);
  const previousSelection = useRef(null);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  const hasSelection = selectedId !== undefined && selectedId !== null && selectedId !== '';
  const selectedItem = items.find(item => item.id === selectedId);
  const person = selectedPerson || selectedItem?.person || selectedItem;
  const name = selectedItem?.name || fullName(person);
  const modality = selectedModality ?? selectedItem?.modality ?? person?.modality;
  const role = selectedItem?.role || person?.position || person?.role;

  const setListNode = useCallback(node => {
    listRef.current = node;
    if (typeof scrollRef === 'function') scrollRef(node);
    else if (scrollRef) scrollRef.current = node;
    if (node) node.scrollTop = scrollTop.current;
  }, [scrollRef]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    if (!nativeDialogOpen()) closeRef.current?.focus({ preventScroll: true });
    return () => {
      queueMicrotask(() => {
        const target = returnFocusRef?.current || previousFocus;
        if (!nativeDialogOpen() && target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
      });
    };
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (open && !nativeDialogOpen() && !panelRef.current?.contains(document.activeElement)) {
      closeRef.current?.focus({ preventScroll: true });
    }
  }, [open, desktop]);

  useEffect(() => {
    if (!open || desktop) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousPageOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      // Restore after nested editor dialogs have performed their own cleanup.
      queueMicrotask(() => {
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousPageOverflow;
      });
    };
  }, [open, desktop]);

  useEffect(() => {
    if (!open) return undefined;
    const keydown = event => {
      // A native approved-shift dialog owns its keyboard and focus until closed.
      if (nativeDialogOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeAction.current?.();
        return;
      }
      if (desktop || event.key !== 'Tab') return;
      const nodes = [...(panelRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex]:not([tabindex="-1"])') || [])]
        .filter(node => {
          if (node.closest('[hidden]') || !node.getClientRects().length) return false;
          // A closed details exposes only its first summary to the keyboard.
          for (let parent = node.parentElement; parent && parent !== panelRef.current; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS' && !parent.open && node !== [...parent.children].find(child => child.tagName === 'SUMMARY')) return false;
          }
          return true;
        });
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      const outside = !panelRef.current?.contains(document.activeElement);
      if (outside || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [open, desktop]);

  useEffect(() => {
    if (!open) return;
    if (hasSelection) {
      previousSelection.current = selectedId;
      if (!nativeDialogOpen()) backRef.current?.focus({ preventScroll: true });
    } else {
      if (listRef.current) listRef.current.scrollTop = scrollTop.current;
      if (previousSelection.current !== null && !nativeDialogOpen()) {
        const previousRow = rowRefs.current.get(previousSelection.current);
        (previousRow || closeRef.current)?.focus({ preventScroll: true });
        previousSelection.current = null;
      }
    }
  }, [open, hasSelection, selectedId, desktop]);

  if (!open) return null;

  const resetListScroll = () => {
    scrollTop.current = 0;
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const panel = <aside ref={panelRef} id="focus-staff-panel" data-testid="focus-staff-panel"
    role={desktop ? undefined : 'dialog'} aria-modal={desktop ? undefined : true} aria-labelledby={titleId}
    className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] min-h-0 min-w-0 flex-col overflow-hidden rounded-t-2xl border border-blue-100 bg-white shadow-2xl lg:relative lg:inset-auto lg:z-auto lg:h-full lg:max-h-full lg:w-[400px] lg:shrink-0 lg:self-stretch lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none">
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
      <div className="min-w-0"><h2 id={titleId} className="text-base font-bold text-slate-900">Colaboradores</h2>
        {dayLabel && <p className="mt-1 break-words text-sm text-slate-600">{dayLabel}</p>}
        {!draftReady && <p role="status" className="mt-1 text-xs text-blue-700">Cargando horario...</p>}
      </div>
      <button ref={closeRef} type="button" aria-label="Cerrar panel de colaboradores" onClick={onClose}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"><X className="h-5 w-5" aria-hidden="true" /></button>
    </header>

    <div data-testid="focus-staff-list" hidden={hasSelection} className={`${hasSelection ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col`}>
      <div className="shrink-0 space-y-3 border-b border-slate-100 p-4">
        <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input type="search" aria-label="Buscar colaborador" placeholder="Buscar colaborador..." value={search}
            onChange={event => { resetListScroll(); onSearchChange?.(event.target.value); }}
            className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <div className="grid grid-cols-3 gap-2" aria-label="Filtros de colaboradores">{filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value}
          onClick={() => { resetListScroll(); onFilterChange?.(value); }}
          className={`min-h-11 rounded-full border px-2 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${filter === value ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-blue-50'}`}>{label}</button>)}</div>
      </div>
      <div ref={setListNode} data-testid="focus-staff-list-scroll" onScroll={event => { if (!hasSelection) scrollTop.current = event.currentTarget.scrollTop; }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {items.length ? items.map(item => <button key={item.id} type="button" data-focus-person-id={item.id}
          aria-label={`Seleccionar a ${item.name || 'colaborador'}`} aria-pressed={selectedId === item.id}
          aria-describedby={`${titleId}-${item.id}-modality${item.role ? ` ${titleId}-${item.id}-metadata` : ''} ${titleId}-${item.id}-shift ${titleId}-${item.id}-hours${item.hasAlert ? ` ${titleId}-${item.id}-alert` : ''}`}
          ref={node => { if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id); }}
          onClick={() => { scrollTop.current = listRef.current?.scrollTop || 0; onSelect?.(item.id); }}
          className={`min-h-20 w-full rounded-xl border p-3 text-left transition-colors hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ${item.hasAlert ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
          <span className="flex items-start justify-between gap-2"><span data-testid="focus-staff-name" className="min-w-0 flex-1 break-words text-sm font-bold leading-snug text-slate-900">{item.name || 'Colaborador'}</span>
            <ScheduleModalityBadge id={`${titleId}-${item.id}-modality`} modality={item.modality} />
            {item.hasAlert && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />}
          </span>
          {item.role && <span id={`${titleId}-${item.id}-metadata`} className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{item.role}</span>}
          <span id={`${titleId}-${item.id}-shift`} className="mt-2 block text-sm font-semibold tabular-nums text-slate-800">{shiftLabel(item)}</span>
          <span id={`${titleId}-${item.id}-hours`} className="mt-1 block break-words text-xs text-slate-600">{item.position || 'Sin puesto'} · Día {item.dailyHours ?? '—'} · Semana {item.weeklyHours ?? '—'}</span>
          {item.hasAlert && <span id={`${titleId}-${item.id}-alert`} className="mt-2 block text-xs font-medium text-amber-800">{item.alertLabel || 'Revisar turno'}</span>}
        </button>) : <p role="status" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No hay colaboradores que coincidan con los filtros.</p>}
      </div>
    </div>

    {hasSelection && <div data-testid="focus-staff-editor" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-slate-100 p-4">
        <button ref={backRef} type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Volver a la lista</button>
        <div><div className="flex flex-wrap items-start gap-x-2 gap-y-1"><h3 data-testid="focus-staff-name" className="min-w-0 flex-1 basis-[180px] break-words text-base font-bold text-slate-900">{name}</h3>
          <ScheduleModalityBadge modality={modality} />
        </div>
          {role && <p className="mt-2"><span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{role}</span></p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {person ? renderEditor?.(person) : <p role="status" className="text-sm text-slate-600">Este colaborador ya no está en la lista. Vuelve para seleccionar otro.</p>}
      </div>
    </div>}
  </aside>;

  if (desktop || typeof document === 'undefined') return panel;
  return createPortal(<div className="fixed inset-0 z-50">
    <button type="button" aria-label="Cerrar panel de colaboradores desde el fondo" onClick={onClose} tabIndex={-1} className="absolute inset-0 h-full w-full bg-slate-950/40" />
    {panel}
  </div>, document.body);
}
