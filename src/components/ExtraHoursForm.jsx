import React, { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  getDocs,
  getFirestore,
  query,
  where,
  deleteDoc,
  doc,
} from "firebase/firestore";

const ExtraHoursForm = ({ uid, onSuccess }) => {
  const [fecha, setFecha] = useState("");
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [actividad, setActividad] = useState("apoyo en cocina");
  const [horasExtras, setHorasExtras] = useState([]);
  const db = getFirestore();

  const calcularDuracion = (start, end) => {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const inicioMin = sh * 60 + sm;
    const finMin = eh * 60 + em;
    const duracion = finMin - inicioMin;
    return `${Math.floor(duracion / 60)}h ${duracion % 60}m`;
  };

  const fetchHoras = async () => {
    if (!uid) return;
    const q = query(collection(db, "extra_hours"), where("uid", "==", uid));
    const snap = await getDocs(q);
    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const ordenado = data.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    setHorasExtras(ordenado);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!fecha || !inicio || !fin) {
      alert("Por favor, completa todos los campos.");
      return;
    }

    const duracion = calcularDuracion(inicio, fin);
    await addDoc(collection(db, "extra_hours"), {
      uid,
      fecha,
      inicio,
      fin,
      actividad,
      duracion,
    });

    fetchHoras();
    if (onSuccess) onSuccess();
  };

  const eliminar = async (id) => {
    const confirmar = window.confirm("¿Seguro que deseas eliminar esta hora extra?");
    if (!confirmar) return;
    await deleteDoc(doc(db, "extra_hours", id));
    fetchHoras();
  };

  useEffect(() => {
    fetchHoras();
  }, [uid]);

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-2">
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full border p-2" />
        <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-full border p-2" />
        <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} className="w-full border p-2" />
        <textarea value={actividad} onChange={(e) => setActividad(e.target.value)} className="w-full border p-2" />

        <button type="submit" className="bg-blue-600 text-white px-4 py-2 w-full">Registrar hora extra</button>
      </form>

      <h3 className="mt-4 font-semibold">Historial</h3>
      <table className="w-full mt-2 border">
        <thead>
          <tr className="bg-gray-200 text-sm text-left">
            <th className="px-2 py-1">Fecha</th>
            <th className="px-2 py-1">Inicio</th>
            <th className="px-2 py-1">Fin</th>
            <th className="px-2 py-1">Duración</th>
            <th className="px-2 py-1">Actividad</th>
            <th className="px-2 py-1">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {horasExtras.map((h) => (
            <tr key={h.id} className="text-sm">
              <td className="px-2 py-1">{h.fecha}</td>
              <td className="px-2 py-1">{h.inicio}</td>
              <td className="px-2 py-1">{h.fin}</td>
              <td className="px-2 py-1">{h.duracion}</td>
              <td className="px-2 py-1">{h.actividad}</td>
              <td className="px-2 py-1">
                <button onClick={() => eliminar(h.id)} className="text-red-600 text-xs">Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ExtraHoursForm;

