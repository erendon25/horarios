"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Check, CircleHelp, Copy, Save, Sparkles, Trash2, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";
import { ScheduleCoverageMatrix } from "@/components/schedule-coverage-matrix";
import { expandProjectionMatrix, type CoverageAssignment } from "@/lib/schedule-coverage";
import { exportExtraHoursPdf, exportGeoVictoriaExcel, exportPositioningPdf, exportWeeklySchedulePdf } from "@/lib/weekly-exports";
import {
  WEEKDAYS, WEEKDAY_LABELS, addIsoDays, effectiveModality, emptyStaffWeek, mondayOf,
  emptyShift, normalizePosition, serializeShift, shiftConflicts, shiftMinutes, timeMinutes,
  type Shift, type StaffWeek, type StudyDay, type Weekday,
} from "@/lib/weekly-schedule";

type Staff = {
  id: string; first_name: string; last_name: string; modality: string | null; modality_change_date: string | null;
  next_modality: string | null; position: string; dni: string | null; birth_date: string | null; cessation_date: string | null;
  is_trainee: boolean; training_end_date: string | null; skills: string[]; study: Partial<Record<Weekday, StudyDay>>;
};
type Request = { id: number; staff_id: string; requested_date: string; shift_type: string; start_time: string | null; end_time: string | null; reason: string | null };
type Projection = { positions: string[]; requirements: Record<string, unknown> };
type LoadedData = { storeId: string; staff: Staff[]; current: Record<string, StaffWeek>; previous: Record<string, StaffWeek>; holidays: Record<string, string>; requests: Request[]; projection: Projection; shiftMap: Record<string, string | number> };
type ScheduleContext = { stores: Array<{ id: string; name: string; is_active: boolean }>; defaultStoreId: string };

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clock = (value: string | null) => value?.slice(0, 5) ?? "";
const shortDate = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;

function shiftLabel(shift: Shift | undefined) {
  if (!shift) return "Sin horario registrado";
  if (shift.off) return "Descanso";
  if (shift.holiday) return "Feriado";
  if (!shift.start || !shift.end) return "Sin horario asignado";
  const secondBlock = shift.splitShift && shift.start2 && shift.end2 ? ` · ${shift.start2}–${shift.end2}` : "";
  return `${shift.start}–${shift.end}${secondBlock}${shift.position ? ` · ${shift.position}` : ""}`;
}

function studyLabel(study: StudyDay | undefined) {
  if (!study) return "Sin horario de estudios registrado";
  const blocks = study.blocks.map((block) => `${block.start}–${block.end}`).join(" · ");
  if (study.free) return blocks ? `Solicita día libre · ${blocks}` : "Solicita día libre por estudios";
  return blocks || "Sin clases registradas";
}

function limaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function hydrateWeek(weekStart: string, staff: Staff[], weeks: Array<Record<string, unknown>>) {
  const result = Object.fromEntries(staff.map((person) => [person.id, emptyStaffWeek(weekStart)])) as Record<string, StaffWeek>;
  for (const week of weeks) {
    const staffId = String(week.staff_id);
    if (!result[staffId]) continue;
    const shifts = Array.isArray(week.schedule_shifts) ? week.schedule_shifts : [];
    for (const raw of shifts) {
      if (!isObject(raw) || typeof raw.work_date !== "string") continue;
      const index = WEEKDAYS.findIndex((_, dayIndex) => addIsoDays(weekStart, dayIndex) === raw.work_date);
      if (index < 0) continue;
      const metadata = isObject(raw.metadata) ? raw.metadata : {};
      result[staffId][WEEKDAYS[index]] = {
        date: raw.work_date,
        start: clock(typeof raw.start_time === "string" ? raw.start_time : null),
        end: clock(typeof raw.end_time === "string" ? raw.end_time : null),
        position: typeof raw.position === "string" ? raw.position : "",
        off: raw.is_day_off === true,
        holiday: raw.is_holiday === true,
        notes: typeof raw.notes === "string" ? raw.notes : "",
        splitShift: metadata.splitShift === true || metadata.isSplit === true,
        start2: clock(typeof metadata.start2 === "string" ? metadata.start2 : null),
        end2: clock(typeof metadata.end2 === "string" ? metadata.end2 : null),
        extraHoursPre: Number(metadata.extraHoursPre ?? 0) || 0,
        extraHoursPost: Number(metadata.extraHoursPost ?? metadata.extraHours ?? 0) || 0,
      };
    }
  }
  return result;
}

async function loadScheduleContext(forcedStoreId?: string): Promise<ScheduleContext> {
  const supabase = createClient();
  if (forcedStoreId) {
    const stores = await supabase.from("stores").select("id,name,is_active").eq("id", forcedStoreId);
    if (stores.error) throw stores.error;
    return { stores: stores.data, defaultStoreId: forcedStoreId };
  }
  const auth = await supabase.auth.getUser();
  if (auth.error || !auth.data.user) throw auth.error ?? new Error("missing_authenticated_user");
  const profile = await supabase.from("user_profiles").select("role,store_id").eq("id", auth.data.user.id).single();
  if (profile.error) throw profile.error;
  let storesQuery = supabase.from("stores").select("id,name,is_active").eq("is_active", true).order("name");
  if (profile.data.role !== "superadmin" && profile.data.store_id) storesQuery = storesQuery.eq("id", profile.data.store_id);
  const stores = await storesQuery;
  if (stores.error) throw stores.error;
  return { stores: stores.data, defaultStoreId: profile.data.store_id ?? stores.data[0]?.id ?? "" };
}

async function loadWeeklySchedule(weekStart: string, storeId: string): Promise<LoadedData> {
  const supabase = createClient();
  const previousStart = addIsoDays(weekStart, -7);
  const weekEnd = addIsoDays(weekStart, 6);
  const staffResult = await supabase.from("staff_profiles").select("id,first_name,last_name,dni,modality,modality_change_date,next_modality,position,birth_date,cessation_date,is_trainee,training_end_date,staff_skills(skill_code)").eq("store_id", storeId).order("first_name");
  if (staffResult.error) throw staffResult.error;
  const staffIds = (staffResult.data ?? []).map((person) => person.id);
  const [weeksResult, studyResult, projectionResult, holidaysResult, requestsResult, shiftMapResult] = await Promise.all([
    supabase.from("schedule_weeks").select("id,staff_id,week_start,schedule_shifts(work_date,start_time,end_time,position,is_day_off,is_holiday,notes,metadata)").eq("store_id", storeId).in("week_start", [weekStart, previousStart]),
    staffIds.length ? supabase.from("study_schedule_days").select("id,staff_id,weekday,requests_day_off,study_schedule_blocks(start_time,end_time)").in("staff_id", staffIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("sales_projection_templates").select("positions,requirements").eq("store_id", storeId).maybeSingle(),
    supabase.from("official_holidays").select("holiday_date,name").gte("holiday_date", weekStart).lte("holiday_date", weekEnd),
    supabase.from("schedule_requests").select("id,staff_id,requested_date,shift_type,start_time,end_time,reason").eq("store_id", storeId).eq("status", "approved").gte("requested_date", weekStart).lte("requested_date", weekEnd),
    supabase.from("store_configs").select("value").eq("store_id", storeId).eq("config_key", "geovictoria_turnos").maybeSingle(),
  ]);
  for (const result of [weeksResult, studyResult, projectionResult, holidaysResult, requestsResult, shiftMapResult]) if (result.error) throw result.error;

  const rawStaff = (staffResult.data ?? []) as unknown as Array<Record<string, unknown>>;
  const studyByStaff = new Map<string, Partial<Record<Weekday, StudyDay>>>();
  for (const day of (studyResult.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = WEEKDAYS[Number(day.weekday)];
    if (!key) continue;
    const blocks = Array.isArray(day.study_schedule_blocks) ? day.study_schedule_blocks : [];
    const schedule = studyByStaff.get(String(day.staff_id)) ?? {};
    schedule[key] = { free: day.requests_day_off === true, blocks: blocks.filter(isObject).map((block) => ({ start: clock(typeof block.start_time === "string" ? block.start_time : null), end: clock(typeof block.end_time === "string" ? block.end_time : null) })) };
    studyByStaff.set(String(day.staff_id), schedule);
  }
  const staff: Staff[] = rawStaff.map((person) => ({
    id: String(person.id), first_name: String(person.first_name), last_name: String(person.last_name),
    modality: typeof person.modality === "string" ? person.modality : null,
    modality_change_date: typeof person.modality_change_date === "string" ? person.modality_change_date : null,
    next_modality: typeof person.next_modality === "string" ? person.next_modality : null,
    position: String(person.position ?? ""), dni: typeof person.dni === "string" ? person.dni : null, birth_date: typeof person.birth_date === "string" ? person.birth_date : null,
    cessation_date: typeof person.cessation_date === "string" ? person.cessation_date : null,
    is_trainee: person.is_trainee === true, training_end_date: typeof person.training_end_date === "string" ? person.training_end_date : null,
    skills: (Array.isArray(person.staff_skills) ? person.staff_skills : []).filter(isObject).map((skill) => String(skill.skill_code)),
    study: studyByStaff.get(String(person.id)) ?? {},
  }));
  const weeks = (weeksResult.data ?? []) as unknown as Array<Record<string, unknown>>;
  const projectionRaw = projectionResult.data as unknown as Record<string, unknown> | null;
  const shiftConfig = shiftMapResult.data?.value;
  const shiftConfigObject = isObject(shiftConfig) ? shiftConfig : {};
  const rawShiftMap = isObject(shiftConfigObject.turnoMap) ? shiftConfigObject.turnoMap : {};
  return {
    storeId, staff,
    current: hydrateWeek(weekStart, staff, weeks.filter((week) => week.week_start === weekStart)),
    previous: hydrateWeek(previousStart, staff, weeks.filter((week) => week.week_start === previousStart)),
    holidays: Object.fromEntries((holidaysResult.data ?? []).map((holiday) => [holiday.holiday_date, holiday.name])),
    requests: (requestsResult.data ?? []) as Request[],
    projection: {
      positions: Array.isArray(projectionRaw?.positions) ? projectionRaw.positions.filter((item): item is string => typeof item === "string") : [],
      requirements: isObject(projectionRaw?.requirements) ? projectionRaw.requirements : {},
    },
    shiftMap: Object.fromEntries(Object.entries(rawShiftMap).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number")),
  };
}

function projectionForDay(projection: Projection, day: Weekday) {
  const raw = projection.requirements[day];
  if (!isObject(raw)) return { positions: projection.positions, matrix: [] as number[][] };
  const positions = Array.isArray(raw.positions) ? raw.positions.filter((item): item is string => typeof item === "string") : projection.positions;
  const matrix = expandProjectionMatrix(raw.matrix, positions.length);
  return { positions, matrix };
}

export function WeeklyScheduleEditor({ storeId }: { storeId?: string } = {}) {
  const context = useQuery({ queryKey: ["weekly-schedule", "context", storeId ?? "role"], queryFn: () => loadScheduleContext(storeId) });
  if (context.isPending) return <div className="study-loading">Cargando tiendas…</div>;
  if (context.error || !context.data?.defaultStoreId) return <p className="form-alert error">No hay una tienda disponible para administrar horarios.</p>;
  return <WeeklyScheduleStoreSelector context={context.data}/>;
}

function WeeklyScheduleStoreSelector({ context }: { context: ScheduleContext }) {
  const [storeId, setStoreId] = useState(context.defaultStoreId);
  const [weekStart, setWeekStart] = useState(() => mondayOf(limaToday()));
  const query = useQuery({ queryKey: ["weekly-schedule", storeId, weekStart], queryFn: () => loadWeeklySchedule(weekStart, storeId) });
  return <>
    {context.stores.length > 1 && <div className="weekly-store-selector"><label>Tienda<select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{context.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.is_active ? "" : " (inactiva)"}</option>)}</select></label></div>}
    {query.isPending ? <div className="study-loading">Cargando horario semanal…</div> : query.error || !query.data ? <p className="form-alert error">No se pudo cargar el horario semanal.</p> : <LoadedWeeklySchedule key={`${storeId}-${weekStart}-${query.dataUpdatedAt}`} weekStart={weekStart} onWeekChange={(value) => setWeekStart(mondayOf(value))} data={query.data}/>} 
  </>;
}

function LoadedWeeklySchedule({ weekStart, onWeekChange, data }: { weekStart: string; onWeekChange: (value: string) => void; data: LoadedData }) {
  const queryClient = useQueryClient();
  const draftKey = `next_weekly_schedule_${data.storeId}_${weekStart}`;
  const [selectedDay, setSelectedDay] = useState<Weekday>("monday");
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState("Todos");
  const [position, setPosition] = useState("Todas");
  const [excludeTrainees, setExcludeTrainees] = useState(false);
  const [showPositions, setShowPositions] = useState(false);
  const [positionTurn, setPositionTurn] = useState<"mañana" | "tarde" | "ambos">("ambos");
  const [exportingExcel, setExportingExcel] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [savedDraft, setSavedDraft] = useState<Record<string, StaffWeek> | null>(() => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      return saved ? JSON.parse(saved) as Record<string, StaffWeek> : null;
    } catch { return null; }
  });
  const [schedule, setSchedule] = useState<Record<string, StaffWeek>>(data.current);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Array<{ schedule: Record<string, StaffWeek>; dirty: Set<string>; selectedDay: Weekday }>>([]);

  useEffect(() => {
    if (!dirty.size) return;
    const timeout = window.setTimeout(() => window.localStorage.setItem(draftKey, JSON.stringify(schedule)), 700);
    return () => window.clearTimeout(timeout);
  }, [draftKey, dirty.size, schedule]);

  const selectedDate = addIsoDays(weekStart, WEEKDAYS.indexOf(selectedDay));
  const projection = projectionForDay(data.projection, selectedDay);
  const positions = projection.positions;
  const activeWeekStaff = useMemo(() => data.staff.filter((person) => {
    const endDate = person.is_trainee ? person.training_end_date : person.cessation_date;
    return !endDate || endDate >= weekStart;
  }), [data.staff, weekStart]);
  const visibleStaff = useMemo(() => activeWeekStaff.filter((person) => {
    const name = `${person.first_name} ${person.last_name}`.toLocaleLowerCase("es");
    if (search && !name.includes(search.toLocaleLowerCase("es"))) return false;
    const effective = effectiveModality(person, selectedDate);
    if (modality !== "Todos" && effective !== modality) return false;
    if (position !== "Todas" && normalizePosition(schedule[person.id][selectedDay].position) !== normalizePosition(position)) return false;
    return true;
  }), [activeWeekStaff, modality, position, schedule, search, selectedDate, selectedDay]);
  const coverageAssignments = useMemo(() => visibleStaff.flatMap((person): CoverageAssignment[] => {
    const shift = schedule[person.id][selectedDay];
    if (!shift.position || !shift.start || !shift.end || shift.off) return [];
    const preStart = Math.max(0, timeMinutes(shift.start) - shift.extraHoursPre * 60);
    const postEnd = timeMinutes(shift.end) + shift.extraHoursPost * 60;
    const format = (minutes: number) => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const result: CoverageAssignment[] = [{ position: shift.position, start: format(preStart), end: format(postEnd), isTrainer: normalizePosition(person.position) === "entrenador" }];
    if (shift.splitShift && shift.start2 && shift.end2) result.push({ position: shift.position, start: shift.start2, end: shift.end2, isTrainer: normalizePosition(person.position) === "entrenador" });
    return result;
  }), [schedule, selectedDay, visibleStaff]);

  function rememberCurrentState() {
    setHistory((current) => [...current.slice(-19), { schedule, dirty: new Set(dirty), selectedDay }]);
  }

  function restoreSavedDraft() {
    if (!savedDraft) return;
    const restored = { ...data.current, ...savedDraft };
    const changedStaff = Object.keys(restored).filter((staffId) =>
      JSON.stringify(restored[staffId]) !== JSON.stringify(data.current[staffId]),
    );
    setSchedule(restored);
    setDirty(new Set(changedStaff));
    setHistory([]);
    setSavedDraft(null);
    setMessage(changedStaff.length
      ? `Borrador recuperado para ${changedStaff.length} colaboradores. Revisa y guarda los cambios.`
      : "El borrador era igual al horario guardado; no hay cambios pendientes.");
    if (!changedStaff.length) window.localStorage.removeItem(draftKey);
  }

  function discardSavedDraft() {
    window.localStorage.removeItem(draftKey);
    setSavedDraft(null);
    setSchedule(data.current);
    setDirty(new Set());
    setHistory([]);
    setMessage("Borrador descartado. Se muestra el horario vigente guardado en Supabase.");
  }

  function undoLastChange() {
    const previous = history.at(-1);
    if (!previous) return;
    setSchedule(previous.schedule);
    setDirty(new Set(previous.dirty));
    setSelectedDay(previous.selectedDay);
    setHistory((current) => current.slice(0, -1));
    if (previous.dirty.size) window.localStorage.setItem(draftKey, JSON.stringify(previous.schedule));
    else window.localStorage.removeItem(draftKey);
    setMessage("Se deshizo el último cambio y se restauró el horario anterior.");
  }

  function changeShift(staffId: string, update: Partial<Shift>) {
    rememberCurrentState();
    setSchedule((current) => ({ ...current, [staffId]: { ...current[staffId], [selectedDay]: { ...current[staffId][selectedDay], ...update } } }));
    setDirty((current) => new Set(current).add(staffId));
    setMessage("");
  }

  function toggleOff(person: Staff, checked: boolean) {
    changeShift(person.id, checked ? { off: true, holiday: false, start: "", end: "", position: "", splitShift: false, start2: "", end2: "", extraHoursPre: 0, extraHoursPost: 0 } : { off: false });
  }

  function toggleHoliday(person: Staff, checked: boolean) {
    if (!checked) return changeShift(person.id, { holiday: false });
    if (data.holidays[selectedDate]) {
      changeShift(person.id, { off: true, holiday: false, start: "", end: "", position: "", splitShift: false, start2: "", end2: "" });
      setMessage(`${selectedDate} es ${data.holidays[selectedDate]}; se marcó como descanso legal.`);
      return;
    }
    const full = effectiveModality(person, selectedDate) === "Full-Time";
    changeShift(person.id, { holiday: true, off: false, start: "08:00", end: full ? "16:45" : "12:00", position: "", splitShift: false, start2: "", end2: "", extraHoursPre: 0, extraHoursPost: 0 });
  }

  function replicatePrevious() {
    rememberCurrentState();
    const next = { ...schedule };
    const changed = new Set(dirty);
    for (const person of data.staff) {
      const current = next[person.id];
      const previous = data.previous[person.id];
      if (!previous) continue;
      let touched = false;
      const copied = { ...current };
      for (const day of WEEKDAYS) {
        const target = current[day];
        const source = previous[day];
        if (!target.start && !target.end && !target.off && !target.holiday && (source.start || source.off || source.holiday)) {
          const valid = new Set(projectionForDay(data.projection, day).positions.map(normalizePosition));
          copied[day] = { ...source, date: target.date, position: source.position && valid.has(normalizePosition(source.position)) ? source.position : "" };
          touched = true;
        }
      }
      if (touched) { next[person.id] = copied; changed.add(person.id); }
    }
    setSchedule(next); setDirty(changed); setMessage("Se replicaron únicamente días vacíos de la semana anterior.");
  }

  function generateIdeal() {
    if (!positions.length || !projection.matrix.length) { setMessage("La proyección de este día todavía no tiene una matriz utilizable."); return; }
    rememberCurrentState();
    const slots = Array.from({ length: 77 }, (_, index) => ({ minute: 360 + index * 15, assigned: positions.map(() => 0) }));
    const next = { ...schedule };
    const changed = new Set(dirty);
    const candidates = data.staff.filter((person) => !(person.is_trainee ? person.training_end_date : person.cessation_date) || (person.is_trainee ? person.training_end_date! : person.cessation_date!) >= selectedDate);
    for (const person of candidates) {
      const study = person.study[selectedDay];
      if (study?.free) { next[person.id] = { ...next[person.id], [selectedDay]: { ...next[person.id][selectedDay], off: true, start: "", end: "", position: "", holiday: false } }; changed.add(person.id); continue; }
      const full = effectiveModality(person, selectedDate) === "Full-Time";
      const freeStudyDays = Object.values(person.study).filter((day) => day?.free).length;
      const blockOptions = full ? [35] : freeStudyDays > 1 ? [24, 16] : [16];
      const currentMinutes = WEEKDAYS.reduce((total, day) => total + shiftMinutes(next[person.id][day], effectiveModality(person, next[person.id][day].date) === "Full-Time"), 0);
      let assigned: Shift | null = null;
      for (const blocks of blockOptions) for (let startIndex = 0; startIndex + blocks <= slots.length && !assigned; startIndex++) {
        const startMinute = slots[startIndex].minute;
        const endMinute = startMinute + blocks * 15;
        if (currentMinutes + blocks * 15 > (full ? 2880 : 1440)) continue;
        if (study?.blocks.some((block) => !(endMinute <= timeMinutes(block.start) - 60 || startMinute >= timeMinutes(block.end) + 60))) continue;
        for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
          if (!person.skills.some((skill) => normalizePosition(skill) === normalizePosition(positions[positionIndex]))) continue;
          const hasSpace = slots.slice(startIndex, startIndex + blocks).every((slot, offset) => slot.assigned[positionIndex] < Number(projection.matrix[positionIndex]?.[startIndex + offset] ?? 0));
          if (!hasSpace) continue;
          const displayTime = (minute: number) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
          assigned = { ...next[person.id][selectedDay], start: displayTime(startMinute), end: displayTime(endMinute), position: positions[positionIndex], off: false, holiday: false };
          slots.slice(startIndex, startIndex + blocks).forEach((slot) => slot.assigned[positionIndex]++);
          break;
        }
      }
      next[person.id] = { ...next[person.id], [selectedDay]: assigned ?? { ...next[person.id][selectedDay], start: "", end: "", position: "", off: true, holiday: false } };
      changed.add(person.id);
    }
    setSchedule(next); setDirty(changed); setMessage(`Horario ideal generado para ${WEEKDAY_LABELS[WEEKDAYS.indexOf(selectedDay)]}. Revisa los conflictos antes de guardar.`);
  }

  function deleteSelectedDaySchedule() {
    const affected = data.staff.filter((person) => {
      const shift = schedule[person.id]?.[selectedDay];
      return Boolean(shift && (shift.start || shift.end || shift.position || shift.off || shift.holiday || shift.notes || shift.splitShift || shift.start2 || shift.end2 || shift.extraHoursPre || shift.extraHoursPost));
    });
    if (!affected.length) {
      setMessage(`El horario seleccionado (${selectedDate}) ya está vacío.`);
      return;
    }
    const dayLabel = WEEKDAY_LABELS[WEEKDAYS.indexOf(selectedDay)];
    if (!window.confirm(`¿Eliminar el horario del ${dayLabel} ${selectedDate} para ${affected.length} colaboradores? Podrás deshacerlo antes de guardar.`)) return;
    rememberCurrentState();
    setSchedule((current) => {
      const next = { ...current };
      for (const person of affected) next[person.id] = { ...next[person.id], [selectedDay]: emptyShift(selectedDate) };
      return next;
    });
    setDirty((current) => new Set([...current, ...affected.map((person) => person.id)]));
    setMessage(`Horario del ${dayLabel} ${selectedDate} eliminado para ${affected.length} colaboradores. Pulsa Deshacer para recuperarlo o Guardar para confirmar.`);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!dirty.size) throw new Error("no_changes");
      for (const staffId of dirty) for (const day of WEEKDAYS) {
        const shift = schedule[staffId][day];
        if (!shift.off && ((shift.start && !shift.end) || (!shift.start && shift.end) || (shift.start && shift.start === shift.end))) throw new Error("invalid_shift");
        if (shift.splitShift && (!shift.start2 || !shift.end2 || shift.start2 === shift.end2)) throw new Error("invalid_split");
      }
      const changes = [...dirty].map((staffId) => ({ staffId, days: WEEKDAYS.map((day) => serializeShift(schedule[staffId][day])) }));
      const result = await createClient().rpc("save_weekly_schedules", { p_week_start: weekStart, p_changes: changes as unknown as Json });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      window.localStorage.removeItem(draftKey);
      setDirty(new Set()); setHistory([]); setMessage("Horario guardado y feriados sincronizados.");
      await queryClient.invalidateQueries({ queryKey: ["weekly-schedule", data.storeId, weekStart] });
    },
  });

  return <section className={`weekly-editor ${leftPanelCollapsed ? "left-panel-collapsed" : ""}`}><div className="weekly-editor-main">
    <header className="weekly-header"><div><p className="eyebrow">PLANIFICACIÓN OPERATIVA</p><h2>Horario semanal</h2><p className="muted">Los cambios se guardan por colaborador en una sola transacción.</p></div><CalendarDays size={30}/></header>
    <div className="weekly-toolbar">
      <label>Semana<input type="date" value={weekStart} onChange={(event) => onWeekChange(event.target.value)}/></label>
      <label>Día<select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value as Weekday)}>{WEEKDAYS.map((day, index) => <option key={day} value={day}>{WEEKDAY_LABELS[index]}</option>)}</select></label>
      <input aria-label="Buscar colaborador" placeholder="Buscar colaborador…" value={search} onChange={(event) => setSearch(event.target.value)}/>
      <select aria-label="Filtrar modalidad" value={modality} onChange={(event) => setModality(event.target.value)}><option>Todos</option><option>Full-Time</option><option>Part-Time</option></select>
      <select aria-label="Filtrar posición" value={position} onChange={(event) => setPosition(event.target.value)}><option>Todas</option>{positions.map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    <div className="weekly-actions"><button className="plain-button" disabled={!history.length || save.isPending} onClick={undoLastChange}><Undo2 size={16}/> Deshacer</button><button className="danger-button" disabled={save.isPending} onClick={deleteSelectedDaySchedule}><Trash2 size={16}/> Eliminar día seleccionado</button><button className="plain-button" onClick={replicatePrevious}><Copy size={16}/> Replicar semana anterior</button><button className="secondary-button" onClick={generateIdeal}><Sparkles size={16}/> Generar día desde proyección</button><button className="primary-button" disabled={save.isPending || !dirty.size} onClick={() => save.mutate()}><Save size={16}/> {save.isPending ? "Guardando…" : `Guardar ${dirty.size || ""}`}</button></div>
    <div className="export-toolbar"><label><input type="checkbox" checked={excludeTrainees} onChange={(event) => setExcludeTrainees(event.target.checked)}/> Excluir personal en entrenamiento</label><label><input type="checkbox" checked={showPositions} onChange={(event) => setShowPositions(event.target.checked)}/> Mostrar posiciones en PDF</label><label>Turno<select value={positionTurn} onChange={(event) => setPositionTurn(event.target.value as typeof positionTurn)}><option value="mañana">Mañana</option><option value="tarde">Tarde</option><option value="ambos">Día completo</option></select></label><button className="plain-button" onClick={() => exportWeeklySchedulePdf(activeWeekStaff, schedule, weekStart, { excludeTrainees, showPositions })}>PDF semanal</button><button className="plain-button" onClick={() => exportPositioningPdf(activeWeekStaff, schedule, selectedDay, selectedDate, positionTurn, positions)}>PDF posiciones</button><button className="plain-button" onClick={() => exportExtraHoursPdf(activeWeekStaff, schedule, weekStart)}>PDF horas extra</button><button className="plain-button" disabled={exportingExcel || !Object.keys(data.shiftMap).length} onClick={async () => { setExportingExcel(true); try { await exportGeoVictoriaExcel(activeWeekStaff, schedule, weekStart, data.shiftMap); } finally { setExportingExcel(false); } }}>{exportingExcel ? "Generando…" : "Excel GeoVictoria"}</button></div>
    {savedDraft && <div className="restriction-banner draft-banner"><AlertTriangle size={17}/><span>Hay un borrador local anterior. Se está mostrando el horario vigente guardado.</span><button className="plain-button" onClick={restoreSavedDraft}>Recuperar borrador</button><button className="plain-button" onClick={discardSavedDraft}>Descartar</button></div>}
    {message && <p className="restriction-banner success"><Check size={17}/>{message}</p>}
    {save.error && <p className="form-alert error">{save.error.message === "no_changes" ? "No hay cambios pendientes." : save.error.message === "invalid_shift" ? "Hay turnos incompletos o con horas iguales." : save.error.message === "invalid_split" ? "Completa correctamente ambos bloques del turno partido." : "El servidor rechazó el guardado por validación o permisos."}</p>}
    <div className="table-scroll"><table className="weekly-table"><thead><tr><th>Colaborador</th><th>Modalidad</th><th>Entrada</th><th>Salida</th><th>Posición</th><th>Extra antes</th><th>Extra después</th><th>Partido</th><th>Libre</th><th>Feriado</th><th>Horas semana</th></tr></thead><tbody>
      {visibleStaff.map((person) => {
        const day = schedule[person.id][selectedDay];
        const endDate = person.is_trainee ? person.training_end_date : person.cessation_date;
        const ceased = Boolean(endDate && selectedDate > endDate);
        const conflicts = shiftConflicts(day, person.study[selectedDay], person.skills);
        const selectedDayIndex = WEEKDAYS.indexOf(selectedDay);
        const previousDay = selectedDayIndex === 0 ? data.previous[person.id]?.sunday : schedule[person.id][WEEKDAYS[selectedDayIndex - 1]];
        const previousDate = addIsoDays(selectedDate, -1);
        const previousLabel = shiftLabel(previousDay);
        const weeklyDetails = WEEKDAYS.map((weekday, index) => ({
          day: WEEKDAY_LABELS[index],
          date: addIsoDays(weekStart, index),
          dateLabel: shortDate(addIsoDays(weekStart, index)),
          work: shiftLabel(schedule[person.id][weekday]),
          study: studyLabel(person.study[weekday]),
        }));
        const tooltipId = `schedule-detail-${person.id}`;
        const requests = data.requests.filter((request) => request.staff_id === person.id && request.requested_date === selectedDate);
        const weeklyTotal = WEEKDAYS.reduce((total, key) => total + shiftMinutes(schedule[person.id][key], effectiveModality(person, schedule[person.id][key].date) === "Full-Time"), 0);
        return <tr key={person.id} className={ceased ? "ceased-row" : dirty.has(person.id) ? "dirty-row" : ""}><td><div className="schedule-tooltip-trigger" tabIndex={0} aria-describedby={tooltipId}><span className="schedule-person-name"><strong>{person.first_name} {person.last_name}</strong><CircleHelp size={14} aria-hidden="true"/></span><small>{person.position}</small><span className="previous-shift-summary">Anterior {previousDate}: {previousLabel}</span><div className="schedule-tooltip weekly" id={tooltipId} role="tooltip"><strong>Semana {shortDate(weekStart)}–{shortDate(addIsoDays(weekStart, 6))}</strong><div className="weekly-tooltip-header"><span>Día</span><span>Trabajo</span><span>Estudios</span></div>{weeklyDetails.map((detail) => <div className="weekly-tooltip-row" key={detail.date}><span><b>{detail.day}</b><small>{detail.dateLabel}</small></span><span>{detail.work}</span><span>{detail.study}</span></div>)}</div></div>{conflicts.map((conflict) => <span className="schedule-alert" key={conflict}><AlertTriangle size={12}/>{conflict}</span>)}{requests.map((request) => <span className="request-alert" key={request.id}>{request.shift_type}{request.start_time ? ` ${clock(request.start_time)}–${clock(request.end_time)}` : ""}{request.reason ? ` · ${request.reason}` : ""}</span>)}{ceased && <span className="schedule-alert">Cesado desde {endDate}</span>}</td><td><span className="status-pill active">{effectiveModality(person, selectedDate)}</span></td>
          <td><input type="time" disabled={ceased || day.off} value={day.start} onChange={(event) => changeShift(person.id, { start: event.target.value, off: false })}/>{day.splitShift && <input type="time" disabled={ceased} value={day.start2} onChange={(event) => changeShift(person.id, { start2: event.target.value })}/>}</td>
          <td><input type="time" disabled={ceased || day.off} value={day.end} onChange={(event) => changeShift(person.id, { end: event.target.value, off: false })}/>{day.splitShift && <input type="time" disabled={ceased} value={day.end2} onChange={(event) => changeShift(person.id, { end2: event.target.value })}/>}</td>
          <td><select disabled={ceased || day.off || day.holiday} value={day.position} onChange={(event) => changeShift(person.id, { position: event.target.value })}><option value="">—</option>{positions.map((item) => <option key={item}>{item}</option>)}</select></td>
          <td><input className="number-input" type="number" min="0" step="0.25" disabled={ceased || day.off} value={day.extraHoursPre} onChange={(event) => changeShift(person.id, { extraHoursPre: Number(event.target.value) })}/></td><td><input className="number-input" type="number" min="0" step="0.25" disabled={ceased || day.off} value={day.extraHoursPost} onChange={(event) => changeShift(person.id, { extraHoursPost: Number(event.target.value) })}/></td>
          <td><input type="checkbox" disabled={ceased || day.off} checked={day.splitShift} onChange={(event) => changeShift(person.id, event.target.checked ? { splitShift: true, off: false, holiday: false } : { splitShift: false, start2: "", end2: "" })}/></td><td><input type="checkbox" disabled={ceased} checked={day.off} onChange={(event) => toggleOff(person, event.target.checked)}/></td><td><input type="checkbox" disabled={ceased} checked={day.holiday} onChange={(event) => toggleHoliday(person, event.target.checked)}/>{data.holidays[selectedDate] && <small>{data.holidays[selectedDate]}</small>}</td><td><strong>{Math.floor(weeklyTotal / 60)}:{String(weeklyTotal % 60).padStart(2, "0")}</strong></td></tr>;
      })}
    </tbody></table></div></div>
    <ScheduleCoverageMatrix positions={positions} matrix={projection.matrix} assignments={coverageAssignments} leftPanelCollapsed={leftPanelCollapsed} onToggleLeftPanel={() => setLeftPanelCollapsed((current) => !current)}/>
  </section>;
}
