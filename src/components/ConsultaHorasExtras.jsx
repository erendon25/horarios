
import React, { useEffect, useState } from 'react';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { exportExtraHoursExcel } from '../services/exportExtraHoursExcel';
import { exportExtraHoursPDF } from '../services/exportExtraHoursPDF';

const ConsultaHorasExtras = () => {
  const [extraData, setExtraData] = useState({});
  const [loading, setLoading] = useState(true);
  const db = getFirestore();

  const agruparPorColaborador = async () => {
    const snap = await getDocs(collection(db, 'extra_hours'));
    const staffSnap = await getDocs(collection(db, 'staff_profiles'));

    const staffMap = {};
    staffSnap.forEach(doc => {
      const d = doc.data();
      staffMap[d.uid] = {
        name: d.name,
        lastName: d.lastName,
      };
    });

    const grouped = {};
    snap.forEach(doc => {
      const data = doc.data();
      const uid = data.uid;
      if (!grouped[uid]) grouped[uid] = [];
      grouped[uid].push({ ...data, id: doc.id });
    });

    const final = {};
    for (const uid in grouped) {
      const colab = staffMap[uid] || {};
      final[uid] = {
        name: colab.name || '',
        lastName: colab.lastName || '',
        registros: grouped[uid]
      };
    }

    setExtraData(final);
    setLoading(false);
  };

  useEffect(() => {
    agruparPorColaborador();
  }, []);

  if (loading) return <p className="p-4">Cargando horas extras...</p>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Consulta de Horas Extras</h1>

      {Object.entries(extraData).map(([uid, colab]) => (
        <div key={uid} className="mb-6 border rounded shadow-sm p-4 bg-white">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-semibold">{colab.name} {colab.lastName}</h2>
            <div className="space-x-2">
              <button onClick={() => exportExtraHoursExcel(colab)} className="px-3 py-1 bg-green-600 text-white rounded">Excel</button>
              <button onClick={() => exportExtraHoursPDF(colab)} className="px-3 py-1 bg-red-600 text-white rounded">PDF</button>
            </div>
          </div>
          <table className="table-auto w-full border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Fecha</th>
                <th className="p-2">Inicio</th>
                <th className="p-2">Fin</th>
                <th className="p-2">Duración</th>
                <th className="p-2">Actividad</th>
              </tr>
            </thead>
            <tbody>
              {colab.registros.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.fecha}</td>
                  <td className="p-2">{r.inicio}</td>
                  <td className="p-2">{r.fin}</td>
                  <td className="p-2">{r.duracion}</td>
                  <td className="p-2">{r.actividad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default ConsultaHorasExtras;
