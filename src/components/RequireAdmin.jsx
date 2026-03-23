import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";

export default function RequireAdmin({ children }) {
  const { currentUser, userRole } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  // Permite el acceso si es admin, superadmin o si es el usuario especificado
  if (userRole !== "admin" && userRole !== "superadmin" && currentUser.email !== "erickrendon18@gmail.com") {
    return <Navigate to="/unauthorized" />;
  }

  return children;
}
