import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

const IMPORT_ENABLED = false;
const TOKEN_SHA256 = "482f8e23fb4b378dc27930a59477c53698cd263d9d6a4c19725b7eb11420b33e";
const EXPIRES_AT = Date.parse("2026-07-13T07:00:00.000Z");
const MAX_ROWS = 200;

const TABLES: Record<string, string> = {
  stores: "id",
  staff_profiles: "id",
  user_profiles: "id",
  staff_skills: "staff_id,skill_code",
  store_positions: "store_id,code",
  store_positioning_requirements: "store_id,requirement_key",
  schedule_weeks: "staff_id,week_start",
  study_schedule_days: "staff_id,weekday",
  worked_holidays: "firestore_id",
  extra_hours: "firestore_id",
  cessations: "firestore_id",
  schedule_requests: "firestore_id",
  training_evaluations: "firestore_id",
  store_configs: "store_id,config_key",
  sales_month_configs: "store_id,month_start",
  sales_daily_history: "store_id,sales_date",
  sales_projection_templates: "store_id",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (!IMPORT_ENABLED || Date.now() >= EXPIRES_AT) return json(410, { error: "migration_closed" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const token = request.headers.get("x-migration-token") ?? "";
  if (!token || await sha256(token) !== TOKEN_SHA256) return json(401, { error: "unauthorized" });

  const body = await request.json().catch(() => null);
  if (!body || body.operation !== "upsert_public_rows" || !Array.isArray(body.rows) || body.rows.length > MAX_ROWS) {
    return json(400, { error: "invalid_payload" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "missing_server_configuration" });
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let rows = body.rows.map((row: Record<string, unknown>) => ({ ...row }));
  let table = body.table;
  let onConflict = TABLES[table];

  if (table === "schedule_shifts") {
    const sourceIds = [...new Set(rows.map((row) => String(row.schedule_week_key).replace(/^schedule:/, "")))];
    const parents = await supabase.from("schedule_weeks").select("id,firestore_id").in("firestore_id", sourceIds);
    if (parents.error) return json(400, { error: parents.error.message });
    const parentMap = new Map(parents.data.map((parent) => [parent.firestore_id, parent.id]));
    rows = rows.map(({ schedule_week_key, ...row }) => ({ ...row, schedule_week_id: parentMap.get(String(schedule_week_key).replace(/^schedule:/, "")) }));
    table = "schedule_shifts";
    onConflict = "schedule_week_id,work_date";
  } else if (table === "study_schedule_blocks") {
    const staffIds = [...new Set(rows.map((row) => String(row.staff_id)))];
    const parents = await supabase.from("study_schedule_days").select("id,staff_id,weekday").in("staff_id", staffIds);
    if (parents.error) return json(400, { error: parents.error.message });
    const parentMap = new Map(parents.data.map((parent) => [`${parent.staff_id}:${parent.weekday}`, parent.id]));
    rows = rows.map(({ study_day_key: _key, staff_id, weekday, ...row }) => ({ ...row, study_day_id: parentMap.get(`${staff_id}:${weekday}`) }));
    table = "study_schedule_blocks";
    onConflict = "study_day_id,start_time,end_time";
  } else if (table === "sales_hourly_history") {
    const storeIds = [...new Set(rows.map((row) => String(row.store_id)))];
    const parents = await supabase.from("sales_daily_history").select("id,store_id,sales_date").in("store_id", storeIds);
    if (parents.error) return json(400, { error: parents.error.message });
    const parentMap = new Map(parents.data.map((parent) => [`${parent.store_id}:${parent.sales_date}`, parent.id]));
    rows = rows.map(({ sales_daily_key: _key, ...row }) => ({ ...row, sales_daily_id: parentMap.get(`${row.store_id}:${row.sales_date}`) }));
    table = "sales_hourly_history";
    onConflict = "store_id,sales_date,sales_hour";
  } else if (onConflict) {
    rows = rows.map(({ migration_key: _migrationKey, ...row }) => row);
  } else {
    return json(400, { error: "table_not_allowed" });
  }

  if (rows.some((row) => Object.values(row).some((value) => value === undefined))) return json(400, { error: "unresolved_reference" });
  const result = await supabase.from(table).upsert(rows, {
    onConflict,
    ignoreDuplicates: false,
    defaultToNull: false,
  });
  if (result.error) return json(400, { error: result.error.message });
  return json(200, { table, processed: rows.length });
});
