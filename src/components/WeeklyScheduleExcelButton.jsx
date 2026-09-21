import React, { useState } from 'react';
import { Download } from 'lucide-react';

export default function WeeklyScheduleExcelButton({ canExport = false, ...data }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!canExport) return null;
  const download = async () => {
    if (!canExport || busy) return;
    setBusy(true);
    setError('');
    try {
      const { downloadWeeklyScheduleExcel } = await import('../services/weeklyScheduleExcel');
      await downloadWeeklyScheduleExcel(data);
    } catch (cause) {
      console.error('Error al exportar horario y mapas:', cause);
      setError('No se pudo descargar el Excel. Verifica que la semana tenga colaboradores e intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  };
  return <div>
    <button type="button" onClick={download} disabled={busy || !data.weekStart || !data.staff?.length}
      title="Horario completo con el modelo Excel y siete pestañas de cobertura. Incluye los cambios actuales del editor."
      className="flex items-center gap-2 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-md font-medium disabled:opacity-60 disabled:cursor-not-allowed">
      <Download className="w-5 h-5" />{busy ? 'Generando Excel…' : 'Excel horario + mapas'}
    </button>
    {error && <p role="alert" className="mt-2 max-w-sm text-xs text-red-700">{error}</p>}
  </div>;
}
