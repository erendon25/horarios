import { redirect } from "next/navigation";
import { getCurrentAccess } from "@/lib/auth/access";
import { TrainingWorkspace } from "@/components/training-workspace";

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const access = await getCurrentAccess();
  if (!access || !["trainer", "admin", "superadmin"].includes(access.role)) redirect("/portal");
  const requestedView = (await searchParams).view;
  const effectiveRole = access.role === "superadmin" && requestedView === "superadmin" ? "superadmin" : access.role === "superadmin" ? "admin" : access.role;
  return <main className="content"><div className="page-heading"><div><p className="eyebrow">ENTRENAMIENTO</p><h1>Evaluaciones y capacitación</h1><p className="muted">Evalúa estaciones, consulta resultados, analiza certificaciones y conserva las firmas de forma privada.</p></div></div><TrainingWorkspace role={effectiveRole} userId={access.userId} initialStoreId={access.storeId} ownStaffId={access.staffProfileId}/></main>;
}
