import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function PrivateRoute({ children, role }) {
  const { currentUser, userRole } = useAuth();
  
  // Si no hay usuario autenticado, redirigir al login
  if (!currentUser) {
    return <Navigate to="/login" />;
  }
  
  // Si se especificó un rol requerido y el usuario no lo tiene
  if (role && userRole !== role) {
    // Redirigir según su rol actual
    if (userRole === 'admin') {
      return <Navigate to="/admin" />;
    } else if (userRole === 'staff') {
      return <Navigate to="/staff" />;
    } else {
      // Si no tiene un rol conocido, lo enviamos al login
      return <Navigate to="/login" />;
    }
  }
  
  // Si pasa todas las verificaciones, mostrar el componente hijo
  return children;
}

export default PrivateRoute;