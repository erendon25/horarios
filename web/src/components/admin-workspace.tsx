"use client";

import { useState } from "react";
import { Activity, BarChart3, CalendarDays, FileSpreadsheet, MessageSquareText, UsersRound, UserRoundX } from "lucide-react";
import { StaffManagementPanel } from "@/components/staff-management-panel";
import { HrCessationsPanel } from "@/components/hr-cessations-panel";
import { WeeklyScheduleEditor } from "@/components/weekly-schedule-editor";
import { OperationalMetricsPanel } from "@/components/operational-metrics-panel";
import { ScheduleRequestsPanel } from "@/components/schedule-requests-panel";
import { GeoVictoriaImportPanel } from "@/components/geo-victoria-import-panel";
import { SalesWorkspace } from "@/components/sales-workspace";

export function AdminWorkspace({ storeId }: { storeId: string }) {
  const [tab, setTab] = useState<"staff" | "hr" | "requests" | "schedule" | "sales" | "geovictoria" | "operations">("staff");
  return <>
    <div className="section-tabs" role="tablist">
      <button className={tab === "staff" ? "active" : ""} onClick={() => setTab("staff")}><UsersRound size={17}/> Colaboradores</button>
      <button className={tab === "hr" ? "active" : ""} onClick={() => setTab("hr")}><UserRoundX size={17}/> Ceses y reportes</button>
      <button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}><MessageSquareText size={17}/> Solicitudes</button>
      <button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><CalendarDays size={17}/> Horario semanal</button>
      <button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}><BarChart3 size={17}/> Ventas</button>
      <button className={tab === "geovictoria" ? "active" : ""} onClick={() => setTab("geovictoria")}><FileSpreadsheet size={17}/> GeoVictoria</button>
      <button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}><Activity size={17}/> Indicadores</button>
    </div>
    {tab === "staff" ? <StaffManagementPanel storeId={storeId}/> : tab === "hr" ? <HrCessationsPanel storeId={storeId}/> : tab === "requests" ? <ScheduleRequestsPanel storeId={storeId}/> : tab === "schedule" ? <WeeklyScheduleEditor storeId={storeId}/> : tab === "sales" ? <SalesWorkspace storeId={storeId}/> : tab === "geovictoria" ? <GeoVictoriaImportPanel storeId={storeId}/> : <OperationalMetricsPanel storeId={storeId}/>}
  </>;
}
