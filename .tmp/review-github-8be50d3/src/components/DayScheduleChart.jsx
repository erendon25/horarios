// ✅ DayScheduleChart.jsx
import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LabelList,
} from 'recharts';

function DayScheduleChart({ day, data }) {
  // convierte rango de horarios a duración
  const chartData = data.map(entry => {
    const [startH, startM] = entry.start.split(':').map(Number);
    const [endH, endM] = entry.end.split(':').map(Number);
    const startDecimal = startH + startM / 60;
    const endDecimal = endH + endM / 60;
    return {
      name: entry.name,
      start: startDecimal,
      end: endDecimal,
      duration: endDecimal - startDecimal,
    };
  });

  return (
    <div className="bg-white p-4 rounded shadow">
      <h2 className="text-lg font-bold mb-2">Horario gráfico - {day}</h2>
      <ResponsiveContainer width="100%" height={chartData.length * 40}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 10, right: 30, left: 80, bottom: 10 }}
        >
          <XAxis type="number" domain={[6, 24]} ticks={[6, 8, 10, 12, 14, 16, 18, 20, 22, 24]} />
          <YAxis type="category" dataKey="name" />
          <Tooltip
            formatter={(value, name, props) => [`${value.toFixed(2)} hrs`, 'Duración']}
            labelFormatter={(label) => `Colaborador: ${label}`}
          />
          <Bar dataKey="duration" fill="#60a5fa" isAnimationActive={false}>
            <LabelList dataKey="duration" position="right" formatter={(val) => `${val.toFixed(1)}h`} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default DayScheduleChart;


