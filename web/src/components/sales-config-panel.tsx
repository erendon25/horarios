"use client";

import { useMemo, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { Activity, CalendarDays, FileSpreadsheet, Save, Trash2, TrendingUp, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";
import {
  BUSINESS_HOURS,
  daysInMonth,
  normalizeNumericInput,
  parseDelimitedText,
  parseSalesMatrix,
  sanitizeHourlyParticipation,
  sanitizeMonthlyData,
  totalsForMonth,
  weekdayAverages,
  type HourlyParticipation,
  type MonthlySalesData,
  type RealSalesData,
  type SalesHistoryDayPayload,
} from "@/lib/sales-config";
import type { SheetCell } from "@/lib/geo-victoria";

type Store = { id: string; name: string; is_active: boolean };
type Context = { stores: Store[]; defaultStoreId: string };
type LoadedConfig = { monthly: MonthlySalesData; hourly: HourlyParticipation; real: RealSalesData };

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
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
  let storesQuery = supabase.from("stores").select("id,name,is_active").eq("is_active", true).order("name");
  if (profile.data.role !== "superadmin" && profile.data.store_id) storesQuery = storesQuery.eq("id", profile.data.store_id);
  const stores = await storesQuery;
  if (stores.error) throw stores.error;
  return { stores: stores.data, defaultStoreId: profile.data.store_id ?? stores.data[0]?.id ?? "" };
}

async function loadConfig(storeId: string, month: string): Promise<LoadedConfig> {
  const result = await createClient().from("sales_month_configs").select("monthly_data,daily_hourly_parts,real_sales_data").eq("store_id", storeId).eq("month_start", `${month}-01`).maybeSingle();
  if (result.error) throw result.error;
  return {
    monthly: sanitizeMonthlyData(result.data?.monthly_data),
    hourly: sanitizeHourlyParticipation(result.data?.daily_hourly_parts),
    real: sanitizeMonthlyData(result.data?.real_sales_data),
  };
}

function excelCell(value: ExcelJS.CellValue): SheetCell {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if ("result" in value) return excelCell(value.result as ExcelJS.CellValue);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  return String(value);
}

async function readSalesFile(file: File) {
  if (file.name.toLocaleLowerCase("es").endsWith(".csv")) return parseDelimitedText(await file.text());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await file.arrayBuffer()) as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El archivo no contiene hojas.");
  const matrix: SheetCell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: SheetCell[] = [];
    for (let index = 1; index <= row.cellCount; index += 1) values.push(excelCell(row.getCell(index).value));
    matrix.push(values);
  });
  return matrix;
}

function weekday(month: string, day: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", { weekday: "long" }).format(new Date(year, monthNumber - 1, day));
}

export function SalesConfigPanel({ storeId }: { storeId?: string } = {}) {
  const context = useQuery({ queryKey: ["sales-config", "context", storeId ?? "role"], queryFn: () => loadContext(storeId) });
  if (context.isPending) return <div className="study-loading">Cargando configuración de ventas…</div>;
  if (context.error || !context.data?.defaultStoreId) return <p className="form-alert error">No hay una tienda disponible para configurar ventas.</p>;
  return <SalesStoreSelector context={context.data}/>;
}

function SalesStoreSelector({ context }: { context: Context }) {
  const [storeId, setStoreId] = useState(context.defaultStoreId);
  const [month, setMonth] = useState(currentMonth);
  const query = useQuery({ queryKey: ["sales-config", storeId, month], queryFn: () => loadConfig(storeId, month), enabled: Boolean(storeId && month) });
  return <>
    <div className="sales-config-selector">
      {context.stores.length > 1 && <label>Tienda<select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{context.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.is_active ? "" : " (inactiva)"}</option>)}</select></label>}
      <label>Mes<input type="month" value={month} onChange={(event) => setMonth(event.target.value)}/></label>
    </div>
    {query.isPending ? <div className="study-loading">Cargando el mes…</div> : query.error || !query.data ? <p className="form-alert error">No se pudo cargar la configuración del mes.</p> : <LoadedSalesConfig key={`${storeId}-${month}-${query.dataUpdatedAt}`} storeId={storeId} month={month} initial={query.data}/>} 
  </>;
}

function LoadedSalesConfig({ storeId, month, initial }: { storeId: string; month: string; initial: LoadedConfig }) {
  const queryClient = useQueryClient();
  const [monthly, setMonthly] = useState(initial.monthly);
  const [hourly, setHourly] = useState(initial.hourly);
  const [real, setReal] = useState(initial.real);
  const [pendingHistory, setPendingHistory] = useState<SalesHistoryDayPayload[]>([]);
  const [dirty, setDirty] = useState(false);
  const [fileMessage, setFileMessage] = useState("");
  const [fileError, setFileError] = useState("");
  const days = daysInMonth(month);
  const totals = totalsForMonth(monthly);
  const averages = useMemo(() => weekdayAverages(real, hourly), [hourly, real]);

  const save = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const result = await supabase.rpc("save_sales_configuration", {
        p_store_id: storeId,
        p_month_start: `${month}-01`,
        p_monthly_data: monthly as unknown as Json,
        p_daily_hourly_parts: hourly as unknown as Json,
        p_real_sales_data: real as unknown as Json,
        p_days: pendingHistory as unknown as Json,
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      setDirty(false);
      setPendingHistory([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-config", storeId, month] }),
        queryClient.invalidateQueries({ queryKey: ["sales-analysis", storeId] }),
      ]);
    },
  });

  function change(day: number, field: "vta" | "txs", value: string) {
    if (!/^\d*[.,]?\d*$/.test(value)) return;
    setMonthly((current) => ({ ...current, [day]: { vta: current[day]?.vta ?? "", txs: current[day]?.txs ?? "", [field]: value.replace(",", ".") } }));
    setDirty(true);
  }

  function paste(event: ClipboardEvent<HTMLInputElement>, field: "vta" | "txs", startDay: number) {
    event.preventDefault();
    const values = event.clipboardData.getData("text").split(/\r?\n/).map((row) => normalizeNumericInput(row.split("\t").find((cell) => cell.trim()) ?? "")).filter(Boolean);
    setMonthly((current) => {
      const next = { ...current };
      values.forEach((value, index) => { const day = startDay + index; if (day <= days.length) next[day] = { vta: next[day]?.vta ?? "", txs: next[day]?.txs ?? "", [field]: value }; });
      return next;
    });
    setDirty(true);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(""); setFileMessage("");
    try {
      const parsed = parseSalesMatrix(await readSalesFile(file));
      const dates = Object.keys(parsed.real).filter((date) => date.startsWith(`${month}-`));
      if (!parsed.rows || !dates.length) throw new Error(`No se encontraron ventas válidas para ${month}. Revisa las columnas Fecha, Hora, Pedido y Total.`);
      const selectedHourly = Object.fromEntries(dates.map((date) => [date, parsed.hourly[date]]));
      const selectedReal = Object.fromEntries(dates.map((date) => [date, parsed.real[date]]));
      const selectedHistory = parsed.history.filter((day) => day.date.startsWith(`${month}-`));
      setHourly(selectedHourly); setReal(selectedReal); setPendingHistory(selectedHistory); setDirty(true);
      const ignoredDays = Object.keys(parsed.real).length - dates.length;
      setFileMessage(`${parsed.rows} filas procesadas · ${dates.length} días de ${month} listos para guardar${ignoredDays ? ` · ${ignoredDays} días de otros meses omitidos` : ""}.`);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "No se pudo procesar el archivo.");
    }
  }

  return <section className="sales-config-panel">
    <header className="weekly-header"><div><p className="eyebrow">VENTAS Y DEMANDA</p><h2>Configuración mensual</h2><p className="muted">Define metas diarias y carga ventas reales para construir la participación horaria.</p></div><TrendingUp size={30}/></header>
    <div className="sales-config-actions"><label className="upload-button sales-upload"><Upload size={16}/>Cargar Excel/CSV<input type="file" accept=".xlsx,.csv" onChange={upload}/></label><button className="primary-button" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save size={16}/>{save.isPending ? "Guardando…" : "Guardar configuración"}</button></div>
    {fileMessage && <p className="form-alert success sales-message">{fileMessage}</p>}
    {(fileError || save.error) && <p className="form-alert error sales-message">{fileError || save.error?.message || "No se pudo guardar."}</p>}
    {save.isSuccess && !dirty && <p className="form-alert success sales-message">Configuración guardada correctamente en Supabase{save.data ? ` · ${save.data} días incorporados al historial canónico` : ""}.</p>}
    <div className="sales-summary"><article><FileSpreadsheet/><span>Venta meta del mes</span><strong>S/ {totals.sales.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></article><article><Activity/><span>Transacciones meta</span><strong>{totals.transactions.toLocaleString("es-PE")}</strong></article><article><CalendarDays/><span>Ventas reales cargadas</span><strong>{Object.keys(real).length} días</strong></article></div>
    <div className="sales-config-grid">
      <section className="data-card sales-targets"><div className="data-card-heading"><div><strong>Metas diarias · {month}</strong><span>Pega columnas completas desde Excel si lo necesitas.</span></div></div><div className="table-scroll"><table><thead><tr><th>Día</th><th>VTA</th><th>TXS</th></tr></thead><tbody>{days.map((day) => <tr key={day}><td><strong>{weekday(month, day)} {day}</strong></td><td><label><span>S/</span><input inputMode="decimal" value={monthly[day]?.vta ?? ""} onChange={(event) => change(day, "vta", event.target.value)} onPaste={(event) => paste(event, "vta", day)} placeholder="0.00"/></label></td><td><input inputMode="numeric" value={monthly[day]?.txs ?? ""} onChange={(event) => change(day, "txs", event.target.value)} onPaste={(event) => paste(event, "txs", day)} placeholder="0"/></td></tr>)}</tbody><tfoot><tr><td>Total</td><td>S/ {totals.sales.toLocaleString("es-PE", { maximumFractionDigits: 2 })}</td><td>{totals.transactions.toLocaleString("es-PE")}</td></tr></tfoot></table></div></section>
      <section className="data-card sales-hourly"><div className="data-card-heading"><div><strong>Participación horaria diaria</strong><span>Jornada comercial 06:00–05:00. Cada pedido único se asigna a su primera hora y canal válidos.</span></div>{Object.keys(hourly).length > 0 && <button className="icon-button danger" title="Limpiar matriz" onClick={() => { if (window.confirm("¿Limpiar la matriz horaria cargada?")) { setHourly({}); setReal({}); setPendingHistory([]); setDirty(true); } }}><Trash2 size={15}/></button>}</div><HourlyTable rows={Object.entries(hourly).sort(([a], [b]) => a.localeCompare(b)).map(([label, values]) => ({ label, values }))}/></section>
    </div>
    <section className="data-card sales-averages"><div className="data-card-heading"><div><strong>Promedios por día de semana</strong><span>Calculados desde las ventas reales cargadas.</span></div></div><HourlyTable rows={averages.map((row) => ({ label: row.name, values: row.hourly, sales: row.sales, transactions: row.transactions }))} averages/></section>
  </section>;
}

function HourlyTable({ rows, averages = false }: { rows: Array<{ label: string; values: Record<string, number>; sales?: number; transactions?: number }>; averages?: boolean }) {
  if (!rows.length) return <div className="sales-empty"><Activity size={36}/><p>Carga un Excel o CSV para generar la matriz automáticamente.</p></div>;
  return <div className="table-scroll sales-hourly-scroll"><table><thead><tr><th>{averages ? "Día" : "Fecha"}</th>{averages && <><th>VTA prom.</th><th>TXS prom.</th></>}{BUSINESS_HOURS.map((hour) => <th key={hour}>{hour}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td>{averages && <><td>S/ {(row.sales ?? 0).toLocaleString("es-PE", { maximumFractionDigits: 2 })}</td><td>{Math.round(row.transactions ?? 0)}</td></>}{BUSINESS_HOURS.map((hour) => <td key={hour}>{row.values[hour] ? `${row.values[hour].toFixed(1)}%` : "—"}</td>)}</tr>)}</tbody></table></div>;
}
