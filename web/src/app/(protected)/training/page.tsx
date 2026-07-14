import { redirect } from "next/navigation";
import { getCurrentAccess } from "@/lib/auth/access";
import { StudyScheduleEditor } from "@/components/study-schedule-editor";

export default async function TrainingPage() {
  const access = await getCurrentAccess();
  if (!access || !["trainer", "admin", "superadmin"].includes(access.role)) redirect("/portal");
  return <main className="content"><div className="page-heading"><div><p className="eyebrow">ENTRENAMIENTO</p><h1>Evaluaciones y disponibilidad</h1><p className="muted">Los entrenadores conservan su propia disponibilidad además de las funciones de capacitación.</p></div></div>{access.staffProfileId ? <StudyScheduleEditor staffId={access.staffProfileId}/> : <section className="migration-card"><div><p className="eyebrow">CAPACITACIÓN</p><h2>Módulo de evaluaciones en migración</h2><p className="muted">Esta cuenta administrativa no está vinculada a un colaborador; la disponibilidad personal no aplica.</p></div></section>}</main>;
}
