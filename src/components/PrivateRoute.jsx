import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function PrivateRoute({ children, role }) {
  const { currentUser, userRole } = useAuth();
  if (!currentUser) return <Navigate to="/login" />;

  const allowed = userRole === role
    || (role === "admin" && userRole === "superadmin")
    || (role === "trainer" && ["admin", "superadmin"].includes(userRole));
  if (!role || allowed) return children;

  const destination = {
    superadmin: "/superadmin",
    admin: "/admin",
    trainer: "/entrenamiento",
    collaborator: "/staff",
  }[userRole] ?? "/login";
  return <Navigate to={destination} />;
}

export default PrivateRoute;
