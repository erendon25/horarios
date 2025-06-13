// WeeklyScheduleEditor.jsx – versión con detección de conflictos corregida
import React, { useEffect, useState, useRef } from 'react';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ScheduleHeatmapMatrix from './ScheduleHeatmapMatrix';
import { exportSchedulePDF, exportGroupedPositionsPDF } from './PDFExport';
import GeoVictoriaUpload from './GeoVictoriaUpload';
import { exportGeoVictoriaExcel } from "../services/GeoVictoriaExport";
import { FaInfoCircle, FaExclamationTriangle } from 'react-icons/fa';

const weekdays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const weekdayLabels={monday:'Lunes',tuesday:'Martes',wednesday:'Miércoles',thursday:'Jueves',friday:'Viernes',saturday:'Sábado',sunday:'Domingo'};

const getWeekKey = s=>{
  if(!s)return'';const d=new Date(s);if(isNaN(d))return'';const e=new Date(d);e.setDate(d.getDate()+6);
  return`${d.toISOString().slice(0,10)}_to_${e.toISOString().slice(0,10)}`;
};

const getScheduleDocRef = (db, staffId, weekKey) =>
  doc(db, 'schedules', `${staffId}_${weekKey}`);

export default function WeeklyScheduleEditor(){
  const [staff,setStaff]=useState([]);
  const [positions,setPositions]=useState([]);
  const [allSchedules,setAllSchedules]=useState({});
  const [requirements,setRequirements]=useState({});
  const [selectedDay,setSelectedDay]=useState('monday');
  const [weekStartDate,setWeekStartDate]=useState('');
  const [modalityFilter,setModalityFilter]=useState('Todos');
  const [positionFilter,setPositionFilter]=useState('Todas');
  const [turnoMap,setTurnoMap]=useState({});
  const [tooltipOpen,setTooltipOpen]=useState(null);
  const [showTurnoModal, setShowTurnoModal] = useState(false);
  const [turnoPDF, setTurnoPDF] = useState('mañana');
  const [conflictAlerts, setConflictAlerts] = useState({});

  const tooltipRef=useRef(null);
  const db=getFirestore();
  const navigate=useNavigate();
  const {currentUser,userRole}=useAuth();

  const wk = getWeekKey(weekStartDate);
  const schedules = wk ? allSchedules[wk] || {} : {};

  // Función CORREGIDA para detectar conflictos de horarios
  const detectScheduleConflict = (workStart, workEnd, studyBlocks) => {
    if (!workStart || !workEnd || !Array.isArray(studyBlocks) || studyBlocks.length === 0) {
      return null;
    }

    // Convertir horarios de trabajo a minutos desde medianoche
    const [workStartHour, workStartMin] = workStart.split(':').map(Number);
    const [workEndHour, workEndMin] = workEnd.split(':').map(Number);
    const workStartMinutes = workStartHour * 60 + workStartMin;
    const workEndMinutes = workEndHour * 60 + workEndMin;

    const conflicts = studyBlocks.filter(block => {
      // Verificar si el bloque tiene las propiedades correctas
      const studyStart = block.startTime || block.start;
      const studyEnd = block.endTime || block.end;
      
      if (!studyStart || !studyEnd) return false;

      // Convertir horarios de estudio a minutos
      let studyStartMinutes, studyEndMinutes;
      
      if (typeof studyStart === 'number') {
        // Si ya viene en formato de hora (número)
        studyStartMinutes = studyStart * 60;
      } else {
        // Si viene en formato "HH:MM"
        const [studyStartHour, studyStartMin] = studyStart.split(':').map(Number);
        studyStartMinutes = studyStartHour * 60 + studyStartMin;
      }
      
      if (typeof studyEnd === 'number') {
        // Si ya viene en formato de hora (número)
        studyEndMinutes = studyEnd * 60;
      } else {
        // Si viene en formato "HH:MM"
        const [studyEndHour, studyEndMin] = studyEnd.split(':').map(Number);
        studyEndMinutes = studyEndHour * 60 + studyEndMin;
      }

      // Verificar si hay solapamiento: hay conflicto si NO se cumple que uno termina antes de que empiece el otro
      return !(workEndMinutes <= studyStartMinutes || workStartMinutes >= studyEndMinutes);
    });

    return conflicts.length > 0 ? conflicts : null;
  };

  // Función CORREGIDA para formatear mensaje de conflicto
  const formatConflictMessage = (conflicts) => {
    if (!conflicts || conflicts.length === 0) return '';
    
    const conflictTimes = conflicts.map(block => {
      const studyStart = block.startTime || block.start;
      const studyEnd = block.endTime || block.end;
      
      // Formatear según el tipo de dato
      let startStr, endStr;
      
      if (typeof studyStart === 'number') {
        startStr = `${studyStart.toString().padStart(2, '0')}:00`;
      } else {
        startStr = studyStart;
      }
      
      if (typeof studyEnd === 'number') {
        endStr = `${studyEnd.toString().padStart(2, '0')}:00`;
      } else {
        endStr = studyEnd;
      }
      
      return `${startStr} - ${endStr}`;
    }).join(', ');
    
    return `Conflicto con horarios de estudio: ${conflictTimes}`;
  };

  // Cargar posiciones para el día seleccionado
  useEffect(()=>{
    (async()=>{
      const snap=await getDoc(doc(db,'positioning_requirements',selectedDay));
      setPositions(snap.exists()?snap.data().positions||[]:[]);
    })();
  },[selectedDay,db]);

  // Helpers
  const hasFreeDay=id=>{
    const sch=schedules[id]||{};
    return weekdays.some(d=>sch[d]?.off);
  };

  const calculateDailyHours=(s,e)=>{
    if(!s||!e)return'--';
    const [sh,sm]=s.split(':').map(Number);
    const [eh,em]=e.split(':').map(Number);
    let a=sh*60+sm,b=eh*60+em;if(b<=a)b+=1440;
    const tot=b-a;return`${Math.floor(tot/60)}h ${String(tot%60).padStart(2,'0')}m`;
  };

  const calculateWeeklyHours=id=>{
    let min=0;
    const sch=schedules[id]||{};
    const modality=staff.find(s=>s.id===id)?.modality;
    weekdays.forEach(d=>{
      const {start,end,off,feriado}=sch[d]||{};
      if(feriado){min+=modality==='Full-Time'?480:240;return;}
      if(!start||!end||off)return;
      const [sh,sm]=start.split(':').map(Number);
      const [eh,em]=end.split(':').map(Number);
      let a=sh*60+sm,b=eh*60+em;if(b<=a)b+=1440;
      let daily=b-a;if(modality==='Full-Time')daily-=45;
      min+=daily;
    });
    return{formatted:`${Math.floor(min/60)}h ${String(min%60).padStart(2,'0')}m`,total:min};
  };

  // Efecto para cerrar tooltip al hacer clic fuera
  useEffect(()=>{
    const h=e=>{if(tooltipRef.current&&!tooltipRef.current.contains(e.target))setTooltipOpen(null);};
    document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h);
  },[]);

  // Autenticación y carga inicial
  useEffect(()=>{
    if(userRole===null)return;
    if(!currentUser||userRole!=='admin'){navigate('/login');return;}
    loadData();
  },[currentUser,userRole,navigate]);

  // Carga CORREGIDA de datos desde Firestore
  const loadData = async () => {
    try {
      const storeId = (
        await getDoc(doc(db, 'users', currentUser.uid))
      ).data().storeId;

      const [staffSnap, scheduleSnap, reqSnap, studySnap] =
        await Promise.all([
          getDocs(collection(db, 'staff_profiles')),
          getDocs(collection(db, 'schedules')),
          getDocs(collection(db, 'positioning_requirements')),
          getDocs(collection(db, 'study_schedules'))
        ]);

      const studyMap = Object.fromEntries(
        studySnap.docs.map((d) => [d.id, d.data()])
      );

      setStaff(
        staffSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.storeId === storeId && p.position !== 'admin')
          .map((p) => {
            // CORREGIDO: Priorizar studyHours de staff_profiles si existe, sino usar study_schedules
            const studySchedule = p.studyHours || studyMap[p.uid] || {};
            
            return {
              ...p,
              study_schedule: studySchedule
            };
          })
      );

      setAllSchedules(
        scheduleSnap.docs.reduce((acc, d) => {
          const data = d.data();
          const weekKey = data.weekKey;
          if (!weekKey) return acc;
          const staffId = d.id.split('_')[0];
          const { weekKey: _, ...rest } = data;
          acc[weekKey] = {
            ...(acc[weekKey] || {}),
            [staffId]: rest
          };
          return acc;
        }, {})
      );

      setRequirements(
        Object.fromEntries(reqSnap.docs.map((d) => [d.id, d.data()]))
      );
    } catch (err) {
      console.error('Error al cargar datos:', err);
    }
  };

  // Manejar cambios en los horarios
  const handleChange = async (id, field, value) => {
    if (!wk) return;

    const copyWeek = { ...(allSchedules[wk] || {}) };
    copyWeek[id] = {
      ...copyWeek[id],
      [selectedDay]: { ...copyWeek[id]?.[selectedDay] }
    };

    if (field === 'off') {
      copyWeek[id][selectedDay].off = value;
      if (value) {
        copyWeek[id][selectedDay].start = '';
        copyWeek[id][selectedDay].end = '';
        copyWeek[id][selectedDay].position = '';
      }
    } else if (field === 'feriado') {
      copyWeek[id][selectedDay].feriado = value;
      if (value) {
        const mod = staff.find((s) => s.id === id)?.modality || 'Full-Time';
        copyWeek[id][selectedDay] = {
          ...copyWeek[id][selectedDay],
          start: '08:00',
          end: mod === 'Full-Time' ? '16:45' : '12:00',
          position: ''
        };
      } else {
        copyWeek[id][selectedDay].start = '';
        copyWeek[id][selectedDay].end = '';
      }
    } else {
      copyWeek[id][selectedDay][field] = value;
    }

    // CORREGIDO: Detectar conflictos después del cambio
    if ((field === 'start' || field === 'end') && !copyWeek[id][selectedDay].feriado) {
      const person = staff.find(s => s.id === id);
      const studyBlocks = person?.study_schedule?.[selectedDay] || [];
      const workStart = copyWeek[id][selectedDay].start;
      const workEnd = copyWeek[id][selectedDay].end;
      
      const conflicts = detectScheduleConflict(workStart, workEnd, studyBlocks);
      
      // Actualizar alertas de conflicto
      setConflictAlerts(prev => ({
        ...prev,
        [`${id}_${selectedDay}`]: conflicts
      }));

      
    }

    setAllSchedules((prev) => ({ ...prev, [wk]: copyWeek }));

    await setDoc(
      getScheduleDocRef(db, id, wk),
      { weekKey: wk, ...copyWeek[id] }
    );
  };

  // Filtros
  const filteredStaff=staff.filter(p=>{
    const okMod=modalityFilter==='Todos'||p.modality===modalityFilter;
    const turno=schedules[p.id]?.[selectedDay];
    const okPos=positionFilter==='Todas'||turno?.position?.toLowerCase()===positionFilter.toLowerCase();
    return okMod&&okPos;
  });

  // Expandir requerimientos para heatmap
  const reqDay=requirements[selectedDay]||{};
  const expandedRequirements=Object.fromEntries(
    (reqDay.positions||[]).map((pos,i)=>{
      const base=Array(77).fill(0);
      Object.entries(reqDay.matrix?.[i]||{}).forEach(([k,v])=>{base[+k]=v;});
      return[pos.toLowerCase().trim(),base];
    })
  );

  return(
    <div className="p-6 bg-gray-100 min-h-screen">
      {/* Controles superiores */}
      <div className="flex flex-wrap gap-4 mb-6 sticky top-0 bg-gray-100 z-10 pb-2">
        <div className="flex flex-col">
          <label>Día:</label>
          <select value={selectedDay} onChange={e=>setSelectedDay(e.target.value)} className="border px-3 py-1 rounded">
            {weekdays.map(d=><option key={d} value={d}>{weekdayLabels[d]}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label>Modalidad:</label>
          <select value={modalityFilter} onChange={e=>setModalityFilter(e.target.value)} className="border px-3 py-1 rounded">
            <option value="Todos">Todos</option><option value="Full-Time">Full-Time</option><option value="Part-Time">Part-Time</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label>Área:</label>
          <select value={positionFilter} onChange={e=>setPositionFilter(e.target.value)} className="border px-3 py-1 rounded">
            <option value="Todas">Todas</option>
            {positions.map(pos=><option key={pos} value={pos}>{pos}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label>Inicio de semana:</label>
          <input type="date" value={weekStartDate} onChange={e=>setWeekStartDate(e.target.value)} className="border px-3 py-1 rounded"/>
        </div>
        <div className="flex flex-col justify-end">
          <button onClick={()=>exportSchedulePDF(document.body,filteredStaff,schedules,weekStartDate)} className="bg-green-700 text-white px-4 py-2 rounded">Exportar PDF</button>
        </div>
        <div className="flex flex-col justify-end">
          <button
            className="bg-purple-700 text-white px-4 py-2 rounded"
            onClick={() => setShowTurnoModal(true)}
          >
            Descargar Posicionamiento
          </button>
        </div>
        <div className="flex flex-col justify-end"><GeoVictoriaUpload onTurnosLoaded={setTurnoMap}/></div>
        <div className="flex flex-col justify-end">
          <button onClick={()=>exportGeoVictoriaExcel(filteredStaff,schedules,turnoMap,weekStartDate)} className="bg-yellow-600 text-white px-4 py-2 rounded">Excel GeoVictoria</button>
        </div>
      </div>

      {/* Tabla de turnos + heatmap */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Tabla */}
        <div className="flex-1 bg-white rounded shadow p-4 overflow-auto">
          <h2 className="font-semibold mb-2">Turnos asignados ({weekdayLabels[selectedDay]})</h2>
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="bg-gray-100">
              <tr><th className="p-1 text-left">Nombre</th><th className="p-1">Modalidad</th><th className="p-1">Entrada</th><th className="p-1">Salida</th><th className="p-1">Horas día</th><th className="p-1">Horas semana</th><th className="p-1">Posición</th><th className="p-1">Libre</th><th className="p-1">Feriado</th></tr>
            </thead>
            <tbody>
              {filteredStaff.map((p,idx)=>{
                const d=schedules[p.id]?.[selectedDay]||{};
                const horas=calculateWeeklyHours(p.id);
                const studyBlocks=p.study_schedule?.[selectedDay]||[];
                
                // CORREGIDO: Detectar conflictos con la función corregida
                const conflicts = detectScheduleConflict(d.start, d.end, studyBlocks);
                const hasConflict = conflicts && conflicts.length > 0;
                
                const reqMin=p.modality==='Full-Time'?2880:1440;
                const hoursMatch = horas.total === reqMin;
                
                return(
                  <tr key={idx} className={`even:bg-gray-50 ${!hoursMatch ? 'bg-red-100' : ''} ${hasConflict ? 'bg-yellow-100 border-l-4 border-orange-500' : ''}`}>
                    {/* Nombre + iconos de estado */}
                    <td className="p-1 relative">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[150px]">{p.name} {p.lastName}</span>
                        {!hasFreeDay(p.id)&&<span title="Sin día libre" className="text-red-600">🚫</span>}
                        {hasConflict && (
                          <FaExclamationTriangle 
                            className="text-orange-600" 
                            title={formatConflictMessage(conflicts)}
                          />
                        )}
                        <button onClick={()=>setTooltipOpen(idx===tooltipOpen?null:idx)} className="text-blue-600"><FaInfoCircle/></button>
                      </div>
                      
                      {/* Tooltip con horarios de estudio */}
                      {tooltipOpen===idx&&(
                        <div ref={tooltipRef} className="absolute left-0 top-full mt-1 bg-white border shadow p-2 text-xs z-50 rounded">
                          <strong className="block mb-1 text-blue-800">Horarios de estudio</strong>
                          {weekdays.map(d=>(
                            <div key={d} className="capitalize mb-1">
                              <strong>{weekdayLabels[d]}:</strong>
                              {(p.study_schedule?.[d]||[]).length?
                                p.study_schedule[d].map((b,i)=>{
                                  // CORREGIDO: Mostrar horarios correctamente según el formato
                                  const startTime = typeof b.startTime === 'number' ? `${b.startTime.toString().padStart(2, '0')}:00` : (b.start || b.startTime);
                                  const endTime = typeof b.endTime === 'number' ? `${b.endTime.toString().padStart(2, '0')}:00` : (b.end || b.endTime);
                                  return <div key={i} className="ml-2">{startTime} - {endTime}</div>;
                                })
                                :<span className="ml-2 text-gray-400">--</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Mensaje de conflicto debajo del nombre */}
                      {hasConflict && (
                        <div className="text-xs text-orange-700 bg-orange-50 p-1 rounded mt-1 border border-orange-200">
                          <FaExclamationTriangle className="inline mr-1" />
                          {formatConflictMessage(conflicts)}
                        </div>
                      )}
                    </td>
                    
                    <td className="p-1 text-center">{p.modality}</td>
                    
                    {/* Entrada - con indicador de conflicto */}
                    <td className="p-1 text-center">
                      <input 
                        type="time" 
                        value={d.start||''} 
                        onChange={e=>handleChange(p.id,'start',e.target.value)} 
                        disabled={d.feriado || d.off}   // ← Añadimos d.off
                        className={hasConflict ? 'border-orange-500 bg-orange-50' : ''}
                      />
                    </td>
                    
                    {/* Salida - con indicador de conflicto */}
                    <td className="p-1 text-center">
                      <input 
                        type="time" 
                        value={d.end||''} 
                        onChange={e=>handleChange(p.id,'end',e.target.value)} 
                        disabled={d.feriado || d.off}   // ← Añadimos d.off
                        className={hasConflict ? 'border-orange-500 bg-orange-50' : ''}
                      />
                    </td>
                    
                    <td className="p-1 text-center">{calculateDailyHours(d.start,d.end)}</td>
                    <td className={`p-1 text-center font-semibold ${!hoursMatch?'text-red-600':''}`}>
                      {horas.formatted}
                      {hasConflict && <span className="text-orange-600 ml-1">⚠️</span>}
                    </td>
                    
                    <td className="p-1 text-center">
                      <select value={d.position||''} onChange={e=>handleChange(p.id,'position',e.target.value)} disabled={d.feriado || d.off}>
                        <option value="">--</option>{positions.map(pos=><option key={pos} value={pos}>{pos}</option>)}
                      </select>
                    </td>
                    
                    <td className="p-1 text-center"><input type="checkbox" checked={d.off||false} onChange={e=>handleChange(p.id,'off',e.target.checked)} disabled={d.feriado}/></td>
                    <td className="p-1 text-center"><input type="checkbox" checked={d.feriado||false} onChange={e=>handleChange(p.id,'feriado',e.target.checked)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Heatmap */}
        <div className="w-full lg:w-1/3 sticky top-0 self-start">
          <ScheduleHeatmapMatrix
            key={selectedDay}
            assigned={filteredStaff.map(p=>{
              const d=schedules[p.id]?.[selectedDay];return{position:d?.position,start:d?.start,end:d?.end};
            }).filter(x=>x.position&&x.start&&x.end)}
            requirements={expandedRequirements}/>
        </div>
      </div>

      {/* Modal para selección de turno */}
      {showTurnoModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg p-6 w-80">
            <h3 className="font-semibold mb-4 text-center">Elegir Turno</h3>

            <label className="flex items-center gap-2 mb-2">
              <input
                type="radio"
                value="mañana"
                checked={turnoPDF === 'mañana'}
                onChange={() => setTurnoPDF('mañana')}
              />
              Mañana
            </label>

            <label className="flex items-center gap-2 mb-4">
              <input
                type="radio"
                value="tarde"
                checked={turnoPDF === 'tarde'}
                onChange={() => setTurnoPDF('tarde')}
              />
              Tarde
            </label>

            <div className="flex justify-end gap-3">
              <button
                className="px-3 py-1 rounded bg-gray-300"
                onClick={() => setShowTurnoModal(false)}
              >
                Cancelar
              </button>
              <button
                className="px-3 py-1 rounded bg-purple-700 text-white"
                onClick={() => {
                  exportGroupedPositionsPDF(filteredStaff, schedules, selectedDay, turnoPDF);
                  setShowTurnoModal(false);
                }}
              >
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}