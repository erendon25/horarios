"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, ClipboardCheck, LayoutDashboard, Pencil, Plus, Save, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isCurrentStaff } from "@/lib/staff-summary";
import { evaluationGroups, evaluationScore, stationProgress, trainingStations, trainingStats, type EvaluationFeedback, type EvaluationResponse, type TrainingArea } from "@/lib/training";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { StudyScheduleEditor } from "@/components/study-schedule-editor";
import type { Json } from "@/types/database";

type Tab = "dashboard" | "evaluation" | "results" | "stats" | "availability";
type Staff = { id: string; store_id: string; first_name: string; last_name: string; position: string | null; status: string; cessation_date: string | null; skills: string[] };
type Evaluation = { id: number; staff_id: string; store_id: string; trainer_id: string | null; evaluation_date: string; area: string | null; station_code: string | null; station_name: string | null; score: number | null; responses: Json; feedback: Json; general_findings: string | null; status: "draft" | "completed"; current_step: number | null; collaborator_signature_path: string | null; trainer_signature_path: string | null; is_edited: boolean; created_at: string; updated_at: string };
type Form = { id: number | null; staffId: string; area: TrainingArea; station: string; date: string; responses: EvaluationResponse; feedback: EvaluationFeedback; findings: string; collaboratorPath: string | null; trainerPath: string | null };
type SignatureUrls = { collaborator: string | null; trainer: string | null };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const blank = (): Form => ({ id: null, staffId: "", area: "service", station: "", date: today(), responses: {}, feedback: {}, findings: "", collaboratorPath: null, trainerPath: null });
const name = (staff?: Staff) => staff ? `${staff.first_name} ${staff.last_name}`.trim() : "Colaborador";
const record = <T,>(value: Json) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, T> : {};

async function loadStores() {
  const { data, error } = await createClient().from("stores").select("id,name").eq("is_active", true).order("name");
  if (error) throw error;
  return data ?? [];
}

async function loadData(storeId: string) {
  const supabase = createClient();
  const [people, evaluations] = await Promise.all([
    supabase.from("staff_profiles").select("id,store_id,first_name,last_name,position,status,cessation_date,staff_skills(skill_code)").eq("store_id", storeId).order("first_name"),
    supabase.from("training_evaluations").select("id,staff_id,store_id,trainer_id,evaluation_date,area,station_code,station_name,score,responses,feedback,general_findings,status,current_step,collaborator_signature_path,trainer_signature_path,is_edited,created_at,updated_at").eq("store_id", storeId).order("evaluation_date", { ascending: false }).order("id", { ascending: false }),
  ]);
  if (people.error) throw people.error;
  if (evaluations.error) throw evaluations.error;
  const allStaff = (people.data ?? []).map((person) => ({ ...person, skills: (person.staff_skills ?? []).map((skill) => skill.skill_code) })) as Staff[];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { staff: allStaff.filter((person) => isCurrentStaff({ ...person, modality: null }, today)), allStaff, evaluations: (evaluations.data ?? []) as Evaluation[] };
}

async function getSignatureUrls(evaluation: Evaluation): Promise<SignatureUrls> {
  const create = async (path: string | null) => {
    if (!path) return null;
    const { data, error } = await createClient().storage.from("training-signatures").createSignedUrl(path, 900);
    if (error) throw error;
    return data.signedUrl;
  };
  const [collaborator, trainer] = await Promise.all([create(evaluation.collaborator_signature_path), create(evaluation.trainer_signature_path)]);
  return { collaborator, trainer };
}

export function TrainingWorkspace({ role, userId, initialStoreId, ownStaffId }: { role: string; userId: string; initialStoreId: string | null; ownStaffId: string | null }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [area, setArea] = useState<TrainingArea>("service");
  const [storeId, setStoreId] = useState(initialStoreId ?? "");
  const [form, setForm] = useState<Form>(blank);
  const [view, setView] = useState<Evaluation | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const collaboratorPad = useRef<SignaturePadHandle>(null);
  const trainerPad = useRef<SignaturePadHandle>(null);
  const queryClient = useQueryClient();
  const storesQuery = useQuery({ queryKey: ["training-stores"], queryFn: loadStores, enabled: role === "superadmin" });
  const stores = storesQuery.data ?? [];
  const selectedStore = storeId || stores[0]?.id || "";
  const queryKey = ["training", selectedStore];
  const query = useQuery({ queryKey, queryFn: () => loadData(selectedStore), enabled: Boolean(selectedStore) });
  const data = query.data ?? { staff: [], allStaff: [], evaluations: [] };
  const groups = useMemo(() => evaluationGroups(form.area, form.station), [form.area, form.station]);
  const keys = useMemo(() => groups.flatMap((group) => group.points.map((point) => point.key)), [groups]);
  const score = evaluationScore(form.responses, keys);
  const completed = data.evaluations.filter((row) => row.status === "completed");
  const drafts = data.evaluations.filter((row) => row.status === "draft");
  const stats = useMemo(() => trainingStats(data.staff.map((person) => ({ id: person.id, name: name(person), skills: person.skills })), area), [data.staff, area]);
  const editRow = form.id ? data.evaluations.find((row) => row.id === form.id) : null;
  const editSignatures = useQuery({ queryKey: ["training-signatures-edit", form.id], queryFn: () => getSignatureUrls(editRow!), enabled: Boolean(editRow && (editRow.collaborator_signature_path || editRow.trainer_signature_path)) });
  const viewSignatures = useQuery({ queryKey: ["training-signatures-view", view?.id], queryFn: () => getSignatureUrls(view!), enabled: Boolean(view && (view.collaborator_signature_path || view.trainer_signature_path)) });

  function start() { setForm(blank()); setNotice(null); setTab("evaluation"); }
  function edit(row: Evaluation) {
    setForm({ id: row.id, staffId: row.staff_id, area: row.area === "production" ? "production" : "service", station: row.station_code ?? "", date: row.evaluation_date, responses: record<boolean>(row.responses), feedback: record<string>(row.feedback), findings: row.general_findings ?? "", collaboratorPath: row.collaborator_signature_path, trainerPath: row.trainer_signature_path });
    setNotice(null); setTab("evaluation");
  }

  const save = useMutation({ mutationFn: async (complete: boolean) => {
    if (!selectedStore || !form.staffId || !form.station) throw new Error("Selecciona colaborador, área y estación.");
    if (complete && keys.some((key) => form.responses[key] === undefined)) throw new Error("Responde todos los puntos antes de completar.");
    if (complete && (collaboratorPad.current?.isEmpty() || trainerPad.current?.isEmpty())) throw new Error("Se requieren ambas firmas.");
    const supabase = createClient();
    const stationName = trainingStations(form.area)[form.station].title;
    const values = { staff_id: form.staffId, store_id: selectedStore, trainer_id: userId, evaluation_date: form.date, area: form.area, station_code: form.station, station_name: stationName, score, responses: form.responses as unknown as Json, feedback: form.feedback as unknown as Json, general_findings: form.findings.trim() || null, current_step: Object.keys(form.responses).length, status: "draft" as const, is_edited: Boolean(form.id) };
    let id = form.id;
    if (id) {
      const { error } = await supabase.from("training_evaluations").update(values).eq("id", id).select("id").single();
      if (error) throw error;
    } else {
      const { data: inserted, error } = await supabase.from("training_evaluations").insert(values).select("id").single();
      if (error) throw error;
      id = inserted.id;
    }
    if (complete) {
      const [collaboratorBlob, trainerBlob] = await Promise.all([collaboratorPad.current!.toBlob(), trainerPad.current!.toBlob()]);
      const collaboratorPath = `${selectedStore}/${id}/collaborator.png`;
      const trainerPath = `${selectedStore}/${id}/trainer.png`;
      const uploads = await Promise.all([
        supabase.storage.from("training-signatures").upload(collaboratorPath, collaboratorBlob, { contentType: "image/png", upsert: true }),
        supabase.storage.from("training-signatures").upload(trainerPath, trainerBlob, { contentType: "image/png", upsert: true }),
      ]);
      const uploadError = uploads.find((item) => item.error)?.error;
      if (uploadError) throw uploadError;
      const { error } = await supabase.from("training_evaluations").update({ status: "completed", collaborator_signature_path: collaboratorPath, trainer_signature_path: trainerPath, score }).eq("id", id).select("id").single();
      if (error) throw error;
      if (score >= 90) {
        const { error: skillError } = await supabase.from("staff_skills").upsert({ staff_id: form.staffId, skill_code: form.station, acquired_at: form.date }, { onConflict: "staff_id,skill_code" });
        if (skillError) throw skillError;
      }
    }
    return complete;
  }, onSuccess: async (complete) => { await queryClient.invalidateQueries({ queryKey }); setForm(blank()); setNotice({ kind: "success", text: complete ? "Evaluación completada y firmada." : "Borrador guardado." }); setTab(complete ? "results" : "dashboard"); }, onError: (error) => setNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo guardar." }) });

  if (!selectedStore && role !== "superadmin") return <div className="form-alert error">La cuenta no tiene una tienda asignada.</div>;
  return <>
    <div className="training-toolbar"><nav className="section-tabs"><button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}><LayoutDashboard size={16}/>Resumen</button><button className={tab === "evaluation" ? "active" : ""} onClick={start}><ClipboardCheck size={16}/>Evaluar</button><button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}><CheckCircle2 size={16}/>Resultados</button><button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}><BarChart3 size={16}/>Estadísticas</button>{ownStaffId && <button className={tab === "availability" ? "active" : ""} onClick={() => setTab("availability")}>Disponibilidad</button>}</nav>{role === "superadmin" && <label>Tienda<select value={selectedStore} onChange={(event) => setStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}</div>
    {notice && <div className={`form-alert ${notice.kind}`}>{notice.text}</div>}
    {query.isPending && selectedStore && <div className="portal-loading">Cargando capacitación…</div>}
    {query.error && <div className="form-alert error">{query.error.message}</div>}
    {!query.isPending && tab === "dashboard" && <Dashboard staff={data.staff} drafts={drafts} completed={completed} area={area} setArea={setArea} start={start} edit={edit}/>} 
    {tab === "evaluation" && <EvaluationEditor form={form} setForm={setForm} staff={data.staff} groups={groups} score={score} save={save.mutate} saving={save.isPending} cancel={() => { setForm(blank()); setTab("dashboard"); }} collaboratorPad={collaboratorPad} trainerPad={trainerPad} urls={editSignatures.data}/>} 
    {tab === "results" && <Results rows={completed} staff={data.allStaff} view={setView} edit={edit}/>} 
    {tab === "stats" && <Statistics stats={stats} staffCount={data.staff.length} area={area} setArea={setArea}/>} 
    {tab === "availability" && ownStaffId && <StudyScheduleEditor staffId={ownStaffId}/>} 
    {view && <ResultModal row={view} staff={data.allStaff.find((person) => person.id === view.staff_id)} urls={viewSignatures.data} close={() => setView(null)}/>} 
  </>;
}

function AreaSwitch({ area, setArea }: { area: TrainingArea; setArea: (area: TrainingArea) => void }) { return <div className="training-area-switch"><button className={area === "service" ? "active" : ""} onClick={() => setArea("service")}>Servicio</button><button className={area === "production" ? "active" : ""} onClick={() => setArea("production")}>Producción</button></div>; }

function Dashboard({ staff, drafts, completed, area, setArea, start, edit }: { staff: Staff[]; drafts: Evaluation[]; completed: Evaluation[]; area: TrainingArea; setArea: (area: TrainingArea) => void; start: () => void; edit: (row: Evaluation) => void }) { return <div className="training-stack"><div className="training-section-heading"><div><p className="eyebrow">AVANCE</p><h2>Panel de capacitación</h2></div><div><AreaSwitch area={area} setArea={setArea}/><button className="secondary-button" onClick={start}><Plus size={16}/>Nueva evaluación</button></div></div><div className="metric-grid"><article className="metric-card"><span>Colaboradores</span><strong>{staff.length}</strong><small>Activos</small></article><article className="metric-card"><span>Certificados en todas</span><strong>{staff.filter((person) => stationProgress(person.skills, area) === 100).length}</strong><small>Estaciones del área</small></article><article className="metric-card"><span>Evaluaciones</span><strong>{completed.length}</strong><small>Completadas</small></article><article className="metric-card"><span>Borradores</span><strong>{drafts.length}</strong><small>Pendientes</small></article></div><div className="training-dashboard-grid"><section className="data-card"><div className="data-card-heading"><div><strong>Progreso por colaborador</strong><span>Certificaciones por estación</span></div></div><div className="training-progress-list">{staff.map((person) => { const progress = stationProgress(person.skills, area); return <article key={person.id}><div><strong>{name(person)}</strong><small>{person.position ?? "Sin posición"}</small></div><div className="training-progress"><span style={{ width: `${progress}%` }}/></div><b>{progress}%</b></article>; })}{!staff.length && <p className="empty-row">No hay colaboradores.</p>}</div></section><section className="data-card"><div className="data-card-heading"><div><strong>Borradores pendientes</strong><span>Continúa la evaluación</span></div></div><div className="training-draft-list">{drafts.map((row) => <button key={row.id} onClick={() => edit(row)}><span><strong>{name(staff.find((person) => person.id === row.staff_id))}</strong><small>{row.station_name} · {row.evaluation_date}</small></span><Pencil size={15}/></button>)}{!drafts.length && <p className="empty-row">No hay borradores.</p>}</div></section></div></div>; }

function EvaluationEditor({ form, setForm, staff, groups, score, save, saving, cancel, collaboratorPad, trainerPad, urls }: { form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; staff: Staff[]; groups: ReturnType<typeof evaluationGroups>; score: number; save: (complete: boolean) => void; saving: boolean; cancel: () => void; collaboratorPad: React.RefObject<SignaturePadHandle | null>; trainerPad: React.RefObject<SignaturePadHandle | null>; urls?: SignatureUrls }) {
  const stations = trainingStations(form.area);
  return <section className="training-form"><header><div><p className="eyebrow">{form.id ? `EVALUACIÓN #${form.id}` : "NUEVA EVALUACIÓN"}</p><h2>{form.id ? "Editar evaluación" : "Registrar evaluación"}</h2></div><div className={`score-badge ${score >= 90 ? "certified" : ""}`}><strong>{score}%</strong><span>{score >= 90 ? "Certifica" : "En proceso"}</span></div></header><div className="training-basics"><label>Área<select value={form.area} onChange={(event) => setForm((current) => ({ ...current, area: event.target.value as TrainingArea, station: "", responses: {}, feedback: {} }))}><option value="service">Servicio</option><option value="production">Producción</option></select></label><label>Estación<select value={form.station} onChange={(event) => setForm((current) => ({ ...current, station: event.target.value, responses: {}, feedback: {} }))}><option value="">Seleccionar…</option>{Object.entries(stations).map(([code, station]) => <option key={code} value={code}>{station.title}</option>)}</select></label><label>Colaborador<select value={form.staffId} onChange={(event) => setForm((current) => ({ ...current, staffId: event.target.value }))}><option value="">Seleccionar…</option>{staff.map((person) => <option key={person.id} value={person.id}>{name(person)}</option>)}</select></label><label>Fecha<input type="date" max={today()} value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}/></label></div>{form.station ? <div className="evaluation-groups">{groups.map((group) => <section key={group.id}><h3>{group.title}</h3>{group.points.map((point, index) => <article key={point.key} className={form.responses[point.key] === false ? "failed" : ""}><div className="evaluation-point"><span>{index + 1}</span><p>{point.text}</p></div><div className="evaluation-answer"><button type="button" className={form.responses[point.key] === true ? "yes active" : "yes"} onClick={() => setForm((current) => ({ ...current, responses: { ...current.responses, [point.key]: true } }))}>Cumple</button><button type="button" className={form.responses[point.key] === false ? "no active" : "no"} onClick={() => setForm((current) => ({ ...current, responses: { ...current.responses, [point.key]: false } }))}>No cumple</button></div><textarea placeholder="Observación opcional" value={form.feedback[point.key] ?? ""} onChange={(event) => setForm((current) => ({ ...current, feedback: { ...current.feedback, [point.key]: event.target.value } }))}/></article>)}</section>)}</div> : <div className="training-placeholder">Selecciona una estación para cargar los criterios.</div>}<div className="training-findings"><label>Hallazgos generales<textarea rows={4} value={form.findings} onChange={(event) => setForm((current) => ({ ...current, findings: event.target.value }))}/></label></div><div className="signature-grid"><SignaturePad key={`c-${form.id}`} ref={collaboratorPad} label="Firma del colaborador" initialUrl={urls?.collaborator}/><SignaturePad key={`t-${form.id}`} ref={trainerPad} label="Firma del entrenador" initialUrl={urls?.trainer}/></div><footer><button className="plain-button" onClick={cancel}><X size={16}/>Cancelar</button><button className="plain-button" disabled={saving} onClick={() => save(false)}><Save size={16}/>Guardar borrador</button><button className="secondary-button" disabled={saving} onClick={() => save(true)}><CheckCircle2 size={16}/>{saving ? "Guardando…" : "Completar y firmar"}</button></footer></section>;
}

function Results({ rows, staff, view, edit }: { rows: Evaluation[]; staff: Staff[]; view: (row: Evaluation) => void; edit: (row: Evaluation) => void }) { return <section className="data-card"><div className="data-card-heading"><div><strong>Resultados</strong><span>{rows.length} evaluaciones completas</span></div></div><div className="table-scroll"><table className="training-results-table"><thead><tr><th>Fecha</th><th>Colaborador</th><th>Área / estación</th><th>Puntaje</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.evaluation_date}</td><td>{name(staff.find((person) => person.id === row.staff_id))}</td><td><strong>{row.station_name}</strong><small>{row.area === "production" ? "Producción" : "Servicio"}</small></td><td><span className={`result-score ${Number(row.score) >= 90 ? "certified" : ""}`}>{row.score ?? 0}%</span></td><td><span className={`status-pill ${Number(row.score) >= 90 ? "active" : "pending"}`}>{Number(row.score) >= 90 ? "Certificado" : "Reforzar"}</span></td><td><div className="row-actions"><button className="icon-button" title="Ver" onClick={() => view(row)}><ClipboardCheck size={16}/></button><button className="icon-button" title="Editar" onClick={() => edit(row)}><Pencil size={16}/></button></div></td></tr>)}{!rows.length && <tr><td colSpan={6} className="empty-row">Aún no hay resultados.</td></tr>}</tbody></table></div></section>; }

function Statistics({ stats, staffCount, area, setArea }: { stats: ReturnType<typeof trainingStats>; staffCount: number; area: TrainingArea; setArea: (area: TrainingArea) => void }) { const max = Math.max(staffCount, 1); return <div className="training-stack"><div className="training-section-heading"><div><p className="eyebrow">INDICADORES</p><h2>Estadísticas de certificación</h2></div><AreaSwitch area={area} setArea={setArea}/></div><div className="metric-grid"><article className="metric-card"><span>Certificaciones</span><strong>{stats.totalCertifications}</strong><small>Acumuladas</small></article><article className="metric-card"><span>Colaboradores</span><strong>{staffCount}</strong><small>Base activa</small></article><article className="metric-card"><span>Estaciones</span><strong>{stats.counts.length}</strong><small>Del área</small></article><article className="metric-card"><span>Con certificación</span><strong>{stats.leaders.length}</strong><small>Al menos una</small></article></div><div className="training-dashboard-grid"><section className="data-card training-chart"><div className="data-card-heading"><div><strong>Cobertura por estación</strong><span>Colaboradores certificados</span></div></div>{stats.counts.map((row) => <div className="training-bar" key={row.code}><span>{row.name}</span><div><i style={{ width: `${row.count / max * 100}%` }}/></div><strong>{row.count}</strong></div>)}</section><section className="data-card"><div className="data-card-heading"><div><strong>Líderes de aprendizaje</strong><span>Mayor cobertura</span></div></div><ol className="training-leaders">{stats.leaders.slice(0, 10).map((person, index) => <li key={person.id}><b>{index + 1}</b><span><strong>{person.name}</strong><small>{person.certifiedCount} certificaciones</small></span></li>)}{!stats.leaders.length && <p className="empty-row">Sin certificaciones.</p>}</ol></section></div></div>; }

function ResultModal({ row, staff, urls, close }: { row: Evaluation; staff?: Staff; urls?: SignatureUrls; close: () => void }) { const responses = record<boolean>(row.responses); const feedback = record<string>(row.feedback); const points = evaluationGroups(row.area === "production" ? "production" : "service", row.station_code ?? "").flatMap((group) => group.points); const gaps = points.filter((point) => responses[point.key] === false); return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="training-result-modal" role="dialog" aria-modal="true" aria-label={`Resultado de ${name(staff)}`}><header><div><p className="eyebrow">RESULTADO #{row.id}</p><h2>{name(staff)} · {row.station_name}</h2><p>{row.evaluation_date}</p></div><button className="icon-button" aria-label="Cerrar resultado" onClick={close}><X size={18}/></button></header><div className="result-summary"><div className={`score-badge ${Number(row.score) >= 90 ? "certified" : ""}`}><strong>{row.score ?? 0}%</strong><span>{Number(row.score) >= 90 ? "Certificado" : "Requiere refuerzo"}</span></div><div><strong>{Object.values(responses).filter(Boolean).length}</strong><span>Puntos cumplidos</span></div><div><strong>{gaps.length}</strong><span>Oportunidades</span></div></div><div className="result-body"><section><h3>Oportunidades de mejora</h3>{gaps.map((point) => <article key={point.key}><p>{point.text}</p>{feedback[point.key] && <small>{feedback[point.key]}</small>}</article>)}{!gaps.length && <p className="positive">Todos los criterios fueron cumplidos.</p>}</section><section><h3>Hallazgos generales</h3><p>{row.general_findings || "Sin comentarios adicionales."}</p></section><section><h3>Firmas</h3><div className="result-signatures"><div><span>Colaborador</span>{urls?.collaborator ? <Image unoptimized width={320} height={130} src={urls.collaborator} alt="Firma del colaborador"/> : <small>Cargando…</small>}</div><div><span>Entrenador</span>{urls?.trainer ? <Image unoptimized width={320} height={130} src={urls.trainer} alt="Firma del entrenador"/> : <small>Cargando…</small>}</div></div></section></div></section></div>; }
