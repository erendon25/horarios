// StaffSchedule.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

function StaffSchedule() {
  const { staffId } = useParams();
  const [staffData, setStaffData] = useState(null);
  const [studyHours, setStudyHours] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { currentUser, userRole } = useAuth();
  const db = getFirestore();

  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const weekdayNames = {
    monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles',
    thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo'
  };

  useEffect(() => {
    if (!currentUser || userRole !== 'admin') {
      navigate('/login');
      return;
    }

    const fetchData = async () => {
      try {
        const staffRef = doc(db, 'staff_profiles', staffId);
        const staffDoc = await getDoc(staffRef);
        if (staffDoc.exists()) {
          const data = staffDoc.data();
          setStaffData(data);
          setStudyHours(data.studyHours || []);
        }

        const scheduleRef = doc(db, 'schedules', staffId);
        const scheduleDoc = await getDoc(scheduleRef);
        if (scheduleDoc.exists()) {
          setSchedule(scheduleDoc.data());
        } else {
          const defaultSchedule = {};
          weekdays.forEach(day => {
            defaultSchedule[day] = { start: '', end: '', active: false };
          });
          setSchedule(defaultSchedule);
        }
      } catch (err) {
        setError('Error al cargar datos.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [staffId, currentUser, userRole, db, navigate]);

  const handleChange = (day, field, value) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }));
  };

  const handleCheckbox = (day) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        active: !prev[day].active
      }
    }));
  };

  const hasConflictWithStudy = (day, startTime, endTime) => {
    const start = parseInt(startTime.split(':')[0]);
    const end = parseInt(endTime.split(':')[0]);
    return studyHours.some(h => h.day === day && start < h.endTime && end > h.startTime);
  };

  const getGroupFromPosition = (name) => {
    const lowered = name.toLowerCase();
    if (lowered.includes('sheet')) return 'Sheetout';
    if (lowered.includes('vestido')) return 'Vestido';
    if (lowered.includes('masa')) return 'Masa';
    if (lowered.includes('landing') && lowered.includes('complem')) return 'Landing Crazy';
    if (lowered.includes('landing')) return 'Landing';
    if (lowered.includes('crazy')) return 'Landing Crazy';
    if (lowered.includes('lavado')) return 'Lavado';
    if (lowered.includes('do sheet')) return 'DoSheet';
    if (lowered.includes('drive')) return 'Drive Thru';
    if (lowered.includes('modulo') || lowered.includes('módulo')) return 'Módulo';
    if (lowered.includes('caja') || lowered.includes('despachador') || lowered.includes('promise')) return 'Servicio';
    return 'Otro';
  };

  const validatePositioning = async () => {
    const dayKey = new Date().getDay();
    const currentDay = weekdays[dayKey === 0 ? 6 : dayKey - 1];
    const positioningSnap = await getDocs(collection(db, 'positioning_requirements'));
    const positioningMap = {};

    positioningSnap.forEach(doc => {
      const { day, hour, positions } = doc.data();
      if (!positioningMap[day]) positioningMap[day] = {};
      positioningMap[day][hour] = positions;
    });

    for (const day of weekdays) {
      const daySchedule = schedule[day];
      if (!daySchedule.active) continue;

      const startHour = parseInt(daySchedule.start.split(':')[0]);
      const endHour = parseInt(daySchedule.end.split(':')[0]);

      for (let hour = startHour; hour < endHour; hour++) {
        const hourStr = `${hour.toString().padStart(2, '0')}:00`;
        const req = positioningMap[day]?.[hourStr];
        if (!req) continue;

        const group = getGroupFromPosition(staffData.name);
        const needed = req[group] || 0;
        if (needed <= 0) {
          alert(`No se requiere ${group} el ${weekdayNames[day]} a las ${hourStr}`);
          return false;
        }
      }
    }
    return true;
  };

  const saveSchedule = async () => {
    try {
      for (const day of weekdays) {
        if (schedule[day].active && hasConflictWithStudy(day, schedule[day].start, schedule[day].end)) {
          alert(`Conflicto con horario de estudio el ${weekdayNames[day]}`);
          return;
        }
      }

      const cierreCount = Object.values(schedule).filter(day => day.active && parseInt(day.end) >= 22).length;
      if (cierreCount > 4) {
        alert('Este trabajador tiene más de 4 cierres en la semana.');
        return;
      }

      const isValid = await validatePositioning();
      if (!isValid) return;

      const ref = doc(db, 'schedules', staffId);
      await setDoc(ref, schedule);
      alert('Horario guardado con éxito');
      navigate('/horarios');
    } catch (err) {
      setError('Error al guardar horario');
      console.error(err);
    }
  };

  const downloadPDF = async () => {
    const input = document.querySelector('.schedule-table');
    const canvas = await html2canvas(input);
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF();
    pdf.addImage(imgData, 'PNG', 10, 10);
    pdf.save(`Horario_${staffData.name}.pdf`);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Horario de {staffData?.name}</h1>
      {error && <p className="text-red-600">{error}</p>}
      <table className="schedule-table w-full border text-sm mb-4">
        <thead>
          <tr className="bg-gray-200">
            <th className="p-2">Día</th>
            <th className="p-2">Activo</th>
            <th className="p-2">Inicio</th>
            <th className="p-2">Fin</th>
          </tr>
        </thead>
        <tbody>
          {weekdays.map(day => (
            <tr key={day} className="even:bg-gray-50">
              <td className="p-2">{weekdayNames[day]}</td>
              <td className="p-2">
                <input type="checkbox" checked={schedule[day]?.active || false} onChange={() => handleCheckbox(day)} />
              </td>
              <td className="p-2">
                <input type="time" value={schedule[day]?.start || ''} onChange={(e) => handleChange(day, 'start', e.target.value)} disabled={!schedule[day]?.active} />
              </td>
              <td className="p-2">
                <input type="time" value={schedule[day]?.end || ''} onChange={(e) => handleChange(day, 'end', e.target.value)} disabled={!schedule[day]?.active} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-4">
        <button onClick={saveSchedule} className="bg-red-600 text-white px-4 py-2 rounded">Guardar</button>
        <button onClick={downloadPDF} className="bg-blue-600 text-white px-4 py-2 rounded">Descargar PDF</button>
      </div>
    </div>
  );
}

export default StaffSchedule;
