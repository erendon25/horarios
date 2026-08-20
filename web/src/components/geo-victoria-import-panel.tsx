"use client";

import { useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Clock3, FileDown, FileSpreadsheet, RefreshCw, Upload, UserPlus, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseExtraHours, parseLateArrivals, parseRoster, parseShiftMap, rowsFromMatrix, type GeoVictoriaImportSummary, type GeoVictoriaLateRow, type GeoVictoriaRosterSummary, type GeoVictoriaStaff, type SheetCell } from "@/lib/geo-victoria";
import type { Json, Tables } from "@/types/database";

type Store = Pick<Tables<"stores">, "id" | "name" | "is_active">;
type Staff = Pick<Tables<"staff_profiles">, "id" | "firestore_id" | "user_id" | "dni" | "first_name" | "last_name" | "position" | "modality" | "cessation_date">;
type Context = { stores: Store[]; defaultStoreId: string };
type ShiftMeta = { fileName: string; count: number; updatedAt: string } | null;
type ImportResult = GeoVictoriaImportSummary & { fileName: string; created: number; updated: number };
type RosterResult = GeoVictoriaRosterSummary & { fileName: string; created: number; failed: Array<{ dni: string; message: string }> };
type LateResult = { fileName: string; rows: GeoVictoriaLateRow[]; totalMinutes: number };

async function loadContext(forcedStoreId?: string): Promise<Context> {
  const supabase = createClient();
  if (forcedStoreId) {
    const stores = await supabase.from("stores").select("id,name,is_active").eq("id", forcedStoreId);
    if (stores.error) throw stores.error;
    return { stores: stores.data, defaultStoreId: forcedStoreId };
  }
  const profile = await supabase.from("user_profiles").select("role,store_id").single();
  if (profile.error) throw profile.error;
  let storesQuery = supabase.from("stores").select("id,name,is_active").eq("is_active", true).order("name");
  if (profile.data.role !== "superadmin" && profile.data.store_id) storesQuery = storesQuery.eq("id", profile.data.store_id);
  const stores = await storesQuery;
  if (stores.error) throw stores.error;
  return { stores: stores.data, defaultStoreId: profile.data.store_id ?? stores.data[0]?.id ?? "" };
}

async function loadStoreData(storeId: string) {
  const supabase = createClient();
  const [staffResult, configResult] = await Promise.all([
    supabase.from("staff_profiles").select("id,firestore_id,user_id,dni,first_name,last_name,position,modality,cessation_date").eq("store_id", storeId).order("first_name"),
    supabase.from("store_configs").select("value").eq("store_id", storeId).eq("config_key", "geovictoria_turnos").maybeSingle(),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (configResult.error) throw configResult.error;
  const value = configResult.data?.value;
  const config = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};
  const meta: ShiftMeta = config.turnoMap && typeof config.turnoMap === "object" ? { fileName: String(config.fileName ?? ""), count: Number(config.count ?? Object.keys(config.turnoMap).length), updatedAt: String(config.updatedAt ?? "") } : null;
  return { staff: staffResult.data as Staff[], shiftMeta: meta };
}

function cellValue(value: ExcelJS.CellValue): SheetCell {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  return String(value);
}

async function readMatrix(file: File) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await file.arrayBuffer()) as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("El archivo no contiene hojas.");
  const matrix: SheetCell[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: SheetCell[] = [];
    for (let index = 1; index <= row.cellCount; index += 1) values.push(cellValue(row.getCell(index).value));
    matrix.push(values);
  });
  return matrix;
}

function asGeoStaff(rows: Staff[]): GeoVictoriaStaff[] {
  return rows.map((row) => ({ id: row.id, firestoreId: row.firestore_id, userId: row.user_id, dni: row.dni, firstName: row.first_name, lastName: row.last_name, position: row.position, modality: row.modality, cessationDate: row.cessation_date }));
}

function minutesLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function downloadLateReport(result: LateResult) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const start = result.rows[0]?.date ?? "";
  const end = result.rows[result.rows.length - 1]?.date ?? start;
  doc.setFontSize(16); doc.text("REPORTE DE TARDANZAS", 14, 16);
  doc.setFontSize(9); doc.setTextColor(90); doc.text(`Periodo: ${start} al ${end} · Archivo: ${result.fileName}`, 14, 22);
  autoTable(doc, { startY: 27, head: [["Colaborador", "DNI", "Modalidad", "Fecha", "Turno - Llegada", "Ingreso tarde"]], body: result.rows.map((row) => [row.name, row.dni || "—", row.modality, row.day, `${row.scheduledStart || "--"} - ${row.arrival || "--"}`, minutesLabel(row.lateMinutes)]), styles: { fontSize: 8 }, headStyles: { fillColor: [23, 32, 51] } });
  const totals = new Map<string, { dni: string; name: string; minutes: number }>();
  result.rows.forEach((row) => { const current = totals.get(row.dni || row.name) ?? { dni: row.dni, name: row.name, minutes: 0 }; current.minutes += row.lateMinutes; totals.set(row.dni || row.name, current); });
  autoTable(doc, { startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ? (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8 : 35, head: [["Resumen por colaborador", "DNI", "Total"]], body: [...totals.values()].sort((a, b) => b.minutes - a.minutes).map((row) => [row.name, row.dni || "—", minutesLabel(row.minutes)]), foot: [["TOTAL GENERAL", "", minutesLabel(result.totalMinutes)]], styles: { fontSize: 8 }, headStyles: { fillColor: [180, 71, 8] }, footStyles: { fillColor: [23, 32, 51] } });
  doc.save(`Reporte_Tardanzas_${start}_a_${end}.pdf`);
}

export function GeoVictoriaImportPanel({ storeId: forcedStoreId }: { storeId?: string } = {}) {
  const queryClient = useQueryClient();
  const contextKey = ["geovictoria", "context", "v1", forcedStoreId ?? "role"] as const;
  const context = useQuery({ queryKey: contextKey, queryFn: () => loadContext(forcedStoreId) });
  const [storeId, setStoreId] = useState("");
  const selectedStoreId = storeId || context.data?.defaultStoreId || "";
  const storeDataKey = ["geovictoria", "store", selectedStoreId] as const;
  const storeData = useQuery({ queryKey: storeDataKey, queryFn: () => loadStoreData(selectedStoreId), enabled: Boolean(selectedStoreId) });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rosterResult, setRosterResult] = useState<RosterResult | null>(null);
  const [lateResult, setLateResult] = useState<LateResult | null>(null);
  const [fileError, setFileError] = useState("");

  const availableStaff = storeData.data?.staff ?? [];

  const saveShiftMap = useMutation({
    mutationFn: async ({ file, map }: { file: File; map: Record<string, number> }) => {
      if (!selectedStoreId) throw new Error("Selecciona una tienda.");
      if (Object.keys(map).length === 0) throw new Error("No se encontraron turnos válidos en el archivo.");
      const supabase = createClient();
      const auth = await supabase.auth.getUser();
      if (auth.error || !auth.data.user) throw auth.error ?? new Error("Sesión no disponible.");
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("store_configs").upsert({ store_id: selectedStoreId, config_key: "geovictoria_turnos", value: { turnoMap: map, count: Object.keys(map).length, fileName: file.name, updatedAt: now, storeId: selectedStoreId }, updated_by: auth.data.user.id, updated_at: now }, { onConflict: "store_id,config_key" }).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Supabase no confirmó la actualización del mapa de turnos.");
      return Object.keys(map).length;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storeDataKey }),
  });

  const importExtras = useMutation({
    mutationFn: async ({ file, summary }: { file: File; summary: GeoVictoriaImportSummary }) => {
      if (summary.records.length === 0) throw new Error("El archivo no contiene subtotales de tiempo extra válidos.");
      const supabase = createClient();
      const ids = summary.records.map((record) => record.firestore_id);
      const existing = await supabase.from("extra_hours").select("firestore_id").in("firestore_id", ids);
      if (existing.error) throw existing.error;
      const existingIds = new Set((existing.data ?? []).map((row) => row.firestore_id));
      let confirmed = 0;
      for (let index = 0; index < summary.records.length; index += 100) {
        const chunk = summary.records.slice(index, index + 100);
        const saved = await supabase.from("extra_hours").upsert(chunk, { onConflict: "firestore_id" }).select("id");
        if (saved.error) throw saved.error;
        confirmed += saved.data.length;
      }
      if (confirmed !== summary.records.length) throw new Error(`Supabase confirmó ${confirmed} de ${summary.records.length} registros.`);
      return { ...summary, fileName: file.name, updated: summary.records.filter((record) => existingIds.has(record.firestore_id)).length, created: summary.records.filter((record) => !existingIds.has(record.firestore_id)).length };
    },
    onSuccess: async (saved) => {
      setResult(saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["operational-metrics"] }),
        queryClient.invalidateQueries({ queryKey: ["staff-self-service"] }),
      ]);
    },
  });

  const importRoster = useMutation({
    mutationFn: async ({ file, summary }: { file: File; summary: GeoVictoriaRosterSummary }) => {
      if (summary.candidates.length === 0) return { ...summary, fileName: file.name, created: 0, failed: [] } satisfies RosterResult;
      const supabase = createClient();
      const createdIds: string[] = [];
      const failed: RosterResult["failed"] = [];
      for (const candidate of summary.candidates) {
        const saved = await supabase.rpc("save_staff_profile", { p_staff_id: null, p_store_id: selectedStoreId, p_first_name: candidate.firstName, p_last_name: candidate.lastName, p_email: candidate.email || null, p_dni: candidate.dni, p_gender: null, p_birth_date: null, p_modality: "", p_position: "COLABORADOR", p_status: "pending", p_join_date: candidate.joinDate, p_sanitary_card_expiry: null, p_sanitary_card_unlock: false, p_is_trainee: false, p_training_end_date: null, p_modality_change_date: null, p_next_modality: null });
        if (saved.error) failed.push({ dni: candidate.dni, message: saved.error.message });
        else if (saved.data) createdIds.push(saved.data);
      }
      if (createdIds.length > 0) {
        const marked = await supabase.from("staff_profiles").update({ needs_completion: true, legacy_data: { importedFrom: "geovictoria", sourceFile: file.name, importedAt: new Date().toISOString() } }).in("id", createdIds).select("id");
        if (marked.error) throw marked.error;
        if (marked.data.length !== createdIds.length) throw new Error("No se pudieron marcar todas las altas para completar sus datos.");
      }
      return { ...summary, fileName: file.name, created: createdIds.length, failed } satisfies RosterResult;
    },
    onSuccess: async (saved) => {
      setRosterResult(saved);
      await Promise.all([queryClient.invalidateQueries({ queryKey: storeDataKey }), queryClient.invalidateQueries({ queryKey: ["staff-management"] })]);
    },
  });

  async function handleShiftFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError("");
    try { saveShiftMap.mutate({ file, map: parseShiftMap(await readMatrix(file)) }); }
    catch (error) { setFileError(error instanceof Error ? error.message : "No se pudo leer el Excel de turnos."); }
  }

  async function handleExtrasFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedStoreId) return;
    setFileError("");
    try {
      const importedAt = new Date().toISOString();
      const summary = parseExtraHours(rowsFromMatrix(await readMatrix(file)), asGeoStaff(availableStaff), selectedStoreId, file.name, importedAt);
      importExtras.mutate({ file, summary });
    } catch (error) {
      setResult(null);
      setFileError(error instanceof Error ? error.message : "No se pudo leer el Excel de tiempo extra.");
    }
  }

  async function handleRosterFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedStoreId) return;
    setFileError(""); setRosterResult(null);
    try { importRoster.mutate({ file, summary: parseRoster(rowsFromMatrix(await readMatrix(file)), availableStaff.map((person) => person.dni)) }); }
    catch (error) { setFileError(error instanceof Error ? error.message : "No se pudo leer el archivo de personal."); }
  }

  async function handleLateFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(""); setLateResult(null);
    try {
      const rows = parseLateArrivals(rowsFromMatrix(await readMatrix(file)), asGeoStaff(availableStaff));
      if (rows.length === 0) throw new Error("El archivo no contiene tardanzas no justificadas válidas.");
      const report = { fileName: file.name, rows, totalMinutes: rows.reduce((sum, row) => sum + row.lateMinutes, 0) };
      setLateResult(report); downloadLateReport(report);
    } catch (error) { setFileError(error instanceof Error ? error.message : "No se pudo generar el reporte de tardanzas."); }
  }

  const processing = saveShiftMap.isPending || importExtras.isPending || importRoster.isPending;
  return <section className="geovictoria-panel">
    <header className="weekly-header"><div><p className="eyebrow">INTEGRACIÓN DE ASISTENCIA</p><h2>Importación GeoVictoria</h2><p className="muted">Actualiza códigos de turno e importa tiempo extra conciliado por DNI.</p></div><FileSpreadsheet size={30}/></header>
    {context.data && context.data.stores.length > 1 && <div className="geovictoria-store"><label>Tienda<select value={selectedStoreId} onChange={(event) => { setStoreId(event.target.value); setResult(null); }}><option value="">Selecciona…</option>{context.data.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.is_active ? "" : " (inactiva)"}</option>)}</select></label></div>}
    {(context.error || storeData.error) && <p className="form-alert error geovictoria-alert">No se pudo cargar la configuración de la tienda.</p>}
    <div className="geovictoria-grid">
      <article><div className="geovictoria-card-icon"><Clock3/></div><div><p className="eyebrow">PASO 1</p><h3>Mapa de turnos</h3><p>Lee el ID, inicio y fin desde la primera hoja del Excel.</p>{storeData.data?.shiftMeta ? <small>Actual: {storeData.data.shiftMeta.count} turnos · {storeData.data.shiftMeta.fileName || "archivo anterior"}</small> : <small>Sin archivo configurado.</small>}</div><label className="upload-button"><Upload size={17}/>{saveShiftMap.isPending ? "Guardando…" : "Subir turnos"}<input type="file" accept=".xlsx" disabled={processing || !selectedStoreId} onChange={handleShiftFile}/></label></article>
      <article><div className="geovictoria-card-icon green"><UsersRound/></div><div><p className="eyebrow">PASO 2</p><h3>Tiempo extra</h3><p>Concilia el reporte por DNI y agrupa los subtotales por colaborador y periodo.</p><small>{availableStaff.length} perfiles disponibles para conciliar, incluido el historial de ceses.</small></div><label className="upload-button green"><Upload size={17}/>{importExtras.isPending ? "Importando…" : "Subir tiempo extra"}<input type="file" accept=".xlsx" disabled={processing || !selectedStoreId || availableStaff.length === 0} onChange={handleExtrasFile}/></label></article>
      <article><div className="geovictoria-card-icon violet"><UserPlus/></div><div><p className="eyebrow">PASO 3</p><h3>Altas de personal</h3><p>Agrega únicamente personas activas cuyo DNI todavía no existe.</p><small>Las nuevas altas quedan pendientes para completar modalidad y carnet.</small></div><label className="upload-button violet"><Upload size={17}/>{importRoster.isPending ? "Importando…" : "Subir personal activo"}<input type="file" accept=".xlsx" disabled={processing || !selectedStoreId} onChange={handleRosterFile}/></label></article>
      <article><div className="geovictoria-card-icon orange"><FileDown/></div><div><p className="eyebrow">PASO 4</p><h3>Reporte de tardanzas</h3><p>Excluye filas justificadas y genera un PDF detallado con resumen por colaborador.</p><small>El archivo se procesa localmente y no modifica Supabase.</small></div><label className="upload-button orange"><FileDown size={17}/>Generar PDF<input type="file" accept=".xlsx" disabled={processing || availableStaff.length === 0} onChange={handleLateFile}/></label></article>
    </div>
    {(fileError || saveShiftMap.error || importExtras.error || importRoster.error) && <p className="form-alert error geovictoria-alert">{fileError || saveShiftMap.error?.message || importExtras.error?.message || importRoster.error?.message}</p>}
    {saveShiftMap.isSuccess && <p className="form-alert success geovictoria-alert">Mapa actualizado: {saveShiftMap.data} turnos disponibles para exportar.</p>}
    {result && <section className="geovictoria-result"><header><div><p className="eyebrow">IMPORTACIÓN CONFIRMADA</p><h3>{result.records.length} registros · {minutesLabel(result.totalMinutes)}</h3><p>{result.fileName}</p></div><button className="plain-button" onClick={() => storeData.refetch()}><RefreshCw size={16}/>Actualizar</button></header><div className="geovictoria-metrics"><span><strong>{result.created}</strong>Nuevos</span><span><strong>{result.updated}</strong>Actualizados</span><span><strong>{result.matchedRows}</strong>Subtotales leídos</span><span><strong>{result.unmatchedDnis.length}</strong>DNI sin coincidencia</span><span><strong>{result.invalidDateRows}</strong>Fechas inválidas</span><span><strong>{result.noExtraRows}</strong>Filas sin TE</span></div>{result.unmatchedDnis.length > 0 && <p className="geovictoria-unmatched">Sin coincidencia: {result.unmatchedDnis.join(", ")}</p>}</section>}
    {rosterResult && <section className="geovictoria-result roster"><header><div><p className="eyebrow">ALTAS PROCESADAS</p><h3>{rosterResult.created} colaboradores nuevos</h3><p>{rosterResult.fileName} · {rosterResult.existing} ya existían · {rosterResult.skipped} omitidos</p></div></header>{rosterResult.failed.length > 0 && <p className="geovictoria-unmatched">No creados: {rosterResult.failed.map((row) => `${row.dni}: ${row.message}`).join(" · ")}</p>}</section>}
    {lateResult && <section className="geovictoria-result late"><header><div><p className="eyebrow">REPORTE GENERADO</p><h3>{lateResult.rows.length} tardanzas · {minutesLabel(lateResult.totalMinutes)}</h3><p>{lateResult.fileName}</p></div><button className="plain-button" onClick={() => downloadLateReport(lateResult)}><FileDown size={16}/>Descargar otra vez</button></header></section>}
  </section>;
}
