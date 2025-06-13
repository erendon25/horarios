import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";

export default function RequireAdmin({ children }) {
  const { currentUser, userRole } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  if (userRole !== "admin") {
    return <Navigate to="/unauthorized" />;
  }

  return children;
}
