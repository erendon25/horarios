import React from 'react';

const hours = Array.from({ length: 77 }, (_, i) => {
  const h = Math.floor(i / 4) + 6;
  const m = (i % 4) * 15;
  return `${(h % 24).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
});

export default function AvailableHeatmapMatrix({ studySchedules = [], requirements = {}, assigned = {}, selectedDay }) {
  const timeToIndex = (time) => {
    const [h, m] = time.split(':').map(Number);
    return Math.floor(((h * 60 + m) - 360) / 15);
  };

  const matrix = studySchedules.map(({ name, position, modality, study_schedule }) => {
    const row = Array(77).fill('bg-white');
    const studyBlocks = study_schedule?.[selectedDay] || [];
    const posKey = position?.toLowerCase();

    for (let block of studyBlocks) {
      const start = Math.max(0, timeToIndex(block.start));
      const end = Math.min(76, timeToIndex(block.end));
      for (let i = start; i <= end; i++) row[i] = 'bg-gray-300';
    }

    for (let i = 0; i < 77; i++) {
      const hora = hours[i];
      const esLibre = row[i] === 'bg-white';
      const hayRequerimiento = requirements[posKey]?.[i] > (assigned[posKey]?.[hora] || 0);

      if (esLibre && hayRequerimiento) {
        row[i] = 'bg-green-400';
      }
    }

    return { name, timeline: row };
  });

  return (
    <div className="overflow-auto border rounded shadow">
      <div className="text-sm font-semibold p-2 bg-blue-50 border-b">Disponibilidad útil ({selectedDay})</div>
      <table className="table-auto text-xs w-full">
        <thead>
          <tr>
            <th className="border px-1 py-1 bg-white sticky left-0 z-10">Colaborador</th>
            {hours.map((h, idx) => (
              <th key={idx} className="border px-1 whitespace-nowrap text-[10px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, idx) => (
            <tr key={idx}>
              <td className="border px-1 bg-white sticky left-0 z-0 text-[11px] whitespace-nowrap">{row.name}</td>
              {row.timeline.map((color, i) => (
                <td key={i} className={`border w-4 h-5 ${color}`}></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-3 text-xs p-2 bg-gray-50 border-t">
        <span className="flex items-center gap-1"><div className="w-4 h-4 bg-green-400 border" /> Disponible</span>
        <span className="flex items-center gap-1"><div className="w-4 h-4 bg-gray-300 border" /> Estudio</span>
      </div>
    </div>
  );
}
