"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Building2, Users, UserRoundCog, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { WeeklyScheduleEditor } from "@/components/weekly-schedule-editor";
import { OperationalMetricsPanel } from "@/components/operational-metrics-panel";

async function loadCounts() {
  const supabase = createClient();
  const tables = ["stores", "staff_profiles", "user_profiles", "schedule_weeks"] as const;
  const results = await Promise.all(tables.map((table) => supabase.from(table).select("*", { count: "exact", head: true })));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return { stores: results[0].count ?? 0, staff: results[1].count ?? 0, users: results[2].count ?? 0, schedules: results[3].count ?? 0 };
}

export function SuperadminOverview() {
  const [tab, setTab] = useState<"overview" | "schedule" | "operations">("overview");
  const { data, isPending, error, dataUpdatedAt } = useQuery({ queryKey: ["superadmin", "overview", "v1"], queryFn: loadCounts });
  const cards = [
    ["Tiendas", data?.stores, Building2, "Sedes registradas"], ["Colaboradores", data?.staff, Users, "Perfiles laborales"],
    ["Usuarios", data?.users, UserRoundCog, "Cuentas con acceso"], ["Semanas", data?.schedules, CalendarClock, "Horarios históricos"],
  ] as const;
  return <><div className="section-tabs" role="tablist"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Building2 size={17}/> Resumen</button><button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><CalendarClock size={17}/> Horarios por tienda</button><button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}><Activity size={17}/> Indicadores por tienda</button></div>{tab === "schedule" ? <WeeklyScheduleEditor/> : tab === "operations" ? <OperationalMetricsPanel/> : <><div className="page-heading"><div><p className="eyebrow">CONTROL GENERAL</p><h1>Panel de superadministración</h1><p className="muted">Vista inicial conectada a la información migrada, protegida por RLS.</p></div>{dataUpdatedAt > 0 && <span className="cache-badge">Actualizado {new Date(dataUpdatedAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span>}</div>
    {error && <p className="form-alert error">No se pudo cargar el resumen.</p>}
    <section className="metric-grid">{cards.map(([label, value, Icon, detail]) => <article className="metric-card" key={label}><div className="metric-icon"><Icon size={21}/></div><span>{label}</span><strong>{isPending ? "—" : value?.toLocaleString("es-PE")}</strong><small>{detail}</small></article>)}</section>
    <section className="migration-card"><div><p className="eyebrow">MIGRACIÓN NEXT.JS</p><h2>Base funcional completada</h2><p className="muted">Autenticación, roles, cese de acceso y caché seguro ya funcionan sobre Supabase. Los módulos se incorporarán manteniendo una matriz de paridad.</p></div><div className="progress-ring">1<span>/ 6</span></div></section>
  </>}</>;
}
