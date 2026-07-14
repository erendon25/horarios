"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { buildCoverageRows, COVERAGE_HOURS, type CoverageAssignment } from "@/lib/schedule-coverage";

const FIRST_VISIBLE_HOUR = "08:00";
const firstVisibleIndex = COVERAGE_HOURS.indexOf(FIRST_VISIBLE_HOUR);
const visibleHours = COVERAGE_HOURS.slice(firstVisibleIndex);

export function ScheduleCoverageMatrix({ positions, matrix, assignments, leftPanelCollapsed, onToggleLeftPanel }: { positions: string[]; matrix: number[][]; assignments: CoverageAssignment[]; leftPanelCollapsed: boolean; onToggleLeftPanel: () => void }) {
  const [fullscreen, setFullscreen] = useState(false);
  const rows = useMemo(() => buildCoverageRows(positions, matrix, assignments), [assignments, matrix, positions]);
  const content = <section className={`coverage-card ${fullscreen ? "fullscreen" : ""}`}>
    <header><div><h3>Mapa de cobertura</h3><div className="coverage-legend"><span><i className="missing"/>Faltante</span><span><i className="assigned"/>Asignado</span><span><i className="excess"/>Exceso</span><span><i className="trainer"/>Entrenador</span></div></div><div className="coverage-header-actions"><button className="icon-button" onClick={onToggleLeftPanel} title={leftPanelCollapsed ? "Mostrar panel izquierdo" : "Contraer panel izquierdo"} aria-label={leftPanelCollapsed ? "Mostrar panel izquierdo" : "Contraer panel izquierdo"}>{leftPanelCollapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button><button className="icon-button" onClick={() => setFullscreen(!fullscreen)} title={fullscreen ? "Restaurar" : "Maximizar"} aria-label={fullscreen ? "Restaurar mapa de cobertura" : "Maximizar mapa de cobertura"}>{fullscreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button></div></header>
    <div className="coverage-scroll"><table><thead><tr><th>Posición</th>{visibleHours.map((hour) => <th key={hour}>{hour.replace(/^0/, "")}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={`${row.name}-${row.slot}`}><th>{row.name}</th>{row.cells.slice(firstVisibleIndex).map((cell, index) => <td key={index} className={cell} title={`${row.name} - ${visibleHours[index]} - ${cell}`}/>)}</tr>)}</tbody></table></div>
  </section>;
  return content;
}
