import React from 'react';
import { BookOpen, Calendar, ClipboardList } from 'lucide-react';

export default function CollaboratorScheduleActions({ access, restricted = false, onStudy, onRequest, onHolidays }) {
  const ready = access?.status === 'ready' && Boolean(access.policy);
  const showStudy = ready && !access.policy.adminOnlyStudyEditing;
  const requestEnabled = ready && access.policy.requestsEnabled === true && !restricted;
  const studyEnabled = showStudy && !restricted;
  const requestDescription = !ready ? 'Consultando permisos de la tienda…'
    : !access.policy.requestsEnabled ? 'Solicitudes inhabilitadas por administración'
      : restricted ? 'Cambios inhabilitados' : 'Solicita un turno o rango horario especial';

  return <div className="mb-6 space-y-3" data-testid="collaborator-schedule-actions">
    {!ready && (access?.status === 'error' ? (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{access?.error?.message || access?.error || 'No se pudo consultar la configuración de horarios de tu tienda.'}</p>
        <p className="mt-1">Reintenta antes de editar estudios o enviar solicitudes.</p>
        <button type="button" onClick={access?.retry} className="mt-2 rounded-lg border border-red-300 px-3 py-2 font-semibold">Reintentar configuración de horarios</button>
      </div>
    ) : <p role="status" className="text-sm text-gray-600">Consultando permisos de horarios de tu tienda…</p>)}

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {showStudy && <button type="button"
        onClick={() => studyEnabled && onStudy?.()} disabled={!studyEnabled}
        className={`${studyEnabled ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white transform hover:scale-105' : 'bg-gray-100 text-gray-400 cursor-not-allowed'} flex flex-col items-center gap-3 rounded-xl p-6 shadow-md transition-all duration-200`}>
        <BookOpen className="h-8 w-8" />
        <span className="text-lg font-semibold">Editar Horarios de Estudio</span>
        <span className="text-sm opacity-90">{restricted ? 'Cambios inhabilitados' : 'Gestiona tus horarios académicos'}</span>
      </button>}

      <button type="button" onClick={onHolidays}
        className="flex flex-col items-center gap-3 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 p-6 text-white shadow-md transition-all duration-200">
        <Calendar className="h-8 w-8" />
        <span className="text-lg font-semibold">Ver mis feriados</span>
        <span className="text-sm opacity-90">Saldo, descansos compensados y feriados destinados a boleta</span>
      </button>

      <button type="button" onClick={() => requestEnabled && onRequest?.()} disabled={!requestEnabled}
        className={`${requestEnabled ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white transform hover:scale-105' : 'bg-gray-100 text-gray-400 cursor-not-allowed'} ${showStudy ? 'md:col-span-2' : ''} flex flex-col items-center gap-3 rounded-xl p-6 shadow-md transition-all duration-200`}>
        <ClipboardList className="h-8 w-8" />
        <span className="text-lg font-semibold">Solicitar Horario Específico</span>
        <span className="text-sm opacity-90">{requestDescription}</span>
      </button>
    </div>
  </div>;
}
