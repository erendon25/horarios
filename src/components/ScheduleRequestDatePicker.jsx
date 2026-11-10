import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLimaToday, getRequestDateAccess } from '../services/scheduleAccessPolicy';

const monthLabel = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdays = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const dateLabel = date => date.split('-').reverse().join('/');

export default function ScheduleRequestDatePicker({ value, onChange, policy, status, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value || getLimaToday()).slice(0, 7));
  useEffect(() => { if (value) setMonth(value.slice(0, 7)); }, [value]);
  const first = new Date(`${month}-01T12:00:00Z`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const offset = (first.getUTCDay() + 6) % 7;
  const unavailable = disabled || status !== 'ready';
  const navigate = delta => {
    const next = new Date(first);
    next.setUTCMonth(next.getUTCMonth() + delta);
    const year = next.getUTCFullYear();
    if (year >= 1 && year <= 9999) setMonth(next.toISOString().slice(0, 7));
  };

  return (
    <div className="min-w-0">
      <input type="date" name="date" aria-label="Fecha de la solicitud" value={value}
        onChange={event => onChange(event.target.value)} disabled={unavailable} required
        className="w-full min-w-0 max-w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
      <button type="button" aria-expanded={open} onClick={() => setOpen(previous => !previous)}
        className="mt-2 rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 underline">
        {open ? 'Ocultar calendario disponible' : 'Ver calendario disponible'}
      </button>
      {open && (
        <div aria-label="Calendario de fechas habilitadas" className="mt-2 rounded-xl border border-blue-200 bg-white p-2 sm:p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" aria-label="Mes anterior" onClick={() => navigate(-1)} className="rounded-lg p-2 hover:bg-blue-50"><ChevronLeft className="h-4 w-4" /></button>
            <span aria-live="polite" className="text-center text-sm font-bold capitalize">{monthLabel.format(first)}</span>
            <button type="button" aria-label="Mes siguiente" onClick={() => navigate(1)} className="rounded-lg p-2 hover:bg-blue-50"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdays.map((day, index) => <span key={`heading-${index}`} className="py-1 text-xs font-bold text-gray-500">{day}</span>)}
            {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
            {Array.from({ length: last.getUTCDate() }, (_, index) => {
              const date = `${month}-${String(index + 1).padStart(2, '0')}`;
              const access = status === 'ready' ? getRequestDateAccess(policy, date) : { allowed: false, reason: 'Disponibilidad de solicitudes pendiente de verificar.' };
              return <button key={date} type="button" aria-label={dateLabel(date)} aria-pressed={value === date}
                disabled={unavailable || !access.allowed} title={access.allowed ? `Elegir ${dateLabel(date)}` : access.reason}
                onClick={() => { onChange(date); setOpen(false); }}
                className={`min-h-10 min-w-0 rounded-lg text-sm font-semibold disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:line-through ${value === date ? 'bg-blue-600 text-white' : 'text-gray-800 hover:bg-blue-50'}`}>
                {index + 1}
              </button>;
            })}
          </div>
          <p className="mt-2 text-xs font-normal text-gray-500">Las fechas deshabilitadas no admiten solicitudes.</p>
        </div>
      )}
    </div>
  );
}
