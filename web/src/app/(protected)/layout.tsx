import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, LayoutDashboard } from "lucide-react";
import { QueryProvider } from "@/components/query-provider";
import { LogoutButton } from "@/components/logout-button";
import { getCurrentAccess } from "@/lib/auth/access";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const access = await getCurrentAccess();
  if (!access) redirect("/login");
  if (access.status !== "active") redirect("/auth/logout?reason=inactive");
  if (access.isCessationEffective) redirect("/auth/logout?reason=cessation");
  return <QueryProvider userId={access.userId}><div className="app-shell">
    <aside className="sidebar"><Link href="/portal" className="brand dark"><CalendarDays size={22}/> Horarios</Link><nav><Link href="/portal" className="nav-link active"><LayoutDashboard size={18}/> Resumen</Link>{["admin", "superadmin"].includes(access.role) && <Link href="/admin" className="nav-link"><CalendarDays size={18}/> Administración</Link>}</nav><div className="user-block"><strong>{access.displayName}</strong><span>{access.role}</span><LogoutButton userId={access.userId}/></div></aside>
    <div className="main-column"><header className="topbar"><div><span className="status-dot"/> Supabase conectado</div><span className="muted">Caché de sesión activo</span></header>{children}</div>
  </div></QueryProvider>;
}
