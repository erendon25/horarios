import { redirect } from "next/navigation";
import { getCurrentAccess } from "@/lib/auth/access";
import { AdminWorkspace } from "@/components/admin-workspace";

export default async function AdminPage() {
  const access = await getCurrentAccess();
  if (!access || !["admin", "superadmin"].includes(access.role)) redirect("/portal");
  return <main className="content">
    <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN · RR. HH.</p><h1>Colaboradores y ceses</h1><p className="muted">La fecha del perfil y el registro de RR. HH. se guardan juntos en una sola transacción.</p></div></div>
    <AdminWorkspace />
  </main>;
}
