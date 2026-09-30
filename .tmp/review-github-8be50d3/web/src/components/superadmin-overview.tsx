"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, Building2, Users, UserRoundCog, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { WeeklyScheduleEditor } from "@/components/weekly-schedule-editor";
import { OperationalMetricsPanel } from "@/components/operational-metrics-panel";
import { SalesWorkspace } from "@/components/sales-workspace";
import { isCurrentStaff } from "@/lib/staff-summary";

async function loadCounts() {
  const supabase = createClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const results = await Promise.all([
    supabase.from("stores").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("staff_profiles").select("status,cessation_date"),
    supabase.from("user_profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("schedule_weeks").select("id", { count: "exact", head: true }),
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const currentStaff = (results[1].data ?? []).filter((person) => isCurrentStaff({ ...person, modality: null, position: null }, today)).length;
  return { stores: results[0].count ?? 0, staff: currentStaff, users: results[2].count ?? 0, schedules: results[3].count ?? 0 };
}

export function SuperadminOverview() {
  const [tab, setTab] = useState<"overview" | "schedule" | "sales" | "operations">("overview");
  const { data, isPending, error, dataUpdatedAt } = useQuery({ queryKey: ["superadmin", "overview", "v3", "current-staff"], queryFn: loadCounts });
  const cards = [
    ["Tiendas", data?.stores, Building2, "Sedes activas"], ["Colaboradores", data?.staff, Users, "Perfiles activos"],
    ["Usuarios", data?.users, UserRoundCog, "Cuentas activas"], ["Semanas", data?.schedules, CalendarClock, "Horarios históricos"],
  ] as const;
  return <><div className="section-tabs" role="tablist"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Building2 size={17}/> Resumen</button><button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><CalendarClock size={17}/> Horarios por tienda</button><button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}><BarChart3 size={17}/> Ventas por tienda</button><button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}><Activity size={17}/> Indicadores por tienda</button></div>{tab === "schedule" ? <WeeklyScheduleEditor/> : tab === "sales" ? <SalesWorkspace/> : tab === "operations" ? <OperationalMetricsPanel/> : <><div className="page-heading"><div><p className="eyebrow">CONTROL GENERAL</p><h1>Panel de superadministración</h1><p className="muted">Vista inicial conectada a la información migrada, protegida por RLS.</p></div>{dataUpdatedAt > 0 && <span className="cache-badge">Actualizado {new Date(dataUpdatedAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span>}</div>
    {error && <p className="form-alert error">No se pudo cargar el resumen.</p>}
    <section className="metric-grid">{cards.map(([label, value, Icon, detail]) => <article className="metric-card" key={label}><div className="metric-icon"><Icon size={21}/></div><span>{label}</span><strong>{isPending ? "—" : value?.toLocaleString("es-PE")}</strong><small>{detail}</small></article>)}</section>
    <section className="migration-card"><div><p className="eyebrow">MIGRACIÓN NEXT.JS</p><h2>Paridad funcional completada</h2><p className="muted">Los módulos operativos ya funcionan sobre Supabase. Quedan la validación final por roles, la conciliación incremental y el corte controlado de Firebase.</p></div><div className="progress-ring">5<span>/ 6</span></div></section>
  </>}</>;
}
