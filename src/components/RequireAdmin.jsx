import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";

export default function RequireAdmin({ children }) {
  const { currentUser, userRole, accessLoading, needsStaffLink } = useAuth();
  if (accessLoading) return <p role="status" className="p-6">Comprobando tu acceso…</p>;

  if (!currentUser) {
    return <Navigate to="/login" />;
  }
  if (needsStaffLink) return <Navigate to="/register" replace />;

  if (userRole !== "admin" && userRole !== "superadmin") {
    return <Navigate to="/unauthorized" />;
  }

  return children;
}
