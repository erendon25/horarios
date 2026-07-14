"use client";

import { useMemo, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { buildCoverageRows, COVERAGE_HOURS, type CoverageAssignment } from "@/lib/schedule-coverage";

export function ScheduleCoverageMatrix({ positions, matrix, assignments }: { positions: string[]; matrix: number[][]; assignments: CoverageAssignment[] }) {
  const [fullscreen, setFullscreen] = useState(false);
  const rows = useMemo(() => buildCoverageRows(positions, matrix, assignments), [assignments, matrix, positions]);
  const content = <section className={`coverage-card ${fullscreen ? "fullscreen" : ""}`}>
    <header><div><h3>Mapa de cobertura</h3><div className="coverage-legend"><span><i className="missing"/>Faltante</span><span><i className="assigned"/>Asignado</span><span><i className="excess"/>Exceso</span><span><i className="trainer"/>Entrenador</span></div></div><button className="icon-button" onClick={() => setFullscreen(!fullscreen)} title={fullscreen ? "Restaurar" : "Maximizar"}>{fullscreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button></header>
    <div className="coverage-scroll"><table><thead><tr><th>Posición</th>{COVERAGE_HOURS.map((hour) => <th key={hour}>{hour.replace(/^0/, "")}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={`${row.name}-${row.slot}`}><th>{row.name}</th>{row.cells.map((cell, index) => <td key={index} className={cell} title={`${row.name} - ${COVERAGE_HOURS[index]} - ${cell}`}/>)}</tr>)}</tbody></table></div>
  </section>;
  return content;
}
