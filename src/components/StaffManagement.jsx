// StaffManagement.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc } from "firebase/firestore";
import StaffModal from "./StaffModal";

const StaffManagement = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const loadStaff = async () => {
      try {
        const snapshot = await getDocs(collection(db, "staff_profiles"));
        setStaff(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        setError("Error cargando personal");
      }
    };
    loadStaff();
  }, []);

  const handleSaveStaff = async (staffData) => {
    try {
      if (editingStaff) {
        await updateDoc(doc(db, "staff_profiles", editingStaff.id), staffData);
      } else {
        await addDoc(collection(db, "staff_profiles"), staffData);
      }
      const updatedSnapshot = await getDocs(collection(db, "staff_profiles"));
      setStaff(updatedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setSuccess(editingStaff ? "Actualizado correctamente" : "Agregado correctamente");
    } catch (error) {
      setError(error.message);
    } finally {
      setShowModal(false);
      setEditingStaff(null);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm("¿Estás seguro de eliminar este miembro?")) {
      try {
        await deleteDoc(doc(db, "staff_profiles", id));
        setStaff(prev => prev.filter(member => member.id !== id));
      } catch (error) {
        setError("Error eliminando registro");
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-red-700">Gestión de Personal</h1>
          <button onClick={() => navigate('/admin')} className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
            Volver
          </button>
        </div>

        {error && <p className="text-red-600 mb-4">{error}</p>}
        {success && <p className="text-green-600 mb-4">{success}</p>}

        <div className="mb-4">
          <button
            onClick={() => { setShowModal(true); setEditingStaff(null); }}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Agregar Personal
          </button>
        </div>

        <table className="w-full text-sm border bg-white shadow rounded">
          <thead className="bg-gray-200">
            <tr>
              <th className="p-2 text-left">Nombre</th>
              <th className="p-2">Modalidad</th>
              <th className="p-2 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(member => (
              <tr key={member.id} className="even:bg-gray-50">
                <td className="p-2">{member.name} {member.lastName}</td>
                <td className="p-2 text-center">{member.modality}</td>
                <td className="p-2 text-center space-x-2">
                  <button
                    onClick={() => { setEditingStaff(member); setShowModal(true); }}
                    className="bg-yellow-400 text-white px-2 py-1 rounded"
                  >Editar</button>
                  <button
                    onClick={() => handleDelete(member.id)}
                    className="bg-red-600 text-white px-2 py-1 rounded"
                  >Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {showModal && (
          <StaffModal
            initialData={editingStaff || {}}
            onClose={() => setShowModal(false)}
            onSave={handleSaveStaff}
          />
        )}
      </div>
    </div>
  );
};

export default StaffManagement;
