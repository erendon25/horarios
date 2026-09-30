"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock3, Download, FileText, GraduationCap, History, Plus, Trash2, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { effectiveModality, mondayOf, segmentMinutes, shiftMinutes, WEEKDAYS, WEEKDAY_LABELS } from "@/lib/weekly-schedule";
import { exportWeeklySchedulePdf } from "@/lib/weekly-exports";
import { formatMinutes, holidayBalance, hydrateOwnWeek, limaToday } from "@/lib/staff-self-service";
import { StudyScheduleEditor } from "@/components/study-schedule-editor";
import type { Json, Tables } from "@/types/database";

type Tab = "schedule" | "study" | "extras" | "holidays" | "requests";
type Profile = Pick<Tables<"staff_profiles">, "id" | "user_id" | "store_id" | "first_name" | "last_name" | "email" | "dni" | "modality" | "modality_change_date" | "next_modality" | "position" | "birth_date" | "sanitary_card_expiry" | "sanitary_card_unlock" | "is_trainee" | "training_end_date" | "cessation_date">;
type Extra = Pick<Tables<"extra_hours">, "id" | "work_date" | "start_time" | "end_time" | "duration_minutes" | "activity" | "source" | "pre_shift_minutes" | "post_shift_minutes">;
type Holiday = Pick<Tables<"worked_holidays">, "id" | "holiday_date" | "name" | "balance_type" | "created_at">;
type Request = Pick<Tables<"schedule_requests">, "id" | "requested_date" | "shift_type" | "start_time" | "end_time" | "reason" | "status" | "admin_comment" | "created_at">;

const portalKey = (staffId: string) => ["staff-self-service", staffId] as const;
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const dateLabel = (date: string) => date ? date.split("-").reverse().join("/") : "—";
const timeLabel = (time: string | null) => time?.slice(0, 5) ?? "—";

async function loadPortal(staffId: string) {
  const supabase = createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error("Sesión no disponible.");
  const profileResult = await supabase.from("staff_profiles").select("id,user_id,store_id,first_name,last_name,email,dni,modality,modality_change_date,next_modality,position,birth_date,sanitary_card_expiry,sanitary_card_unlock,is_trainee,training_end_date,cessation_date").eq("id", staffId).eq("user_id", auth.user.id).single();
  if (profileResult.error) throw profileResult.error;
  const profile = profileResult.data as Profile;
  const [store, extras, holidays, requests] = await Promise.all([
    supabase.from("stores").select("name").eq("id", profile.store_id).single(),
    supabase.from("extra_hours").select("id,work_date,start_time,end_time,duration_minutes,activity,source,pre_shift_minutes,post_shift_minutes").eq("staff_id", staffId).order("work_date", { ascending: false }).limit(100),
    supabase.from("worked_holidays").select("id,holiday_date,name,balance_type,created_at").eq("staff_id", staffId).order("holiday_date", { ascending: false }),
    supabase.from("schedule_requests").select("id,requested_date,shift_type,start_time,end_time,reason,status,admin_comment,created_at").eq("staff_id", staffId).eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(100),
  ]);
  for (const result of [store, extras, holidays, requests]) if (result.error) throw result.error;
  return { userId: auth.user.id, profile, storeName: store.data?.name ?? "Tienda", extras: (extras.data ?? []) as Extra[], holidays: (holidays.data ?? []) as Holiday[], requests: (requests.data ?? []) as Request[] };
}

async function loadOwnWeek(staffId: string, weekStart: string) {
  const { data, error } = await createClient().from("schedule_weeks").select("id,schedule_shifts(work_date,start_time,end_time,position,is_day_off,is_holiday,notes,metadata)").eq("staff_id", staffId).eq("week_start", weekStart).maybeSingle();
  if (error) throw error;
  return hydrateOwnWeek(weekStart, data?.schedule_shifts ?? []);
}

export function StaffSelfServicePortal({ staffId }: { staffId: string }) {
  const [tab, setTab] = useState<Tab>("schedule");
  const { data, isPending, error } = useQuery({ queryKey: portalKey(staffId), queryFn: () => loadPortal(staffId) });
  if (isPending) return <section className="portal-loading">Cargando tu información…</section>;
  if (error || !data) return <p className="form-alert error">No se pudo cargar el portal. {errorMessage(error, "Verifica tu vinculación de colaborador.")}</p>;
  const tabs: Array<[Tab, string, typeof CalendarDays]> = [["schedule", "Mi horario", CalendarDays], ["study", "Estudios", GraduationCap], ["extras", "Horas extra", Clock3], ["holidays", "Feriados", History], ["requests", "Solicitudes", FileText]];
  return <>
    <ProfileSummary data={data}/>
    <nav className="staff-portal-tabs" aria-label="Secciones de mi portal">{tabs.map(([key, label, Icon]) => <button type="button" key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={16}/><span>{label}</span></button>)}</nav>
    {tab === "schedule" && <OwnSchedule profile={data.profile}/>} 
    {tab === "study" && <StudyScheduleEditor staffId={staffId}/>} 
    {tab === "extras" && <ExtrasPanel data={data}/>} 
    {tab === "holidays" && <HolidaysPanel data={data}/>} 
    {tab === "requests" && <RequestsPanel data={data}/>} 
  </>;
}

function ProfileSummary({ data }: { data: Awaited<ReturnType<typeof loadPortal>> }) {
  const { profile } = data;
  const today = limaToday();
  const cardExpired = Boolean(profile.sanitary_card_expiry && profile.sanitary_card_expiry < today);
  return <section className="staff-profile-card"><div className="staff-avatar"><UserRound/></div><div className="staff-profile-title"><p className="eyebrow">MI PERFIL</p><h2>{profile.first_name} {profile.last_name}</h2><span>{profile.position || "Sin posición"} · {data.storeName}</span></div><dl><div><dt>DNI</dt><dd>{profile.dni || "—"}</dd></div><div><dt>Correo</dt><dd>{profile.email || "—"}</dd></div><div><dt>Modalidad</dt><dd>{effectiveModality(profile, today) || "—"}</dd></div><div><dt>Carnet sanitario</dt><dd className={cardExpired && !profile.sanitary_card_unlock ? "negative" : "positive"}>{profile.sanitary_card_expiry ? dateLabel(profile.sanitary_card_expiry) : "No registrado"}{cardExpired && profile.sanitary_card_unlock ? " · acceso temporal" : ""}</dd></div></dl></section>;
}

function OwnSchedule({ profile }: { profile: Profile }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(limaToday()));
  const query = useQuery({ queryKey: ["own-week", profile.id, weekStart], queryFn: () => loadOwnWeek(profile.id, weekStart) });
  const weeklyTotal = useMemo(() => query.data ? WEEKDAYS.reduce((total, day) => total + shiftMinutes(query.data[day], effectiveModality(profile, query.data[day].date) === "Full-Time"), 0) : 0, [profile, query.data]);
  return <section className="self-service-panel"><header><div><p className="eyebrow">PLANIFICACIÓN SEMANAL</p><h2>Mi horario</h2></div><div className="self-service-actions"><label>Semana<input type="date" value={weekStart} onChange={(event) => setWeekStart(mondayOf(event.target.value))}/></label><button type="button" className="plain-button" disabled={!query.data} onClick={() => query.data && exportWeeklySchedulePdf([profile], { [profile.id]: query.data }, weekStart, { showPositions: true })}><Download size={16}/> PDF</button></div></header>
    {query.isPending ? <p className="muted">Cargando semana…</p> : query.error || !query.data ? <p className="form-alert error">No se pudo cargar el horario.</p> : <><div className="own-week-grid">{WEEKDAYS.map((day, index) => { const shift = query.data[day]; const empty = !shift.start && !shift.off && !shift.holiday; return <article key={day} className={shift.off ? "off" : shift.holiday ? "holiday" : ""}><header><strong>{WEEKDAY_LABELS[index]}</strong><span>{dateLabel(shift.date).slice(0, 5)}</span></header><div className="shift-main">{shift.off ? "DESCANSO" : shift.holiday && !shift.start ? "FERIADO" : empty ? "SIN ASIGNAR" : `${shift.start}–${shift.end}`}</div>{shift.splitShift && <div className="shift-secondary">Segundo turno: {shift.start2}–{shift.end2}</div>}{shift.position && <span className="position-chip">{shift.position}</span>}{(shift.extraHoursPre || shift.extraHoursPost) > 0 && <small>Extra: {Number(shift.extraHoursPre) + Number(shift.extraHoursPost)} h</small>}{shift.notes && <small>{shift.notes}</small>}</article>; })}</div><p className="week-total"><strong>Total programado:</strong> {formatMinutes(weeklyTotal)}</p></>}
  </section>;
}

function ExtrasPanel({ data }: { data: Awaited<ReturnType<typeof loadPortal>> }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ date: limaToday(), start: "", end: "", activity: "" });
  const create = useMutation({ mutationFn: async () => { if (!form.date || !form.start || !form.end || !form.activity.trim() || form.start === form.end) throw new Error("Completa fecha, horario y actividad con horas diferentes."); if (form.date > limaToday()) throw new Error("La fecha no puede ser futura."); const { error } = await createClient().from("extra_hours").insert({ staff_id: data.profile.id, user_id: data.userId, store_id: data.profile.store_id, work_date: form.date, start_time: form.start, end_time: form.end, duration_minutes: segmentMinutes(form.start, form.end), activity: form.activity.trim(), source: "manual" }); if (error) throw error; }, onSuccess: async () => { setForm({ date: limaToday(), start: "", end: "", activity: "" }); await queryClient.invalidateQueries({ queryKey: portalKey(data.profile.id) }); } });
  const remove = useMutation({ mutationFn: async (id: number) => { const { error } = await createClient().from("extra_hours").delete().eq("id", id).eq("staff_id", data.profile.id).eq("source", "manual"); if (error) throw error; }, onSuccess: () => queryClient.invalidateQueries({ queryKey: portalKey(data.profile.id) }) });
  return <section className="self-service-panel"><header><div><p className="eyebrow">AUTOGESTIÓN</p><h2>Horas extra</h2><p className="muted">Los registros importados son solo lectura; puedes eliminar únicamente los creados por ti.</p></div></header><form className="self-service-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><label>Fecha<input type="date" max={limaToday()} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></label><label>Inicio<input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })}/></label><label>Fin<input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })}/></label><label className="grow">Actividad<input value={form.activity} maxLength={200} placeholder="Describe la actividad realizada" onChange={(event) => setForm({ ...form, activity: event.target.value })}/></label><button className="primary-button" disabled={create.isPending}><Plus size={16}/>{create.isPending ? "Guardando…" : "Registrar"}</button></form>{create.error && <p className="form-alert error">{errorMessage(create.error, "No se pudo registrar.")}</p>}<HistoryTable headers={["Fecha", "Horario", "Duración", "Actividad", "Origen", ""]} empty="No tienes horas extra registradas.">{data.extras.map((extra) => <tr key={extra.id}><td>{dateLabel(extra.work_date)}</td><td>{timeLabel(extra.start_time)}–{timeLabel(extra.end_time)}</td><td>{formatMinutes(extra.duration_minutes || extra.pre_shift_minutes + extra.post_shift_minutes)}</td><td>{extra.activity || "—"}</td><td><span className="source-chip">{extra.source === "manual" ? "Manual" : "Importado"}</span></td><td>{extra.source === "manual" && <button type="button" className="icon-button danger" aria-label="Eliminar registro" disabled={remove.isPending} onClick={() => window.confirm("¿Eliminar esta hora extra?") && remove.mutate(extra.id)}><Trash2 size={15}/></button>}</td></tr>)}</HistoryTable></section>;
}

function HolidaysPanel({ data }: { data: Awaited<ReturnType<typeof loadPortal>> }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(limaToday());
  const create = useMutation({ mutationFn: async () => { if (!date || date > limaToday()) throw new Error("Selecciona una fecha de hoy o anterior."); const { error } = await createClient().from("worked_holidays").insert({ staff_id: data.profile.id, user_id: data.userId, store_id: data.profile.store_id, holiday_date: date, name: "Feriado pendiente", balance_type: "ganado", legacy_data: { source: "staff-self-service" } as Json }); if (error?.code === "23505") throw new Error("Ese feriado ya está registrado."); if (error) throw error; }, onSuccess: () => queryClient.invalidateQueries({ queryKey: portalKey(data.profile.id) }) });
  return <section className="self-service-panel"><header><div><p className="eyebrow">COMPENSACIONES</p><h2>Feriados trabajados</h2><p className="muted">Saldo actual: <strong>{holidayBalance(data.holidays)}</strong></p></div></header><form className="self-service-form compact" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><label>Fecha trabajada<input type="date" max={limaToday()} value={date} onChange={(event) => setDate(event.target.value)}/></label><button className="primary-button" disabled={create.isPending}><Plus size={16}/>{create.isPending ? "Guardando…" : "Registrar feriado"}</button></form>{create.error && <p className="form-alert error">{errorMessage(create.error, "No se pudo registrar.")}</p>}<HistoryTable headers={["Fecha", "Concepto", "Movimiento"]} empty="No tienes movimientos de feriados.">{data.holidays.map((holiday) => <tr key={holiday.id}><td>{dateLabel(holiday.holiday_date)}</td><td>{holiday.name}</td><td className={holiday.balance_type === "ganado" ? "positive" : "negative"}>{holiday.balance_type === "ganado" ? "+1 ganado" : "−1 compensado"}</td></tr>)}</HistoryTable></section>;
}

function RequestsPanel({ data }: { data: Awaited<ReturnType<typeof loadPortal>> }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ date: limaToday(), type: "apertura", start: "", end: "", reason: "" });
  const create = useMutation({ mutationFn: async () => { const range = form.type === "rango"; if (!form.date || !form.reason.trim() || (range && (!form.start || !form.end || form.start === form.end))) throw new Error("Completa la fecha, el motivo y un rango válido."); const { error } = await createClient().from("schedule_requests").insert({ staff_id: data.profile.id, user_id: data.userId, store_id: data.profile.store_id, requested_date: form.date, shift_type: form.type, start_time: range ? form.start : null, end_time: range ? form.end : null, reason: form.reason.trim(), status: "pending" }); if (error) throw error; }, onSuccess: async () => { setForm({ date: limaToday(), type: "apertura", start: "", end: "", reason: "" }); await queryClient.invalidateQueries({ queryKey: portalKey(data.profile.id) }); } });
  const statusLabel = { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", cancelled: "Cancelada" } as const;
  return <section className="self-service-panel">
    <header><div><p className="eyebrow">PREFERENCIAS DE TURNO</p><h2>Solicitudes de horario</h2></div></header>
    <form className="self-service-form request-form" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
      <label>Fecha<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></label>
      <label>Turno<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="apertura">Apertura</option><option value="medio">Medio</option><option value="cierre">Cierre</option><option value="rango">Rango específico</option></select></label>
      {form.type === "rango" ? <><label>Inicio<input type="time" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })}/></label><label>Fin<input type="time" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })}/></label></> : null}
      <label className="grow">Motivo<input maxLength={300} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })}/></label>
      <button className="primary-button" disabled={create.isPending}><Plus size={16}/>{create.isPending ? "Enviando…" : "Enviar"}</button>
    </form>
    {create.error && <p className="form-alert error">{errorMessage(create.error, "No se pudo enviar.")}</p>}
    <HistoryTable headers={["Fecha", "Turno solicitado", "Motivo", "Estado", "Respuesta"]} empty="No tienes solicitudes registradas.">
      {data.requests.map((request) => <tr key={request.id}><td>{dateLabel(request.requested_date)}</td><td>{request.shift_type}{request.start_time ? ` · ${timeLabel(request.start_time)}–${timeLabel(request.end_time)}` : ""}</td><td>{request.reason || "—"}</td><td><span className={`request-status ${request.status}`}>{statusLabel[request.status]}</span></td><td>{request.admin_comment || "—"}</td></tr>)}
    </HistoryTable>
  </section>;
}

function HistoryTable({ headers, empty, children }: { headers: string[]; empty: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0;
  return <div className="table-scroll self-service-history"><table><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{rows ? children : <tr><td colSpan={headers.length} className="empty-row">{empty}</td></tr>}</tbody></table></div>;
}
