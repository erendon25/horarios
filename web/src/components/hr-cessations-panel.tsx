"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Search, UserRoundCheck, UserRoundX, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

type Staff = Pick<Tables<"staff_profiles">,
  "id" | "store_id" | "first_name" | "last_name" | "dni" | "gender" |
  "modality" | "position" | "join_date" | "cessation_date" | "is_trainee"
>;
type Cessation = Tables<"cessations">;
type Store = Pick<Tables<"stores">, "id" | "name">;

type HrRow = Staff & { cessation: Cessation | null; storeName: string };

const reasons = ["RENUNCIA VOLUNTARIA", "ABANDONO DE TRABAJO", "DESPIDO", "TÉRMINO DE CONTRATO"];
const realReasons = ["MEJORA ECONÓMICA", "HORARIO DE ESTUDIO", "SALUD", "BAJO DESEMPEÑO", "DESACUERDO CON BENEFICIOS", "DISTANCIA DE LA TIENDA", "FALTA GRAVE", "HORARIO DE CIERRE EXTENDIDO", "INASISTENCIAS", "MAL CLIMA LABORAL", "MEJORA CONTRACTUAL"];

const emptyForm = {
  cessationDate: "", performance: "BUENO", cessationReason: reasons[0], realReason: realReasons[0],
  storeComment: "", medicalLeaveDays: "0", absences: "0", tardiness: "0", nightHours: "0",
  extraHours: "0", holidays: "0", discounts: "0",
};

async function loadHrRows(): Promise<HrRow[]> {
  const supabase = createClient();
  const [staffResult, cessationResult, storesResult] = await Promise.all([
    supabase.from("staff_profiles").select("id,store_id,first_name,last_name,dni,gender,modality,position,join_date,cessation_date,is_trainee").order("first_name"),
    supabase.from("cessations").select("*").eq("is_modality_change", false),
    supabase.from("stores").select("id,name"),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (cessationResult.error) throw cessationResult.error;
  if (storesResult.error) throw storesResult.error;

  const cessations = new Map((cessationResult.data as Cessation[]).map((item) => [item.staff_id, item]));
  const stores = new Map((storesResult.data as Store[]).map((item) => [item.id, item.name]));
  return (staffResult.data as Staff[]).map((staff) => ({
    ...staff,
    cessation: cessations.get(staff.id) ?? null,
    storeName: stores.get(staff.store_id) ?? "Tienda sin nombre",
  }));
}

function asNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function HrCessationsPanel() {
  const queryClient = useQueryClient();
  const { data = [], isPending, error, dataUpdatedAt } = useQuery({ queryKey: ["hr", "cessations"], queryFn: loadHrRows });
  const [search, setSearch] = useState("");
  const [onlyCessations, setOnlyCessations] = useState(false);
  const [selected, setSelected] = useState<HrRow | null>(null);
  const [form, setForm] = useState(emptyForm);

  const rows = useMemo(() => data.filter((row) => {
    if (onlyCessations && !row.cessation_date) return false;
    const text = `${row.first_name} ${row.last_name} ${row.dni ?? ""} ${row.storeName}`.toLocaleLowerCase("es");
    return text.includes(search.trim().toLocaleLowerCase("es"));
  }), [data, onlyCessations, search]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const { error: saveError } = await createClient().rpc("save_staff_cessation", {
        p_staff_id: selected.id,
        p_cessation_date: form.cessationDate || null,
        p_performance: form.performance,
        p_cessation_reason: form.cessationReason,
        p_real_reason: form.realReason,
        p_store_comment: form.storeComment || null,
        p_medical_leave_days: asNumber(form.medicalLeaveDays),
        p_absences: asNumber(form.absences),
        p_tardiness: form.tardiness || null,
        p_night_hours: asNumber(form.nightHours),
        p_extra_hours: asNumber(form.extraHours),
        p_holidays: asNumber(form.holidays),
        p_discounts: asNumber(form.discounts),
      });
      if (saveError) throw saveError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["hr", "cessations"] });
      setSelected(null);
    },
  });

  function openEditor(row: HrRow) {
    const c = row.cessation;
    setForm({
      cessationDate: row.cessation_date ?? "",
      performance: c?.performance ?? "BUENO",
      cessationReason: c?.cessation_reason ?? reasons[0],
      realReason: c?.real_reason ?? realReasons[0],
      storeComment: c?.store_comment ?? "",
      medicalLeaveDays: String(c?.medical_leave_days ?? 0),
      absences: String(c?.absences ?? 0),
      tardiness: c?.tardiness ?? "0",
      nightHours: String(c?.night_hours ?? 0),
      extraHours: String(c?.extra_hours ?? 0),
      holidays: String(c?.holidays ?? 0),
      discounts: String(c?.discounts ?? 0),
    });
    setSelected(row);
  }

  function downloadCompleteReport() {
    const cessationRows = data.filter((row) => row.cessation_date && row.cessation);
    const headers = ["TIENDA", "PUESTO", "MOD", "DNI", "NOMBRE DE COLABORADOR", "SEXO", "FECHA DE INGRESO", "FECHA DE CESE", "DIAS DESCANSO MEDICO", "INASISTENCIA", "TARDANZAS (MINUTOS, HORAS)", "HORAS NOCTURNAS", "HORAS EXTRAS", "FERIADOS", "DESCUENTOS", "DESEMPEÑO", "MOTIVO DE CESE", "MOTIVO REAL", "COMENTARIO TIENDA"];
    const lines = [headers.map(csvCell).join(";")];
    cessationRows.forEach((row) => {
      const c = row.cessation!;
      lines.push([
        row.storeName, row.position, row.modality === "Full-Time" ? "FT" : row.modality === "Part-Time" ? "PT" : row.modality,
        row.dni, `${row.first_name} ${row.last_name}`, row.gender, formatDate(row.join_date), formatDate(row.cessation_date),
        c.medical_leave_days, c.absences, c.tardiness, c.night_hours, c.extra_hours, c.holidays, c.discounts,
        c.performance, c.cessation_reason, c.real_reason, c.store_comment,
      ].map(csvCell).join(";"));
    });
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Reporte_Completo_Ceses_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <>
    <section className="hr-toolbar">
      <label className="search-box"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, DNI o tienda"/></label>
      <label className="filter-check"><input type="checkbox" checked={onlyCessations} onChange={(event) => setOnlyCessations(event.target.checked)}/> Solo con fecha de cese</label>
      <button className="secondary-button" onClick={downloadCompleteReport} disabled={!data.some((row) => row.cessation)}><Download size={17}/> Descargar reporte completo</button>
    </section>

    {error && <p className="form-alert error">No se pudo cargar la información de RR. HH.</p>}
    <section className="data-card">
      <div className="data-card-heading"><div><strong>{isPending ? "Cargando…" : `${rows.length} colaboradores`}</strong><span>{data.filter((row) => row.cessation_date).length} con cese registrado</span></div>{dataUpdatedAt > 0 && <small>Actualizado {new Date(dataUpdatedAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</small>}</div>
      <div className="table-scroll"><table className="hr-table"><thead><tr><th>Colaborador</th><th>Tienda</th><th>Modalidad</th><th>Fecha de cese</th><th>Motivo</th><th/></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}><td><strong>{row.first_name} {row.last_name}</strong><span>{row.dni || "Sin DNI"} · {row.position}</span></td><td>{row.storeName}</td><td>{row.is_trainee ? "Entrenamiento" : row.modality || "—"}</td><td>{row.cessation_date ? <span className="status-pill ceased"><UserRoundX size={14}/>{formatDate(row.cessation_date)}</span> : <span className="status-pill active"><UserRoundCheck size={14}/>{row.is_trainee ? "En entrenamiento" : "Activo"}</span>}</td><td>{row.cessation?.cessation_reason ?? "—"}<small>{row.cessation?.real_reason ?? ""}</small></td><td><button className="icon-button" disabled={row.is_trainee} onClick={() => openEditor(row)} title={row.is_trainee ? "Los trainees usan fecha de fin de entrenamiento" : "Editar cese"}><Pencil size={16}/></button></td></tr>)}
        {!isPending && rows.length === 0 && <tr><td colSpan={6} className="empty-row">No hay resultados para los filtros seleccionados.</td></tr>}
      </tbody></table></div>
    </section>

    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="hr-modal" role="dialog" aria-modal="true" aria-labelledby="cessation-title">
      <header><div><p className="eyebrow">RR. HH.</p><h2 id="cessation-title">Cese de {selected.first_name} {selected.last_name}</h2><p className="muted">Si borras la fecha, el registro dejará de aparecer en RR. HH.</p></div><button className="icon-button" onClick={() => setSelected(null)}><X size={20}/></button></header>
      <div className="hr-form-grid">
        <label>Fecha de cese<input type="date" value={form.cessationDate} onChange={(e) => setForm({ ...form, cessationDate: e.target.value })}/></label>
        <label>Desempeño<select value={form.performance} onChange={(e) => setForm({ ...form, performance: e.target.value })}>{["EXCELENTE", "BUENO", "REGULAR", "MALO"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Motivo de cese<select value={form.cessationReason} onChange={(e) => setForm({ ...form, cessationReason: e.target.value })}>{reasons.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Motivo real<select value={form.realReason} onChange={(e) => setForm({ ...form, realReason: e.target.value })}>{realReasons.map((value) => <option key={value}>{value}</option>)}</select></label>
        {[ ["Días descanso médico", "medicalLeaveDays"], ["Inasistencias", "absences"], ["Horas nocturnas", "nightHours"], ["Horas extras", "extraHours"], ["Feriados", "holidays"], ["Descuentos", "discounts"] ].map(([label, key]) => <label key={key}>{label}<input type="number" min="0" step="0.01" value={form[key as keyof typeof form]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}/></label>)}
        <label className="span-2">Tardanzas (minutos u horas)<input value={form.tardiness} onChange={(e) => setForm({ ...form, tardiness: e.target.value })}/></label>
        <label className="span-2">Comentario de tienda<textarea rows={3} value={form.storeComment} onChange={(e) => setForm({ ...form, storeComment: e.target.value })} placeholder="Describe con mayor detalle el motivo del retiro"/></label>
      </div>
      {saveMutation.error && <p className="form-alert error">No se pudo guardar el cese. Verifica tus permisos y vuelve a intentar.</p>}
      <footer><button className="plain-button" onClick={() => setSelected(null)}>Cancelar</button><button className="primary-button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? "Guardando…" : form.cessationDate ? "Guardar cese" : "Quitar cese"}</button></footer>
    </section></div>}
  </>;
}
