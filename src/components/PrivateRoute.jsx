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
    // Excepciones especiales para el correo maestro
    const isMasterEmail = currentUser?.email === 'erickrendon18@gmail.com';
    
    // Si la ruta requiere 'superadmin', permitir si es el correo maestro o si su rol es superadmin
    if (role === 'superadmin' && (isMasterEmail || userRole === 'superadmin')) {
      return children;
    }
    
    // Si la ruta requiere 'admin', permitir si es el correo maestro o si su rol es superadmin
    if (role === 'admin' && (isMasterEmail || userRole === 'superadmin')) {
      return children;
    }

    // Redirigir según su rol actual si es distinto a lo que busca
    if (userRole === 'superadmin') {
      return <Navigate to="/superadmin" />;
    } else if (userRole === 'admin') {
      return <Navigate to="/admin" />;
    } else if (userRole === 'collaborator') {
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