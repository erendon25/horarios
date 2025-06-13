// PositionRequirements.jsx – restaurado con pintura de celdas y edición de posiciones
import React, { useEffect, useState, useRef } from 'react';
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

/* === constantes de tiempo === */
const hours = Array.from({ length: 77 }, (_, i) => {
  const h = Math.floor(i / 4) + 6; // inicia 06:00
  const m = (i % 4) * 15;
  return `${(h % 24).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
});

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const weekdayLabels = {
  monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles',
  thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo'
};

/* === utilidades de matriz === */
const compressMatrix = (matrix) => Object.fromEntries(matrix.map((r, i) => [i, Object.fromEntries(r.map((v, j) => [j, v]))]));
const expandMatrix   = (data, rows, cols) => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => data?.[i]?.[j] || 0));

export default function PositionRequirements() {
  const db = getFirestore();
  const [day, setDay] = useState('monday');
  const [positions, setPositions] = useState([]);
  const [matrix, setMatrix] = useState([]);
  const [newPos, setNewPos] = useState('');
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [selectedDays, setSelectedDays] = useState([]);

  /* === para pintar arrastrando === */
  const isDragging = useRef(false);
  const dragMode  = useRef('add'); // 'add' | 'sub'
  const lastKey   = useRef('');

  /* === carga datos del día === */
  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, 'positioning_requirements', day));
      if (snap.exists()) {
        const { positions: pos, matrix: mat } = snap.data();
        setPositions(pos);
        setMatrix(expandMatrix(mat, pos.length, hours.length));
      } else {
        setPositions([]);
        setMatrix([]);
      }
    })();
  }, [day, db]);

  /* === helpers === */
  const mutateCell = (r, c, type) => {
    setMatrix(prev => prev.map((row, i) => i === r ? row.map((v, j) => j === c ? (type === 'add' ? v + 1 : Math.max(v - 1, 0)) : v) : row));
  };

  /* === eventos mouse === */
  const onCellMouseDown = (r, c, e) => {
    e.preventDefault();
    dragMode.current = e.altKey ? 'sub' : 'add';
    isDragging.current = true;
    mutateCell(r, c, dragMode.current);
    lastKey.current = `${r}-${c}`;
  };
  const onCellMouseEnter = (r, c) => {
    if (!isDragging.current) return;
    const k = `${r}-${c}`;
    if (k !== lastKey.current) {
      mutateCell(r, c, dragMode.current);
      lastKey.current = k;
    }
  };
  useEffect(() => {
    const stop = () => { isDragging.current = false; };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  /* === CRUD posiciones === */
  const addPosition = () => {
    if (!newPos.trim()) return;
    setPositions(p => [...p, newPos.trim()]);
    setMatrix(m => [...m, Array(hours.length).fill(0)]);
    setNewPos('');
  };
  const updatePosition = (idx, val) => setPositions(p => p.map((pos, i) => i === idx ? val : pos));
  const deletePosition = (idx) => {
    if (!confirm('¿Eliminar posición?')) return;
    setPositions(p => p.filter((_, i) => i !== idx));
    setMatrix(m => m.filter((_, i) => i !== idx));
  };

  /* === guardar / limpiar === */
  const save = async () => {
    await setDoc(doc(db, 'positioning_requirements', day), { positions, matrix: compressMatrix(matrix) });
    alert('Guardado');
  };
  const clearAll = async () => {
    if (!confirm('¿Borrar toda la planificación del día?')) return;
    await deleteDoc(doc(db, 'positioning_requirements', day));
    setPositions([]);
    setMatrix([]);
  };

  /* === duplicar === */
  const toggleDupDay = d => setSelectedDays(s => s.includes(d) ? s.filter(x => x !== d) : [...s, d]);
  const duplicatePlan = async () => {
    if (!selectedDays.length) return alert('Selecciona días');
    const data = { positions, matrix: compressMatrix(matrix) };
    for (const d of selectedDays) await setDoc(doc(db, 'positioning_requirements', d), data);
    alert('Duplicado');
    setShowDuplicate(false);
  };

  /* === UI === */
  return (
    <div className="p-4 select-none">
      {/* barra superior */}
      <div className="flex items-center gap-3 mb-3">
        <label className="font-semibold">Día:</label>
        <select value={day} onChange={e => setDay(e.target.value)} className="border px-2 py-1 rounded">
          {weekdays.map(d => <option key={d} value={d}>{weekdayLabels[d]}</option>)}
        </select>
        <button onClick={save} className="bg-blue-600 text-white px-4 py-1 rounded">Guardar</button>
        <button onClick={clearAll} className="bg-red-600 text-white px-4 py-1 rounded">Borrar Todo</button>
        <button onClick={() => setShowDuplicate(!showDuplicate)} className="bg-purple-600 text-white px-4 py-1 rounded">Duplicar planificación</button>
      </div>

      {showDuplicate && (
        <div className="border p-3 rounded mb-4 bg-purple-50">
          <p className="font-semibold mb-2">Duplicar a:</p>
          <div className="flex flex-wrap gap-3 mb-2">
            {weekdays.map(d => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" checked={selectedDays.includes(d)} onChange={() => toggleDupDay(d)} />
                {weekdayLabels[d]}
              </label>
            ))}
          </div>
          <button onClick={duplicatePlan} className="bg-purple-600 text-white px-4 py-1 rounded">Confirmar</button>
        </div>
      )}

      {/* nueva posición */}
      <div className="flex gap-2 mb-3">
        <input value={newPos} onChange={e => setNewPos(e.target.value)} placeholder="Nueva posición" className="border px-2 py-1 rounded w-60" />
        <button onClick={addPosition} className="bg-green-600 text-white px-4 py-1 rounded">Añadir Posición</button>
      </div>

      {/* tabla */}
      <div className="overflow-auto border rounded">
        <table className="table-auto w-[1400px] text-xs">
          <thead className="sticky top-0 bg-gray-100 z-10">
            <tr>
              <th className="border px-2">Posición</th>
              {hours.map((h, i) => <th key={i} className="border px-1 whitespace-nowrap">{h}</th>)}
              <th className="border px-2">❌</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, r) => (
              <tr key={r}>
                <td className="border px-2">
                  <input value={pos} onChange={e => updatePosition(r, e.target.value)} className="w-40 border-b" />
                </td>
                {hours.map((_, c) => (
                  <td key={c}
                    onMouseDown={e => onCellMouseDown(r, c, e)}
                    onMouseEnter={() => onCellMouseEnter(r, c)}
                    className={`border text-center w-4 h-6 ${matrix[r]?.[c] ? 'bg-orange-400 text-white font-bold' : ''}`}
                    title={matrix[r]?.[c] ? `${matrix[r][c]} persona(s)` : ''}
                  >{matrix[r]?.[c] || ''}</td>
                ))}
                <td className="border px-2 text-red-600 text-center cursor-pointer" onClick={() => deletePosition(r)}>🗑️</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
