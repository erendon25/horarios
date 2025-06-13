// PDFSchedulePreview.jsx
import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { format, addDays } from 'date-fns';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const cierreDias = {
  Lunes: '24:00', Martes: '24:00', Miércoles: '24:00', Domingo: '24:00',
  Jueves: '25:00', Viernes: '25:00', Sábado: '25:00'
};

function getColor(hora) {
  const [h] = hora.split(':').map(Number);
  if (h <= 12) return 'bg-green-500';
  if (h < 22) return 'bg-gray-500';
  return 'bg-blue-500';
}

export default function PDFSchedulePreview({ weekStartDate }) {
  const db = getFirestore();
  const [scheduleData, setScheduleData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const usersSnap = await getDocs(collection(db, 'staff_profiles'));
      const schedulesSnap = await getDocs(collection(db, 'schedules'));

      const users = [];
      usersSnap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));

      const days = dias.map((d, i) => format(addDays(new Date(weekStartDate), i), 'yyyy-MM-dd'));

      const resultado = users.map(user => {
        const perDay = {};
        let totalMinutes = 0;

        for (let i = 0; i < dias.length; i++) {
          const sched = schedulesSnap.docs.find(s => s.data().uid === user.uid && s.data().day === days[i]);
          if (sched) {
            const { start, end } = sched.data();
            perDay[dias[i]] = `${start}-${end}`;

            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            totalMinutes += (eh * 60 + em) - (sh * 60 + sm);
          }
        }

        return {
          name: user.name,
          lastName: user.lastName,
          modality: user.modality,
          schedule: perDay,
          totalHours: Math.round(totalMinutes / 60)
        };
      });

      setScheduleData(resultado);
    };

    fetchData();
  }, [weekStartDate]);

  const exportPDF = () => {
    const input = document.getElementById('pdfArea');
    html2canvas(input).then(canvas => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'pt', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('Horarios_Semana.pdf');
    });
  };

  return (
    <div>
      <button onClick={exportPDF} className="mb-4 bg-blue-700 text-white px-4 py-2 rounded">Exportar PDF Semana</button>
      <div id="pdfArea" className="bg-white p-4 w-[1200px]">
        <h2 className="text-2xl font-bold text-center mb-4">Horarios</h2>
        <div className="grid grid-cols-8 font-semibold text-sm">
          <div>Nombre</div>
          {dias.map((d, i) => (
            <div key={i} className="text-center">
              {d}
              <div className="text-xs font-normal">
                {format(addDays(new Date(weekStartDate), i), 'dd/MM')}
              </div>
            </div>
          ))}
        </div>
        {scheduleData.map((colab, i) => (
          <div key={i} className="grid grid-cols-8 text-xs border-t py-1 items-center">
            <div className="font-medium">
              {colab.name} {colab.lastName}
              <div className="text-[10px]">{colab.modality}</div>
            </div>
            {dias.map((d, j) => {
              const horario = colab.schedule?.[d] || "";
              const color = horario ? getColor(horario.split('-')[0]) : 'bg-white';
              return (
                <div key={j} className={`text-center text-white rounded ${color}`}>
                  {horario || "-"}
                </div>
              );
            })}
          </div>
        ))}
        <div className="text-right font-semibold text-sm mt-4">
          Total Horas por Persona:
          <ul>
            {scheduleData.map((colab, i) => (
              <li key={i}>{colab.name}: {colab.totalHours || 0}h</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

