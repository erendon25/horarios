"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Clock, Lock, Plus, Save, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Json, Tables } from "@/types/database";

const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const labels = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
type DayKey = typeof dayKeys[number];
type Block = { start: string; end: string };
type DaySchedule = { free: boolean; blocks: Block[] };
type Schedule = Record<DayKey, DaySchedule>;
type StaffAccess = Pick<Tables<"staff_profiles">, "id" | "first_name" | "last_name" | "store_id" | "sanitary_card_expiry" | "sanitary_card_unlock">;

const emptySchedule = (): Schedule => Object.fromEntries(dayKeys.map((key) => [key, { free: false, blocks: [] }])) as unknown as Schedule;

async function loadStudySchedule(staffId: string) {
  const supabase = createClient();
  const [staffResult, daysResult] = await Promise.all([
    supabase.from("staff_profiles").select("id,first_name,last_name,store_id,sanitary_card_expiry,sanitary_card_unlock").eq("id", staffId).single(),
    supabase.from("study_schedule_days").select("id,weekday,requests_day_off").eq("staff_id", staffId).order("weekday"),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (daysResult.error) throw daysResult.error;
  const dayIds = daysResult.data.map((day) => day.id);
  const [blocksResult, lockResult] = await Promise.all([
    dayIds.length ? supabase.from("study_schedule_blocks").select("study_day_id,start_time,end_time").in("study_day_id", dayIds).order("start_time") : Promise.resolve({ data: [], error: null }),
    supabase.from("store_configs").select("value").eq("store_id", staffResult.data.store_id).eq("config_key", "schedule_lock").maybeSingle(),
  ]);
  if (blocksResult.error) throw blocksResult.error;
  if (lockResult.error) throw lockResult.error;

  const blocksByDay = new Map<number, Block[]>();
  for (const block of blocksResult.data ?? []) {
    const list = blocksByDay.get(block.study_day_id) ?? [];
    list.push({ start: block.start_time.slice(0, 5), end: block.end_time.slice(0, 5) });
    blocksByDay.set(block.study_day_id, list);
  }
  const schedule = emptySchedule();
  for (const day of daysResult.data) {
    const key = dayKeys[day.weekday];
    if (key) schedule[key] = { free: day.requests_day_off, blocks: blocksByDay.get(day.id) ?? [] };
  }
  return { staff: staffResult.data as StaffAccess, schedule, lock: lockResult.data?.value ?? null };
}

function limaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseLock(value: Json | null) {
  if (!value || Array.isArray(value) || typeof value !== "object") return { enabled: false, reenableDate: "" };
  return { enabled: value.restrictionsEnabled === true, reenableDate: typeof value.reenableDate === "string" ? value.reenableDate : "" };
}

export function StudyScheduleEditor({ staffId, adminMode = false, onClose }: { staffId: string; adminMode?: boolean; onClose?: () => void }) {
  const queryKey = ["study-schedule", staffId] as const;
  const { data, isPending, error, dataUpdatedAt } = useQuery({ queryKey, queryFn: () => loadStudySchedule(staffId) });

  if (isPending) return <div className="study-loading">Cargando disponibilidad…</div>;
  if (error || !data) return <p className="form-alert error">No se pudo cargar el horario de estudio.</p>;
  return <LoadedStudyScheduleEditor key={`${staffId}-${dataUpdatedAt}`} staffId={staffId} adminMode={adminMode} onClose={onClose} data={data}/>;
}

function LoadedStudyScheduleEditor({ staffId, adminMode, onClose, data }: {
  staffId: string;
  adminMode: boolean;
  onClose?: () => void;
  data: Awaited<ReturnType<typeof loadStudySchedule>>;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["study-schedule", staffId] as const;
  const [schedule, setSchedule] = useState<Schedule>(() => Object.fromEntries(dayKeys.map((key) => [key, { ...data.schedule[key], blocks: data.schedule[key].blocks.map((block) => ({ ...block })) }])) as unknown as Schedule);
  const [saved, setSaved] = useState(false);

  const lock = parseLock(data?.lock ?? null);
  const today = limaToday();
  const expiredCard = Boolean(data?.staff.sanitary_card_expiry && today > data.staff.sanitary_card_expiry);
  const cardBlocked = expiredCard && !data?.staff.sanitary_card_unlock;
  const dateBlocked = lock.enabled && Boolean(lock.reenableDate) && today <= lock.reenableDate;
  const blocked = !adminMode && (cardBlocked || dateBlocked);

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const key of dayKeys) for (const block of schedule[key].blocks) {
        if (!schedule[key].free && (!block.start || !block.end || block.start === block.end)) throw new Error("invalid_block");
      }
      const { error: saveError } = await createClient().rpc("save_study_schedule", { p_staff_id: staffId, p_schedule: schedule as unknown as Json });
      if (saveError) throw saveError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    },
  });

  function updateDay(key: DayKey, update: Partial<DaySchedule>) {
    setSchedule((current) => ({ ...current, [key]: { ...current[key], ...update } }));
  }
  function updateBlock(key: DayKey, index: number, field: keyof Block, value: string) {
    const blocks = schedule[key].blocks.map((block, position) => position === index ? { ...block, [field]: value } : block);
    updateDay(key, { blocks });
  }

  return <section className="study-editor">
    <div className="study-intro"><div><p className="eyebrow">DISPONIBILIDAD ACADÉMICA</p><h2>{data.staff.first_name} {data.staff.last_name}</h2><p className="muted">Registra todos los bloques de estudio. Los horarios que cruzan medianoche están permitidos.</p></div><Clock size={30}/></div>
    {cardBlocked && !adminMode && <p className="restriction-banner error"><Lock size={18}/> El carnet sanitario venció. Un administrador debe renovarlo o habilitar temporalmente el acceso.</p>}
    {expiredCard && data.staff.sanitary_card_unlock && !adminMode && <p className="restriction-banner success"><CheckCircle size={18}/> Carnet vencido con acceso temporal autorizado.</p>}
    {dateBlocked && !adminMode && <p className="restriction-banner warning"><AlertTriangle size={18}/> Los cambios están bloqueados hasta el {lock.reenableDate.split("-").reverse().join("/")} inclusive.</p>}
    <div className="study-days">
      {dayKeys.map((key, dayIndex) => <article className="study-day" key={key}>
        <header><strong>{labels[dayIndex]}</strong><label><input type="checkbox" disabled={blocked} checked={schedule[key].free} onChange={(event) => updateDay(key, { free: event.target.checked, blocks: event.target.checked ? [] : schedule[key].blocks })}/> Solicitar día libre</label></header>
        {schedule[key].free ? <div className="free-day"><CheckCircle size={18}/> Día libre solicitado</div> : <div className="study-blocks">
          {schedule[key].blocks.map((block, index) => <div className="study-block" key={`${key}-${index}`}><label>Inicio<input type="time" disabled={blocked} value={block.start} onChange={(event) => updateBlock(key, index, "start", event.target.value)}/></label><span>a</span><label>Fin<input type="time" disabled={blocked} value={block.end} onChange={(event) => updateBlock(key, index, "end", event.target.value)}/></label><button className="icon-button danger" disabled={blocked} onClick={() => updateDay(key, { blocks: schedule[key].blocks.filter((_, position) => position !== index) })} title="Eliminar bloque"><Trash2 size={15}/></button></div>)}
          <button className="add-block-button" disabled={blocked} onClick={() => updateDay(key, { blocks: [...schedule[key].blocks, { start: "", end: "" }] })}><Plus size={15}/> Agregar bloque</button>
        </div>}
      </article>)}
    </div>
    {saveMutation.error && <p className="form-alert error">{saveMutation.error.message === "invalid_block" ? "Todos los bloques deben tener inicio y fin diferentes." : "No se pudo guardar. El servidor rechazó el cambio por permisos o restricciones vigentes."}</p>}
    <footer>{onClose && <button className="plain-button" onClick={onClose}>Cerrar</button>}<button className="primary-button" disabled={blocked || saveMutation.isPending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? "Guardando…" : saved ? "¡Guardado!" : <><Save size={16}/> Guardar horarios</>}</button></footer>
  </section>;
}
