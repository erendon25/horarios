import { supabase } from "./client";

export const db = Object.freeze({ kind: "supabase-database" });
export const getFirestore = () => db;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const ROOT_TABLE = {
  users: "user_profiles",
  staff_profiles: "staff_profiles",
  stores: "stores",
  feriados_trabajados: "worked_holidays",
  extra_hours: "extra_hours",
  ceses: "cessations",
  schedule_requests: "schedule_requests",
  training_evaluations: "training_evaluations",
};

const isoDate = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value?.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  return null;
};
const clock = (value) => (typeof value === "string" ? value.slice(0, 5) : null);
const addDays = (date, count) => {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
};
const weekKey = (start) => `${start}_to_${addDays(start, 6)}`;
const legacy = (row) => row?.legacy_data && typeof row.legacy_data === "object" ? row.legacy_data : {};

const unwrapSpecialValues = (next, previous = {}) => Object.fromEntries(
  Object.entries(next ?? {}).map(([key, value]) => {
    if (value?.__supabaseCompat === "serverTimestamp") return [key, new Date().toISOString()];
    if (value?.__supabaseCompat === "arrayUnion") {
      const current = Array.isArray(previous[key]) ? previous[key] : [];
      return [key, [...current, ...value.values.filter((item) => !current.some((old) => JSON.stringify(old) === JSON.stringify(item)))]];
    }
    return [key, value];
  }),
);

const mapStaff = (row) => ({
  ...legacy(row),
  uid: row.user_id,
  storeId: row.store_id,
  name: row.first_name,
  lastName: row.last_name,
  email: row.email,
  dni: row.dni,
  gender: row.gender,
  birthDate: row.birth_date,
  modality: row.modality,
  position: row.position,
  status: row.status,
  joinDate: row.join_date,
  cessationDate: row.cessation_date ?? "",
  sanitaryCardExpiry: row.sanitary_card_expiry,
  sanitaryCardUnlock: row.sanitary_card_unlock,
  isTrainee: row.is_trainee,
  trainingEndDate: row.training_end_date,
  modalityChangeDate: row.modality_change_date,
  nextModality: row.next_modality,
  needsCompletion: row.needs_completion,
  holidayBalance: row.holiday_balance,
  lastEvaluationDate: row.last_evaluation_date,
  lastEvaluationScore: row.last_evaluation_score,
  lastStationEvaluated: row.last_station_evaluated,
  trainingScores: row.training_scores ?? {},
  skills: row.position_abilities ?? [],
  positionAbilities: row.position_abilities ?? [],
  pendingHolidays: row.pending_holidays ?? [],
  linkedAt: row.linked_at,
});

const mapUser = (row) => ({
  ...legacy(row),
  email: row.email,
  role: row.role,
  storeId: row.store_id,
  staffProfileId: row.staff_profile_id,
  name: row.first_name,
  lastName: row.last_name,
  status: row.status,
  registrationPending: row.registration_pending,
  createdAt: row.created_at,
});

const mapStore = (row) => ({
  ...legacy(row),
  name: row.name,
  city: row.city,
  ciudad: row.city,
  address: row.address,
  direccion: row.address,
  active: row.is_active,
  isActive: row.is_active,
  createdAt: row.created_at,
});

const mapSchedule = (row) => {
  const result = {
    ...legacy(row),
    uid: row.staff?.user_id ?? null,
    staffId: row.staff_id,
    storeId: row.store_id,
    weekKey: weekKey(row.week_start),
  };
  for (const shift of row.schedule_shifts ?? []) {
    const index = Math.round((new Date(`${shift.work_date}T12:00:00Z`) - new Date(`${row.week_start}T12:00:00Z`)) / 86400000);
    if (index < 0 || index > 6) continue;
    const metadata = shift.metadata && typeof shift.metadata === "object" ? shift.metadata : {};
    result[WEEKDAYS[index]] = {
      ...metadata,
      start: clock(shift.start_time) ?? metadata.start ?? "",
      end: clock(shift.end_time) ?? metadata.end ?? "",
      position: shift.position ?? metadata.position ?? "",
      off: shift.is_day_off,
      feriado: shift.is_holiday,
      holiday: shift.is_holiday,
      notes: shift.notes ?? metadata.notes ?? "",
    };
  }
  return result;
};

const mapStudy = (row) => {
  const result = { uid: row.staff?.user_id ?? null, staffId: row.staff_id };
  for (const day of row.days ?? []) {
    result[WEEKDAYS[day.weekday]] = {
      free: day.requests_day_off,
      blocks: (day.study_schedule_blocks ?? []).map((block) => ({
        ...(block.metadata && typeof block.metadata === "object" ? block.metadata : {}),
        start: clock(block.start_time),
        end: clock(block.end_time),
      })),
    };
  }
  return result;
};

const mappers = {
  users: mapUser,
  staff_profiles: mapStaff,
  stores: mapStore,
  feriados_trabajados: (row) => ({ ...legacy(row), uid: row.user_id, staffId: row.staff_id, storeId: row.store_id, date: row.holiday_date, name: row.name, type: row.balance_type, createdAt: row.created_at }),
  extra_hours: (row) => ({ ...legacy(row), uid: row.user_id, staffId: row.staff_id, storeId: row.store_id, fecha: row.work_date, inicio: clock(row.start_time), fin: clock(row.end_time), duracion: row.duration_minutes, durationMinutes: row.duration_minutes, extraMinutesPre: row.pre_shift_minutes, extraMinutesPost: row.post_shift_minutes, actividad: row.activity, source: row.source, sourceFile: row.source_file, importedAt: row.imported_at, segments: row.segments ?? [], dailyDetails: row.daily_details ?? [] }),
  ceses: (row) => ({ ...legacy(row), staffId: row.staff_id, storeId: row.store_id, joinDate: row.join_date, cessationDate: row.cessation_date, modality: row.previous_modality, nextModality: row.next_modality, isModalityChange: row.is_modality_change, desempenio: row.performance, motivoCese: row.cessation_reason, motivoReal: row.real_reason, comentario: row.store_comment, diasDescansoMedico: row.medical_leave_days, inasistencias: row.absences, tardanzas: row.tardiness, horasNocturnas: row.night_hours, horasExtras: row.extra_hours, feriados: row.holidays, descuentos: row.discounts, registeredAt: row.registered_at, lastUpdated: row.updated_at }),
  schedule_requests: (row) => ({ ...legacy(row), uid: row.user_id, staffId: row.staff_id, storeId: row.store_id, date: row.requested_date, shiftType: row.shift_type, startTime: clock(row.start_time), endTime: clock(row.end_time), reason: row.reason, status: row.status, adminComment: row.admin_comment, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, createdAt: row.created_at }),
  training_evaluations: (row) => ({ ...legacy(row), collaboratorId: row.staff_id, trainerId: row.trainer_id, storeId: row.store_id, date: row.evaluation_date, area: row.area, station: row.station_code, stationName: row.station_name, score: row.score, responses: row.responses ?? {}, feedback: row.feedback ?? {}, generalFindings: row.general_findings, status: row.status, step: row.current_step, collabSignature: row.collaborator_signature_url ?? row.collaborator_signature_path, trainerSignature: row.trainer_signature_url ?? row.trainer_signature_path, isEdited: row.is_edited, timestamp: row.created_at, lastUpdated: row.updated_at }),
};

const pathOf = (parts) => parts.filter((part) => part !== db && part != null).flatMap((part) => part?.path ?? String(part)).join("/");
export const collection = (...parts) => ({ kind: "collection", path: pathOf(parts) });
export const doc = (...parts) => {
  if (parts.length === 1 && parts[0]?.kind === "collection") return { kind: "doc", path: `${parts[0].path}/${crypto.randomUUID()}` };
  return { kind: "doc", path: pathOf(parts) };
};
export const where = (field, operator, value) => ({ kind: "where", field, operator, value });
export const orderBy = (field, direction = "asc") => ({ kind: "orderBy", field, direction });
export const limit = (count) => ({ kind: "limit", count });
export const query = (ref, ...constraints) => ({ ...ref, constraints: [...(ref.constraints ?? []), ...constraints] });
export const serverTimestamp = () => ({ __supabaseCompat: "serverTimestamp" });
export const arrayUnion = (...values) => ({ __supabaseCompat: "arrayUnion", values });

class DocumentSnapshot {
  constructor(ref, id, value) { this.ref = ref; this.id = String(id); this._value = value; }
  exists() { return this._value !== undefined && this._value !== null; }
  data() { return this._value; }
}
class QuerySnapshot {
  constructor(docs) { this.docs = docs; this.empty = docs.length === 0; this.size = docs.length; }
  forEach(callback) { this.docs.forEach(callback); }
}

const throwIfError = (error) => {
  if (!error) return;
  const next = new Error(error.message);
  next.code = error.code === "42501" ? "permission-denied" : error.code;
  throw next;
};

const applyConstraints = (items, constraints = []) => {
  let result = items;
  for (const constraint of constraints) {
    if (constraint.kind === "where") {
      result = result.filter(({ id, data }) => {
        const actual = constraint.field === "__name__" ? id : data?.[constraint.field];
        if (constraint.operator === "==") return actual === constraint.value;
        if (constraint.operator === "in") return constraint.value.includes(actual);
        if (constraint.operator === ">=") return actual >= constraint.value;
        if (constraint.operator === "<=") return actual <= constraint.value;
        if (constraint.operator === ">") return actual > constraint.value;
        if (constraint.operator === "<") return actual < constraint.value;
        if (constraint.operator === "array-contains") return Array.isArray(actual) && actual.includes(constraint.value);
        return false;
      });
    } else if (constraint.kind === "orderBy") {
      result = [...result].sort((a, b) => {
        const left = constraint.field === "__name__" ? a.id : a.data?.[constraint.field];
        const right = constraint.field === "__name__" ? b.id : b.data?.[constraint.field];
        const comparison = left === right ? 0 : left == null ? -1 : right == null ? 1 : left < right ? -1 : 1;
        return constraint.direction === "desc" ? -comparison : comparison;
      });
    } else if (constraint.kind === "limit") result = result.slice(0, constraint.count);
  }
  return result;
};

async function fetchRows(ref) {
  const segments = ref.path.split("/");
  const root = segments[0];
  let rows = [];
  let map = mappers[root] ?? ((row) => ({ ...legacy(row), ...row }));

  if (root === "schedules") {
    const storeFilter = ref.constraints?.find((item) => item.kind === "where" && item.field === "storeId" && item.operator === "==")?.value;
    const weekFilter = ref.constraints?.find((item) => item.kind === "where" && item.field === "weekKey" && item.operator === "==")?.value;
    let scheduleQuery = supabase.from("schedule_weeks").select("*,staff:staff_profiles(user_id),schedule_shifts(*)");
    if (storeFilter) scheduleQuery = scheduleQuery.eq("store_id", storeFilter);
    if (weekFilter) scheduleQuery = scheduleQuery.eq("week_start", isoDate(weekFilter));
    const result = await scheduleQuery;
    throwIfError(result.error); rows = result.data ?? []; map = mapSchedule;
  } else if (root === "study_schedules") {
    const daysResult = await supabase.from("study_schedule_days").select("*,study_schedule_blocks(*)");
    throwIfError(daysResult.error);
    const staffResult = await supabase.from("staff_profiles").select("id,user_id");
    throwIfError(staffResult.error);
    const staffById = new Map((staffResult.data ?? []).map((staff) => [staff.id, staff]));
    const grouped = (daysResult.data ?? []).reduce((result, day) => {
      const days = result.get(day.staff_id) ?? [];
      days.push(day);
      result.set(day.staff_id, days);
      return result;
    }, new Map());
    rows = [...grouped].map(([staffId, days]) => ({ staff_id: staffId, staff: staffById.get(staffId), days }));
    map = mapStudy;
  } else if (root === "nocturnidad") {
    rows = [];
  } else if (segments[0] === "stores" && segments[2] === "config") {
    const result = await supabase.from("store_configs").select("*").eq("store_id", segments[1]);
    throwIfError(result.error); rows = result.data ?? []; map = (row) => row.value ?? {};
  } else if (segments[0] === "stores" && segments[2] === "positioning_requirements") {
    const result = await supabase.from("store_positioning_requirements").select("*").eq("store_id", segments[1]);
    throwIfError(result.error); rows = result.data ?? []; map = (row) => row.requirements ?? {};
  } else if (root === "positioning_requirements") {
    const result = await supabase.from("store_positioning_requirements").select("*");
    throwIfError(result.error); rows = result.data ?? []; map = (row) => row.requirements ?? {};
  } else if (segments[0] === "stores" && segments[2] === "sales_config") {
    const result = await supabase.from("sales_month_configs").select("*").eq("store_id", segments[1]);
    throwIfError(result.error); rows = result.data ?? []; map = (row) => ({ monthlyData: row.monthly_data ?? {}, dailyHourlyParts: row.daily_hourly_parts ?? {}, realSalesData: row.real_sales_data ?? {}, hourlyParticipation: row.real_sales_data?.hourlyParticipation ?? null });
  } else if (segments[0] === "stores" && segments[2] === "sales_history") {
    const result = await supabase.from("sales_daily_history").select("*").eq("store_id", segments[1]);
    throwIfError(result.error); rows = result.data ?? []; map = (row) => ({ ...legacy(row), totalSales: row.sales_amount, totalTxs: row.transactions, hourlyData: row.hourly_data ?? {}, date: row.sales_date });
  } else {
    const table = ROOT_TABLE[root];
    if (!table) throw new Error(`Colección no migrada a Supabase: ${ref.path}`);
    const result = await supabase.from(table).select("*");
    throwIfError(result.error); rows = result.data ?? [];
    if (root === "training_evaluations") {
      const paths = [...new Set(rows.flatMap((row) => [row.collaborator_signature_path, row.trainer_signature_path]).filter(Boolean))];
      if (paths.length) {
        const signed = await supabase.storage.from("training-signatures").createSignedUrls(paths, 3600);
        if (!signed.error) {
          const urls = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
          rows = rows.map((row) => ({
            ...row,
            collaborator_signature_url: urls.get(row.collaborator_signature_path),
            trainer_signature_url: urls.get(row.trainer_signature_path),
          }));
        }
      }
    }
  }

  const items = rows.map((row) => {
    let id = row.id ?? row.firestore_id;
    if (root === "schedules") id = `${row.staff_id}_${weekKey(row.week_start)}`;
    else if (root === "study_schedules") id = row.staff?.user_id ?? row.staff_id;
    else if (segments[2] === "config") id = row.config_key;
    else if (segments[2] === "positioning_requirements" || root === "positioning_requirements") id = row.requirement_key;
    else if (segments[2] === "sales_config") id = row.month_start?.slice(0, 7);
    else if (segments[2] === "sales_history") id = row.sales_date;
    return { id: String(id), data: map(row), row };
  });
  return applyConstraints(items, ref.constraints);
}

export async function getDocs(ref) {
  const items = await fetchRows(ref);
  return new QuerySnapshot(items.map((item) => new DocumentSnapshot(doc(ref, item.id), item.id, item.data)));
}

export async function getDoc(ref) {
  const segments = ref.path.split("/");
  const id = segments.at(-1);
  if (segments[0] === "schedules") {
    const match = id.match(/^(.*?)_(\d{4}-\d{2}-\d{2})_to_\d{4}-\d{2}-\d{2}$/);
    if (match) {
      const result = await supabase
        .from("schedule_weeks")
        .select("*,staff:staff_profiles(user_id),schedule_shifts(*)")
        .eq("staff_id", match[1])
        .eq("week_start", match[2])
        .maybeSingle();
      throwIfError(result.error);
      return new DocumentSnapshot(ref, id, result.data ? mapSchedule(result.data) : undefined);
    }
  }
  if (segments[0] === "study_schedules") {
    const staff = await supabase.from("staff_profiles").select("id,user_id").or(`id.eq.${id},user_id.eq.${id}`).maybeSingle();
    throwIfError(staff.error);
    if (!staff.data) return new DocumentSnapshot(ref, id, undefined);
    const days = await supabase.from("study_schedule_days").select("*,study_schedule_blocks(*)").eq("staff_id", staff.data.id);
    throwIfError(days.error);
    return new DocumentSnapshot(ref, id, mapStudy({ staff_id: staff.data.id, staff: staff.data, days: days.data ?? [] }));
  }
  const parent = { kind: "collection", path: segments.slice(0, -1).join("/") };
  const items = await fetchRows(parent);
  const item = items.find((candidate) => candidate.id === id || String(candidate.row?.firestore_id) === id);
  return new DocumentSnapshot(ref, id, item?.data);
}

const oldToColumns = {
  users: { email: "email", role: "role", storeId: "store_id", staffProfileId: "staff_profile_id", name: "first_name", lastName: "last_name", status: "status", registrationPending: "registration_pending", createdAt: "created_at" },
  staff_profiles: { uid: "user_id", storeId: "store_id", name: "first_name", lastName: "last_name", email: "email", dni: "dni", gender: "gender", birthDate: "birth_date", modality: "modality", position: "position", status: "status", joinDate: "join_date", cessationDate: "cessation_date", sanitaryCardExpiry: "sanitary_card_expiry", sanitaryCardUnlock: "sanitary_card_unlock", isTrainee: "is_trainee", trainingEndDate: "training_end_date", modalityChangeDate: "modality_change_date", nextModality: "next_modality", needsCompletion: "needs_completion", holidayBalance: "holiday_balance", lastEvaluationDate: "last_evaluation_date", lastEvaluationScore: "last_evaluation_score", lastStationEvaluated: "last_station_evaluated", trainingScores: "training_scores", skills: "position_abilities", positionAbilities: "position_abilities", pendingHolidays: "pending_holidays", linkedAt: "linked_at" },
  stores: { name: "name", city: "city", ciudad: "city", address: "address", direccion: "address", active: "is_active", isActive: "is_active", createdAt: "created_at" },
  feriados_trabajados: { uid: "user_id", staffId: "staff_id", storeId: "store_id", date: "holiday_date", name: "name", type: "balance_type", createdAt: "created_at" },
  extra_hours: { uid: "user_id", staffId: "staff_id", storeId: "store_id", fecha: "work_date", periodStart: "work_date", inicio: "start_time", entrada: "start_time", fin: "end_time", salida: "end_time", durationMinutes: "duration_minutes", duracion: "duration_minutes", extraMinutesPre: "pre_shift_minutes", extraMinutesPost: "post_shift_minutes", actividad: "activity", source: "source", sourceFile: "source_file", importedAt: "imported_at", segments: "segments", dailyDetails: "daily_details" },
  ceses: { staffId: "staff_id", storeId: "store_id", joinDate: "join_date", cessationDate: "cessation_date", modality: "previous_modality", nextModality: "next_modality", isModalityChange: "is_modality_change", desempenio: "performance", motivoCese: "cessation_reason", motivoReal: "real_reason", comentario: "store_comment", diasDescansoMedico: "medical_leave_days", inasistencias: "absences", tardanzas: "tardiness", horasNocturnas: "night_hours", horasExtras: "extra_hours", feriados: "holidays", descuentos: "discounts", registeredAt: "registered_at", lastUpdated: "updated_at" },
  schedule_requests: { uid: "user_id", staffId: "staff_id", storeId: "store_id", date: "requested_date", shiftType: "shift_type", startTime: "start_time", endTime: "end_time", reason: "reason", status: "status", adminComment: "admin_comment", reviewedBy: "reviewed_by", reviewedAt: "reviewed_at", createdAt: "created_at" },
  training_evaluations: { collaboratorId: "staff_id", trainerId: "trainer_id", storeId: "store_id", date: "evaluation_date", area: "area", station: "station_code", stationName: "station_name", score: "score", responses: "responses", feedback: "feedback", generalFindings: "general_findings", status: "status", step: "current_step", collabSignature: "collaborator_signature_path", trainerSignature: "trainer_signature_path", isEdited: "is_edited", timestamp: "created_at", lastUpdated: "updated_at" },
};

function columnsFor(root, data, previous = {}) {
  const clean = unwrapSpecialValues(data, previous);
  const mapping = oldToColumns[root] ?? {};
  const columns = {};
  const unhandled = {};
  for (const [key, value] of Object.entries(clean)) {
    if (key.startsWith("trainingScores.")) {
      const station = key.slice("trainingScores.".length);
      columns.training_scores = { ...(previous.trainingScores ?? {}), [station]: value };
      continue;
    }
    const column = mapping[key];
    if (column && ["collaborator_signature_path", "trainer_signature_path"].includes(column) && typeof value === "string" && /^https?:/.test(value)) continue;
    if (column) columns[column] = value === "" && ["cessation_date", "join_date", "birth_date", "training_end_date", "modality_change_date", "next_modality", "sanitary_card_expiry", "sanitary_card_unlock", "last_evaluation_date", "last_station_evaluated"].includes(column) ? null : value;
    else if (key !== "id" && key !== "firestore_path") unhandled[key] = value;
  }
  if (Object.keys(unhandled).length) columns.legacy_data = { ...(previous ?? {}), ...unhandled };
  return columns;
}

const SCHEDULE_NUMERIC_FIELDS = new Set(["extraHours", "extraHoursPre", "extraHoursPost", "extraMinutes", "extraMinutesPre", "extraMinutesPost"]);
const sanitizeScheduleMetadata = (metadata) => {
  const out = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (SCHEDULE_NUMERIC_FIELDS.has(key)) {
      if (value === "" || value === null || value === undefined) continue;
      const num = Number(value);
      out[key] = Number.isFinite(num) ? num : null;
    } else {
      out[key] = value;
    }
  }
  return out;
};

async function saveSchedule(ref, data) {
  const match = ref.path.split("/").at(-1).match(/^(.*?)_(\d{4}-\d{2}-\d{2})_to_\d{4}-\d{2}-\d{2}$/);
  const staffId = data.staffId ?? match?.[1];
  const start = isoDate(data.weekKey) ?? match?.[2];
  if (!staffId || !start) throw new Error("Horario sin colaborador o semana válida.");
  const days = WEEKDAYS.map((day, index) => {
    const shift = data[day] ?? {};
    const { start: shiftStart = "", end = "", position = "", off = false, feriado = false, holiday = false, notes = "", ...metadata } = shift;
    return { date: addDays(start, index), start: shiftStart, end, position, off: Boolean(off), holiday: Boolean(feriado || holiday), notes, metadata: sanitizeScheduleMetadata(metadata) };
  });
  const result = await supabase.rpc("save_weekly_schedules", { p_week_start: start, p_changes: [{ staffId, days }] });
  throwIfError(result.error);
}

async function saveStudy(ref, data) {
  let staffId = data.staffId;
  if (!staffId) {
    const id = ref.path.split("/").at(-1);
    const result = await supabase.from("staff_profiles").select("id").or(`id.eq.${id},user_id.eq.${id}`).maybeSingle();
    throwIfError(result.error); staffId = result.data?.id;
  }
  if (!staffId) throw new Error("No se encontró el colaborador del horario de estudios.");
  const schedule = Object.fromEntries(WEEKDAYS.map((day) => [day, {
    free: Boolean(data[day]?.free),
    blocks: (data[day]?.blocks ?? []).map((block) => ({ start: block.start ?? block.startTime, end: block.end ?? block.endTime })),
  }]));
  const result = await supabase.rpc("save_study_schedule", { p_staff_id: staffId, p_schedule: schedule });
  throwIfError(result.error);
}

async function persist(ref, data, merge) {
  const segments = ref.path.split("/");
  const root = segments[0];
  const id = segments.at(-1);
  if (root === "schedules") return saveSchedule(ref, data);
  if (root === "study_schedules") return saveStudy(ref, data);
  if (segments[0] === "stores" && segments[2] === "config") {
    const result = await supabase.from("store_configs").upsert({ store_id: segments[1], config_key: id, value: data }, { onConflict: "store_id,config_key" });
    return throwIfError(result.error);
  }
  if (segments[0] === "stores" && segments[2] === "positioning_requirements") {
    const result = await supabase.from("store_positioning_requirements").upsert({ store_id: segments[1], requirement_key: id, requirements: data }, { onConflict: "store_id,requirement_key" });
    return throwIfError(result.error);
  }
  if (segments[0] === "stores" && segments[2] === "sales_config") {
    const result = await supabase.from("sales_month_configs").upsert({ store_id: segments[1], month_start: `${id}-01`, monthly_data: data.monthlyData ?? {}, daily_hourly_parts: data.dailyHourlyParts ?? {}, real_sales_data: { ...(data.realSalesData ?? {}), hourlyParticipation: data.hourlyParticipation ?? data.realSalesData?.hourlyParticipation ?? null } }, { onConflict: "store_id,month_start" });
    return throwIfError(result.error);
  }
  if (segments[0] === "stores" && segments[2] === "sales_history") {
    const result = await supabase.from("sales_daily_history").upsert({ store_id: segments[1], sales_date: id, sales_amount: data.totalSales ?? null, transactions: data.totalTxs ?? null, hourly_data: data.hourlyData ?? {}, source_data: data }, { onConflict: "store_id,sales_date" });
    return throwIfError(result.error);
  }
  const table = ROOT_TABLE[root];
  if (!table) throw new Error(`Escritura no migrada a Supabase: ${ref.path}`);
  const previousSnap = merge ? await getDoc(ref) : null;
  const previous = previousSnap?.data() ?? {};
  if (root === "staff_profiles" && merge) {
    const session = await supabase.auth.getSession();
    const isOwner = previous.uid && previous.uid === session.data.session?.user?.id;
    const selfKeys = Object.keys(data).filter((key) => !["id"].includes(key));
    const allowedSelfKeys = new Set(["birthDate", "skills", "positionAbilities", "pendingHolidays"]);
    if (isOwner && selfKeys.every((key) => allowedSelfKeys.has(key))) {
      const abilities = data.skills ?? data.positionAbilities;
      const result = await supabase.rpc("update_own_staff_profile", {
        p_birth_date: data.birthDate ?? null,
        p_position_abilities: abilities ?? null,
        p_pending_holidays: data.pendingHolidays ?? null,
      });
      throwIfError(result.error);
      return id;
    }
  }
  let prepared = merge ? { ...previous, ...data } : { ...data };
  if (["extra_hours", "feriados_trabajados", "schedule_requests"].includes(root) && prepared.uid && (!prepared.staffId || !prepared.storeId)) {
    const owner = await supabase.from("staff_profiles").select("id,store_id").eq("user_id", prepared.uid).maybeSingle();
    throwIfError(owner.error);
    if (owner.data) prepared = { ...prepared, staffId: prepared.staffId ?? owner.data.id, storeId: prepared.storeId ?? owner.data.store_id };
  }
  if (root === "extra_hours") {
    const toMinutes = (start, end) => {
      if (!start || !end) return 0;
      const [startHour, startMinute] = start.split(":").map(Number);
      const [endHour, endMinute] = end.split(":").map(Number);
      let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
      if (minutes < 0) minutes += 1440;
      return minutes;
    };
    prepared.durationMinutes = Number.isFinite(Number(prepared.durationMinutes))
      ? Number(prepared.durationMinutes)
      : toMinutes(prepared.inicio ?? prepared.entrada, prepared.fin ?? prepared.salida);
    delete prepared.duracion;
  }
  if (root === "training_evaluations") {
    for (const [field, suffix] of [["collabSignature", "collaborator"], ["trainerSignature", "trainer"]]) {
      const value = prepared[field];
      if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) continue;
      const blob = await (await fetch(value)).blob();
      const path = `${prepared.storeId}/${prepared.collaboratorId}/${Date.now()}-${suffix}.png`;
      const upload = await supabase.storage.from("training-signatures").upload(path, blob, { contentType: "image/png", upsert: false });
      throwIfError(upload.error);
      prepared[field] = path;
    }
  }
  const columns = columnsFor(root, prepared, legacy(previous));
  if (["staff_profiles", "stores"].includes(root)) columns.id = id;
  else if (root === "users") columns.id = id;
  else if (!/^\d+$/.test(id)) columns.firestore_id = id;
  const entityWithUuid = ["staff_profiles", "stores", "users"].includes(root);
  let result;
  if (root === "users") {
    result = await supabase.from(table).update(columns).eq("id", id).select("id").single();
  } else if (!entityWithUuid && /^\d+$/.test(id)) {
    result = await supabase.from(table).update(columns).eq("id", Number(id)).select("id").single();
  } else if (!entityWithUuid) {
    result = await supabase.from(table).upsert(columns, { onConflict: "firestore_id" }).select("id").single();
  } else {
    result = await supabase.from(table).upsert(columns).select("id").single();
  }
  throwIfError(result.error);
  return result.data?.id ?? id;
}

export const setDoc = (ref, data, options = {}) => persist(ref, data, Boolean(options.merge));
export async function updateDoc(ref, data) {
  const current = await getDoc(ref);
  if (!current.exists()) throw new Error(`Documento no encontrado: ${ref.path}`);
  return persist(ref, unwrapSpecialValues(data, current.data()), true);
}
export async function addDoc(ref, data) {
  const target = doc(ref);
  const persistedId = await persist(target, data, false);
  return doc(ref, String(persistedId));
}
export async function deleteDoc(ref) {
  const segments = ref.path.split("/");
  const root = segments[0];
  const id = segments.at(-1);
  if (root === "study_schedules") return saveStudy(ref, {});
  const table = ROOT_TABLE[root];
  if (!table) throw new Error(`Eliminación no migrada a Supabase: ${ref.path}`);
  const entityWithUuid = ["staff_profiles", "stores", "users"].includes(root);
  const result = entityWithUuid
    ? await supabase.from(table).delete().eq("id", id)
    : /^\d+$/.test(id)
      ? await supabase.from(table).delete().eq("id", Number(id))
      : await supabase.from(table).delete().eq("firestore_id", id);
  throwIfError(result.error);
}

export function onSnapshot(ref, onNext, onError) {
  let active = true;
  const emit = async () => {
    try {
      const snapshot = ref.kind === "doc" ? await getDoc(ref) : await getDocs(ref);
      if (active) onNext(snapshot);
    } catch (error) { if (active && onError) onError(error); }
  };
  emit();
  const root = ref.path.split("/")[0];
  const table = ROOT_TABLE[root] ?? (root === "schedules" ? "schedule_weeks" : root === "study_schedules" ? "study_schedule_days" : null);
  const channel = table ? supabase.channel(`legacy:${ref.path}:${crypto.randomUUID()}`).on("postgres_changes", { event: "*", schema: "public", table }, emit).subscribe() : null;
  return () => { active = false; if (channel) supabase.removeChannel(channel); };
}

export function writeBatch() {
  const operations = [];
  return {
    set: (ref, data, options) => operations.push(() => setDoc(ref, data, options)),
    update: (ref, data) => operations.push(() => updateDoc(ref, data)),
    delete: (ref) => operations.push(() => deleteDoc(ref)),
    commit: async () => { for (const operation of operations) await operation(); },
  };
}

export default db;
