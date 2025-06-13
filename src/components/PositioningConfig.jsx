// PositioningConfig.jsx
import { useState, useEffect } from 'react';
import { getFirestore, collection, getDocs, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { useNavigate, Link } from 'react-router-dom';

function PositioningConfig() {
  const db = getFirestore();
  const navigate = useNavigate();
  const [day, setDay] = useState('monday');
  const [position, setPosition] = useState('Do Sheet');
  const [count, setCount] = useState(1);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [requirements, setRequirements] = useState([]);
  const [error, setError] = useState('');

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const positions = ['Do Sheet', 'Sheet Out', 'Masa', 'Vestido', 'Landing', 'Landing Crazy', 'Lavado', 'Drive Thru', 'Modulo', 'Servicio'];

  useEffect(() => {
    fetchRequirements();
  }, []);

  function timeToBlockIndex(time) {
    const [h, m] = time.split(':').map(Number);
    const totalMinutes = h * 60 + m;
    const startMinutes = 6 * 60; // desde 06:00
    return Math.floor((totalMinutes - startMinutes) / 15);
  }

  async function fetchRequirements() {
    try {
      const snap = await getDocs(collection(db, 'positioning_requirements'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRequirements(list);
    } catch (err) {
      console.error('Error al cargar posicionamiento:', err);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');

    try {
      const startBlock = timeToBlockIndex(startTime);
      const endBlock = timeToBlockIndex(endTime);
      const blockMap = {};
      for (let i = startBlock; i <= endBlock; i++) {
        blockMap[i] = count;
      }

      const existing = requirements.find(r => r.day === day);
      if (existing) {
        const idx = existing.positions.findIndex(p => p === position);
        const ref = doc(db, 'positioning_requirements', existing.id);

        if (idx !== -1) {
          existing.matrix[idx] = blockMap;
        } else {
          existing.positions.push(position);
          existing.matrix.push(blockMap);
        }

        await updateDoc(ref, {
          positions: existing.positions,
          matrix: existing.matrix
        });
      } else {
        await addDoc(collection(db, 'positioning_requirements'), {
          day,
          positions: [position],
          matrix: [blockMap]
        });
      }

      fetchRequirements();
    } catch (err) {
      console.error(err);
      setError('No se pudo guardar el requerimiento.');
    }
  }

  async function handleDelete(id) {
    try {
      await deleteDoc(doc(db, 'positioning_requirements', id));
      fetchRequirements();
    } catch (err) {
      console.error('Error al eliminar:', err);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <nav className="bg-white shadow mb-6 rounded px-4 py-3 flex justify-between items-center">
        <h1 className="text-xl font-bold text-red-600">Panel de Navegación</h1>
        <div className="space-x-4">
          <Link to="/admin" className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">Inicio</Link>
          <Link to="/horarios" className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">Horarios</Link>
          <Link to="/posiciones" className="text-sm bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700">Posiciones</Link>
        </div>
      </nav>

      <div className="w-full max-w-4xl mx-auto bg-white p-6 rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Requerimientos de Posicionamiento</h2>
        </div>

        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
          <select value={day} onChange={e => setDay(e.target.value)} className="p-2 border rounded">
            {days.map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={position} onChange={e => setPosition(e.target.value)} className="p-2 border rounded">
            {positions.map(p => <option key={p}>{p}</option>)}
          </select>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="p-2 border rounded" />
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="p-2 border rounded" />
          <input type="number" min="1" value={count} onChange={e => setCount(Number(e.target.value))} className="p-2 border rounded" />
          <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Guardar</button>
        </form>

        {error && <p className="text-red-500 mb-4">{error}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white border">
            <thead className="bg-gray-200">
              <tr>
                <th className="p-2 text-left">Día</th>
                <th className="p-2 text-left">Posición</th>
                <th className="p-2 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map(req => req.positions.map((pos, idx) => (
                <tr key={`${req.id}-${idx}`} className="even:bg-gray-50">
                  <td className="p-2 capitalize">{req.day}</td>
                  <td className="p-2">{pos}</td>
                  <td className="p-2 text-center">
                    <button
                      onClick={() => {
                        setDay(req.day);
                        setPosition(pos);
                        const blocks = req.matrix[idx];
                        const blockIndexes = Object.keys(blocks).map(n => parseInt(n)).sort((a, b) => a - b);
                        const startBlock = blockIndexes[0];
                        const endBlock = blockIndexes[blockIndexes.length - 1];
                        const start = new Date(0, 0, 0, 6 + Math.floor(startBlock / 4), (startBlock % 4) * 15);
                        const end = new Date(0, 0, 0, 6 + Math.floor(endBlock / 4), (endBlock % 4) * 15);
                        setStartTime(start.toTimeString().slice(0, 5));
                        setEndTime(end.toTimeString().slice(0, 5));
                        setCount(blocks[startBlock]);
                      }}
                      className="bg-yellow-500 text-white px-2 py-1 rounded mr-2"
                    >Editar</button>
                    <button
                      onClick={() => handleDelete(req.id)}
                      className="bg-red-600 text-white px-2 py-1 rounded"
                    >Eliminar</button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default PositioningConfig;

