import { redirect } from "next/navigation";
import { getCurrentAccess } from "@/lib/auth/access";
import { StaffSelfServicePortal } from "@/components/staff-self-service-portal";

export default async function StaffPage() {
  const access = await getCurrentAccess();
  if (!access) redirect("/login");
  return <main className="content"><div className="page-heading"><div><p className="eyebrow">MI ESPACIO</p><h1>Portal del colaborador</h1><p className="muted">Consulta tu planificación y gestiona tus movimientos sin depender de Firebase.</p></div><span className="cache-badge">Caché de sesión activa</span></div>{access.staffProfileId ? <StaffSelfServicePortal staffId={access.staffProfileId}/> : <p className="form-alert error">Tu cuenta todavía no está vinculada a un perfil de colaborador.</p>}</main>;
}
