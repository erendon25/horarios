"use client";

import { useState } from "react";
import { BarChart3, Calculator, Settings2 } from "lucide-react";
import { SalesAnalysisPanel } from "@/components/sales-analysis-panel";
import { SalesConfigPanel } from "@/components/sales-config-panel";
import { SalesProjectionPanel } from "@/components/sales-projection-panel";

export function SalesWorkspace({ storeId }: { storeId?: string } = {}) {
  const [tab, setTab] = useState<"analysis" | "projection" | "config">("analysis");
  return <div className="sales-workspace">
    <div className="section-tabs sales-inner-tabs" role="tablist">
      <button className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}><BarChart3 size={16}/> Análisis</button>
      <button className={tab === "projection" ? "active" : ""} onClick={() => setTab("projection")}><Calculator size={16}/> Proyección</button>
      <button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}><Settings2 size={16}/> Configuración</button>
    </div>
    {tab === "analysis" ? <SalesAnalysisPanel storeId={storeId}/> : tab === "projection" ? <SalesProjectionPanel storeId={storeId}/> : <SalesConfigPanel storeId={storeId}/>} 
  </div>;
}
