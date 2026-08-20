"use client";

import Link from "next/link";
import { Building2, CalendarDays, GraduationCap, LayoutDashboard, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const SIDEBAR_STORAGE_KEY = "horarios-sidebar-collapsed";

export function AppSidebar({ children, isSuperadmin, hasAdminAccess, hasTrainingAccess }: { children: ReactNode; isSuperadmin: boolean; hasAdminAccess: boolean; hasTrainingAccess: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  const navClass = (href: string) => `nav-link ${pathname.startsWith(href) ? "active" : ""}`;
  const trainingHref = isSuperadmin && pathname.startsWith("/superadmin") ? "/training?view=superadmin" : "/training?view=admin";

  return <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
    <div className="sidebar-header">
      <Link href="/portal" className="brand dark" title="Horarios"><CalendarDays size={22}/><span>Horarios</span></Link>
      <button type="button" className="sidebar-collapse-button" onClick={toggleSidebar} aria-label={collapsed ? "Mostrar menú lateral" : "Contraer menú lateral"} title={collapsed ? "Mostrar menú lateral" : "Contraer menú lateral"}>{collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button>
    </div>
    <nav>
      <Link href="/portal" className={navClass("/portal")} title="Resumen"><LayoutDashboard size={18}/><span>Resumen</span></Link>
      {isSuperadmin && <Link href="/superadmin" className={navClass("/superadmin")} title="Control general"><Building2 size={18}/><span>Control general</span></Link>}
      {hasAdminAccess && <Link href="/admin" className={navClass("/admin")} title="Administración"><CalendarDays size={18}/><span>Administración</span></Link>}
      {hasTrainingAccess && <Link href={trainingHref} className={navClass("/training")} title="Capacitación"><GraduationCap size={18}/><span>Capacitación</span></Link>}
    </nav>
    {children}
  </aside>;
}
