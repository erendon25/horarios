"use client";

import { Building2, Store } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

export function ViewModeSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const superadminView = pathname.startsWith("/superadmin");

  return <section className="view-mode-switcher" aria-label="Cambiar modo de vista">
    <span>Modo de vista</span>
    <div role="group" aria-label="Seleccionar vista">
      <button
        type="button"
        className={!superadminView ? "active" : ""}
        aria-pressed={!superadminView}
        onClick={() => router.push("/admin")}
      >
        <Store size={15}/>
        <span>Admin</span>
        <small>Porongoche</small>
      </button>
      <button
        type="button"
        className={superadminView ? "active" : ""}
        aria-pressed={superadminView}
        onClick={() => router.push("/superadmin")}
      >
        <Building2 size={15}/>
        <span>Superadmin</span>
        <small>Todas las tiendas</small>
      </button>
    </div>
  </section>;
}
