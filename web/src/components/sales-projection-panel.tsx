"use client";

import { useMemo, useState, type ChangeEvent, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { AlertTriangle, Calculator, CheckCircle2, Plus, RotateCcw, Save, Settings2, Trash2, Upload, UsersRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { addIsoDays } from "@/lib/sales-analysis";
import {
  PROJECTION_DAYS,
  PROJECTION_HOURS,
  buildDayMatrix,
  buildProjectionRequirements,
  contractHours,
  normalizeManualStaff,
  normalizeProjectionPositions,
  normalizeSalesByDay,
  parseDelimitedText,
  parseProjectionMatrix,
  positionLogicLabel,
  projectedTargets,
  weeklyRequiredHours,
  type ManualStaffByDay,
  type ProjectionLogic,
  type ProjectionPosition,
  type SalesByDay,
} from "@/lib/sales-projection";
import type { Json } from "@/types/database";
import type { SheetCell } from "@/lib/geo-victoria";

type Store = { id: string; name: string; is_active: boolean };
type Context = { stores: Store[]; defaultStoreId: string };
type TemplateData = {
  positions: ProjectionPosition[];
  salesByDay: SalesByDay;
  manual: ManualStaffByDay;
  configs: Array<{ month_start: string; monthly_data: Json }>;
  availableHours: number;
};

function limaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function mondayOf(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const offset = value.getUTCDay() === 0 ? -6 : 1 - value.getUTCDay();
  return addIsoDays(date, offset);
}

async function loadContext(forcedStoreId?: string): Promise<Context> {
  const supabase = createClient();
  if (forcedStoreId) {
    const stores = await supabase.from("stores").select("id,name,is_active").eq("id", forcedStoreId);
    if (stores.error) throw stores.error;
    return { stores: stores.data, defaultStoreId: forcedStoreId };
  }
  const auth = await supabase.auth.getUser();
  if (!auth.data.user) throw new Error("not_authenticated");
  const profile = await supabase.from("user_profiles").select("role,store_id").eq("id", auth.data.user.id).single();
  if (profile.error) throw profile.error;
  let query = supabase.from("stores").select("id,name,is_active").eq("is_active", true).order("name");
  if (profile.data.role !== "superadmin" && profile.data.store_id) query = query.eq("id", profile.data.store_id);
  const stores = await query;
  if (stores.error) throw stores.error;
  return { stores: stores.data, defaultStoreId: profile.data.store_id ?? stores.data.find((store) => store.is_active)?.id ?? "" };
}

async function loadTemplate(storeId: string): Promise<TemplateData> {
  const supabase = createClient();
  const [template, configs, staff] = await Promise.all([
    supabase.from("sales_projection_templates").select("positions,sales_by_day,manual_staff_by_day").eq("store_id", storeId).maybeSingle(),
    supabase.from("sales_month_configs").select("month_start,monthly_data").eq("store_id", storeId).order("month_start"),
    supabase.from("staff_profiles").select("modality,cessation_date,status").eq("store_id", storeId),
  ]);
  if (template.error) throw template.error;
  if (configs.error) throw configs.error;
  if (staff.error) throw staff.error;
  const today = limaToday();
  const availableHours = contractHours(staff.data, today);
  return {
    positions: normalizeProjectionPositions(template.data?.positions),
    salesByDay: normalizeSalesByDay(template.data?.sales_by_day),
    manual: normalizeManualStaff(template.data?.manual_staff_by_day),
    configs: configs.data,
    availableHours,
  };
}

function money(value: number) {
  return `S/ ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function projectionExcelCell(value: ExcelJS.CellValue): SheetCell {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if ("result" in value) return projectionExcelCell(value.result as ExcelJS.CellValue);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  return String(value);
}

async function readProjectionFile(file: File) {
  if (file.name.toLocaleLowerCase("es").endsWith(".csv")) return parseDelimitedText(await file.text());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await file.arrayBuffer()) as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El archivo no contiene hojas.");
  const matrix: SheetCell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: SheetCell[] = [];
    for (let index = 1; index <= row.cellCount; index += 1) values.push(projectionExcelCell(row.getCell(index).value));
    matrix.push(values);
  });
  return matrix;
}

export function SalesProjectionPanel({ storeId }: { storeId?: string } = {}) {
  const context = useQuery({ queryKey: ["sales-projection", "context", storeId ?? "role"], queryFn: () => loadContext(storeId) });
  if (context.isPending) return <div className="study-loading">Cargando proyección…</div>;
  if (context.error || !context.data?.defaultStoreId) return <p className="form-alert error">No hay una tienda disponible para proyectar.</p>;
  return <ProjectionStoreSelector context={context.data}/>;
}

function ProjectionStoreSelector({ context }: { context: Context }) {
  const [storeId, setStoreId] = useState(context.defaultStoreId);
  const query = useQuery({ queryKey: ["sales-projection", "v2", storeId], queryFn: () => loadTemplate(storeId), enabled: Boolean(storeId) });
  return <>
    {context.stores.length > 1 && <div className="sales-config-selector"><label>Tienda<select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{context.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.is_active ? "" : " (inactiva)"}</option>)}</select></label></div>}
    {query.isPending ? <div className="study-loading">Consultando plantilla…</div> : query.error || !query.data ? <p className="form-alert error">No se pudo cargar la plantilla de proyección.</p> : <ProjectionEditor key={`${storeId}-${query.dataUpdatedAt}`} storeId={storeId} initial={query.data}/>} 
  </>;
}

function ProjectionEditor({ storeId, initial }: { storeId: string; initial: TemplateData }) {
  const queryClient = useQueryClient();
  const [positions, setPositions] = useState(initial.positions);
  const [salesByDay, setSalesByDay] = useState(initial.salesByDay);
  const [manual, setManual] = useState(initial.manual);
  const [selectedDay, setSelectedDay] = useState(PROJECTION_DAYS[0].key as string);
  const [weekStart, setWeekStart] = useState(() => mondayOf(limaToday()));
  const [positionsOpen, setPositionsOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const targets = useMemo(() => projectedTargets(initial.configs, weekStart), [initial.configs, weekStart]);
  const selectedMatrix = useMemo(() => buildDayMatrix(salesByDay[selectedDay] ?? {}, positions, manual[selectedDay]), [manual, positions, salesByDay, selectedDay]);
  const weeklyHours = useMemo(() => weeklyRequiredHours(salesByDay, positions, manual), [manual, positions, salesByDay]);
  const dailySales = Object.values(salesByDay[selectedDay] ?? {}).reduce((sum, sale) => sum + (Number(sale) || 0), 0);
  const dayTarget = targets[selectedDay] || 0;
  const weeklyTarget = Object.values(targets).reduce((sum, sale) => sum + sale, 0);
  const dailyRequiredHours = selectedMatrix.reduce((sum, column) => sum + column.totalStaff, 0);
  const peakStaff = Math.max(0, ...selectedMatrix.map((column) => column.totalStaff));
  const overCapacity = weeklyHours > initial.availableHours;

  const save = useMutation({
    mutationFn: async () => {
      const result = await createClient().from("sales_projection_templates").upsert({
        store_id: storeId,
        positions: positions as unknown as Json,
        sales_by_day: salesByDay as unknown as Json,
        manual_staff_by_day: manual as unknown as Json,
        requirements: buildProjectionRequirements(salesByDay, positions, manual) as unknown as Json,
        updated_at: new Date().toISOString(),
      }, { onConflict: "store_id" }).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Supabase no confirmó el guardado.");
    },
    onSuccess: async () => {
      setDirty(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-projection", "v2", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-schedule"] }),
      ]);
    },
  });

  function changeSale(hour: string, value: string) {
    if (!/^\d*(?:[.,]\d*)?$/.test(value)) return;
    setSalesByDay((current) => ({ ...current, [selectedDay]: { ...current[selectedDay], [hour]: Number(value.replace(",", ".")) || 0 } }));
    setDirty(true);
  }

  function adjustStaff(event: MouseEvent<HTMLButtonElement>, positionId: string, hour: string, currentValue: number) {
    const next = Math.max(0, currentValue + (event.ctrlKey || event.metaKey ? -1 : 1));
    setManual((value) => ({ ...value, [selectedDay]: { ...(value[selectedDay] ?? {}), [positionId]: { ...(value[selectedDay]?.[positionId] ?? {}), [hour]: next } } }));
    setDirty(true);
  }

  function resetDayOverrides() {
    if (!window.confirm(`¿Restablecer los ajustes manuales de ${selectedDay}?`)) return;
    setManual((value) => { const next = { ...value }; delete next[selectedDay]; return next; });
    setDirty(true);
  }

  async function importProjection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setImportMessage(""); setImportError("");
    try {
      const parsed = parseProjectionMatrix(await readProjectionFile(file));
      if (!parsed.rows) throw new Error("El reporte no contiene ventas entre las 09:00 y las 23:00.");
      setSalesByDay(parsed.salesByDay); setDirty(true);
      setImportMessage(`${parsed.rows} filas horarias importadas desde ${file.name}.`);
    } catch (error) { setImportError(error instanceof Error ? error.message : "No se pudo importar el reporte."); }
  }

  return <section className="projection-panel">
    <header className="weekly-header"><div><p className="eyebrow">DOTACIÓN Y DEMANDA</p><h2>Proyección horaria</h2><p className="muted">La matriz guardada alimenta directamente la generación del horario semanal.</p></div><Calculator size={30}/></header>
    <div className="projection-toolbar"><label>Semana<input type="date" value={weekStart} onChange={(event) => setWeekStart(mondayOf(event.target.value))}/></label><label className="upload-button projection-upload"><Upload size={16}/> Importar reporte<input type="file" accept=".xlsx,.csv" onChange={importProjection}/></label><button className="plain-button" onClick={() => setPositionsOpen(true)}><Settings2 size={16}/> Posiciones</button><button className="primary-button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save size={16}/>{save.isPending ? "Guardando…" : "Guardar proyección"}</button></div>
    {importMessage && <p className="form-alert success projection-message">{importMessage}</p>}
    {importError && <p className="form-alert error projection-message">{importError}</p>}
    {save.error && <p className="form-alert error projection-message">{save.error.message}</p>}
    {save.isSuccess && !dirty && <p className="form-alert success projection-message">Proyección guardada. El generador de horarios ya usa esta matriz.</p>}
    <div className="projection-metrics">
      <ProjectionMetric icon={Calculator} label="Venta base del día" value={money(dailySales)} detail={`${PROJECTION_HOURS[0]}–${PROJECTION_HOURS.at(-1)}`}/>
      <ProjectionMetric icon={CheckCircle2} label="Meta del día" value={money(dayTarget)} detail={`Meta semanal ${money(weeklyTarget)}`}/>
      <ProjectionMetric icon={UsersRound} label="Dotación del día" value={`${dailyRequiredHours} h`} detail={`Pico de ${peakStaff} colaboradores`}/>
      <ProjectionMetric icon={overCapacity ? AlertTriangle : CheckCircle2} label="Capacidad semanal" value={`${weeklyHours} / ${initial.availableHours} h`} detail={overCapacity ? "Supera la bolsa contractual" : "Dentro de la bolsa contractual"} tone={overCapacity ? "negative" : "positive"}/>
    </div>
    <div className="projection-day-tabs" role="tablist">{PROJECTION_DAYS.map((day, index) => <button key={day.key} className={selectedDay === day.key ? "active" : ""} onClick={() => setSelectedDay(day.key)}><span>{day.label}</span><small>{addIsoDays(weekStart, index)} · {money(targets[day.key] || 0)}</small></button>)}</div>
    <div className="projection-table-heading"><div><strong>Distribución por hora · {PROJECTION_DAYS.find((day) => day.key === selectedDay)?.label}</strong><span>Clic suma una persona; Ctrl + clic resta. Los ajustes manuales se resaltan.</span></div><button className="plain-button" disabled={!manual[selectedDay]} onClick={resetDayOverrides}><RotateCcw size={15}/> Restablecer día</button></div>
    <div className="table-scroll projection-table-scroll"><table className="projection-table"><thead><tr><th>Área / posición</th><th>Lógica</th>{PROJECTION_HOURS.map((hour) => <th key={hour}>{hour}</th>)}</tr></thead><tbody>
      <tr className="projection-sales-row"><td>Venta por hora</td><td>—</td>{PROJECTION_HOURS.map((hour) => <td key={hour}><label><span>S/</span><input aria-label={`Venta ${hour}`} inputMode="decimal" value={salesByDay[selectedDay]?.[hour] || ""} onChange={(event) => changeSale(hour, event.target.value)}/></label></td>)}</tr>
      {positions.map((position) => <tr key={position.id}><td><strong>{position.name}</strong></td><td><small>{positionLogicLabel(position.logic)}</small></td>{selectedMatrix.map((column) => { const count = column.requiredByPosition[position.id] || 0; const changed = manual[selectedDay]?.[position.id]?.[column.hour] !== undefined; return <td key={column.hour}><button className={`${count > 2 ? "high" : count > 0 ? "assigned" : ""} ${changed ? "manual" : ""}`} title="Clic suma · Ctrl + clic resta" onClick={(event) => adjustStaff(event, position.id, column.hour, count)}>{count}</button></td>; })}</tr>)}
      <tr className="projection-total-row"><td>Total requerido</td><td>—</td>{selectedMatrix.map((column) => <td key={column.hour}>{column.totalStaff}</td>)}</tr>
    </tbody></table></div>
    {positionsOpen && <PositionsModal positions={positions} matrix={selectedMatrix} onChange={(next) => { setPositions(next); setDirty(true); }} onClose={() => setPositionsOpen(false)}/>} 
  </section>;
}

function ProjectionMetric({ icon: Icon, label, value, detail, tone = "" }: { icon: typeof Calculator; label: string; value: string; detail: string; tone?: string }) {
  return <article className={`projection-metric ${tone}`}><Icon size={20}/><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function PositionsModal({ positions, matrix, onChange, onClose }: { positions: ProjectionPosition[]; matrix: ReturnType<typeof buildDayMatrix>; onChange: (positions: ProjectionPosition[]) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  function update(id: string, changes: Partial<ProjectionPosition>) { onChange(positions.map((position) => position.id === id ? { ...position, ...changes } : position)); }
  function add() {
    const clean = name.trim(); if (!clean) return;
    onChange(positions.concat({ id: `custom_${Date.now()}`, name: clean, logic: "sales", capacity: 780, ticketAverage: 35, transactionsPerCollaborator: 23, factor: 1, fixedStaff: 1 }));
    setName("");
  }
  return <div className="modal-backdrop"><section className="hr-modal projection-positions-modal"><header><div><p className="eyebrow">FÓRMULAS DE DOTACIÓN</p><h2>Configurar posiciones</h2></div><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={17}/></button></header><div className="table-scroll"><table className="projection-positions-table"><thead><tr><th>Posición</th><th>Lógica</th><th>Cap./fijo</th><th>Ticket</th><th>TXS/colab.</th><th>Factor</th><th>Horas</th><th>Pico</th><th/></tr></thead><tbody>{positions.map((position) => {
    const values = matrix.map((column) => column.requiredByPosition[position.id] || 0);
    return <tr key={position.id}><td><input value={position.name} onChange={(event) => update(position.id, { name: event.target.value })}/></td><td><select value={position.logic} onChange={(event) => update(position.id, { logic: event.target.value as ProjectionLogic })}><option value="sales">Venta/capacidad</option><option value="service">Servicio</option><option value="driver">Driver</option><option value="fixed">Fijo</option></select></td><td><input type="number" min="0" value={position.logic === "fixed" ? position.fixedStaff : position.capacity} disabled={position.logic === "service" || position.logic === "driver"} onChange={(event) => update(position.id, position.logic === "fixed" ? { fixedStaff: event.target.value } : { capacity: event.target.value })}/></td><td><input type="number" min="0" value={position.ticketAverage} disabled={!(["service", "driver"] as ProjectionLogic[]).includes(position.logic)} onChange={(event) => update(position.id, { ticketAverage: event.target.value })}/></td><td><input type="number" min="0" value={position.transactionsPerCollaborator} disabled={position.logic !== "service"} onChange={(event) => update(position.id, { transactionsPerCollaborator: event.target.value })}/></td><td><input type="number" min="0" step="0.05" value={position.factor} disabled={position.logic === "fixed"} onChange={(event) => update(position.id, { factor: event.target.value })}/></td><td><b>{values.reduce((sum, value) => sum + value, 0)}</b></td><td><b>{Math.max(0, ...values)}</b></td><td><button className="icon-button danger" aria-label={`Eliminar ${position.name}`} onClick={() => onChange(positions.filter((item) => item.id !== position.id))}><Trash2 size={15}/></button></td></tr>;
  })}</tbody></table></div><footer className="projection-add-position"><input placeholder="Nueva posición" value={name} onChange={(event) => setName(event.target.value)}/><button className="secondary-button" disabled={!name.trim()} onClick={add}><Plus size={15}/> Agregar</button><button className="plain-button" onClick={onClose}>Listo</button></footer></section></div>;
}
