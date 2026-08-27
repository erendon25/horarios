import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { QueryProvider } from "@/components/query-provider";
import { LogoutButton } from "@/components/logout-button";
import { ViewModeSwitcher } from "@/components/view-mode-switcher";
import { getCurrentAccess } from "@/lib/auth/access";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const access = await getCurrentAccess();
  if (!access) redirect("/login");
  if (access.requiresRegistration) redirect("/auth/logout?reason=registration");
  if (access.role === "admin" && !access.storeActive) redirect("/auth/logout?reason=inactive_store");
  if (access.status !== "active") redirect("/auth/logout?reason=inactive");
  if (access.isCessationEffective) redirect("/auth/logout?reason=cessation");
  const isSuperadmin = access.role === "superadmin";
  const hasAdminAccess = ["admin", "superadmin"].includes(access.role);
  const hasTrainingAccess = ["trainer", "admin", "superadmin"].includes(access.role);
  return <QueryProvider userId={access.userId}><div className="app-shell">
    <AppSidebar isSuperadmin={isSuperadmin} hasAdminAccess={hasAdminAccess} hasTrainingAccess={hasTrainingAccess}>
      {isSuperadmin && <ViewModeSwitcher/>}
      <div className="user-block"><strong>{access.displayName}</strong><span>{isSuperadmin ? "Superadmin · Admin" : access.role}</span><LogoutButton userId={access.userId}/></div>
    </AppSidebar>
    <div className="main-column"><header className="topbar"><div><span className="status-dot"/> Supabase conectado</div><span className="muted">Caché de sesión activo</span></header>{children}</div>
  </div></QueryProvider>;
}
