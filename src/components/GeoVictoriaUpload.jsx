import React, { useState } from 'react';
import * as XLSX from 'xlsx';

function GeoVictoriaUpload({ onTurnosLoaded }) {
  const [turnosCargados, setTurnosCargados] = useState(false);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (turnosCargados && !window.confirm("Ya hay un archivo cargado. ¿Deseas sobrescribirlo?")) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });

      const turnoMap = {};
      for (let i = 2; i < sheet.length; i++) { // Desde fila 3 (índice 2)
        const [turnoID, start, , end] = sheet[i];
        if (turnoID && start && end) {
          turnoMap[`${start}-${end}`] = Number(turnoID);
        }
      }

      onTurnosLoaded(turnoMap);
      setTurnosCargados(true);
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="mb-4">
      <label className="block mb-1 text-sm font-medium text-gray-700">Subir archivo de turnos de GeoVictoria:</label>
      <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} />
    </div>
  );
}

export default GeoVictoriaUpload;


