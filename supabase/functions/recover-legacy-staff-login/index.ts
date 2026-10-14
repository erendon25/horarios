import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const reply = (status: number, recovered = false) => new Response(JSON.stringify({ recovered }), { status, headers });
// Firebase Web SDK public configuration for lc-scheduler; this is not an admin key.
const firebaseKey = "AIzaSyDumwsFqGDE4esA-kB_51yrhTl38DeqDTs";
const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const providerCodes = new Set([
  "INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND", "USER_DISABLED",
  "TOO_MANY_ATTEMPTS_TRY_LATER", "OPERATION_NOT_ALLOWED", "API_KEY_INVALID",
  "INVALID_API_KEY", "PROJECT_NOT_FOUND", "CREDENTIAL_MISMATCH",
]);
const diagnose = (stage: string, approvalId: string | null, providerCode?: string) => {
  // Only operational categories and the private approval reference. Never log
  // request bodies, passwords, email addresses, Firebase responses or tokens.
  console.warn(JSON.stringify({ event: "legacy_staff_login_denied", stage,
    approval_id: approvalId, ...(providerCode ? { provider_code: providerCode } : {}) }));
};

// Custom authentication: prove the approved legacy identity with its actual password.
// No signup by arbitrary email, password resets, emails, or password/token logging.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405);
  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply(400);
    const body = JSON.parse(raw);
    const email = normalizeEmail(body?.email);
    const password = body?.password;
    if (!email || email.length > 254 || typeof password !== "string" || password.length < 6 || password.length > 1024) return reply(400);
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return reply(503);
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const prepared = await service.rpc("prepare_approved_legacy_staff_login", { p_email: email });
    if (prepared.error) return reply(503);
    const approval = prepared.data;
    if (!approval) {
      diagnose("approval_not_ready", null);
      return reply(401);
    }
    const limit = await service.rpc("consume_rate_limit", {
      p_bucket_key: `legacy-staff-login:${approval.approval_id}`,
      p_max_requests: 5,
      p_window_seconds: 900,
    });
    if (limit.error) return reply(503);
    if (!limit.data?.[0]?.allowed) return reply(429);
    const verified = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseKey}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!verified.ok) {
      const failure = await verified.json().catch(() => null);
      const message = typeof failure?.error?.message === "string" ? failure.error.message.split(" : ")[0] : "";
      const code = providerCodes.has(message) ? message : "UPSTREAM_REJECTED";
      diagnose("legacy_password_verification", approval.approval_id, code);
      if (verified.status >= 500 || verified.status === 403
        || ["OPERATION_NOT_ALLOWED", "API_KEY_INVALID", "INVALID_API_KEY", "PROJECT_NOT_FOUND", "CREDENTIAL_MISMATCH"].includes(code)) {
        return reply(503);
      }
      return reply(code === "TOO_MANY_ATTEMPTS_TRY_LATER" ? 429 : 401);
    }
    const legacy = await verified.json();
    if (legacy.localId !== approval.firebase_uid || normalizeEmail(legacy.email) !== email) {
      diagnose("legacy_identity_mismatch", approval.approval_id);
      return reply(401);
    }
    let userId = approval.user_id;
    if (!userId) {
      const created = await service.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { legacy_staff_recovery_id: approval.approval_id, firebase_uid: approval.firebase_uid },
      });
      if (created.error || !created.data?.user?.id) {
        // A concurrent request or ambiguous Auth response may have created it.
        // Resume only our exact server-tagged account; never overwrite a password.
        const retried = await service.rpc("prepare_approved_legacy_staff_login", { p_email: email });
        if (retried.error || !retried.data?.user_id) return reply(503);
        userId = retried.data.user_id;
      } else userId = created.data.user.id;
    }
    const completed = await service.rpc("complete_approved_legacy_staff_login", {
      p_email: email, p_user_id: userId, p_firebase_uid: approval.firebase_uid,
    });
    if (completed.error || completed.data !== true) return reply(503);
    return reply(200, true);
  } catch {
    return reply(503);
  }
});
