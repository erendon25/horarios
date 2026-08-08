import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function PrivateRoute({ children, role }) {
  const { currentUser, userRole } = useAuth();
  if (!currentUser) return <Navigate to="/login" />;

  const allowed = userRole === role
    || (role === "admin" && userRole === "superadmin")
    || (role === "trainer" && ["admin", "superadmin"].includes(userRole))
    // El dashboard de colaborador es el panel personal de cualquier miembro:
    // entrenadores, admins y superadmins también pueden verlo.
    || (role === "collaborator" && ["trainer", "admin", "superadmin"].includes(userRole));
  if (!role || allowed) return children;

  const destination = {
    superadmin: "/superadmin",
    admin: "/admin",
    trainer: "/staff",
    collaborator: "/staff",
  }[userRole] ?? "/login";
  return <Navigate to={destination} />;
}

export default PrivateRoute;
