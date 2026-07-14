import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

const IMPORT_ENABLED = false;
const TOKEN_SHA256 = "482f8e23fb4b378dc27930a59477c53698cd263d9d6a4c19725b7eb11420b33e";
const EXPIRES_AT = Date.parse("2026-07-13T07:00:00.000Z");
const ALLOWED_ROLES = new Set(["superadmin", "admin", "trainer", "collaborator"]);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (!IMPORT_ENABLED || Date.now() >= EXPIRES_AT) return json(410, { error: "migration_closed" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const token = request.headers.get("x-migration-token") ?? "";
  if (!token || await sha256(token) !== TOKEN_SHA256) return json(401, { error: "unauthorized" });

  const body = await request.json().catch(() => null);
  if (!body || body.operation !== "import_auth_users" || !Array.isArray(body.users) || body.users.length > 25) {
    return json(400, { error: "invalid_payload" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "missing_server_configuration" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let created = 0;
  let existing = 0;
  const errors: Array<{ index: number; message: string }> = [];

  for (let index = 0; index < body.users.length; index += 1) {
    const user = body.users[index];
    const role = user?.app_metadata?.role;
    if (!user?.id || !user?.email || !ALLOWED_ROLES.has(role)) {
      errors.push({ index, message: "invalid_user" });
      continue;
    }

    const current = await supabase.auth.admin.getUserById(user.id);
    if (current.data.user) {
      const update = await supabase.auth.admin.updateUserById(user.id, {
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata ?? {},
      });
      if (update.error) errors.push({ index, message: update.error.message });
      else existing += 1;
      continue;
    }

    const result = await supabase.auth.admin.createUser({
      id: user.id,
      email: user.email,
      email_confirm: true,
      app_metadata: user.app_metadata,
      user_metadata: {
        ...(user.user_metadata ?? {}),
        firebase_email_verified: Boolean(user.email_verified),
        migrated_from_firebase: true,
      },
    });
    if (result.error) errors.push({ index, message: result.error.message });
    else created += 1;
  }

  return json(errors.length ? 207 : 200, { processed: body.users.length, created, existing, errors });
});
