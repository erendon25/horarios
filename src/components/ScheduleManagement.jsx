// ScheduleManagement.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';

const ScheduleManagement = () => {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { currentUser, userRole } = useAuth();
  const db = getFirestore();

  useEffect(() => {
    if (!currentUser || userRole !== 'admin') {
      navigate('/login');
      return;
    }
    fetchStaff();
  }, [currentUser, userRole, navigate]);

  async function fetchStaff() {
    try {
      setLoading(true);
      const staffCollection = collection(db, 'staff_profiles');
      const snapshot = await getDocs(staffCollection);
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaff(list);
      setLoading(false);
    } catch (err) {
      console.error('Error al cargar personal:', err);
      setError('No se pudo cargar la lista de personal');
      setLoading(false);
    }
  }

  const navigateToSchedule = (staffId) => {
    navigate(`/horarios/${staffId}`);
  };

  const formatName = (p) => `${p.name || ''} ${p.lastName || ''}`.trim();

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-red-700">Gestión de Horarios</h1>
          <button onClick={() => navigate('/admin')} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
            Volver al Panel
          </button>
        </div>

        {loading && <p className="text-gray-600">Cargando...</p>}
        {error && <p className="text-red-600">{error}</p>}

        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-xl font-semibold mb-4">Selecciona un colaborador para asignar horario</h2>
          <table className="w-full text-sm border">
            <thead className="bg-gray-200">
              <tr>
                <th className="p-2 text-left">Nombre</th>
                <th className="p-2">Modalidad</th>
                <th className="p-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id} className="even:bg-gray-50">
                  <td className="p-2">{formatName(member)}</td>
                  <td className="p-2 text-center">{member.modality}</td>
                  <td className="p-2 text-center">
                    <button
                      onClick={() => navigateToSchedule(member.id)}
                      className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                    >
                      Configurar Horario
                    </button>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && !loading && (
                <tr><td colSpan="3" className="text-center text-gray-500 py-4">No hay personal disponible</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ScheduleManagement;
