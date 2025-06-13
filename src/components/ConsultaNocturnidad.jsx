// ConsultaNocturnidad.jsx corregido y completo
import React, { useEffect, useState } from 'react';
import {
    getFirestore,
    collection,
    getDocs,
    query,
    where,
    deleteDoc,
    doc as firestoreDoc,
    getDoc,
    onSnapshot,
    doc
} from 'firebase/firestore';
import { FaFilePdf, FaFileExcel, FaEye, FaTrash } from 'react-icons/fa';
import { exportExtraHoursPDF } from '../services/exportExtraHoursPDF';
import { exportExtraHoursExcelStyled } from '../services/exportExtraHoursExcelStyled';
import { toast } from 'react-toastify';
import ExcelExportButton from './ExcelExportButton';

function getDateOfISOWeek(week, year) {
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = new Date(simple);
    if (dow <= 4) {
        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    return ISOweekStart;
}

function getDateFromWeekKeyAndDay(weekKey, day) {
    if (!weekKey || typeof weekKey !== 'string') return null;
    let weekStart;
    if (weekKey.includes('_to_')) {
        const [startStr] = weekKey.split('_to_');
        weekStart = new Date(startStr);
        if (isNaN(weekStart)) return null;
    } else {
        const parts = weekKey.split('-');
        if (parts.length !== 2) return null;
        const year = parseInt(parts[0], 10);
        const week = parseInt(parts[1], 10);
        if (isNaN(year) || isNaN(week)) return null;
        weekStart = getDateOfISOWeek(week, year);
    }
    const offsets = {
        monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
        friday: 4, saturday: 5, sunday: 6,
        lunes: 0, martes: 1, miercoles: 2, 'miércoles': 2,
        jueves: 3, viernes: 4, sabado: 5, 'sábado': 5, domingo: 6
    };
    const offset = offsets[String(day).toLowerCase()];
    if (offset === undefined) return null;
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + offset);
    return date;
}

function calcularHorasNocturnas(inicio, fin) {
  if (!inicio || !fin) return 0;
  const [ih, im] = inicio.split(':').map(Number);
  const [fh, fm] = fin.split(':').map(Number);
  let startMin = ih * 60 + im;
  let endMin = fh * 60 + fm;
  if (endMin <= startMin) endMin += 1440;
  const windows = [{ start: 1320, end: 1440 }, { start: 0, end: 360 }];
  let noctMins = 0;
  for (const w of windows) {
    const overlapStart = Math.max(startMin, w.start);
    const overlapEnd = Math.min(endMin, w.end);
    if (overlapEnd > overlapStart) noctMins += overlapEnd - overlapStart;
  }
  return noctMins / 60;
}
function calcularDuracionHoras(start, end) {
  if (!start || !end) return 0;

  // Suponemos misma fecha arbitraria
  const fechaBase = '2000-01-01';
  const inicio = new Date(`${fechaBase}T${start}:00`);
  let fin = new Date(`${fechaBase}T${end}:00`);

  if (fin <= inicio) {
    // Si fin es menor o igual, asumimos que es del día siguiente
    fin.setDate(fin.getDate() + 1);
  }

  const diffMs = fin - inicio;
  const diffHoras = diffMs / (1000 * 60 * 60);
  return diffHoras;
}


const ConsultaNocturnidad = () => {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [resultados, setResultados] = useState([]);
  const [detallesExtra, setDetallesExtra] = useState({});
  const [expandedRows, setExpandedRows] = useState({});
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState('Todos');

  const calcularNocturnidad = async () => {
    if (!desde || !hasta) return;
    setCargando(true);
    setDetallesExtra({});
    setExpandedRows({});

    try {
      const db = getFirestore();
      const [staffSnap, scheduleSnap, extraSnap] = await Promise.all([
        getDocs(collection(db, 'staff_profiles')),
        getDocs(collection(db, 'schedules')),
        getDocs(collection(db, 'extra_hours'))
      ]);

      const staffMap = {};
      staffSnap.forEach(d => {
        const data = d.data();
        staffMap[d.id] = data;
        if (data.uid) staffMap[data.uid] = data;
      });

      const fechaInicio = new Date(desde);
      const fechaFin = new Date(hasta);
      const usuariosMap = {};
      const extraMap = {};

      extraSnap.forEach(d => {
        const data = d.data();
        const f = new Date(data.fecha);
        if (f >= fechaInicio && f <= fechaFin) {
          const uid = data.uid;
          if (!uid) return;
          const duracion = calcularDuracionHoras(data.inicio, data.fin);
          extraMap[uid] = (extraMap[uid] || 0) + duracion;
        }
      });

      scheduleSnap.forEach(d => {
        const data = d.data();
        const uid = data.uid || d.id;
        const staff = staffMap[uid] || {};
        if (!usuariosMap[uid] && staff) {
          usuariosMap[uid] = {
            uid,
            name: staff.name || '',
            lastName: staff.lastName || '',
            dni: staff.dni || '',
            sucursal: staff.storeId || '',
            horasNocturnas: 0,
            horasExtras: 0,
            feriadosPendientes: 0,
            scheduleRecords: []
          };
        }
        Object.entries(data).forEach(([dia, turno]) => {
          if (dia === 'weekKey' || typeof turno !== 'object') return;
          if (!turno.start || !turno.end) return;
          const date = new Date(data.weekKey.split('_to_')[0]);
          const offsets = {
            monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
            friday: 4, saturday: 5, sunday: 6
          };
          const offset = offsets[dia.toLowerCase()];
          if (offset === undefined) return;
          const fechaTurno = new Date(date);
          fechaTurno.setDate(date.getDate() + offset);
          if (fechaTurno < fechaInicio || fechaTurno > fechaFin) return;
          const noct = calcularHorasNocturnas(turno.start, turno.end);
          usuariosMap[uid].horasNocturnas += noct;
          usuariosMap[uid].scheduleRecords.push({
            fecha: fechaTurno.toISOString().split('T')[0],
            inicio: turno.start,
            fin: turno.end,
            noct
          });
          const fechaKey = fechaTurno.toISOString().split('T')[0];
          if (staff.pendingHolidays?.includes(fechaKey) && !turno.feriado) {
            usuariosMap[uid].feriadosPendientes++;
          }
        });
      });

      Object.entries(extraMap).forEach(([uid, horas]) => {
        if (!usuariosMap[uid]) {
          const s = staffMap[uid] || {};
          usuariosMap[uid] = {
            uid,
            name: s.name || '',
            lastName: s.lastName || '',
            dni: s.dni || '',
            sucursal: s.storeId || '',
            horasNocturnas: 0,
            horasExtras: 0,
            feriadosPendientes: 0,
            scheduleRecords: []
          };
        }
        usuariosMap[uid].horasExtras = horas;
      });

      let resultadosFiltrados = Object.values(usuariosMap);
      if (filtro === 'Nocturnas') {
        resultadosFiltrados = resultadosFiltrados.filter(r => r.horasNocturnas > 0);
      } else if (filtro === 'Extras') {
        resultadosFiltrados = resultadosFiltrados.filter(r => r.horasExtras > 0);
      } else if (filtro === 'Feriados') {
        resultadosFiltrados = resultadosFiltrados.filter(r => r.feriadosPendientes > 0);
      }

      setResultados(resultadosFiltrados);
    } catch (error) {
      console.error('Error al calcular horas:', error);
      toast.error('Error al calcular horas');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (!desde || !hasta) return;
    const db = getFirestore();
    const unsub1 = onSnapshot(collection(db, 'schedules'), calcularNocturnidad);
    const unsub2 = onSnapshot(collection(db, 'extra_hours'), calcularNocturnidad);
    const unsub3 = onSnapshot(collection(db, 'staff_profiles'), calcularNocturnidad);
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [desde, hasta, filtro]);
    const fetchDetalles = async (uid) => {
        try {
            const db = getFirestore();
            const q = query(
                collection(db, 'extra_hours'),
                where('uid', '==', uid),
                where('fecha', '>=', desde),
                where('fecha', '<=', hasta)
            );
            const snap = await getDocs(q);
            setDetallesExtra(prev => ({
                ...prev,
                [uid]: snap.docs.map(d => ({ id: d.id, ...d.data() }))
            }));
        } catch (error) {
            console.error("Error al obtener detalles:", error);
            toast.error('Error al cargar detalles de horas extras');
        }
    };

    const handleToggle = (uid) => {
        setExpandedRows(prev => {
            const open = !!prev[uid];
            if (open) return { ...prev, [uid]: false };
            if (!detallesExtra[uid]) fetchDetalles(uid);
            return { ...prev, [uid]: true };
        });
    };

    const eliminarHorasExtrasUsuario = async (uid) => {
        if (!window.confirm('¿Seguro que deseas eliminar todas las horas extras de este colaborador en el rango seleccionado?')) return;

        try {
            const db = getFirestore();
            const qr = query(
                collection(db, 'extra_hours'),
                where('uid', '==', uid),
                where('fecha', '>=', desde),
                where('fecha', '<=', hasta)
            );
            const snap = await getDocs(qr);
            await Promise.all(snap.docs.map(d => deleteDoc(firestoreDoc(db, 'extra_hours', d.id))));

            toast.success('Horas extras eliminadas correctamente');
            calcularNocturnidad();

            setDetallesExtra(prev => {
                const copy = { ...prev };
                delete copy[uid];
                return copy;
            });

            setExpandedRows(prev => ({ ...prev, [uid]: false }));
        } catch (error) {
            console.error("Error al eliminar horas extras:", error);
            toast.error('Error al eliminar las horas extras');
        }
    };

    return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-red-700 mb-4">Consulta de Horas Nocturnas y Extras</h2>
      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div className="flex flex-col">
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="border p-2 rounded" />
        </div>
        <div className="flex flex-col">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="border p-2 rounded" />
        </div>
        <div className="flex flex-col">
          <label>Filtro</label>
          <select value={filtro} onChange={e => setFiltro(e.target.value)} className="border p-2 rounded">
            <option value="Todos">Todos</option>
            <option value="Nocturnas">Solo Nocturnas</option>
            <option value="Extras">Solo Extras</option>
            <option value="Feriados">Solo Feriados</option>
          </select>
        </div>
        <button
          onClick={calcularNocturnidad}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {cargando ? 'Cargando...' : 'Consultar'}
        </button>
      </div>

            {resultados.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full border mt-4">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="p-2 text-left">Nombre</th>
                                <th className="p-2 text-left">Horas Nocturnas</th>
                                <th className="p-2 text-left">Horas Extras</th>
                                <th className="p-2 text-left">Feriados Pendientes</th>
                                <th className="p-2 text-left">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {resultados.map(r => (
                                <React.Fragment key={r.uid}>
                                    <tr className="hover:bg-gray-50 border-b">
                                        <td className="p-2">{r.name} {r.lastName}</td>
                                        <td className="p-2">{r.horasNocturnas.toFixed(2)}</td>
                                        <td className="p-2">{(r.horasExtras || 0).toFixed(2)}</td>
                                        <td className="p-2">{r.feriadosPendientes}</td>
                                        <td className="p-2 flex gap-2">
                                            <button
                                                onClick={() => handleToggle(r.uid)}
                                                title={expandedRows[r.uid] ? 'Ocultar detalle' : 'Ver detalle'}
                                                className="p-1 hover:bg-gray-100 rounded"
                                            >
                                                <FaEye className="text-blue-600" />
                                            </button>

                                            <ExcelExportButton
                                                r={r}
                                                detallesExtra={detallesExtra}
                                                fetchDetalles={fetchDetalles}
                                            />

                                            {r.horasExtras > 0 && (
                                                <button
                                                    onClick={() => eliminarHorasExtrasUsuario(r.uid)}
                                                    title="Eliminar horas extras"
                                                    className="p-1 hover:bg-gray-100 rounded"
                                                >
                                                    <FaTrash className="text-red-600" />
                                                </button>
                                            )}
                                        </td>

                                    </tr>
                                    {expandedRows[r.uid] && (
                                        <tr>
                                            <td colSpan={5} className="p-4 bg-gray-50">
                                                <div className="space-y-4">
                                                    <div>
                                                        <strong>Total Nocturnas:</strong> {r.horasNocturnas.toFixed(2)} horas<br />
                                                        <strong>Total Extras:</strong> {r.horasExtras.toFixed(2)} horas<br />
                                                        <strong>Feriados Pendientes:</strong> {r.feriadosPendientes}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold mb-2">Turnos y Nocturnidad Detallada</h4>
                                                        {r.scheduleRecords.length > 0 ? (
                                                            <table className="w-full text-sm border">
                                                                <thead className="bg-gray-100">
                                                                    <tr>
                                                                        <th className="p-1">Fecha</th>
                                                                        <th className="p-1">Inicio</th>
                                                                        <th className="p-1">Fin</th>
                                                                        <th className="p-1">Nocturnas</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {r.scheduleRecords.map((t, i) => (
                                                                        <tr key={i} className="even:bg-gray-50">
                                                                            <td className="p-1">{t.fecha}</td>
                                                                            <td className="p-1">{t.inicio}</td>
                                                                            <td className="p-1">{t.fin}</td>
                                                                            <td className="p-1">{t.noct.toFixed(2)}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        ) : (
                                                            <p className="text-sm text-gray-500">No hay registros de turnos</p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold mb-2">Registro de Horas Extras</h4>
                                                        <table className="w-full text-sm border">
                                                            <thead className="bg-gray-100">
                                                                <tr>
                                                                    <th className="p-1">Fecha</th>
                                                                    <th className="p-1">Inicio</th>
                                                                    <th className="p-1">Fin</th>
                                                                    <th className="p-1">Duración</th>
                                                                    <th className="p-1">Actividad</th>
                                                                    <th className="p-1">Acciones</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(detallesExtra[r.uid] || []).map((d, i) => (
                                                                    <tr key={i} className="even:bg-gray-50">
                                                                        <td className="p-1">{d.fecha}</td>
                                                                        <td className="p-1">{d.inicio}</td>
                                                                        <td className="p-1">{d.fin}</td>
                                                                        <td className="p-1">
  {(() => {
    const duracion = calcularDuracionHoras(d.inicio, d.fin);
    const h = Math.floor(duracion);
    const m = Math.round((duracion % 1) * 60);
    return `${h}h ${m}m`;
  })()}
</td>
                                                                        <td className="p-1">{d.actividad}</td>
                                                                        <td className="p-1">
                                                                            <button
                                                                                onClick={async () => {
                                                                                    if (!window.confirm('¿Eliminar esta hora extra?')) return;
                                                                                    try {
                                                                                        const db = getFirestore();
                                                                                        await deleteDoc(firestoreDoc(db, 'extra_hours', d.id));
                                                                                        toast.success('Hora extra eliminada');
                                                                                        fetchDetalles(r.uid);
                                                                                        calcularNocturnidad();
                                                                                    } catch (error) {
                                                                                        console.error("Error al eliminar:", error);
                                                                                        toast.error('Error al eliminar');
                                                                                    }
                                                                                }}
                                                                                title="Eliminar registro"
                                                                                className="hover:bg-gray-200 p-1 rounded"
                                                                            >
                                                                                <FaTrash className="text-red-600 text-sm" />
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                                {(detallesExtra[r.uid] || []).length === 0 && (
                                                                    <tr>
                                                                        <td colSpan={6} className="text-center py-2 text-sm text-gray-500">No hay registros de horas extras</td>
                                                                    </tr>
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="mt-6 text-center">
                    {cargando ? (
                        <p className="text-gray-600">Cargando datos...</p>
                    ) : (
                        desde && hasta && (
                            <p className="text-gray-600">No se encontraron registros para el periodo seleccionado</p>
                        )
                    )}
                </div>
            )}
        </div>
    );
};

export default ConsultaNocturnidad;
