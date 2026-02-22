// StaffManagement.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc } from "firebase/firestore";
import StaffModal from "./StaffModal";

const StaffManagement = () => {
  const { logout, userData } = useAuth();
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refreshStaff = async () => {
    try {
      const snapshot = await getDocs(collection(db, "staff_profiles"));
      setStaff(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      setError("Error cargando personal");
    }
  };

  useEffect(() => {
    refreshStaff();
  }, []);

  const handleDelete = async (id) => {
    if (window.confirm("¿Estás seguro de eliminar este miembro?")) {
      try {
        await deleteDoc(doc(db, "staff_profiles", id));
        setStaff(prev => prev.filter(member => member.id !== id));
        setSuccess("Registro eliminado exitosamente");
      } catch (error) {
        setError("Error eliminando registro");
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-blue-700">Gestión de Personal</h1>
          <button onClick={() => navigate('/admin')} className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700">
            Volver
          </button>
        </div>

        {error && <p className="text-red-600 mb-4">{error}</p>}
        {success && <p className="text-green-600 mb-4">{success}</p>}

        <div className="mb-4">
          <button
            onClick={() => { setShowModal(true); setEditingStaff(null); }}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Agregar Personal
          </button>
        </div>

        <div className="bg-white shadow rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-4 text-left font-semibold text-gray-600">Nombre</th>
                <th className="p-4 text-center font-semibold text-gray-600">Modalidad</th>
                <th className="p-4 text-center font-semibold text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(member => (
                <tr key={member.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-4 font-medium text-gray-800">{member.name} {member.lastName}</td>
                  <td className="p-4 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${member.modality === 'Full-Time' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {member.modality}
                    </span>
                  </td>
                  <td className="p-4 text-center space-x-2">
                    <button
                      onClick={() => { setEditingStaff(member); setShowModal(true); }}
                      className="text-blue-600 hover:text-blue-800 font-semibold"
                    >Editar</button>
                    <button
                      onClick={() => handleDelete(member.id)}
                      className="text-red-600 hover:text-red-800 font-semibold"
                    >Eliminar</button>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan="3" className="p-8 text-center text-gray-400 font-medium">No hay colaboradores registrados</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {showModal && (
          <StaffModal
            staff={editingStaff}
            userData={userData}
            onClose={() => setShowModal(false)}
            onSaved={async () => {
              setShowModal(false);
              setEditingStaff(null);
              setSuccess(editingStaff ? "Actualizado correctamente" : "Agregado correctamente");
              await refreshStaff();
            }}
          />
        )}
      </div>
    </div>
  );
};

export default StaffManagement;
