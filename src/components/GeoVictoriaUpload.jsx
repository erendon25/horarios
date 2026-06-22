import React, { useState } from 'react';
import * as XLSX from 'xlsx';

function GeoVictoriaUpload({
  onTurnosLoaded,
  initialCount = 0,
  label = 'Subir archivo de turnos de GeoVictoria:',
  compact = false,
}) {
  const [turnosCargados, setTurnosCargados] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const normalizeTime = (value) => {
    if (value === null || value === undefined || value === '') return '';

    if (value instanceof Date && !isNaN(value.getTime())) {
      return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    }

    if (typeof value === 'number') {
      if (value >= 0 && value < 1) {
        const totalMinutes = Math.round(value * 24 * 60);
        return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
      }

      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return `${String(parsed.H || 0).padStart(2, '0')}:${String(parsed.M || 0).padStart(2, '0')}`;
      }
    }

    const match = String(value).trim().match(/(\d{1,2}):(\d{2})/);
    if (!match) return String(value).trim();
    return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if ((turnosCargados || initialCount > 0) && !window.confirm('Ya hay un archivo cargado. ¿Deseas sobrescribirlo?')) {
      event.target.value = '';
      return;
    }

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true });

        const turnoMap = {};
        for (let i = 2; i < sheet.length; i += 1) {
          const [turnoID, start, , end] = sheet[i];
          const normalizedStart = normalizeTime(start);
          const normalizedEnd = normalizeTime(end);

          if (turnoID && normalizedStart && normalizedEnd) {
            turnoMap[`${normalizedStart}-${normalizedEnd}`] = Number(turnoID);
          }
        }

        await onTurnosLoaded(turnoMap, file);
        setTurnosCargados(true);
      } finally {
        setIsProcessing(false);
        event.target.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className={compact ? '' : 'mb-4'}>
      <label className="block mb-1 text-sm font-medium text-gray-700">{label}</label>
      <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} disabled={isProcessing} />
      {isProcessing && <p className="text-xs text-gray-500 mt-1">Procesando archivo...</p>}
    </div>
  );
}

export default GeoVictoriaUpload;
