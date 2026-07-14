"use client";

import { useState } from "react";
import { Activity, CalendarDays, UsersRound, UserRoundX } from "lucide-react";
import { StaffManagementPanel } from "@/components/staff-management-panel";
import { HrCessationsPanel } from "@/components/hr-cessations-panel";
import { WeeklyScheduleEditor } from "@/components/weekly-schedule-editor";
import { OperationalMetricsPanel } from "@/components/operational-metrics-panel";

export function AdminWorkspace() {
  const [tab, setTab] = useState<"staff" | "hr" | "schedule" | "operations">("staff");
  return <>
    <div className="section-tabs" role="tablist">
      <button className={tab === "staff" ? "active" : ""} onClick={() => setTab("staff")}><UsersRound size={17}/> Colaboradores</button>
      <button className={tab === "hr" ? "active" : ""} onClick={() => setTab("hr")}><UserRoundX size={17}/> Ceses y reportes</button>
      <button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><CalendarDays size={17}/> Horario semanal</button>
      <button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}><Activity size={17}/> Indicadores</button>
    </div>
    {tab === "staff" ? <StaffManagementPanel/> : tab === "hr" ? <HrCessationsPanel/> : tab === "schedule" ? <WeeklyScheduleEditor/> : <OperationalMetricsPanel/>}
  </>;
}
