// ScheduleHeatmapMatrix.jsx
import React, { useState, useEffect, useMemo } from 'react';

export const hours = Array.from({ length: 81 }, (_, i) => {
  const totalMinutes = 360 + i * 15;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

export default function ScheduleHeatmapMatrix({ assigned = [], requirements = {} }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [matrixRows, setMatrixRows] = useState([]);
const [debugInfo, setDebugInfo] = useState('');

  // Precalcular los bloques horarios con sus minutos de inicio y fin
  const blocks = useMemo(() => {
    return hours.map((hour, index) => {
      const startMinute = 360 + index * 15;
      const endMinute = startMinute + 15;
      return {
        time: hour,
        startMinute,
        endMinute
      };
    });
  }, []);

  useEffect(() => {
     let debugLog = "Iniciando cálculo de asignaciones...\n";
    const needMatrix = {};
    const assignMatrix = {};

    // Construir matriz de requerimientos
    Object.entries(requirements).forEach(([position, arr]) => {
      arr.forEach((qty, idx) => {
        if (!qty) return;
        needMatrix[position] = needMatrix[position] || {};
        needMatrix[position][hours[idx]] = qty;
      });
    });

    // Función para convertir tiempo a minutos
    const timeToMinutes = (time) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };

    // Procesar asignaciones con nueva lógica para manejar superposiciones
    assigned.forEach((p, personIndex) => {
      const pos = p.position?.trim().toLowerCase();
      if (!pos || !p.start || !p.end) return;

      const startMin = timeToMinutes(p.start);
      let endMin = timeToMinutes(p.end);
      
      debugLog += `\nPersona ${personIndex + 1} (${pos}): ${p.start} - ${p.end}\n`;
      debugLog += `  - Minutos: ${startMin} - ${endMin}\n`;
      
      // Manejar turnos que cruzan la medianoche
      const crossesMidnight = endMin < startMin;
      if (crossesMidnight) {
        endMin += 1440; // Agregar 24 horas en minutos
        debugLog += `  - Cruza medianoche, endMin ajustado a: ${endMin}\n`;
      }

      // Verificar superposición con cada bloque
      blocks.forEach((block) => {
        const blockStart = block.startMinute;
        const blockEnd = block.endMinute;
        
        // Caso especial para bloques nocturnos
        const blockSpansMidnight = blockStart >= 1440;
        const adjustedBlockStart = blockSpansMidnight ? blockStart - 1440 : blockStart;
        const adjustedBlockEnd = blockSpansMidnight ? blockEnd - 1440 : blockEnd;
        
        // Determinar superposición
        let overlaps = false;
        
        if (crossesMidnight) {
          // Turno cruza medianoche
          overlaps = (startMin < blockEnd && startMin >= blockStart) || 
                    (endMin > blockStart && endMin <= blockEnd) ||
                    (startMin < adjustedBlockEnd && endMin > adjustedBlockStart);
        } else {
          // Turno normal
          overlaps = (startMin < blockEnd) && (endMin > blockStart);
        }
        
        // Caso especial para turnos que terminan exactamente a medianoche
        const endsAtMidnight = p.end === "00:00" && block.time === "23:45";
        if (endsAtMidnight) overlaps = true;
        
        // Caso especial para turnos que terminan en el límite del bloque
        const endsAtBlockBoundary = endMin === blockEnd;
        if (endsAtBlockBoundary) overlaps = true;
        
        // Si hay superposición, agregar al conteo
        if (overlaps) {
          assignMatrix[pos] = assignMatrix[pos] || {};
          assignMatrix[pos][block.time] = (assignMatrix[pos][block.time] || 0) + 1;
          
          debugLog += `  - Superpone con bloque ${block.time} (${blockStart}-${blockEnd}): `;
          debugLog += `Asignado = ${assignMatrix[pos][block.time]}\n`;
        }
      });
    });

    // Generar filas para la matriz visual
    const allPositions = new Set([...Object.keys(needMatrix), ...Object.keys(assignMatrix)]);
    const rows = [];

    allPositions.forEach((position) => {
      const maxCount = Math.max(
        ...hours.map((h) => Math.max(needMatrix[position]?.[h] || 0, assignMatrix[position]?.[h] || 0, 0))
      );

      for (let rowIdx = 0; rowIdx < maxCount; rowIdx++) {
        const timeline = hours.map((h) => {
          const need = needMatrix[position]?.[h] || 0;
          const assigned = assignMatrix[position]?.[h] || 0;
          
          // Determinar color basado en asignación vs requerimiento
          if (rowIdx < need && rowIdx < assigned) return 'bg-blue-500';
          if (rowIdx < assigned && rowIdx >= need) return 'bg-red-500';
          if (rowIdx < need && rowIdx >= assigned) return 'bg-yellow-300';
          return 'bg-white';
        });
        rows.push({ position, timeline });
      }
    });

    setMatrixRows(rows);
  }, [assigned, requirements]);

  // Componente de tabla para el heatmap
  const HeatmapTable = () => (
    <div className="overflow-x-auto">
      <table className="table-auto border text-xs w-full">
        <thead className="sticky top-0 bg-white z-20">
          <tr>
            <th className="border px-2 py-1 bg-white sticky left-0 z-20 min-w-[120px]">Posición</th>
            {hours.map((h, i) => (
              <th key={i} className={`border px-1 text-[10px] whitespace-nowrap ${
                h === "23:45" || h === "00:00" ? 'bg-blue-100 font-bold' : ''
              }`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrixRows.map((row, ri) => (
            <tr key={ri}>
              <td className="border px-2 py-1 whitespace-nowrap bg-white sticky left-0 z-10 font-medium">
                {row.position}
              </td>
              {row.timeline.map((color, ci) => (
                <td key={ci} className={`border w-4 h-6 ${color} ${
                  hours[ci] === "23:45" || hours[ci] === "00:00" ? 'border-2 border-blue-500' : ''
                }`} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="schedule-heatmap-container">
      <div className="overflow-auto relative pt-28">
        <div className="flex justify-between items-center mb-4 px-2">
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1">
              <div className="w-4 h-4 bg-yellow-300 border" /> Requerido
            </span>
            <span className="flex items-center gap-1">
              <div className="w-4 h-4 bg-blue-500 border" /> Asignado
            </span>
            <span className="flex items-center gap-1">
              <div className="w-4 h-4 bg-red-500 border" /> Exceso
            </span>
          </div>
          
          <button 
            onClick={() => setFullscreen(true)} 
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
          >
            <span>🖵</span> Pantalla Completa
          </button>
        </div>

        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm">
          <p className="font-medium">Nota sobre bloques finales:</p>
          <p>• Turnos que terminan a las 00:00 se reflejan en el bloque 23:45</p>
          <p>• El bloque 00:00 representa el intervalo 00:00-00:15</p>
        </div>

        <div className="overflow-auto max-h-[calc(100vh-200px)] shadow-md">
          <HeatmapTable />
        </div>
      </div>

      {fullscreen && (
        <div className="fixed inset-0 bg-white z-50 overflow-auto p-4">
          <div className="flex justify-between items-center mb-4 bg-gray-100 p-3 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-800">Vista Completa - Heatmap de Horarios</h2>
            <button 
              onClick={() => setFullscreen(false)} 
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center gap-2"
            >
              <span>✖</span> Cerrar
            </button>
          </div>
          
          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <h3 className="font-bold mb-2">Turnos Actuales:</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {assigned.map((p, i) => (
                <div key={i} className="bg-white p-2 rounded border text-sm">
                  <span className="font-medium">{p.name}</span>: {p.start} - {p.end} ({p.position})
                </div>
              ))}
            </div>
          </div>
          
          <div className="overflow-auto h-[calc(100vh-180px)] border-2 border-gray-200 rounded-lg">
            <HeatmapTable />
          </div>
        </div>
      )}
    </div>
  );
}